/**
 * categoryConsolidation.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Groups Category values that are really the SAME product type but written
 * inconsistently across the catalog (e.g. "Camera A", "Camera B", "Camera
 * hội nghị" should all collapse to one canonical "Camera") into clusters
 * with one suggested canonical name each. This is a different operation
 * from catalogAiReview.ts's category_mismatch check — that verifies a
 * single product's Category against ITS OWN content; this instead looks
 * across every DISTINCT Category value in the catalog at once and asks
 * "which of these are really naming variants of the same thing".
 *
 * One Ollama call for the whole distinct-category list (not one per
 * product) — the input is just the list of unique strings, so it stays
 * small even for a catalog with thousands of products.
 *
 * A second, optional path (clusterCategoriesWithWebVerification) does the
 * same job but first looks a representative product per category up on
 * the open web (DuckDuckGo HTML search, no paid API) and feeds the search
 * result snippets to the SAME Ollama qwen3.5:9b model as extra context —
 * everything stays on the self-hosted model, only the fact-finding step
 * reaches out to the internet. Plain clusterCategories() only ever reasons
 * from the category STRINGS themselves, so when two categories look
 * structurally different (e.g. "Camera & Video Capture" vs "Video - Camera
 * & PTZ") it can't verify what the underlying products actually ARE.
 *
 * Server-only: never import this from a Client Component.
 */

import { mapWithConcurrency } from "@/lib/utils/concurrencyLimit";
import { searchDuckDuckGoWithSnippets, type DuckDuckGoSearchResult } from "@/lib/utils/duckDuckGoSearch";
import { stripCodeFence } from "./translationProvider";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL;
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
const CATEGORY_CLUSTER_MODEL = process.env.CATALOG_AI_REVIEW_MODEL || "qwen3.5:9b";
const CATEGORY_CLUSTER_TIMEOUT_MS = Number(process.env.CATALOG_AI_REVIEW_TIMEOUT_MS) || 300000;
const CATEGORY_CLUSTER_NUM_CTX = Number(process.env.CATALOG_AI_REVIEW_NUM_CTX) || 16384;

const MAX_SAMPLES_PER_CATEGORY = 3;
/** How much of a sample's Main Feature / Product Overview gets shown per field — keeps prompt size bounded even with many distinct categories. */
const MAX_CONTENT_LENGTH = 220;
/** Hard cap on how many categories get a real web lookup per request — bounds both request time and the risk of DuckDuckGo rate-limiting/blocking a burst of sequential searches. */
const MAX_CATEGORIES_TO_SEARCH = 60;
const WEB_SEARCH_CONCURRENCY = 3;

export interface GroundingSource {
  title: string;
  url: string;
}

export interface ClusterProductSample {
  brand?: string;
  product?: string;
  title?: string;
  /** Only the FIRST sample per category actually gets its content shown in the prompt (see MAX_CONTENT_LENGTH) — enough to ground the device-type decision without letting prompt size scale with every category's full content. */
  mainFeature?: string;
  productOverview?: string;
}

export interface CategoryClusterEntry {
  category: string;
  samples: ClusterProductSample[];
}

export interface CategoryCluster {
  canonical: string;
  members: string[];
}

export type CategoryClusterErrorCode = "NOT_CONFIGURED" | "TIMEOUT" | "UPSTREAM_ERROR" | "INVALID_RESPONSE";

export class CategoryClusterError extends Error {
  readonly code: CategoryClusterErrorCode;
  constructor(message: string, code: CategoryClusterErrorCode) {
    super(message);
    this.name = "CategoryClusterError";
    this.code = code;
  }
}

export function isCategoryClusterConfigured(): boolean {
  return Boolean(OLLAMA_BASE_URL);
}

export function isWebVerifiedClusteringConfigured(): boolean {
  return Boolean(OLLAMA_BASE_URL);
}

const CLUSTER_RESPONSE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      canonical: { type: "string" },
      members: { type: "array", items: { type: "string" } },
    },
    required: ["canonical", "members"],
  },
};

function truncate(text: string | undefined, max: number): string {
  const t = (text || "").trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max)}...` : t;
}

/** Renders one entry's sample list for a clustering prompt — full brand/product/title for every sample (up to MAX_SAMPLES_PER_CATEGORY), but Main Feature/Product Overview content only for the first sample that has any, to keep prompt size bounded. */
function renderClusterEntrySamples(samples: ClusterProductSample[]): string {
  if (samples.length === 0) return "    (không có sản phẩm mẫu)";
  let contentShown = false;
  return samples
    .map((s) => {
      const line = `    Sản phẩm mẫu: ${[s.brand, s.product, s.title].filter(Boolean).join(" — ") || "(không rõ)"}`;
      const mainFeature = truncate(s.mainFeature, MAX_CONTENT_LENGTH);
      const productOverview = truncate(s.productOverview, MAX_CONTENT_LENGTH);
      if (!contentShown && (mainFeature || productOverview)) {
        contentShown = true;
        const extra = [
          mainFeature ? `      Main Feature: ${mainFeature}` : null,
          productOverview ? `      Product Overview: ${productOverview}` : null,
        ]
          .filter(Boolean)
          .join("\n");
        return extra ? `${line}\n${extra}` : line;
      }
      return line;
    })
    .join("\n");
}

function buildClusterPrompt(entries: CategoryClusterEntry[]): string {
  const listing = entries
    .map((e, i) => `${i + 1}. Category: "${e.category}"\n${renderClusterEntrySamples(e.samples)}`)
    .join("\n\n");

  return `Bạn là chuyên gia chuẩn hoá dữ liệu catalog sản phẩm Audio Visual (AV) chuyên nghiệp.

Dưới đây là danh sách các giá trị Category (đã loại trùng) đang tồn tại trong catalog, gộp từ NHIỀU HÃNG khác nhau, mỗi Category kèm sản phẩm mẫu và nội dung Main Feature/Product Overview thực tế của sản phẩm đó (nếu có). Vì mỗi hãng/mỗi lần nhập liệu có thể đặt tên khác nhau cho cùng một loại thiết bị, rất nhiều giá trị chỉ là BIẾN THỂ CÁCH VIẾT của CÙNG một loại sản phẩm.

${listing}

QUAN TRỌNG: PHẢI đọc kỹ nội dung Main Feature/Product Overview của sản phẩm mẫu (nếu có) để xác định loại thiết bị THẬT SỰ của mỗi Category, KHÔNG chỉ đoán theo tên Category hay tên sản phẩm. Nếu nội dung mô tả rõ chức năng khác với tên Category, hãy tin theo nội dung. Nếu một Category không có sản phẩm mẫu hoặc không có nội dung, suy luận hợp lý từ tên Category như bình thường.

Nhiệm vụ: nhóm các Category THỰC SỰ CÙNG MỘT LOẠI THIẾT BỊ lại với nhau, chọn ĐÚNG MỘT tên chuẩn (tiếng Việt, ngắn gọn, nhất quán, dễ hiểu) đại diện cho mỗi nhóm.

CÁCH NHẬN BIẾT BIẾN THỂ CỦA CÙNG MỘT LOẠI (phải gộp chung dù nhìn bề ngoài khác nhau):
- Đảo thứ tự cụm từ: ví dụ "Camera & Video Capture" và "Video - Camera & PTZ" là CÙNG một loại (camera/PTZ camera) dù thứ tự từ và tiền tố khác nhau — PHẢI gộp chung (cả hai đều KHÔNG có chữ "Audio").
- Thêm/bớt hậu tố mô tả kỹ thuật không đổi bản chất loại thiết bị: ví dụ thêm "PTZ", "4K" vào tên loại camera vẫn là "Camera".
- Chỉ khác hậu tố A/B/C, số thứ tự, hoặc tên viết tắt khác nhau của cùng khái niệm (ví dụ "Mic" và "Microphone").
- Khác ngôn ngữ (một bên tiếng Anh, một bên tiếng Việt) nhưng cùng nghĩa.
Khi không chắc chắn giữa "gộp" và "để riêng", hãy ưu tiên GỘP nếu cả hai category đều rõ ràng mô tả cùng một loại thiết bị vật lý — mục tiêu là giảm tối đa số Category trùng lặp/dư thừa trên toàn catalog, không phải để an toàn mà giữ nguyên trạng.

QUAN TRỌNG — KHÔNG được gộp nhầm các loại thiết bị THỰC SỰ KHÁC NHAU dù có liên quan chức năng:
- "Camera" và "Đầu ghi camera" (recorder) là 2 loại khác nhau, KHÔNG nhóm chung.
- "Loa" và "Amply" là 2 loại khác nhau, KHÔNG nhóm chung.
- "Camera/Video" và "Microphone/Audio" là 2 loại khác nhau dù cùng dùng trong phòng họp — KHÔNG nhóm chung chỉ vì hay bán kèm nhau.
- "Bảng/Màn hình điều khiển cảm ứng" (touch panel, control panel, room scheduling panel) là thiết bị ĐIỀU KHIỂN, KHÔNG PHẢI thiết bị âm thanh — KHÔNG nhóm chung với "Microphone/Audio Input" dù bảng điều khiển đó có nút mute mic hay điều chỉnh âm lượng, vì bản thân nó không thu/phát âm thanh.
- Chữ "Capture" trong tên Category KHÔNG đồng nghĩa với "Camera" — một thiết bị "Capture" có thể là bộ THU/MÃ HOÁ tín hiệu (capture card/encoder) từ một nguồn khác (ví dụ card thu tín hiệu HDMI để ghi/stream), bản thân nó KHÔNG có ống kính/cảm biến và KHÔNG PHẢI là camera. CHỈ gộp một Category có chữ "Capture" vào nhóm "Camera" khi tên đó cũng rõ ràng nói về camera (ví dụ có chữ "Camera" hoặc "PTZ" đi kèm); không được suy diễn chỉ vì có chữ "Capture" hoặc "Video".
- Nếu tên Category gốc nêu rõ nó xử lý CẢ HAI loại tín hiệu (ví dụ "Audio/Video Capture" — vừa thu âm thanh vừa thu hình ảnh), TUYỆT ĐỐI KHÔNG gộp nó vào một nhóm canonical chỉ mang nghĩa hình ảnh/camera đơn thuần (ví dụ "Camera & Video Capture") — làm vậy sẽ xoá mất thông tin nó còn thu cả âm thanh. Nếu không chắc "Audio/Video Capture" là loại thiết bị gì cụ thể, hãy để nó thành một nhóm riêng (canonical giữ nguyên ý nghĩa "Audio/Video") thay vì gộp liều vào nhóm Camera.

Nếu một category không giống với category nào khác trong danh sách, vẫn phải trả về nó thành một nhóm riêng chỉ chứa chính nó (canonical = chính category đó, members = [category đó]).
Mỗi category trong danh sách gốc PHẢI xuất hiện trong ĐÚNG MỘT nhóm — không bỏ sót, không lặp lại ở nhóm khác.
Giữ nguyên chính tả gốc trong "members" — chỉ "canonical" là tên mới do bạn chọn.

Danh sách Category gốc cần phân nhóm (giữ nguyên chính tả trong "members"):
${JSON.stringify(entries.map((e) => e.category))}

Trả lời DUY NHẤT một JSON array, không giải thích, không dùng markdown code fence, đúng định dạng:
[{"canonical": "<tên chuẩn>", "members": ["<category gốc 1>", "<category gốc 2>", ...]}, ...]`;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new CategoryClusterError("Category clustering request timed out.", "TIMEOUT")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutHandle!);
  }
}

function extractClusterArray(parsed: unknown): unknown[] | null {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (Object.keys(obj).length === 0) return [];
  const wrapperKey = Object.keys(obj).find((k) => Array.isArray(obj[k]));
  return wrapperKey ? (obj[wrapperKey] as unknown[]) : null;
}

/**
 * Device families detected from KEYWORDS in a Category string, used only to
 * enforce the hard boundaries below — NOT a general taxonomy (a category
 * matching none of these is simply "unknown" and never blocks a merge).
 */
function detectDeviceFamilies(category: string): Set<string> {
  const lower = category.toLowerCase();
  const families = new Set<string>();
  if (/camera|video capture|\bptz\b|webcam|video bar/.test(lower)) families.add("camera");
  if (/microphone|\bmic\b|audio input|âm thanh|\bmicro\b/.test(lower)) families.add("audio_input");
  if (/\bspeaker\b|\bloa\b/.test(lower)) families.add("speaker");
  if (/amplifier|\bamply\b|power amp/.test(lower)) families.add("amplifier");
  if (/recorder|đầu ghi/.test(lower)) families.add("recorder");
  if (/touch panel|control panel|room scheduling|bảng điều khiển|màn hình điều khiển/.test(lower)) families.add("control_panel");
  return families;
}

/** Family pairs that must NEVER end up merged together, regardless of what the model concluded — mirrors the explicit guardrail examples already in both cluster prompts. */
const CONFLICTING_FAMILY_PAIRS: [string, string][] = [
  ["camera", "audio_input"],
  ["camera", "recorder"],
  ["speaker", "amplifier"],
  ["control_panel", "audio_input"],
];

function familiesConflict(a: Set<string>, b: Set<string>): boolean {
  return CONFLICTING_FAMILY_PAIRS.some(([x, y]) => (a.has(x) && b.has(y)) || (a.has(y) && b.has(x)));
}

/**
 * Deterministic safety net run AFTER the model produces clusters: pulls any
 * member back out into its own singleton cluster if its device family
 * (see detectDeviceFamilies) hard-conflicts with another member already
 * kept in the same cluster — e.g. a "Microphone/Audio" category merged with
 * a "Camera" one. Verified live: a modest local model does not reliably
 * obey every negative constraint in an increasingly long prompt (both
 * cluster prompts already explicitly forbid merging these exact device
 * families, yet it has still happened repeatedly) — so the hard boundaries
 * are enforced here in code instead of only hoped for via the prompt.
 */
function splitConflictingClusters(clusters: CategoryCluster[]): CategoryCluster[] {
  const result: CategoryCluster[] = [];
  for (const cluster of clusters) {
    if (cluster.members.length <= 1) {
      result.push(cluster);
      continue;
    }
    const kept: string[] = [];
    const keptFamilies: Set<string>[] = [];
    for (const m of cluster.members) {
      const fam = detectDeviceFamilies(m);
      if (keptFamilies.some((kf) => familiesConflict(kf, fam))) {
        console.warn(`[categoryConsolidation] Splitting "${m}" out of cluster "${cluster.canonical}" — conflicting device family with another member in the same cluster.`);
        result.push({ canonical: m, members: [m] });
      } else {
        kept.push(m);
        keptFamilies.push(fam);
      }
    }
    if (kept.length > 0) result.push({ canonical: cluster.canonical, members: kept });
  }
  return result;
}

/**
 * Clusters a deduplicated list of Categories (each with sample products —
 * brand/product/title plus, ideally, Main Feature/Product Overview content)
 * into canonical groups. Any input category the model drops or mangles is
 * added back as its own singleton cluster, so every category the caller
 * sent in is guaranteed to appear in exactly one returned cluster — a
 * caller building a "these products would change" UI can rely on that
 * invariant.
 */
export async function clusterCategories(entries: CategoryClusterEntry[]): Promise<CategoryCluster[]> {
  if (!OLLAMA_BASE_URL) {
    throw new CategoryClusterError("OLLAMA_BASE_URL is not configured.", "NOT_CONFIGURED");
  }

  const cleanedEntries = entries
    .map((e) => ({
      category: e.category.trim(),
      samples: e.samples.slice(0, MAX_SAMPLES_PER_CATEGORY).map((s) => ({
        brand: (s.brand || "").trim(),
        product: (s.product || "").trim(),
        title: (s.title || "").trim(),
        mainFeature: (s.mainFeature || "").trim(),
        productOverview: (s.productOverview || "").trim(),
      })),
    }))
    .filter((e) => e.category.length > 0);

  // Dedupe by category, keeping the first occurrence's samples.
  const dedupedEntries = Array.from(new Map(cleanedEntries.map((e) => [e.category, e])).values());

  const distinct = dedupedEntries.map((e) => e.category);
  if (distinct.length === 0) return [];
  if (distinct.length === 1) return [{ canonical: distinct[0], members: distinct }];

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (OLLAMA_API_KEY) headers.Authorization = `Bearer ${OLLAMA_API_KEY}`;

  let response: Response;
  try {
    response = await withTimeout(
      fetch(`${OLLAMA_BASE_URL.replace(/\/+$/, "")}/api/generate`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: CATEGORY_CLUSTER_MODEL,
          prompt: buildClusterPrompt(dedupedEntries),
          stream: false,
          think: false,
          format: CLUSTER_RESPONSE_SCHEMA,
          options: { temperature: 0.1, num_ctx: CATEGORY_CLUSTER_NUM_CTX },
        }),
      }),
      CATEGORY_CLUSTER_TIMEOUT_MS
    );
  } catch (err) {
    if (err instanceof CategoryClusterError) throw err;
    throw new CategoryClusterError(
      `Category clustering request failed: ${err instanceof Error ? err.message : String(err)}`,
      "UPSTREAM_ERROR"
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new CategoryClusterError(`Category clustering request failed: ${response.status} ${text}`, "UPSTREAM_ERROR");
  }

  const json = (await response.json()) as { response?: string; done_reason?: string };
  if (!json.response) {
    throw new CategoryClusterError("Category clustering returned an empty response.", "INVALID_RESPONSE");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(json.response));
  } catch {
    console.error(
      `[categoryConsolidation] Invalid JSON for ${distinct.length} categories (done_reason: ${json.done_reason}). Raw response (first 2000 chars):`,
      json.response.slice(0, 2000)
    );
    throw new CategoryClusterError("Category clustering returned invalid JSON.", "INVALID_RESPONSE");
  }

  const rawEntries = extractClusterArray(parsed);
  if (rawEntries === null) {
    throw new CategoryClusterError("Category clustering response was not a JSON array.", "INVALID_RESPONSE");
  }

  const distinctSet = new Set(distinct);
  const seen = new Set<string>();
  const clusters: CategoryCluster[] = [];

  for (const entry of rawEntries) {
    if (!entry || typeof entry !== "object") continue;
    const canonical = (entry as Record<string, unknown>).canonical;
    const membersRaw = (entry as Record<string, unknown>).members;
    if (typeof canonical !== "string" || !canonical.trim() || !Array.isArray(membersRaw)) continue;

    // A plain .filter() checking `seen` would NOT catch the model listing the
    // same member twice inside this ONE entry's own membersRaw array — `seen`
    // was only updated via a separate .forEach AFTER the filter already ran,
    // so both occurrences of a self-duplicated member would pass and end up
    // in the same cluster's `members` (observed live: a category listed
    // twice in one cluster, which then broke a React list key elsewhere).
    // Adding to `seen` synchronously, item by item, dedupes both within this
    // entry and across every other entry already processed.
    const members: string[] = [];
    for (const m of membersRaw) {
      if (typeof m === "string" && distinctSet.has(m) && !seen.has(m)) {
        members.push(m);
        seen.add(m);
      }
    }
    if (members.length > 0) clusters.push({ canonical: canonical.trim(), members });
  }

  // Guarantee every input category ends up somewhere, even if the model
  // dropped it — as its own singleton cluster.
  for (const c of distinct) {
    if (!seen.has(c)) clusters.push({ canonical: c, members: [c] });
  }

  return splitConflictingClusters(clusters);
}

interface CategoryWebContext {
  category: string;
  contextText: string;
  sources: GroundingSource[];
}

/**
 * Looks up one representative product per category on the open web (bounded
 * to MAX_CATEGORIES_TO_SEARCH, run with limited concurrency plus a small
 * jittered delay per request to avoid getting rate-limited/blocked) and
 * turns each hit into a short text block the clustering prompt can cite.
 * A category with no sample, or whose search comes back empty, still gets
 * a placeholder context so the model can fall back to reasoning from the
 * name alone for that one entry.
 */
async function researchCategoriesViaWeb(
  entries: { category: string; samples: ClusterProductSample[] }[]
): Promise<{ contexts: CategoryWebContext[]; sources: GroundingSource[] }> {
  const toSearch = entries.slice(0, MAX_CATEGORIES_TO_SEARCH);
  const skipped = entries.slice(MAX_CATEGORIES_TO_SEARCH);

  const searched = await mapWithConcurrency<{ category: string; samples: ClusterProductSample[] }, CategoryWebContext>(
    toSearch,
    WEB_SEARCH_CONCURRENCY,
    async (entry) => {
      const sample = entry.samples.find((s) => (s.brand || "").trim() || (s.product || "").trim());
      if (!sample) {
        return { category: entry.category, contextText: "(không có sản phẩm mẫu để tra cứu)", sources: [] };
      }

      const query = [sample.brand, sample.product, "specifications datasheet"].filter(Boolean).join(" ").trim();
      let results: DuckDuckGoSearchResult[] = [];
      try {
        results = await searchDuckDuckGoWithSnippets(query, 3);
      } catch (err) {
        console.warn(`[categoryConsolidation] Web search failed for "${query}":`, err);
      }
      // Polite jittered delay so a burst of sequential category searches doesn't look like abuse to DuckDuckGo.
      await new Promise((resolve) => setTimeout(resolve, 300 + Math.random() * 400));

      if (results.length === 0) {
        return { category: entry.category, contextText: "(không tìm thấy kết quả tra cứu)", sources: [] };
      }

      const sources: GroundingSource[] = results.map((r) => ({ title: r.title, url: r.url }));
      const contextText = results
        .map((r) => `  - "${r.title}": ${r.snippet || "(không có mô tả)"} (nguồn: ${r.url})`)
        .join("\n");
      return { category: entry.category, contextText, sources };
    }
  );

  const skippedContexts: CategoryWebContext[] = skipped.map((e) => ({
    category: e.category,
    contextText: "(bỏ qua tra cứu vì có quá nhiều Category trong một lần chạy)",
    sources: [],
  }));

  const allContexts = [...searched, ...skippedContexts];
  const seenUrls = new Set<string>();
  const sources: GroundingSource[] = [];
  for (const c of allContexts) {
    for (const s of c.sources) {
      if (seenUrls.has(s.url)) continue;
      seenUrls.add(s.url);
      sources.push(s);
    }
  }

  return { contexts: allContexts, sources };
}

function buildWebVerifiedClusterPrompt(
  entries: { category: string; samples: ClusterProductSample[] }[],
  contexts: CategoryWebContext[]
): string {
  const contextByCategory = new Map(contexts.map((c) => [c.category, c.contextText]));
  const listing = entries
    .map((e, i) => {
      const samples = renderClusterEntrySamples(e.samples);
      const webInfo = contextByCategory.get(e.category) || "(không tra cứu được)";
      return `${i + 1}. Category: "${e.category}"\n${samples}\n    Kết quả tra cứu trên mạng:\n${webInfo}`;
    })
    .join("\n\n");

  return `Bạn là chuyên gia chuẩn hoá dữ liệu catalog sản phẩm Audio Visual (AV) chuyên nghiệp.

Dưới đây là danh sách Category (đã loại trùng) trong catalog, mỗi Category kèm sản phẩm mẫu (kèm nội dung Main Feature/Product Overview thực tế của sản phẩm đó, nếu có) VÀ kết quả tra cứu Internet THỰC TẾ (tìm kiếm web) về sản phẩm mẫu đó. Hãy dùng CẢ HAI nguồn này để XÁC THỰC loại thiết bị thật sự của mỗi Category, thay vì chỉ đoán theo tên gọi:

${listing}

NHIỆM VỤ:
1. Dựa vào nội dung Main Feature/Product Overview của sản phẩm mẫu VÀ kết quả tra cứu web (nếu có), xác định loại thiết bị THẬT SỰ của từng Category (ví dụ: camera hội nghị, micro, loa, bộ xử lý DSP, bộ điều khiển...). Nếu Main Feature/Product Overview mô tả chức năng khác với tên Category, hãy tin theo nội dung đó. Nếu một Category không có nội dung và không tra cứu được gì, hãy suy luận hợp lý từ tên Category và tên sản phẩm mẫu như bình thường.
2. Nhóm các Category XÁC THỰC LÀ CÙNG MỘT LOẠI THIẾT BỊ lại với nhau — kể cả khi tên gọi Category khác nhau về thứ tự từ, hậu tố kỹ thuật (PTZ, 4K...), viết tắt, hay ngôn ngữ (ví dụ "Camera & Video Capture" và "Video - Camera & PTZ" cùng là "Camera" nếu tra cứu xác nhận cả hai đều là camera/camera PTZ — lưu ý cả hai tên này đều KHÔNG có chữ "Audio").
3. Nếu nhiều Category khác nhau đều xác thực là "Camera" (hoặc cùng một loại thiết bị bất kỳ), PHẢI gộp chung thành một nhóm với một tên chuẩn duy nhất.
4. KHÔNG được gộp các Category là các loại thiết bị THỰC SỰ KHÁC NHAU, dù hay được bán kèm nhau (Camera/Video Bar khác Microphone/Audio dù thường dùng chung trong phòng họp; Camera khác Đầu ghi camera/recorder; Loa khác Amply; Bảng/màn hình điều khiển cảm ứng (touch panel, control panel) khác Microphone/Audio dù bảng điều khiển đó có nút mute mic hay chỉnh âm lượng — bản thân nó không thu/phát âm thanh).
5. Nếu một sản phẩm mẫu hoá ra là PHỤ KIỆN/THIẾT BỊ MỞ RỘNG (mic mở rộng, remote, cáp, chân đế...), phải xét theo BẢN CHẤT CHỨC NĂNG của chính phụ kiện đó (ví dụ micro mở rộng cho video bar vẫn thuộc nhóm Microphone/Audio, KHÔNG thuộc nhóm Camera).
6. CẢNH GIÁC với kết quả tra cứu chỉ nói về HÃNG/CÔNG TY nói chung (ví dụ "X là hãng chuyên về giải pháp âm thanh/DSP hội nghị...") mà KHÔNG nhắc cụ thể đến sản phẩm/model đang xét — KHÔNG được dùng thông tin chung chung về ngành nghề của hãng để suy ra loại thiết bị của một sản phẩm cụ thể. Chỉ tin kết quả tra cứu khi nó thực sự mô tả đúng sản phẩm/model trong câu hỏi; nếu không, hãy suy luận từ tên Category và tên sản phẩm mẫu như bình thường.
7. Chữ "Capture" trong tên Category KHÔNG đồng nghĩa với "Camera" — có thể là bộ THU/MÃ HOÁ tín hiệu (capture card/encoder) từ một nguồn khác, bản thân KHÔNG có ống kính/cảm biến, KHÔNG PHẢI camera. Chỉ gộp một Category có chữ "Capture" vào nhóm Camera khi tra cứu/tên đó xác nhận rõ đó là camera (có chữ "Camera"/"PTZ" đi kèm) — không suy diễn chỉ vì có chữ "Capture" hoặc "Video".
8. Nếu tên Category gốc nêu rõ xử lý CẢ HAI loại tín hiệu (ví dụ "Audio/Video Capture" — vừa thu âm thanh vừa thu hình ảnh), TUYỆT ĐỐI KHÔNG gộp vào nhóm canonical chỉ mang nghĩa hình ảnh/camera đơn thuần (ví dụ "Camera & Video Capture") vì sẽ xoá mất thông tin nó còn thu cả âm thanh. Nếu không tra cứu xác nhận được cụ thể đó là loại thiết bị gì, hãy để riêng thành một nhóm (canonical giữ nguyên ý nghĩa "Audio/Video") thay vì gộp liều vào nhóm Camera.

Nếu một category không giống category nào khác, vẫn trả về thành một nhóm riêng chỉ chứa chính nó (canonical = chính category đó, members = [category đó]).
Mỗi category trong danh sách gốc PHẢI xuất hiện trong ĐÚNG MỘT nhóm — không bỏ sót, không lặp lại ở nhóm khác.
Giữ nguyên chính tả gốc trong "members" — chỉ "canonical" là tên mới do bạn chọn (tiếng Việt, ngắn gọn, nhất quán, dễ hiểu).

Trả lời DUY NHẤT một JSON array, không giải thích, không dùng markdown code fence, đúng định dạng:
[{"canonical": "<tên chuẩn>", "members": ["<category gốc 1>", "<category gốc 2>", ...]}, ...]`;
}

/**
 * Same job as clusterCategories() and same model (Ollama qwen3.5:9b), but
 * first looks up one representative sample product per category via a free
 * DuckDuckGo HTML search (see researchCategoriesViaWeb) and feeds the
 * search snippets to the model as verification context, so categories that
 * merely LOOK different in name (e.g. "Camera & Video Capture" vs "Video -
 * Camera & PTZ") can still be recognized as the same real device type.
 */
export async function clusterCategoriesWithWebVerification(
  entries: CategoryClusterEntry[]
): Promise<{ clusters: CategoryCluster[]; sources: GroundingSource[] }> {
  if (!OLLAMA_BASE_URL) {
    throw new CategoryClusterError("OLLAMA_BASE_URL is not configured.", "NOT_CONFIGURED");
  }

  const cleanedEntries = entries
    .map((e) => ({
      category: e.category.trim(),
      samples: e.samples.slice(0, MAX_SAMPLES_PER_CATEGORY).map((s) => ({
        brand: (s.brand || "").trim(),
        product: (s.product || "").trim(),
        title: (s.title || "").trim(),
      })),
    }))
    .filter((e) => e.category.length > 0);

  // Dedupe by category, keeping the first occurrence's samples.
  const dedupedEntries = Array.from(new Map(cleanedEntries.map((e) => [e.category, e])).values());

  const distinct = dedupedEntries.map((e) => e.category);
  if (distinct.length === 0) return { clusters: [], sources: [] };
  if (distinct.length === 1) return { clusters: [{ canonical: distinct[0], members: distinct }], sources: [] };

  const { contexts, sources } = await researchCategoriesViaWeb(dedupedEntries);

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (OLLAMA_API_KEY) headers.Authorization = `Bearer ${OLLAMA_API_KEY}`;

  let response: Response;
  try {
    response = await withTimeout(
      fetch(`${OLLAMA_BASE_URL.replace(/\/+$/, "")}/api/generate`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: CATEGORY_CLUSTER_MODEL,
          prompt: buildWebVerifiedClusterPrompt(dedupedEntries, contexts),
          stream: false,
          think: false,
          format: CLUSTER_RESPONSE_SCHEMA,
          options: { temperature: 0.1, num_ctx: CATEGORY_CLUSTER_NUM_CTX },
        }),
      }),
      CATEGORY_CLUSTER_TIMEOUT_MS
    );
  } catch (err) {
    if (err instanceof CategoryClusterError) throw err;
    throw new CategoryClusterError(
      `Web-verified category clustering request failed: ${err instanceof Error ? err.message : String(err)}`,
      "UPSTREAM_ERROR"
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new CategoryClusterError(`Web-verified category clustering request failed: ${response.status} ${text}`, "UPSTREAM_ERROR");
  }

  const json = (await response.json()) as { response?: string; done_reason?: string };
  if (!json.response) {
    throw new CategoryClusterError("Web-verified category clustering returned an empty response.", "INVALID_RESPONSE");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(json.response));
  } catch {
    console.error(
      `[categoryConsolidation] Invalid JSON for web-verified clustering of ${distinct.length} categories (done_reason: ${json.done_reason}). Raw response (first 2000 chars):`,
      json.response.slice(0, 2000)
    );
    throw new CategoryClusterError("Web-verified category clustering returned invalid JSON.", "INVALID_RESPONSE");
  }

  const rawEntries = extractClusterArray(parsed);
  if (rawEntries === null) {
    throw new CategoryClusterError("Web-verified category clustering response was not a JSON array.", "INVALID_RESPONSE");
  }

  const distinctSet = new Set(distinct);
  const seen = new Set<string>();
  const clusters: CategoryCluster[] = [];

  for (const entry of rawEntries) {
    if (!entry || typeof entry !== "object") continue;
    const canonical = (entry as Record<string, unknown>).canonical;
    const membersRaw = (entry as Record<string, unknown>).members;
    if (typeof canonical !== "string" || !canonical.trim() || !Array.isArray(membersRaw)) continue;

    // A plain .filter() checking `seen` would NOT catch the model listing the
    // same member twice inside this ONE entry's own membersRaw array — `seen`
    // was only updated via a separate .forEach AFTER the filter already ran,
    // so both occurrences of a self-duplicated member would pass and end up
    // in the same cluster's `members` (observed live: a category listed
    // twice in one cluster, which then broke a React list key elsewhere).
    // Adding to `seen` synchronously, item by item, dedupes both within this
    // entry and across every other entry already processed.
    const members: string[] = [];
    for (const m of membersRaw) {
      if (typeof m === "string" && distinctSet.has(m) && !seen.has(m)) {
        members.push(m);
        seen.add(m);
      }
    }
    if (members.length > 0) clusters.push({ canonical: canonical.trim(), members });
  }

  for (const c of distinct) {
    if (!seen.has(c)) clusters.push({ canonical: c, members: [c] });
  }

  return { clusters: splitConflictingClusters(clusters), sources };
}
