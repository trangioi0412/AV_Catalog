/**
 * wixService.js
 * 
 * Module tích hợp và đẩy dữ liệu lên hệ thống Wix Studio hoạt động ở môi trường Server-side.
 * Chứa cơ chế Hàng đợi (Queue), Tự động thử lại (Retry với Exponential Backoff),
 * kiểm soát thời gian ngắt kết nối (Timeout), giới hạn tốc độ (Rate Limit 10 requests/min),
 * và xử lý lỗi qua Hàng đợi lỗi tồn đọng (Dead Letter Queue - DLQ).
 */

// 1. Đọc biến môi trường và Cấu hình chung
const SECRET = process.env.CRON_SECRET;
const BASE_URL = process.env.WIX_FUNCTION_URL;

// Kiểm tra cấu hình môi trường ban đầu
if (!SECRET) {
  console.warn("[WixService] Cảnh báo: Biến môi trường CRON_SECRET chưa được cấu hình.");
}
if (!BASE_URL) {
  console.warn("[WixService] Cảnh báo: Biến môi trường WIX_FUNCTION_URL chưa được cấu hình.");
}

// Trạng thái nội bộ phục vụ hàng đợi và kiểm soát tốc độ
const MAX_QUEUE_SIZE = 1000;
const queue = [];
const deadLetterQueue = [];
const requestTimestamps = [];
let isProcessing = false;

// Hàm sleep helper
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Hàm kiểm tra URL hợp lệ
function isValidUrl(string) {
  try {
    new URL(string);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * 2. Hàm fetchWithRetry
 * Thực thi HTTP request có cơ chế Timeout và Retry Exponential Backoff
 */
async function fetchWithRetry(url, options = {}, retryCount = 0) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // Timeout cứng 10 giây

  // Thiết lập Headers bắt buộc
  const headers = {
    "Content-Type": "application/json",
    ...options.headers
  };
  
  if (SECRET) {
    headers["x-secret"] = SECRET;
  }

  const fetchOptions = {
    ...options,
    headers,
    signal: controller.signal
  };

  try {
    const response = await fetch(url, fetchOptions);
    clearTimeout(timeoutId);

    // Nếu mã phản hồi không nằm trong dải 200-299
    if (!response.ok) {
      const errorText = await response.text().catch(() => "Không thể đọc nội dung phản hồi");
      throw new Error(`HTTP_${response.status}: ${errorText}`);
    }

    return response;
  } catch (error) {
    clearTimeout(timeoutId);

    // Xác định tên lỗi để ghi log (ẩn thông tin nhạy cảm của SECRET)
    const errorMsg = error.name === "AbortError" 
      ? "Yêu cầu bị timeout sau 10000ms" 
      : (error.message || String(error));

    // Thực hiện cơ chế thử lại nếu chưa đạt giới hạn tối đa
    if (retryCount < 3) {
      const nextRetryCount = retryCount + 1;
      const delayMs = Math.pow(2, retryCount) * 1000; // Exponential Backoff: 1s, 2s, 4s

      console.log(`[Retry] Thử lại lần thứ ${nextRetryCount} sau ${delayMs}ms do lỗi: ${errorMsg}`);
      await sleep(delayMs);
      return fetchWithRetry(url, options, nextRetryCount);
    } else {
      // Đã thử lại hết số lần cho phép -> Ghi log lỗi nghiêm trọng và ném lỗi
      const logPayload = options.body ? options.body : "Không có payload body";
      console.error("=================== WIX CRITICAL ERROR ===================");
      console.error(`Thời gian: ${new Date().toISOString()}`);
      console.error(`URL: ${url}`);
      console.error(`Loại lỗi: Đã thử lại tối đa 3 lần thất bại. Lỗi cuối cùng: ${errorMsg}`);
      console.error(`Payload gửi đi: ${logPayload}`);
      console.error("==========================================================");
      throw new Error(`Wix Integration Failed: ${errorMsg}`);
    }
  }
}

/**
 * Cơ chế kiểm soát tốc độ (Rate Limiting - Sliding Window)
 * Đảm bảo tổng số request không vượt quá 10 request/phút
 */
async function enforceRateLimit() {
  const now = Date.now();
  
  // Lọc bỏ các timestamp đã quá 1 phút trước
  while (requestTimestamps.length > 0 && requestTimestamps[0] < now - 60000) {
    requestTimestamps.shift();
  }

  // Nếu số lượng request trong 1 phút qua đã đạt 10, trì hoãn cho đến khi có slot trống
  if (requestTimestamps.length >= 10) {
    const oldestTimestamp = requestTimestamps[0];
    const waitTime = oldestTimestamp + 60000 - now;
    if (waitTime > 0) {
      console.log(`[RateLimit] Đạt giới hạn tốc độ (10 req/phút). Tạm dừng hàng đợi trong ${waitTime}ms...`);
      await sleep(waitTime);
    }
    // Đệ quy gọi lại để cập nhật lại mảng và thời gian hiện tại
    return enforceRateLimit();
  }

  // Ghi nhận thời gian gửi request
  requestTimestamps.push(Date.now());
}

/**
 * 3. Worker xử lý hàng đợi tuần tự (Sequential Queue Worker)
 */
async function startWorker() {
  if (isProcessing) return;
  isProcessing = true;

  console.log(`[QueueWorker] Bắt đầu xử lý hàng đợi. Hiện có ${queue.length} tác vụ.`);

  while (queue.length > 0) {
    const task = queue.shift();
    
    try {
      // 1. Áp dụng Rate Limit 10 requests / 1 phút trước khi gọi API
      await enforceRateLimit();

      console.log(`[QueueWorker] Đang xử lý tác vụ: ${task.type}`);
      let result;

      // 2. Định tuyến xử lý tác vụ dựa trên loại tác vụ (taskType)
      switch (task.type) {
        case "ADD_ITEM":
          result = await sendToCMSInternal(task.data);
          break;
        case "UPLOAD_MEDIA":
          result = await uploadMediaInternal(task.data.fileUrl, task.data.fileName);
          break;
        case "ADD_ITEM_FULL":
          result = await addItemFullInternal(task.data);
          break;
        default:
          throw new Error(`Loại tác vụ không hợp lệ: ${task.type}`);
      }

      // 3. Giải quyết Promise khi tác vụ thành công
      if (task.resolve) task.resolve(result);

    } catch (error) {
      console.error(`[QueueWorker] Tác vụ thất bại sau các lượt thử lại: ${task.type}. Chi tiết lỗi: ${error.message}`);
      
      // 4. Đẩy tác vụ lỗi vào Dead Letter Queue (DLQ)
      deadLetterQueue.push({
        type: task.type,
        data: task.data,
        failedAt: new Date().toISOString(),
        error: error.message
      });

      // 5. Trả lỗi về cho Promise đang đợi
      if (task.reject) task.reject(error);
    }

    // 6. Nghỉ 500ms bắt buộc giữa các yêu cầu
    await sleep(500);
  }

  console.log("[QueueWorker] Đã xử lý xong toàn bộ hàng đợi hiện tại.");
  isProcessing = false;
}

/**
 * Đẩy tác vụ vào hàng đợi để xử lý bất đồng bộ, tuần tự.
 * Trả về một Promise chứa kết quả trả về từ API của Wix sau khi xử lý thành công.
 */
function sendToQueue(taskData, taskType) {
  if (queue.length >= MAX_QUEUE_SIZE) {
    throw new Error(`Hệ thống quá tải: Hàng đợi Wix đã vượt quá dung lượng tối đa ${MAX_QUEUE_SIZE} phần tử.`);
  }

  return new Promise((resolve, reject) => {
    queue.push({
      type: taskType,
      data: taskData,
      resolve,
      reject
    });
    
    // Kích hoạt Worker chạy nền
    startWorker().catch(err => {
      console.error("[QueueWorker] Lỗi thực thi Worker chạy nền:", err);
    });
  });
}

/**
 * 4. Các hàm nghiệp vụ cụ thể (Internal thực hiện gọi API trực tiếp)
 */

async function sendToCMSInternal(data) {
  const { title, description } = data;
  if (!title || !description) {
    throw new Error("Dữ liệu không hợp lệ: Thiếu trường bắt buộc 'title' hoặc 'description'.");
  }

  console.log(`[WixService] Đang gửi bài viết lên CMS: "${title}"`);
  const response = await fetchWithRetry(`${BASE_URL}/addItem`, {
    method: "POST",
    body: JSON.stringify({ title, description })
  });

  const resJson = await response.json();
  return resJson.itemId;
}

async function uploadMediaInternal(fileUrl, fileName) {
  if (!fileUrl || !fileName) {
    throw new Error("Dữ liệu không hợp lệ: Thiếu trường bắt buộc 'fileUrl' hoặc 'fileName'.");
  }
  if (!isValidUrl(fileUrl)) {
    throw new Error(`Dữ liệu không hợp lệ: 'fileUrl' không phải là URL hợp lệ (${fileUrl}).`);
  }

  console.log(`[WixService] Đang đẩy media lên Wix: "${fileName}"`);
  const response = await fetchWithRetry(`${BASE_URL}/uploadMedia`, {
    method: "POST",
    body: JSON.stringify({ fileUrl, fileName })
  });

  const resJson = await response.json();
  return resJson.fileUrl; // Wix internal URL format
}

async function addItemFullInternal(data) {
  const { title, description, imageUrl, imageName } = data;
  if (!title || !description || !imageUrl || !imageName) {
    throw new Error("Dữ liệu không hợp lệ: Thiếu 'title', 'description', 'imageUrl', hoặc 'imageName'.");
  }
  if (!isValidUrl(imageUrl)) {
    throw new Error(`Dữ liệu không hợp lệ: 'imageUrl' không phải là URL hợp lệ (${imageUrl}).`);
  }

  console.log(`[WixService] Đang gửi sản phẩm đầy đủ lên Wix: "${title}"`);
  const response = await fetchWithRetry(`${BASE_URL}/addItemFull`, {
    method: "POST",
    body: JSON.stringify({ title, description, imageUrl, imageName })
  });

  const resJson = await response.json();
  return {
    itemId: resJson.itemId,
    fileUrl: resJson.fileUrl
  };
}

/**
 * Các hàm API Public cho module bên ngoài sử dụng
 */

function sendToCMS(data) {
  // Validate đồng bộ ngay lập tức trước khi xếp hàng đợi
  if (!data || !data.title || !data.description) {
    return Promise.reject(new Error("Dữ liệu không hợp lệ: Thiếu trường bắt buộc 'title' hoặc 'description'."));
  }
  return sendToQueue(data, "ADD_ITEM");
}

function uploadMedia(fileUrl, fileName) {
  if (!fileUrl || !fileName) {
    return Promise.reject(new Error("Dữ liệu không hợp lệ: Thiếu 'fileUrl' hoặc 'fileName'."));
  }
  if (!isValidUrl(fileUrl)) {
    return Promise.reject(new Error(`Dữ liệu không hợp lệ: 'fileUrl' không phải là URL hợp lệ (${fileUrl}).`));
  }
  return sendToQueue({ fileUrl, fileName }, "UPLOAD_MEDIA");
}

function addItemFull(data) {
  if (!data || !data.title || !data.description || !data.imageUrl || !data.imageName) {
    return Promise.reject(new Error("Dữ liệu không hợp lệ: Thiếu 'title', 'description', 'imageUrl' hoặc 'imageName'."));
  }
  if (!isValidUrl(data.imageUrl)) {
    return Promise.reject(new Error(`Dữ liệu không hợp lệ: 'imageUrl' không phải là URL hợp lệ (${data.imageUrl}).`));
  }
  return sendToQueue(data, "ADD_ITEM_FULL");
}

/**
 * 5. Hàm vận hành Dead Letter Queue (DLQ)
 * Hàm được thiết kế để kích hoạt từ một Cron Job chạy định kỳ mỗi giờ để quét và xử lý lại các tệp tin lỗi.
 */
async function processDeadLetterQueue() {
  if (deadLetterQueue.length === 0) {
    console.log("[WixService] Không có tác vụ lỗi nào trong Dead Letter Queue.");
    return { processedCount: 0, reQueuedCount: 0 };
  }

  console.log(`[WixService] Phát hiện ${deadLetterQueue.length} tác vụ lỗi trong DLQ. Tiến hành đẩy lại vào hàng đợi hoạt động...`);
  
  let reQueuedCount = 0;
  const originalDlqLength = deadLetterQueue.length;

  for (let i = 0; i < originalDlqLength; i++) {
    const failedTask = deadLetterQueue.shift(); // Lấy từ đầu hàng
    try {
      // Đẩy lại vào hàng đợi hoạt động qua sendToQueue
      sendToQueue(failedTask.data, failedTask.type).catch(err => {
        // Chúng ta catch ở đây vì Promise này chạy background trong worker
        console.warn(`[WixService] Tác vụ DLQ đẩy lại gặp lỗi xử lý: ${failedTask.type}`, err.message);
      });
      reQueuedCount++;
    } catch (err) {
      // Nếu hàng đợi bị quá tải, đẩy ngược lại vào DLQ để không mất dữ liệu
      deadLetterQueue.push(failedTask);
      console.error(`[WixService] Không thể đẩy lại tác vụ từ DLQ do hàng đợi đầy:`, err.message);
    }
  }

  console.log(`[WixService] Đã xử lý lại DLQ: Quét ${originalDlqLength} tác vụ, tái xếp hàng thành công ${reQueuedCount} tác vụ.`);
  return {
    processedCount: originalDlqLength,
    reQueuedCount
  };
}

// Hàm lấy thông tin kích thước và trạng thái hiện tại (tiện ích cho debug và giám sát)
function getServiceStatus() {
  return {
    queueLength: queue.length,
    dlqLength: deadLetterQueue.length,
    isProcessing,
    activeRpm: requestTimestamps.length
  };
}

// Export module phục vụ Server-side
module.exports = {
  sendToCMS,
  uploadMedia,
  addItemFull,
  processDeadLetterQueue,
  getServiceStatus,
  // Xuất bản thêm DLQ nội bộ phục vụ kiểm thử
  _deadLetterQueue: deadLetterQueue,
  _queue: queue
};