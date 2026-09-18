/**
 * ollamaProductDiscovery.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Alternative to geminiEnricher.ts's discoverProductsWithGeminiAgent /
 * enrichProductDataWithGeminiAgent for the "Tra Cứu Sản Phẩm Bằng AI" tool
 * (/admin/image-discovery) — same job (find a brand's real AV products, then
 * enrich each new one), but backed by the self-hosted Ollama model
 * (qwen3.5:9b) instead of Gemini's paid Google Search Grounding tool.
 *
 * Ollama itself has NO internet access, so the actual web lookup is done
 * here with the same free DuckDuckGo HTML scrape used by
 * categoryConsolidation.ts's web-verified category clustering
 * (searchDuckDuckGoWithSnippets) — Ollama only ever sees the search result
 * snippets as text context and is explicitly told never to name a product
 * that isn't literally present in that context, to avoid inventing model
 * numbers that don't exist.
 *
 * Offered as a parallel choice to Gemini on the discovery page, not a
 * replacement — DuckDuckGo scraping + a modest local model is inherently
 * less complete/reliable for open-ended "find every product a brand makes"
 * discovery than Gemini's live grounded search, so an admin who wants
 * maximum coverage should still prefer Gemini; this exists for when Gemini
 * isn't configured or a free/local-only run is preferred.
 *
 * Server-only: never import this from a Client Component.
 */

import { searchDuckDuckGoWithSnippets } from "@/lib/utils/duckDuckGoSearch";
import { stripCodeFence } from "./translationProvider";
import type { DiscoveredProduct } from "./sitemapParser";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL;
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY;
const OLLAMA_DISCOVERY_MODEL = process.env.CATALOG_AI_REVIEW_MODEL || "qwen3.5:9b";
const OLLAMA_DISCOVERY_TIMEOUT_MS = Number(process.env.CATALOG_AI_REVIEW_TIMEOUT_MS) || 300000;
const OLLAMA_DISCOVERY_NUM_CTX = Number(process.env.CATALOG_AI_REVIEW_NUM_CTX) || 16384;
const SEARCH_RESULTS_PER_QUERY = 5;

export interface OllamaSearchSource {
  title: string;
  url: string;
}

export function isOllamaProductDiscoveryConfigured(): boolean {
  return Boolean(OLLAMA_BASE_URL);
}

async function callOllamaJson(prompt: string, schema: object): Promise<string> {
  if (!OLLAMA_BASE_URL) throw new Error("OLLAMA_BASE_URL is not configured.");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (OLLAMA_API_KEY) headers.Authorization = `Bearer ${OLLAMA_API_KEY}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OLLAMA_DISCOVERY_TIMEOUT_MS);
  try {
    const response = await fetch(`${OLLAMA_BASE_URL.replace(/\/+$/, "")}/api/generate`, {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: OLLAMA_DISCOVERY_MODEL,
        prompt,
        stream: false,
        think: false,
        format: schema,
        options: { temperature: 0.1, num_ctx: OLLAMA_DISCOVERY_NUM_CTX },
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Ollama request failed: ${response.status} ${text}`);
    }
    const json = (await response.json()) as { response?: string };
    if (!json.response) throw new Error("Ollama returned an empty response.");
    return json.response;
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractJsonArray(raw: string): unknown[] {
  const parsed: unknown = JSON.parse(stripCodeFence(raw));
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const wrapperKey = Object.keys(obj).find((k) => Array.isArray(obj[k]));
    if (wrapperKey) return obj[wrapperKey] as unknown[];
  }
  return [];
}

async function searchBrandContext(brandName: string, keyword?: string): Promise<{ contextText: string; sources: OllamaSearchSource[] }> {
  const queries = [
    `${brandName} professional AV products catalog`,
    `${brandName} product lineup${keyword ? ` ${keyword}` : ""}`,
  ];
  if (keyword) queries.push(`${brandName} ${keyword}`);

  const seenUrls = new Set<string>();
  const sources: OllamaSearchSource[] = [];
  const blocks: string[] = [];

  for (const query of queries) {
    let results: Awaited<ReturnType<typeof searchDuckDuckGoWithSnippets>> = [];
    try {
      results = await searchDuckDuckGoWithSnippets(query, SEARCH_RESULTS_PER_QUERY);
    } catch (err) {
      console.warn(`[ollamaProductDiscovery] Search failed for "${query}":`, err);
    }
    for (const r of results) {
      if (seenUrls.has(r.url)) continue;
      seenUrls.add(r.url);
      sources.push({ title: r.title, url: r.url });
      blocks.push(`- "${r.title}": ${r.snippet || "(không có mô tả)"} (nguồn: ${r.url})`);
    }
    // Polite delay between sequential queries to avoid looking like abuse to DuckDuckGo.
    await new Promise((resolve) => setTimeout(resolve, 400 + Math.random() * 400));
  }

  return { contextText: blocks.join("\n"), sources };
}

const DISCOVERY_RESPONSE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      Category: { type: "string" },
      Product: { type: "string" },
      Title: { type: "string" },
    },
    required: ["Category", "Product", "Title"],
  },
};

/**
 * Finds candidate products for `brandName` using DuckDuckGo search context
 * fed to Ollama — same return shape as discoverProductsWithGeminiAgent's
 * result (features/overview left blank) so it plugs into the same
 * discoveryEngine.ts pipeline and gets enriched the same way afterward.
 */
export async function discoverProductsWithOllama(brandName: string, keyword?: string): Promise<{ products: DiscoveredProduct[]; sources: OllamaSearchSource[] }> {
  if (!OLLAMA_BASE_URL) throw new Error("OLLAMA_BASE_URL is not configured.");

  const { contextText, sources } = await searchBrandContext(brandName, keyword);
  if (!contextText.trim()) {
    return { products: [], sources: [] };
  }

  const prompt = `Bạn là chuyên gia phân loại sản phẩm Audio Visual (AV) chuyên nghiệp.

Dưới đây là kết quả tra cứu Internet THỰC TẾ (tìm kiếm web) về các sản phẩm của hãng "${brandName}"${keyword ? ` (liên quan đến: ${keyword})` : ""}:

${contextText}

NHIỆM VỤ: liệt kê các sản phẩm AV CHUYÊN DỤNG (không phải hàng tiêu dùng) của hãng "${brandName}" được NHẮC ĐẾN RÕ RÀNG (có tên/mã model cụ thể) trong nội dung tra cứu trên.

QUY TẮC BẮT BUỘC:
- TUYỆT ĐỐI KHÔNG bịa ra sản phẩm hay mã model không xuất hiện trong nội dung tra cứu trên. Nếu không chắc một cái tên có phải là mã sản phẩm thật hay không, hãy bỏ qua, không đưa vào danh sách.
- Chỉ liệt kê mỗi sản phẩm (theo mã model) một lần, không trùng lặp.
- Với mỗi sản phẩm, xác định:
  - "Category": loại thiết bị (ví dụ: Camera hội nghị, Micro, Loa, Bộ xử lý DSP, Bộ điều khiển...) dựa trên ngữ cảnh trong nội dung tra cứu.
  - "Product": mã model chính xác như xuất hiện trong nội dung tra cứu.
  - "Title": tên đầy đủ sản phẩm bằng tiếng Việt (dịch tự nhiên, giữ nguyên mã model/tên riêng).
- Nếu nội dung tra cứu không đủ để xác định được sản phẩm cụ thể nào, trả về mảng rỗng [].

Trả lời DUY NHẤT một JSON array, không giải thích, không dùng markdown code fence, đúng định dạng:
[{"Category": "<loại thiết bị>", "Product": "<mã model>", "Title": "<tên tiếng Việt>"}, ...]`;

  const raw = await callOllamaJson(prompt, DISCOVERY_RESPONSE_SCHEMA);
  let entries: unknown[];
  try {
    entries = extractJsonArray(raw);
  } catch (err) {
    console.error("[ollamaProductDiscovery] Failed to parse discovery JSON:", err, "Raw (first 2000 chars):", raw.slice(0, 2000));
    throw new Error("Ollama trả về JSON không hợp lệ khi tìm sản phẩm.");
  }

  const seen = new Set<string>();
  const products: DiscoveredProduct[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const category = typeof e.Category === "string" ? e.Category.trim() : "";
    const product = typeof e.Product === "string" ? e.Product.trim() : "";
    const title = typeof e.Title === "string" ? e.Title.trim() : "";
    if (!product || !title) continue;
    const key = product.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    products.push({
      Category: category,
      Product: product,
      Title: title,
      productItem: "",
      Series: "",
      MainFeature: "",
      ProductOverview: "",
      TechnicalSpecifications: "[]",
      image: "",
      Datasheet: "",
    });
  }

  return { products, sources };
}

export interface OllamaEnrichedProduct {
  Category: string;
  Series: string;
  "Main Feature": string;
  "Product Overview": string;
  "Technical Specifications": string;
  sources: OllamaSearchSource[];
}

const ENRICH_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    Category: { type: "string" },
    Series: { type: "string" },
    MainFeature: { type: "string" },
    ProductOverview: { type: "string" },
    TechnicalSpecifications: { type: "string" },
  },
  required: ["Category", "Series", "MainFeature", "ProductOverview", "TechnicalSpecifications"],
};

/**
 * Enriches one already-discovered product using DuckDuckGo search context
 * fed to Ollama — deliberately narrower than Gemini's enrichment agent:
 * no image/Datasheet/productItem (extracting a real, working direct file
 * URL from a short text snippet is unreliable), only the text fields Ollama
 * can respond to armed with genuine search-result context — and every
 * field is left empty rather than guessed when the search context doesn't
 * cover it, per this codebase's "never invent" rule for a non-browsing model.
 */
export async function enrichProductDataWithOllama(basicInfo: {
  Brand: string;
  Product: string;
  Title?: string;
  Category?: string;
}): Promise<OllamaEnrichedProduct> {
  if (!OLLAMA_BASE_URL) throw new Error("OLLAMA_BASE_URL is not configured.");

  const { Brand, Product, Title, Category } = basicInfo;
  const query = `${Brand} ${Product} specifications datasheet`;
  let results: Awaited<ReturnType<typeof searchDuckDuckGoWithSnippets>> = [];
  try {
    results = await searchDuckDuckGoWithSnippets(query, SEARCH_RESULTS_PER_QUERY);
  } catch (err) {
    console.warn(`[ollamaProductDiscovery] Enrichment search failed for "${query}":`, err);
  }

  const sources: OllamaSearchSource[] = results.map((r) => ({ title: r.title, url: r.url }));
  const contextText = results.map((r) => `- "${r.title}": ${r.snippet || "(không có mô tả)"} (nguồn: ${r.url})`).join("\n");

  const empty: OllamaEnrichedProduct = {
    Category: "",
    Series: "",
    "Main Feature": "",
    "Product Overview": "",
    "Technical Specifications": "",
    sources,
  };
  if (!contextText.trim()) return empty;

  const prompt = `Bạn là chuyên gia biên tập dữ liệu catalog sản phẩm Audio Visual (AV) chuyên nghiệp.

Sản phẩm cần bổ sung thông tin: hãng "${Brand}", mã model "${Product}"${Title ? `, tên "${Title}"` : ""}${Category ? `, Category hiện tại "${Category}"` : ""}.

Dưới đây là kết quả tra cứu Internet THỰC TẾ (tìm kiếm web) về đúng sản phẩm này:

${contextText}

QUAN TRỌNG — GIỚI HẠN: bạn KHÔNG có quyền truy cập Internet trực tiếp, CHỈ được dùng nội dung tra cứu bên trên. TUYỆT ĐỐI KHÔNG bịa ra thông số, tính năng, hay mô tả không có căn cứ trong nội dung trên. Nếu nội dung không đủ thông tin cho một trường, để trống trường đó (chuỗi rỗng ""), không suy đoán.

Trả lời DUY NHẤT một JSON object, không giải thích, không dùng markdown code fence, đúng định dạng:
{"Category": "<loại thiết bị, dựa trên nội dung tra cứu>", "Series": "<dòng sản phẩm nếu có, để trống nếu không có căn cứ>", "MainFeature": "<3-4 tính năng cốt lõi bằng tiếng Việt, phân tách bằng dấu chấm phẩy (;), để trống nếu không có căn cứ>", "ProductOverview": "<mô tả tổng quan bằng tiếng Việt, để trống nếu không có căn cứ>", "TechnicalSpecifications": "<JSON string mảng [{\\"label\\":...,\\"value\\":...}] các thông số tìm thấy, để trống nếu không có căn cứ>"}`;

  const raw = await callOllamaJson(prompt, ENRICH_RESPONSE_SCHEMA);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripCodeFence(raw)) as Record<string, unknown>;
  } catch (err) {
    console.error("[ollamaProductDiscovery] Failed to parse enrichment JSON:", err, "Raw (first 2000 chars):", raw.slice(0, 2000));
    return empty;
  }

  return {
    Category: typeof parsed.Category === "string" ? parsed.Category : "",
    Series: typeof parsed.Series === "string" ? parsed.Series : "",
    "Main Feature": typeof parsed.MainFeature === "string" ? parsed.MainFeature : "",
    "Product Overview": typeof parsed.ProductOverview === "string" ? parsed.ProductOverview : "",
    "Technical Specifications": typeof parsed.TechnicalSpecifications === "string" ? parsed.TechnicalSpecifications : "",
    sources,
  };
}
