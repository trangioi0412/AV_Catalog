/**
 * "Kiểm tra sản phẩm AV" for Upload SP mới lên CMS: asks the self-hosted
 * Ollama model (same model as Catalog AI Review) whether each new sheet row
 * is a product for the professional Audio Video industry, so crawler noise
 * (spare parts, apparel, generic IT, services...) can be removed from the
 * sheet before it reaches the CMS.
 *
 * One Ollama call per batch of rows; the client loops over batches.
 * Server-only.
 */
import type { BrandSheetRow } from "./brandSheets";
import { stripCodeFence } from "./translationProvider";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL;
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
const MODEL = process.env.CATALOG_AI_REVIEW_MODEL || "qwen3.5:9b";
const NUM_CTX = Number(process.env.CATALOG_AI_REVIEW_NUM_CTX) || 16384;
// Below the route's 300 s maxDuration.
const TIMEOUT_MS = 240_000;
const MAX_TEXT = 250;

export const AV_CHECK_MAX_ROWS = 10;
const MISSING_REASON = "AI không trả kết quả cho dòng này";

export type AvVerdict = "av" | "not_av" | "unsure";

export interface AvCheckResult {
  rowNumber: number;
  key: string;
  verdict: AvVerdict;
  reason: string;
  /** false: the AI gave no answer for this row (left for the next run, not a verdict). */
  checked: boolean;
}

const RESPONSE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id: { type: "integer" },
      verdict: { type: "string", enum: ["av", "not_av", "unsure"] },
      reason: { type: "string" },
    },
    required: ["id", "verdict", "reason"],
  },
};

function plain(text: string | undefined, max = MAX_TEXT): string {
  const t = (text || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? `${t.slice(0, max)}...` : t;
}

export function buildAvPrompt(brand: string, rows: BrandSheetRow[]): string {
  const listing = rows
    .map((row, i) => {
      const v = (k: string, max?: number) => plain(row.values[k], max);
      return [
        `${i + 1}. Title: ${v("Title") || "(trống)"}`,
        v("Product") &&
          v("Product") !== v("Title") &&
          `   Product: ${v("Product")}`,
        v("product (item)") && `   Model: ${v("product (item)")}`,
        v("Category") && `   Category: ${v("Category")}`,
        v("Series") && `   Series: ${v("Series")}`,
        v("Main Feature") && `   Main Feature: ${v("Main Feature")}`,
        v("Product Overview") && `   Overview: ${v("Product Overview")}`,
        v("Technical Specifications") &&
          `   Specs: ${v("Technical Specifications", 200)}`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  return `Bạn là chuyên gia sản phẩm của nhà phân phối thiết bị Audio Video (AV) chuyên nghiệp.
Danh sách dưới đây do crawler thu thập từ website hãng "${brand}". Phân loại TỪNG mục theo đúng các quy tắc sau.
Kết quả phải nhất quán: cùng một sản phẩm luôn cho cùng một kết quả. Mỗi mục được xét độc lập.

BƯỚC 1 — mục có phải là MỘT SẢN PHẨM có thể bán (thiết bị, phụ kiện, phần mềm/license) không?
Nếu là trang tin tức, sự kiện, case study, danh mục/series chung, tài liệu, khoá học, dịch vụ, gói bảo hành/support,
dịch vụ lắp đặt, hoặc Title chỉ là tên danh mục -> "not_av".

BƯỚC 2 — sản phẩm đó có dùng trong hệ thống AV chuyên nghiệp không?
"av" nếu thuộc một trong các nhóm:
- Âm thanh: loa, loa sub, micro (có dây, không dây, hội nghị, cổ ngỗng), mixer, amplifier, DSP, bộ xử lý,
  audio interface, Dante/AES67, hệ thống hội thảo, phiên dịch, tour guide, tai nghe/intercom chuyên dụng, PA/thông báo.
- Hình ảnh: camera (PTZ, hội nghị, broadcast), màn hình chuyên dụng/interactive, LED wall, máy chiếu, màn chiếu,
  video wall controller, switcher, matrix, scaler, extender, splitter, converter, encoder/decoder, AV-over-IP, KVM,
  thiết bị ghi hình, streaming, capture.
- Hội nghị & điều khiển: codec/thiết bị video conference, room system, wireless presentation, touch panel,
  bộ điều khiển trung tâm, room booking panel, phần mềm/license quản lý thiết bị AV.
- Phụ kiện cho thiết bị AV: cáp và đầu nối AV (HDMI, HDBaseT, SDI, audio, quang), giá treo, chân đế, rack, case,
  pin, sạc, nguồn, antenna, bộ thu phát của thiết bị AV, wall plate, hộp sàn/bàn AV.
- Thiết bị mạng/IT CHỈ khi được mô tả dành cho AV (AV-over-IP, Dante, PoE cho camera/loa) -> "av".

"not_av" nếu:
- Linh kiện thay thế lẻ (spare part, núm vặn, ốc vít, vỏ, màng loa thay thế, board mạch lẻ).
- Quần áo, mũ, quà tặng, đồ lưu niệm, merchandise.
- Thiết bị IT/gia dụng thông thường không mô tả dành cho AV (laptop, PC, máy in, router/switch mạng thường, đồ gia dụng).

BƯỚC 3 — "unsure" CHỈ khi Title và các trường khác đều trống hoặc vô nghĩa, không thể biết đây là gì.
Nếu có tên sản phẩm hoặc model, PHẢI chọn "av" hoặc "not_av" theo quy tắc trên.

Trả về JSON array, mỗi mục: {"id": <số thứ tự>, "verdict": "av"|"not_av"|"unsure", "reason": "<lý do ngắn, tiếng Việt, tối đa 15 từ>"}.
Phải có đủ ${rows.length} mục, mỗi id từ 1 đến ${rows.length} đúng một lần (id 1..${rows.length}).

${listing}`;
}

/** Maps the model's answer back onto the rows; a missing or broken entry becomes "unsure". */
export function parseAvResponse(
  raw: string,
  rows: BrandSheetRow[],
): AvCheckResult[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch {
    throw new Error("AI trả về JSON không hợp lệ");
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? ((Object.values(parsed).find(Array.isArray) as unknown[] | undefined) ??
        [])
      : [];

  const byId = new Map<number, { verdict: AvVerdict; reason: string }>();
  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    const o = e as Record<string, unknown>;
    const id = Number(o.id);
    const verdict = o.verdict;
    if (
      !Number.isInteger(id) ||
      (verdict !== "av" && verdict !== "not_av" && verdict !== "unsure")
    )
      continue;
    if (!byId.has(id))
      byId.set(id, {
        verdict,
        reason: typeof o.reason === "string" ? o.reason.trim() : "",
      });
  }

  return rows.map((row, i) => {
    const hit = byId.get(i + 1);
    return {
      rowNumber: row.rowNumber,
      key: row.key,
      verdict: hit?.verdict ?? "unsure",
      reason: hit ? hit.reason : MISSING_REASON,
      checked: Boolean(hit),
    };
  });
}

// One request must finish inside the route's maxDuration (300 s), retries included.
const DEADLINE_MS = 280_000;

async function askModel(
  brand: string,
  rows: BrandSheetRow[],
  timeoutMs: number,
): Promise<AvCheckResult[]> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (OLLAMA_API_KEY) headers.Authorization = `Bearer ${OLLAMA_API_KEY}`;

  let response: Response;
  try {
    response = await fetch(
      `${OLLAMA_BASE_URL!.replace(/\/+$/, "")}/api/generate`,
      {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          model: MODEL,
          prompt: buildAvPrompt(brand, rows),
          stream: false,
          think: false,
          format: RESPONSE_SCHEMA,
          // Greedy + fixed seed: re-checking the same product gives the same verdict.
          options: { temperature: 0, top_k: 1, seed: 42, num_ctx: NUM_CTX },
        }),
      },
    );
  } catch (err) {
    const timedOut =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError");
    throw new Error(
      timedOut
        ? "AI kiểm tra AV quá thời gian"
        : `Gọi AI lỗi: ${(err as Error).message}`,
    );
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`AI lỗi ${response.status}: ${body.slice(0, 200)}`);
  }
  const json = (await response.json()) as { response?: string };
  if (!json.response) throw new Error("AI trả về rỗng");
  return parseAvResponse(json.response, rows);
}

/**
 * Classifies every row in one call: a failed batch is retried row by row, and
 * rows the model skipped are asked again alone, so the caller never has to
 * run the check twice. Rows still without an answer come back "unsure".
 */
export async function checkAvRelevance(
  brand: string,
  rows: BrandSheetRow[],
): Promise<AvCheckResult[]> {
  if (rows.length === 0) return [];
  if (!OLLAMA_BASE_URL)
    throw new Error("Chưa cấu hình OLLAMA_BASE_URL cho kiểm tra AV");
  const deadline = Date.now() + DEADLINE_MS;
  const left = () => deadline - Date.now();

  let results: AvCheckResult[];
  try {
    results = await askModel(brand, rows, Math.min(TIMEOUT_MS, left()));
  } catch (err) {
    if (rows.length === 1) throw err;
    results = rows.map((r) => ({
      rowNumber: r.rowNumber,
      key: r.key,
      verdict: "unsure" as const,
      reason: MISSING_REASON,
      checked: false,
    }));
  }

  for (const [i, res] of results.entries()) {
    if (res.checked) continue;
    if (left() < 15_000) break;
    try {
      const [single] = await askModel(
        brand,
        [rows[i]],
        Math.min(60_000, left()),
      );
      if (single) results[i] = single;
    } catch (err) {
      results[i] = {
        ...res,
        reason: `Chưa kiểm tra được: ${(err as Error).message}`,
      };
    }
  }
  return results;
}
