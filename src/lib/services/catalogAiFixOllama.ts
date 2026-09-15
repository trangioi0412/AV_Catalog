/**
 * catalogAiFixOllama.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Bulk, local AI-proposed fixes for products the AI Review (catalogAiReview.ts)
 * already flagged, using a self-hosted Ollama model (qwen3.5:9b) instead of
 * Gemini's grounded-search research agent (geminiEnricher.ts /
 * /api/catalog-upload/ai-fix). Unlike Gemini, a local model has NO internet
 * access — it cannot look up a manufacturer's real datasheet, so it must never
 * invent specifications it wasn't given. Its job here is narrower: clean up
 * and normalize the EXISTING data using only the row's own fields and the
 * specific issues the review already found (strip placeholders, fix an
 * internally-inconsistent Category, deduplicate content wrongly copied from
 * another product, etc.) — and explicitly decline (omit the field, explain in
 * `note`) anything that would require outside knowledge, e.g. filling in
 * specs that are simply missing.
 *
 * Same batching/resilience approach as catalogAiReview.ts: JSON-schema
 * constrained output (a bare "json" format let this exact model collapse
 * multi-item batches into a single flat object — see that file's comments),
 * an explicit num_ctx override (Ollama's 4096 default undercuts this model's
 * real 262144 limit), and a bounded split-and-retry on a malformed/oversized
 * batch.
 *
 * Server-only: never import this from a Client Component.
 */

import { stripCodeFence } from "./translationProvider";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL;
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
const CATALOG_AI_FIX_MODEL = process.env.CATALOG_AI_FIX_MODEL || process.env.CATALOG_AI_REVIEW_MODEL || "qwen3.5:9b";
const CATALOG_AI_FIX_TIMEOUT_MS = Number(process.env.CATALOG_AI_FIX_TIMEOUT_MS) || 300000;
const CATALOG_AI_FIX_NUM_CTX = Number(process.env.CATALOG_AI_FIX_NUM_CTX) || 16384;
export const CATALOG_AI_FIX_BATCH_SIZE = Number(process.env.CATALOG_AI_FIX_BATCH_SIZE) || 8;

/** The exact catalog fields this engine is allowed to propose changes for — mirrors the Gemini path's field set (see AiFixSuggestion in types/index.ts) minus image/Datasheet/product(item), which a non-browsing model can't meaningfully supply. */
export const FIXABLE_FIELDS = [
  "Category",
  "Product",
  "Title",
  "Series",
  "MainFeature",
  "ProductOverview",
  "TechnicalSpecifications",
  "Brand",
] as const;

export type FixableField = (typeof FIXABLE_FIELDS)[number];

export interface CatalogFixItem {
  id: string;
  /** Current values of FIXABLE_FIELDS for this product (only non-empty ones need be included). */
  fields: Record<string, string>;
  /** The specific AI Review finding messages that flagged this product — gives the model concrete issues to address instead of guessing. */
  issues: string[];
}

export interface CatalogFixResult {
  id: string;
  /** Only the fields the model chose to change — a field it left out means "leave as-is". */
  fields: Partial<Record<FixableField, string>>;
  note: string;
}

export type CatalogAiFixErrorCode = "NOT_CONFIGURED" | "TIMEOUT" | "UPSTREAM_ERROR" | "INVALID_RESPONSE";

export class CatalogAiFixError extends Error {
  readonly code: CatalogAiFixErrorCode;
  constructor(message: string, code: CatalogAiFixErrorCode) {
    super(message);
    this.name = "CatalogAiFixError";
    this.code = code;
  }
}

export function isCatalogAiFixOllamaConfigured(): boolean {
  return Boolean(OLLAMA_BASE_URL);
}

export function getCatalogAiFixModel(): string {
  return CATALOG_AI_FIX_MODEL;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new CatalogAiFixError("AI fix request timed out.", "TIMEOUT")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutHandle!);
  }
}

const FIX_RESPONSE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id: { type: "string" },
      fields: {
        type: "object",
        properties: Object.fromEntries(FIXABLE_FIELDS.map((f) => [f, { type: "string" }])),
      },
      note: { type: "string" },
    },
    required: ["id", "fields", "note"],
  },
};

function buildFixPrompt(items: CatalogFixItem[]): string {
  return `Bạn là chuyên gia biên tập dữ liệu catalog sản phẩm Audio Visual (AV) chuyên nghiệp.

QUAN TRỌNG — GIỚI HẠN CỦA BẠN: Bạn KHÔNG có quyền truy cập Internet, KHÔNG thể tra cứu website hãng hay datasheet thật. Vì vậy:
- TUYỆT ĐỐI KHÔNG được bịa ra thông số kỹ thuật, số liệu, hay thông tin mà bạn không có căn cứ từ chính dữ liệu được cung cấp bên dưới.
- CHỈ được sửa những gì có thể suy luận chắc chắn TỪ CHÍNH dữ liệu đã cho: chuẩn hoá format, loại bỏ placeholder ("N/A", "CẦN VERIFY", "???", "xxx"...), sửa Category cho khớp với tên sản phẩm/thông số đã có, loại bỏ nội dung bị dán nhầm từ sản phẩm khác, làm sạch ký tự rác trong tên sản phẩm.
- Nếu một vấn đề (ví dụ "Technical Specifications bị thiếu") cần kiến thức bên ngoài mà bạn không có, KHÔNG được tự bịa ra — hãy BỎ QUA trường đó (không đưa field đó vào "fields") và giải thích lý do trong "note".

QUAN TRỌNG — LỖI LẪN NGÔN NGỮ (mixed_language): nếu "issues" của một sản phẩm nêu rằng một trường (Title, MainFeature, ProductOverview...) bị lẫn lộn cả tiếng Anh và tiếng Việt, hãy VIẾT LẠI TOÀN BỘ nội dung trường đó bằng tiếng Việt thống nhất, giữ nguyên đầy đủ thông tin/ý nghĩa gốc — không dịch từng câu một cách máy móc mà hãy diễn đạt tự nhiên như văn bản tiếng Việt thuần. Chỉ giữ nguyên (không dịch) tên riêng, tên hãng, mã model/số hiệu, và các thuật ngữ/viết tắt kỹ thuật tiếng Anh phổ biến (HDMI, USB, WiFi, DSP, 4K...). Đây KHÔNG cần kiến thức bên ngoài (chỉ là viết lại ngôn ngữ của nội dung đã có) nên PHẢI thực hiện, không được bỏ qua với lý do "cần tra cứu thêm".

Nhiệm vụ: với mỗi sản phẩm dưới đây (có "id", "fields" hiện tại, và "issues" — các vấn đề đã được phát hiện trước đó), đề xuất giá trị sửa cho CÁC TRƯỜNG BẠN CÓ THỂ SỬA CHẮC CHẮN. Các trường được phép sửa: ${FIXABLE_FIELDS.join(", ")}.

Trả lời DUY NHẤT một JSON array, không giải thích thêm, đúng định dạng:
[{"id": "<id>", "fields": {"<TênTrường>": "<giá trị mới>"}, "note": "<giải thích ngắn gọn đã sửa gì và bỏ qua gì, vì sao>"}]
QUAN TRỌNG: câu trả lời PHẢI bắt đầu bằng "[" và kết thúc bằng "]" — một mảng JSON ở cấp cao nhất, KHÔNG bọc trong object.
Nếu một sản phẩm bạn không sửa được gì chắc chắn, vẫn trả về object với "fields": {} rỗng và giải thích trong "note".

Danh sách sản phẩm (JSON):
${JSON.stringify(items, null, 2)}`;
}

function extractArray(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (Object.keys(obj).length === 0) return [];
  if (typeof obj.id === "string" && obj.fields && typeof obj.fields === "object") return [obj];
  const wrapperKey = Object.keys(obj).find((k) => Array.isArray(obj[k]));
  return wrapperKey ? (obj[wrapperKey] as unknown[]) : null;
}

async function fixBatchOnce(items: CatalogFixItem[], model?: string): Promise<CatalogFixResult[]> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (OLLAMA_API_KEY) headers.Authorization = `Bearer ${OLLAMA_API_KEY}`;

  let response: Response;
  try {
    response = await withTimeout(
      fetch(`${OLLAMA_BASE_URL!.replace(/\/+$/, "")}/api/generate`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: model || CATALOG_AI_FIX_MODEL,
          prompt: buildFixPrompt(items),
          stream: false,
          think: false,
          format: FIX_RESPONSE_SCHEMA,
          options: { temperature: 0.1, num_ctx: CATALOG_AI_FIX_NUM_CTX },
        }),
      }),
      CATALOG_AI_FIX_TIMEOUT_MS
    );
  } catch (err) {
    if (err instanceof CatalogAiFixError) throw err;
    throw new CatalogAiFixError(`AI fix request failed: ${err instanceof Error ? err.message : String(err)}`, "UPSTREAM_ERROR");
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new CatalogAiFixError(`AI fix request failed: ${response.status} ${text}`, "UPSTREAM_ERROR");
  }

  const json = (await response.json()) as { response?: string; done_reason?: string };
  if (!json.response) {
    const reason = json.done_reason === "length" ? " (model ran out of output tokens — try a smaller batch size)" : "";
    throw new CatalogAiFixError(`AI fix returned an empty response.${reason}`, "INVALID_RESPONSE");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(json.response));
  } catch {
    console.error(
      `[catalogAiFixOllama] Invalid JSON from model for a ${items.length}-item batch (done_reason: ${json.done_reason}). Raw response (first 2000 chars):`,
      json.response.slice(0, 2000)
    );
    throw new CatalogAiFixError(
      `AI fix returned invalid JSON${json.done_reason === "length" ? " (model ran out of output tokens mid-answer)" : ""}.`,
      "INVALID_RESPONSE"
    );
  }

  const entries = extractArray(parsed);
  if (entries === null) {
    throw new CatalogAiFixError("AI fix response was not a JSON array.", "INVALID_RESPONSE");
  }

  const validIds = new Set(items.map((i) => i.id));
  const fixableSet = new Set<string>(FIXABLE_FIELDS);
  const results: CatalogFixResult[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const id = (entry as Record<string, unknown>).id;
    const fieldsRaw = (entry as Record<string, unknown>).fields;
    const noteRaw = (entry as Record<string, unknown>).note;
    if (typeof id !== "string" || !validIds.has(id) || !fieldsRaw || typeof fieldsRaw !== "object") continue;

    // An empty string is a deliberate signal from the model — e.g. "this
    // Technical Specifications content was copy-pasted from an unrelated
    // product, clear it" — not "no suggestion" (that's expressed by omitting
    // the key entirely, per the prompt). Verified live: qwen3.5:9b does use
    // "" this way, so keep it rather than filtering it out as if it were blank.
    const fields: Partial<Record<FixableField, string>> = {};
    for (const [key, value] of Object.entries(fieldsRaw as Record<string, unknown>)) {
      if (fixableSet.has(key) && typeof value === "string") {
        fields[key as FixableField] = value;
      }
    }
    results.push({ id, fields, note: typeof noteRaw === "string" ? noteRaw : "" });
  }
  return results;
}

/**
 * Fixes ONE batch of already-flagged products. Same bounded retry as
 * reviewCatalogBatch in catalogAiReview.ts: on a malformed/oversized batch,
 * retries once by splitting into two halves run sequentially (a local Ollama
 * server serves one generation at a time) rather than recursing further.
 */
export async function fixCatalogBatch(items: CatalogFixItem[], model?: string): Promise<CatalogFixResult[]> {
  if (!OLLAMA_BASE_URL) {
    throw new CatalogAiFixError("OLLAMA_BASE_URL is not configured.", "NOT_CONFIGURED");
  }
  if (items.length === 0) return [];

  try {
    return await fixBatchOnce(items, model);
  } catch (err) {
    const isRetryable = err instanceof CatalogAiFixError && (err.code === "INVALID_RESPONSE" || err.code === "TIMEOUT");
    if (!isRetryable || items.length < 2) throw err;

    console.warn(`[catalogAiFixOllama] Batch of ${items.length} failed (${(err as CatalogAiFixError).code}) — retrying as two smaller batches.`);
    const mid = Math.ceil(items.length / 2);
    const halves = [items.slice(0, mid), items.slice(mid)];

    const results: CatalogFixResult[] = [];
    let anyHalfSucceeded = false;
    for (const half of halves) {
      try {
        results.push(...(await fixBatchOnce(half, model)));
        anyHalfSucceeded = true;
      } catch (halfErr) {
        console.error(`[catalogAiFixOllama] Half-batch of ${half.length} also failed:`, halfErr);
      }
    }
    if (!anyHalfSucceeded) throw err;
    return results;
  }
}
