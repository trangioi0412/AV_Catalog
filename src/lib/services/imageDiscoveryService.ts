import { GoogleGenAI } from "@google/genai";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getActiveBrands, getAllProducts, uploadToWixMedia, updateProductImages, isValidProductImageFormat } from "./wixCms";
import { logImageDiscovery, ImageDiscoveryLogEntry } from "./imageDiscoveryLogger";
import { getSystemConfig } from "./googleSheets";
import { discoverProductInfo } from "./productDiscovery";

export let activeImageDiscoveryLogs: string[] = [];
export let isImageDiscoveryInProgress = false;

const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

export function hookConsole() {
  console.log = (...args: any[]) => {
    originalConsoleLog(...args);
    const msg = args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
    const time = new Date().toLocaleTimeString();
    if (msg.startsWith("[IMAGE-DISCOVERY]")) {
      activeImageDiscoveryLogs.push(msg);
    } else {
      activeImageDiscoveryLogs.push(`[LOG] [${time}] ${msg}`);
    }
    if (activeImageDiscoveryLogs.length > 1000) activeImageDiscoveryLogs.shift();
  };

  console.warn = (...args: any[]) => {
    originalConsoleWarn(...args);
    const msg = args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
    const time = new Date().toLocaleTimeString();
    activeImageDiscoveryLogs.push(`[WARN] [${time}] ${msg}`);
    if (activeImageDiscoveryLogs.length > 1000) activeImageDiscoveryLogs.shift();
  };

  console.error = (...args: any[]) => {
    originalConsoleError(...args);
    const msg = args.map(a => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
    const time = new Date().toLocaleTimeString();
    activeImageDiscoveryLogs.push(`[ERROR] [${time}] ${msg}`);
    if (activeImageDiscoveryLogs.length > 1000) activeImageDiscoveryLogs.shift();
  };
}

export function restoreConsole() {
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
}

export function logToConsole(message: string) {
  const time = new Date().toLocaleTimeString();
  const logLine = `[IMAGE-DISCOVERY] [${time}] ${message}`;
  
  if (console.log === originalConsoleLog) {
    activeImageDiscoveryLogs.push(logLine);
    if (activeImageDiscoveryLogs.length > 1000) {
      activeImageDiscoveryLogs.shift();
    }
  }
  originalConsoleLog(logLine);
}

export function resetImageDiscoveryStatus() {
  isImageDiscoveryInProgress = false;
  logToConsole("Tiến trình đã được đặt lại (reset) thủ công bởi Admin.");
}

export interface DiscoveryResult {
  success?: boolean;
  productName: string;
  brand: string;
  searchQuery: string;
  productUrl: string;
  imageUrl: string;
  status: ImageDiscoveryLogEntry["status"];
  source?: string;
  reason?: string;
}

export async function discoverAndSyncProductImage(
  productId: string,
  productName: string,
  brandName: string,
  collectionId = "Import1"
): Promise<DiscoveryResult> {
  const result: DiscoveryResult = {
    success: false,
    productName,
    brand: brandName,
    searchQuery: "",
    productUrl: "",
    imageUrl: "",
    status: "PRODUCT_PAGE_NOT_FOUND"
  };

  logToConsole(`Bắt đầu xử lý ảnh cho sản phẩm: ${productName} (Hãng: ${brandName})`);

  if (!brandName || brandName.trim() === "" || brandName.toLowerCase() === "unknown") {
    result.status = "MISSING_BRAND";
    result.reason = "Thương hiệu trống hoặc không hợp lệ.";
    return result;
  }

  try {
    logToConsole(`Đang gọi bộ tìm kiếm hợp nhất (discoverProductInfo)...`);
    const discovery = await discoverProductInfo(productName, brandName, 1000);

    result.productUrl = discovery.productUrl;
    result.imageUrl = discovery.imageUrl;
    result.success = discovery.success;
    
    if (discovery.success && discovery.imageUrl) {
      const decodedUrl = decodeURIComponent(discovery.imageUrl);
      const localPath = path.join(process.cwd(), "public", decodedUrl);
      
      if (fs.existsSync(localPath)) {
        logToConsole(`Đọc file ảnh cục bộ: ${localPath}`);
        const buffer = fs.readFileSync(localPath);
        const ext = path.extname(localPath).toLowerCase();
        const mimeMap: Record<string, string> = {
          ".png": "image/png",
          ".webp": "image/webp",
          ".gif": "image/gif",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".avif": "image/avif",
        };
        const mimeType = mimeMap[ext] || "image/jpeg";
        const fileName = path.basename(localPath);
        
        logToConsole(`Đang upload ảnh lên Wix Media Manager...`);
        const wixMedia = await uploadToWixMedia(buffer, fileName, mimeType);
        logToConsole(`Upload Wix Media thành công: ${wixMedia.wixUrl}`);
        
        logToConsole(`Đang cập nhật ảnh vào Wix CMS cho sản phẩm ID ${productId}...`);
        const patchRes = await updateProductImages(productId, collectionId, wixMedia.wixUrl, []);
        if (patchRes.success) {
          logToConsole(`Cập nhật Wix CMS thành công.`);
          result.imageUrl = wixMedia.wixUrl;
          result.status = "SUCCESS";
          result.success = true;
        } else {
          logToConsole(`Cập nhật Wix CMS thất bại: ${patchRes.error}`);
          result.status = "UPLOAD_FAILED";
          result.reason = patchRes.error;
        }
      } else {
        logToConsole(`Không tìm thấy file cục bộ tại: ${localPath}`);
        result.status = "IMAGE_NOT_FOUND";
        result.reason = "Không tìm thấy tệp ảnh cục bộ sau khi tải xuống.";
      }
    } else {
      // Map failure statuses
      if (discovery.status === "MISSING_BRAND") {
        result.status = "MISSING_BRAND";
      } else if (discovery.status === "IMAGE_NOT_FOUND") {
        result.status = "IMAGE_NOT_FOUND";
      } else if (discovery.status === "SEARCH_PROVIDER_TIMEOUT") {
        result.status = "SEARCH_PROVIDER_TIMEOUT";
      } else if (discovery.status === "RATE_LIMITED") {
        result.status = "RATE_LIMITED";
      } else if (discovery.status === "SEARCH_PROVIDER_ERROR") {
        result.status = "SEARCH_PROVIDER_ERROR";
      } else {
        result.status = "PRODUCT_PAGE_NOT_FOUND";
      }
      result.reason = discovery.reason || "Không tìm thấy trang sản phẩm hoặc hình ảnh.";
      logToConsole(`Bộ tìm kiếm thất bại: ${result.reason}`);
    }

    result.source = discovery.source;
    await logImageDiscovery(result);
    return result;
  } catch (err: any) {
    logToConsole(`Lỗi hệ thống: ${err.message || err}`);
    result.status = "UPLOAD_FAILED";
    result.reason = err.message || String(err);
    await logImageDiscovery(result);
    return result;
  }
}

function resolveBrandName(brandField: any, brandMap: Map<string, string>): string {
  if (!brandField) return "Unknown";
  
  if (typeof brandField === "object") {
    const name = brandField.name || brandField.Name || brandField.title || brandField.Title;
    if (name) return String(name).trim();
    const id = brandField._id || brandField.id;
    if (id && brandMap.has(id)) return brandMap.get(id)!;
  }
  
  if (typeof brandField === "string") {
    const trimmed = brandField.trim();
    const lowerTrimmed = trimmed.toLowerCase();
    
    // 1. Direct lookup in brandMap by ID
    if (brandMap.has(brandField)) {
      return brandMap.get(brandField)!;
    }
    
    // 2. Case-insensitive lookup by ID
    for (const [id, name] of brandMap.entries()) {
      if (id.toLowerCase().trim() === lowerTrimmed) {
        return name;
      }
    }
    
    // 3. Case-insensitive lookup by brand name (e.g. "extron" -> "Extron")
    for (const name of brandMap.values()) {
      if (name.toLowerCase().trim() === lowerTrimmed) {
        return name; // Return the correct standard brand name
      }
    }
    
    return trimmed;
  }
  
  return "Unknown";
}

export async function processMissingImages(options?: {
  productIds?: string[];
  collectionId?: string;
  concurrencyLimit?: number;
}): Promise<{
  totalProcessed: number;
  successCount: number;
  failedCount: number;
  outcomes: DiscoveryResult[];
}> {
  const collectionId = options?.collectionId ?? "Import1";
  const concurrencyLimit = Math.min(options?.concurrencyLimit ?? 2, 3);

  const config = await getSystemConfig();
  if (config.ImageSearchEnabled === "false") {
    throw new Error("Image Discovery and searching feature is currently disabled in System Config.");
  }

  activeImageDiscoveryLogs.length = 0;
  isImageDiscoveryInProgress = true;
  hookConsole();
  logToConsole("Khởi động tiến trình tìm kiếm hình ảnh AI tự động...");

  try {
    const brands = await getActiveBrands();
    const brandMap = new Map(brands.map((b) => [b._id, b.name]));

    const allProducts = await getAllProducts();
    let candidates = allProducts;

    if (options?.productIds && options.productIds.length > 0) {
      const idSet = new Set(options.productIds);
      candidates = candidates.filter((p) => p._id && idSet.has(p._id));
      logToConsole(`Được chỉ định ${candidates.length} sản phẩm để quét hình ảnh.`);
    } else {
      candidates = candidates.filter((p) => !isValidProductImageFormat(p.image));
      logToConsole(`Phát hiện ${candidates.length} sản phẩm chưa có ảnh trong Wix CMS.`);
    }

    if (candidates.length === 0) {
      logToConsole("Không tìm thấy sản phẩm nào chưa có ảnh cần xử lý.");
    }

    const outcomes: DiscoveryResult[] = [];
    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < candidates.length; i += concurrencyLimit) {
      if (!isImageDiscoveryInProgress) {
        logToConsole("Dừng tiến trình tìm kiếm hình ảnh AI do yêu cầu từ Admin.");
        break;
      }
      const chunk = candidates.slice(i, i + concurrencyLimit);
      logToConsole(`Đang xử lý nhóm ${Math.floor(i / concurrencyLimit) + 1}/${Math.ceil(candidates.length / concurrencyLimit)} (${chunk.length} sản phẩm)...`);
      
      const promises = chunk.map(async (prod) => {
        if (!isImageDiscoveryInProgress) return;
        const id = prod._id;
        const productName = prod.Product || prod.Title || "Unknown Product";
        const brandName = resolveBrandName(prod.Brand, brandMap);

        if (!id) return;

        const outcome = await discoverAndSyncProductImage(id, productName, brandName, collectionId);
        outcomes.push(outcome);

        if (outcome.status === "SUCCESS") {
          successCount++;
        } else {
          failedCount++;
        }

        await new Promise((resolve) => setTimeout(resolve, 3000));
      });

      await Promise.all(promises);
    }

    logToConsole(`Hoàn thành quét! Đã tìm kiếm xong ${candidates.length} sản phẩm. Thành công: ${successCount}, Thất bại: ${failedCount}`);

    return {
      totalProcessed: candidates.length,
      successCount,
      failedCount,
      outcomes
    };
  } catch (err: any) {
    logToConsole(`[ERROR] Có lỗi xảy ra trong quá trình xử lý: ${err.message || String(err)}`);
    throw err;
  } finally {
    isImageDiscoveryInProgress = false;
    logToConsole("Hệ thống hoàn tất tiến trình tìm kiếm hình ảnh AI tự động.");
    restoreConsole();
  }
}
