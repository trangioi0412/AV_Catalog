/**
 * catalogAiReview.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * AI-assisted data-quality review for products just uploaded via the Catalog
 * Upload tool (see fileUtils.ts / useDataStore.ts / page.tsx). Regex-based
 * validation (specsTranslator.ts, "CẦN VERIFY" scan) already catches malformed
 * specs and leftover reviewer markers; this catches what regex can't:
 *   - Category that doesn't match the product's actual type.
 *   - Technical Specifications that are empty, near-empty, garbled, or
 *     obviously duplicated/copy-pasted from an unrelated product.
 *   - Product/model names that are missing, truncated, or contain junk
 *     characters left over from the source PDF/Excel extraction.
 *   - Placeholder content ("N/A", "TBD", "???", empty required fields) in
 *     fields that should carry real data.
 *
 * Runs against a local/self-hosted Ollama server (same OLLAMA_BASE_URL as
 * translationProvider.ts) using a separate model — CATALOG_AI_REVIEW_MODEL,
 * default "qwen3.5:9b" — since the translation feature's OLLAMA_MODEL is
 * pinned to a translation-only fine-tune (see translationProvider.ts) and
 * this is a general instruction-following review task instead.
 *
 * Server-only: never import this from a Client Component.
 */

import { stripCodeFence } from "./translationProvider";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL;
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
const CATALOG_AI_REVIEW_MODEL = process.env.CATALOG_AI_REVIEW_MODEL || "qwen3.5:9b";
// Local/self-hosted inference on modest hardware has measured well over a
// minute for a single moderately-sized generation (see OLLAMA_TIMEOUT_MS in
// translationProvider.ts) — a batch of several products' worth of fields is
// a larger prompt than that, so this needs real headroom, not a short default.
const CATALOG_AI_REVIEW_TIMEOUT_MS = Number(process.env.CATALOG_AI_REVIEW_TIMEOUT_MS) || 300000;
// Kept small so a modest local model has a realistic chance of reasoning about
// every item in the batch and returning complete, well-formed JSON instead of
// running out of its output budget partway through (see done_reason "length"
// handling below).
export const CATALOG_AI_REVIEW_BATCH_SIZE = Number(process.env.CATALOG_AI_REVIEW_BATCH_SIZE) || 10;
// Ollama loads a model with a conservative 4096-token context window by
// default regardless of what the model actually supports (qwen3.5:9b's real
// limit is 262144) — verified via /api/ps on this machine. A batch of several
// products' worth of Vietnamese specs (which tokenize less efficiently than
// ASCII) can plausibly exceed 4096 combined prompt+output tokens, silently
// corrupting the JSON response. Force a much larger window explicitly.
const CATALOG_AI_REVIEW_NUM_CTX = Number(process.env.CATALOG_AI_REVIEW_NUM_CTX) || 16384;

export interface CatalogReviewItem {
  id: string;
  /** Trimmed, human-readable fields only — never the full raw row (keeps the prompt small). */
  fields: Record<string, string>;
}

/**
 * Fixed taxonomy the model is constrained to (via each request's dynamically
 * built response schema — see getReviewResponseSchema) — lets the review
 * dashboard show a real breakdown by problem type instead of trying to
 * bucket free-text Vietnamese with regex.
 */
export const CATALOG_REVIEW_CATEGORIES = [
  "category_mismatch",
  "series_mismatch",
  "missing_specs",
  "invalid_name",
  "placeholder_data",
  "duplicate_content",
  "mixed_language",
  "other",
] as const;

export type CatalogReviewCategory = (typeof CATALOG_REVIEW_CATEGORIES)[number];

/**
 * Fields a reviewer can choose to have AI check (see page.tsx's "Kiểm tra
 * AI" field-picker dialog — the admin picks a subset before running the
 * review, defaulting to Category + Series). Every field is still given to
 * the model as CONTEXT regardless of selection — judging Category
 * correctly, for instance, requires reading Main Feature/Product Overview
 * even when those two aren't themselves selected for checking.
 */
export const AI_REVIEW_TARGET_FIELDS = ["Category", "Series", "Title", "MainFeature", "ProductOverview", "TechnicalSpecifications"] as const;

export type AiReviewTargetField = (typeof AI_REVIEW_TARGET_FIELDS)[number];

/** Which finding categories are in-scope when a given field is selected for checking. */
const FIELD_CATEGORY_MAP: Record<AiReviewTargetField, CatalogReviewCategory[]> = {
  Category: ["category_mismatch"],
  Series: ["series_mismatch"],
  Title: ["invalid_name"],
  MainFeature: ["duplicate_content", "placeholder_data", "mixed_language"],
  ProductOverview: ["duplicate_content", "placeholder_data", "mixed_language"],
  TechnicalSpecifications: ["missing_specs", "duplicate_content"],
};

/** Prompt instructions per selected field — only the ones for the fields the reviewer picked get included, so the model isn't asked to also hunt for problems nobody asked about this run. */
const FIELD_DESCRIPTIONS: Record<AiReviewTargetField, string> = {
  Category: `- "category_mismatch": Category không khớp với loại sản phẩm thực tế. QUAN TRỌNG: so sánh Category không chỉ với tên sản phẩm (Product/Title), mà PHẢI đối chiếu cả với nội dung Main Feature và Product Overview — nếu Main Feature/Product Overview mô tả rõ chức năng của một loại thiết bị khác với Category đã ghi (ví dụ Category ghi "Loa" nhưng Main Feature/Product Overview mô tả rõ đây là bộ xử lý tín hiệu DSP hoặc micro), đây LÀ category_mismatch dù tên sản phẩm không rõ ràng.
  ĐẶC BIỆT LƯU Ý VỚI PHỤ KIỆN/THIẾT BỊ MỞ RỘNG (mic mở rộng, remote, dây cáp, chân đế, adapter, module mở rộng...): phải phân loại theo BẢN CHẤT CHỨC NĂNG của CHÍNH sản phẩm đó, KHÔNG PHẢI theo loại sản phẩm CHÍNH mà nó đi kèm/mở rộng. Ví dụ: một microphone mở rộng (extension mic) được thiết kế để dùng kèm một video bar/camera thì BẢN THÂN nó VẪN LÀ thiết bị âm thanh (microphone) — phải thuộc Category về Audio/Microphone, TUYỆT ĐỐI KHÔNG được xếp vào Category về Camera/Video Capture chỉ vì nó tương thích hoặc bán kèm với một camera/video bar. Luôn hỏi "bản thân thiết bị NÀY thu/xử lý/truyền tín hiệu gì (âm thanh, hình ảnh, điều khiển...)" chứ không phải "nó đi kèm với sản phẩm loại gì".
  TUYỆT ĐỐI KHÔNG suy ra Category của một sản phẩm dựa trên việc HÃNG đó thường được biết đến với loại sản phẩm gì (ví dụ: một hãng nổi tiếng về DSP/âm thanh hội nghị KHÔNG có nghĩa mọi sản phẩm của hãng đó đều là thiết bị âm thanh) — chỉ được kết luận Category dựa trên chức năng CỤ THỂ của CHÍNH sản phẩm đang xét (đọc kỹ Title/Main Feature/Product Overview của đúng sản phẩm đó).
  ĐẶC BIỆT LƯU Ý VỚI BẢNG/MÀN HÌNH ĐIỀU KHIỂN CẢM ỨNG (touch panel, control panel, room scheduling panel, bộ điều khiển phòng họp...): đây là thiết bị ĐIỀU KHIỂN/GIAO DIỆN NGƯỜI DÙNG, KHÔNG PHẢI thiết bị âm thanh — dù mô tả sản phẩm có nhắc đến các nút điều khiển liên quan đến âm thanh (mute mic, điều chỉnh âm lượng, định tuyến audio...), bản thân màn hình/bảng điều khiển đó KHÔNG thu/phát/xử lý tín hiệu âm thanh nên KHÔNG được xếp vào Category về Microphone/Audio Input — phải xếp vào Category về Control/Touch Panel hoặc tương đương.`,
  Series: `- "series_mismatch": Series (dòng sản phẩm) không hợp lý hoặc không khớp với Model/Title/Category/Brand — ví dụ Series ghi tên của một dòng sản phẩm hoàn toàn khác, rõ ràng bị dán nhầm từ sản phẩm khác, hoặc không thuộc hãng/dòng sản phẩm mà Brand/Product/Title thể hiện. KHÔNG báo cáo chỉ vì Series đang trống — trống không đủ căn cứ để so sánh, không phải lỗi sai lệch nội dung.`,
  Title: `- "invalid_name": Tên sản phẩm/Model (Title/Product) bị thiếu, chứa ký tự rác/lỗi encoding, hoặc bị cắt cụt bất thường.`,
  MainFeature: `- "placeholder_data", "duplicate_content", "mixed_language" áp dụng cho Main Feature: còn sót placeholder ("N/A", "TBD", "CẦN VERIFY"...), nội dung rõ ràng dán nhầm/trùng lặp từ sản phẩm khác, hoặc lẫn lộn cả tiếng Anh và tiếng Việt không nhất quán trong Main Feature.`,
  ProductOverview: `- "placeholder_data", "duplicate_content", "mixed_language" áp dụng cho Product Overview: còn sót placeholder, nội dung rõ ràng dán nhầm/trùng lặp từ sản phẩm khác, hoặc lẫn lộn cả tiếng Anh và tiếng Việt không nhất quán trong Product Overview.`,
  TechnicalSpecifications: `- "missing_specs": Technical Specifications trống, quá sơ sài (chỉ 1-2 thông số cho một thiết bị phức tạp), hoặc lặp lại thông số giống hệt nhau. "duplicate_content" áp dụng cho Technical Specifications khi nội dung rõ ràng bị dán nhầm từ sản phẩm khác không liên quan.`,
};

const MIXED_LANGUAGE_NOTE = `Với "mixed_language": KHÔNG tính là lỗi nếu chỉ là tên riêng, tên hãng, mã model, hoặc thuật ngữ kỹ thuật/viết tắt tiếng Anh phổ biến (HDMI, USB, WiFi, DSP...) xuất hiện trong câu tiếng Việt bình thường — đó là cách hành văn tự nhiên, không phải lỗi.`;

/** Every category reachable from a set of target fields — what the model's response schema gets constrained to for this request. */
function allowedCategoriesForFields(targetFields: readonly AiReviewTargetField[]): CatalogReviewCategory[] {
  const set = new Set<CatalogReviewCategory>();
  targetFields.forEach((f) => FIELD_CATEGORY_MAP[f].forEach((c) => set.add(c)));
  return Array.from(set);
}

// A bare `format: "json"` only forces *some* valid JSON — it does not pin down
// the top-level type. Verified live against qwen3.5:9b: with just "json", a
// batch with several flagged products came back as a single flat
// `{"id":...,"findings":[...]}`, silently dropping every other finding.
// Passing this schema instead forces genuine array output — same batch then
// returned all flagged items correctly, each with an accurate category.
// The category `enum` is built PER REQUEST from the reviewer's selected
// fields — Ollama's grammar-constrained decoding then makes it structurally
// impossible for the model to emit a category outside what was asked for,
// which is a stronger guarantee than a prompt instruction alone.
function getReviewResponseSchema(allowedCategories: CatalogReviewCategory[]) {
  return {
    type: "array",
    items: {
      type: "object",
      properties: {
        id: { type: "string" },
        findings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              category: { type: "string", enum: allowedCategories },
              message: { type: "string" },
            },
            required: ["category", "message"],
          },
        },
      },
      required: ["id", "findings"],
    },
  };
}

export interface CatalogReviewFinding {
  category: CatalogReviewCategory;
  message: string;
}

export interface CatalogReviewIssue {
  id: string;
  findings: CatalogReviewFinding[];
}

export type CatalogAiReviewErrorCode = "NOT_CONFIGURED" | "TIMEOUT" | "UPSTREAM_ERROR" | "INVALID_RESPONSE";

export class CatalogAiReviewError extends Error {
  readonly code: CatalogAiReviewErrorCode;
  constructor(message: string, code: CatalogAiReviewErrorCode) {
    super(message);
    this.name = "CatalogAiReviewError";
    this.code = code;
  }
}

/** Whether the Ollama server this feature depends on is configured. */
export function isCatalogAiReviewConfigured(): boolean {
  return Boolean(OLLAMA_BASE_URL);
}

/** The model this feature would use right now (env override or the qwen3.5:9b default). */
export function getCatalogAiReviewModel(): string {
  return CATALOG_AI_REVIEW_MODEL;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new CatalogAiReviewError("AI review request timed out.", "TIMEOUT")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutHandle!);
  }
}

function buildReviewPrompt(items: CatalogReviewItem[], targetFields: readonly AiReviewTargetField[]): string {
  const descriptions = targetFields.map((f) => FIELD_DESCRIPTIONS[f]).join("\n");
  const needsMixedLanguageNote = targetFields.includes("MainFeature") || targetFields.includes("ProductOverview");

  return `Bạn là chuyên gia kiểm duyệt chất lượng dữ liệu catalog sản phẩm Audio Visual (AV) chuyên nghiệp (âm thanh, hội nghị truyền hình, trình chiếu, điều khiển tích hợp).

Nhiệm vụ: kiểm tra danh sách sản phẩm dưới đây (mỗi sản phẩm có "id" và các trường dữ liệu). Người dùng CHỈ yêu cầu kiểm tra các khía cạnh sau — KHÔNG báo cáo bất kỳ vấn đề nào khác dù có nhận thấy, dù đó là vấn đề ở một trường không nằm trong phạm vi được yêu cầu:
${descriptions}
${needsMixedLanguageNote ? `\n${MIXED_LANGUAGE_NOTE}\n` : ""}
QUAN TRỌNG: dù chỉ báo cáo các khía cạnh trên, bạn vẫn phải đọc và đối chiếu ĐẦY ĐỦ mọi trường dữ liệu của sản phẩm (Category, Product, Title, Series, Main Feature, Product Overview, Technical Specifications...) làm CĂN CỨ đánh giá — ví dụ để biết Category đúng hay sai, PHẢI đối chiếu với nội dung thực tế ở Main Feature/Product Overview, kể cả khi hai trường đó không nằm trong phạm vi được yêu cầu báo cáo riêng lần này.

QUAN TRỌNG — MỖI SẢN PHẨM PHẢI ĐƯỢC ĐÁNH GIÁ ĐỘC LẬP: danh sách dưới đây có thể chứa nhiều sản phẩm khác loại nhau trong cùng một lượt kiểm tra. TUYỆT ĐỐI KHÔNG để dữ liệu/Category/đặc điểm của một sản phẩm ảnh hưởng đến kết luận về một sản phẩm KHÁC có "id" khác — mọi nhận định về một "id" phải dựa CHỈ trên đúng các trường dữ liệu của chính "id" đó. Đặc biệt: nếu Category của một sản phẩm thuộc một NHÓM CHỨC NĂNG hoàn toàn khác với nội dung Main Feature/Product Overview của CHÍNH sản phẩm đó (ví dụ: thiết bị THU tín hiệu như micro/camera bị ghi Category là thiết bị PHÁT/khuếch đại như loa/amply/power amplifier, hoặc ngược lại; hoặc bất kỳ hai nhóm thiết bị không liên quan nào khác), đây LUÔN LÀ category_mismatch RÕ RÀNG với độ tin cậy cao — phải báo cáo, không được bỏ sót chỉ vì đang bận đánh giá nhiều sản phẩm khác trong cùng batch.

Mỗi vấn đề phát hiện được PHẢI gán đúng một trong các loại (category) đã liệt kê ở trên — KHÔNG dùng loại nào khác ngoài danh sách đó.

KHÔNG báo cáo những điều chỉ là thiếu sót nhỏ, không chắc chắn, hoặc là cách hành văn bình thường. CHỈ liệt kê sản phẩm CÓ vấn đề rõ ràng — bỏ qua hoàn toàn sản phẩm hợp lệ. Nhưng một Category thuộc nhóm chức năng hoàn toàn khác với mô tả thực tế của sản phẩm KHÔNG BAO GIỜ được coi là "thiếu sót nhỏ" — luôn phải báo cáo.

Trả lời DUY NHẤT một JSON array, không kèm giải thích, không dùng markdown code fence, đúng định dạng:
[{"id": "<id sản phẩm>", "findings": [{"category": "<một trong các loại ở trên>", "message": "<mô tả ngắn gọn vấn đề>"}]}, ...]
QUAN TRỌNG: câu trả lời PHẢI bắt đầu bằng ký tự "[" và kết thúc bằng "]" — một mảng JSON ở cấp cao nhất.
TUYỆT ĐỐI KHÔNG bọc mảng đó bên trong một object (ví dụ KHÔNG trả về {"products": [...]} hay {"results": [...]}).
Nếu tất cả sản phẩm trong danh sách đều ổn, trả về đúng mảng rỗng: []

Danh sách sản phẩm cần kiểm tra (JSON):
${JSON.stringify(items, null, 2)}`;
}

/**
 * `format: "json"` only forces syntactically valid JSON — the model still
 * picks its own top-level shape, and smaller/local models frequently wrap
 * the requested array in an object (e.g. `{"products": [...]}`), return `{}`
 * instead of `[]` when nothing is flagged, or return a single finding object
 * unwrapped when only one item in the batch has issues. This normalizes all
 * of those into a plain array, or returns null if the shape is unrecognizable.
 */
function extractIssueArray(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return null;

  const obj = parsed as Record<string, unknown>;
  if (Object.keys(obj).length === 0) return [];
  if (typeof obj.id === "string" && Array.isArray(obj.findings)) return [obj];

  const wrapperKey = Object.keys(obj).find((k) => Array.isArray(obj[k]));
  return wrapperKey ? (obj[wrapperKey] as unknown[]) : null;
}

function normalizeCategory(value: unknown, allowedCategories: CatalogReviewCategory[]): CatalogReviewCategory {
  if (allowedCategories.includes(value as CatalogReviewCategory)) return value as CatalogReviewCategory;
  // Falls back to whichever allowed category comes first rather than a
  // hardcoded "other" — "other" isn't necessarily in scope for this
  // request's selected fields, and the schema enum should already prevent
  // this path in practice (kept only as a defensive fallback).
  return allowedCategories[0];
}

/** Single Ollama call for one batch — no retry logic. See reviewCatalogBatch for that. */
async function reviewCatalogBatchOnce(items: CatalogReviewItem[], targetFields: readonly AiReviewTargetField[], model?: string): Promise<CatalogReviewIssue[]> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (OLLAMA_API_KEY) headers.Authorization = `Bearer ${OLLAMA_API_KEY}`;
  const allowedCategories = allowedCategoriesForFields(targetFields);

  let response: Response;
  try {
    response = await withTimeout(
      fetch(`${OLLAMA_BASE_URL!.replace(/\/+$/, "")}/api/generate`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: model || CATALOG_AI_REVIEW_MODEL,
          prompt: buildReviewPrompt(items, targetFields),
          stream: false,
          // Skip hybrid-reasoning chain-of-thought (e.g. Qwen3) — on a batch-sized
          // prompt like this, thinking alone can consume the whole output budget
          // and leave the actual JSON answer empty. No-op for non-hybrid models.
          think: false,
          format: getReviewResponseSchema(allowedCategories),
          options: { temperature: 0.1, num_ctx: CATALOG_AI_REVIEW_NUM_CTX },
        }),
      }),
      CATALOG_AI_REVIEW_TIMEOUT_MS
    );
  } catch (err) {
    if (err instanceof CatalogAiReviewError) throw err;
    throw new CatalogAiReviewError(
      `AI review request failed: ${err instanceof Error ? err.message : String(err)}`,
      "UPSTREAM_ERROR"
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new CatalogAiReviewError(`AI review request failed: ${response.status} ${text}`, "UPSTREAM_ERROR");
  }

  const json = (await response.json()) as { response?: string; done_reason?: string };
  if (!json.response) {
    const reason = json.done_reason === "length" ? " (model ran out of output tokens — try a smaller batch size)" : "";
    throw new CatalogAiReviewError(`AI review returned an empty response.${reason}`, "INVALID_RESPONSE");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(json.response));
  } catch {
    console.error(
      `[catalogAiReview] Invalid JSON from model for a ${items.length}-item batch (done_reason: ${json.done_reason}). Raw response (first 2000 chars):`,
      json.response.slice(0, 2000)
    );
    throw new CatalogAiReviewError(
      `AI review returned invalid JSON${json.done_reason === "length" ? " (model ran out of output tokens mid-answer)" : ""}.`,
      "INVALID_RESPONSE"
    );
  }

  const entries = extractIssueArray(parsed);
  if (entries === null) {
    throw new CatalogAiReviewError("AI review response was not a JSON array.", "INVALID_RESPONSE");
  }

  const validIds = new Set(items.map((i) => i.id));
  const results: CatalogReviewIssue[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const id = (entry as Record<string, unknown>).id;
    const findingsRaw = (entry as Record<string, unknown>).findings;
    if (typeof id !== "string" || !validIds.has(id) || !Array.isArray(findingsRaw)) continue;

    const findings: CatalogReviewFinding[] = [];
    for (const f of findingsRaw) {
      if (!f || typeof f !== "object") continue;
      const message = (f as Record<string, unknown>).message;
      if (typeof message !== "string" || message.trim() === "") continue;
      findings.push({ category: normalizeCategory((f as Record<string, unknown>).category, allowedCategories), message });
    }
    if (findings.length > 0) results.push({ id, findings });
  }
  return results;
}

/**
 * Reviews ONE batch of products against the configured Ollama model. Callers
 * (the /api/catalog-upload/ai-review route) are expected to chunk the full
 * product list into batches of CATALOG_AI_REVIEW_BATCH_SIZE themselves, so a
 * failed batch doesn't lose progress already made on the rest of the catalog.
 *
 * If the batch as a whole comes back malformed or times out, retries ONCE by
 * splitting it into two halves run sequentially (not concurrently — a local
 * Ollama server serves one generation at a time, same reasoning as
 * getSafeConcurrency() in translationProvider.ts) rather than recursing
 * further, so one bad batch costs at most 3 Ollama calls instead of an
 * open-ended cascade. Whichever half still succeeds is kept even if the other
 * fails, so a single stubborn item doesn't wipe out findings for the rest.
 */
export async function reviewCatalogBatch(
  items: CatalogReviewItem[],
  targetFields: readonly AiReviewTargetField[] = AI_REVIEW_TARGET_FIELDS,
  model?: string
): Promise<CatalogReviewIssue[]> {
  if (!OLLAMA_BASE_URL) {
    throw new CatalogAiReviewError("OLLAMA_BASE_URL is not configured.", "NOT_CONFIGURED");
  }
  if (items.length === 0) return [];
  if (targetFields.length === 0) return [];

  try {
    return await reviewCatalogBatchOnce(items, targetFields, model);
  } catch (err) {
    const isRetryable = err instanceof CatalogAiReviewError && (err.code === "INVALID_RESPONSE" || err.code === "TIMEOUT");
    if (!isRetryable || items.length < 2) throw err;

    console.warn(
      `[catalogAiReview] Batch of ${items.length} failed (${(err as CatalogAiReviewError).code}) — retrying as two smaller batches.`
    );
    const mid = Math.ceil(items.length / 2);
    const halves = [items.slice(0, mid), items.slice(mid)];

    const results: CatalogReviewIssue[] = [];
    let anyHalfSucceeded = false;
    for (const half of halves) {
      try {
        results.push(...(await reviewCatalogBatchOnce(half, targetFields, model)));
        anyHalfSucceeded = true;
      } catch (halfErr) {
        console.error(`[catalogAiReview] Half-batch of ${half.length} also failed:`, halfErr);
      }
    }
    if (!anyHalfSucceeded) throw err;
    return results;
  }
}
