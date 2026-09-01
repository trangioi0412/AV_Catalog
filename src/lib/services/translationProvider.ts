/**
 * translationProvider.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Vietnamese → English text translation for AV product content, tuned for
 * professional Audio Visual System terminology. Three interchangeable providers:
 *   - Gemini (GEMINI_API_KEY, @google/genai — see geminiEnricher.ts)
 *   - GPT / OpenAI (GPT_API_KEY, plain REST call — no SDK dependency added)
 *   - Ollama (OLLAMA_BASE_URL [+ optional OLLAMA_API_KEY, OLLAMA_MODEL] — a
 *     self-hosted/local or cloud Ollama server, plain REST call to its native
 *     /api/generate endpoint)
 * Gemini and GPT share `buildPrompt()` / `parseTranslationResponse()` (one JSON
 * call translates every requested field at once). Ollama instead runs the
 * admin-specified Vietnamese prompt (`buildOllamaPrompt()`) once per field and
 * expects a plain-text translation back — see that function for why.
 *
 * TranslateGemma (set OLLAMA_MODEL to any tag containing "translategemma",
 * e.g. "translategemma:12b") is a translation-only fine-tune, not a general
 * instruction-follower, so `OllamaTranslationProvider` detects it by model
 * name and switches to its own required English prompt template and Ollama's
 * /api/chat endpoint instead — see `buildTranslateGemmaPrompt()`.
 *
 * `getTranslationProvider()` picks whichever is configured — Ollama first (if
 * OLLAMA_BASE_URL is set), then GPT_API_KEY, then GEMINI_API_KEY — see
 * `resolveProviderKind()`, or `TRANSLATION_PROVIDER` env var forces one
 * explicitly ("ollama" | "gpt" | "gemini").
 *
 * Server-only: never import this from a Client Component.
 */

import { GoogleGenAI } from "@google/genai";
import { AV_GLOSSARY_TERMS } from "@/config/translation-glossary";

const GEMINI_MODEL = "gemini-2.5-pro";
const GPT_MODEL = process.env.GPT_MODEL || "gpt-4o";
const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.1";
const TRANSLATE_TIMEOUT_MS = 30000;
// Local/self-hosted model inference is typically much slower than a cloud API.
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 120000;

/** Brand names, protocols, and standards that must be carried over verbatim, never translated. */
const AV_PROTECTED_TERMS = AV_GLOSSARY_TERMS;

export interface TranslationRequest {
  /** field key -> source text */
  fields: Record<string, string>;
  context?: { brand?: string; category?: string; productName?: string };
  /**
   * Locale codes (e.g. "vi", "en"). Only consulted by the Ollama provider's
   * per-field prompt (`buildOllamaPrompt()`), which translates in whichever
   * direction these say — including English -> Vietnamese. Gemini/GPT's
   * shared `buildPrompt()` is still fixed to Vietnamese -> English regardless
   * of these and ignores them; not in scope of this change.
   */
  sourceLocale?: string;
  targetLocale?: string;
}

export interface TranslationResult {
  /** field key -> English translation (only for keys that had non-empty source text) */
  fields: Record<string, string>;
  warnings: string[];
}

export type TranslationProviderErrorCode = "NOT_CONFIGURED" | "TIMEOUT" | "RATE_LIMITED" | "INVALID_RESPONSE" | "UPSTREAM_ERROR";

export class TranslationProviderError extends Error {
  readonly code: TranslationProviderErrorCode;
  constructor(message: string, code: TranslationProviderErrorCode) {
    super(message);
    this.name = "TranslationProviderError";
    this.code = code;
  }
}

export interface TranslationProvider {
  translate(input: TranslationRequest): Promise<TranslationResult>;
}

function buildPrompt(input: TranslationRequest): string {
  const { fields, context } = input;
  const contextLines = [
    context?.brand ? `Brand: ${context.brand}` : null,
    context?.category ? `Category: ${context.category}` : null,
    context?.productName ? `Product: ${context.productName}` : null,
  ].filter(Boolean);

  return `You are a professional technical translator for the Audio Visual (AV) systems integration industry.
Translate the following product content from Vietnamese to English.

THIS IS A TRANSLATION TASK, NOT A REWRITING, SUMMARIZING, OR MARKETING-COPY TASK. Your only job is to
re-express the exact same meaning in the target language — nothing more, nothing less. Every sentence,
claim, and fact in your output must map back to something literally present in the source text below.
Do NOT use any outside/prior knowledge you may have about this brand or product to add, replace,
"correct", or elaborate on the content — even if you believe you know more accurate or complete details
about the real product. The source text is the ONLY source of truth; if the source doesn't say it,
your translation must not say it either.

Rules:
- Do not add, remove, invent, or embellish any information that is not in the source text — no extra
  claims, no marketing language, no explanatory detail the source doesn't contain.
- Translation length must correspond to source length — a short source sentence must stay a short
  translation, never expanded into a longer passage or multiple paragraphs.
- Be technically accurate and use professional, formal AV industry English.
- Never translate brand names, model numbers, units, or these protocol/standard/product names — copy them verbatim wherever they appear: ${AV_PROTECTED_TERMS.join(", ")}.
- Preserve any HTML tags, links, numbers, and formatting exactly as they appear in the source.
- If a source field is an empty string, return it as an empty string. Do not fabricate content for it.
- Return ONLY a JSON object with exactly the same field keys as the input, each mapped to its English translation.

${contextLines.length > 0 ? contextLines.join("\n") + "\n\n" : ""}Fields to translate (JSON):
${JSON.stringify(fields, null, 2)}`;
}

/** Short and full Vietnamese names for the locales this prompt knows how to phrase in either direction. */
const OLLAMA_LOCALE_SHORT_NAMES: Record<string, string> = { vi: "Việt", en: "Anh" };
const OLLAMA_LOCALE_FULL_NAMES: Record<string, string> = { vi: "tiếng Việt", en: "tiếng Anh" };

function ollamaLocaleShortName(locale: string): string {
  return OLLAMA_LOCALE_SHORT_NAMES[locale.toLowerCase()] || locale.toUpperCase();
}

function ollamaLocaleFullName(locale: string): string {
  return OLLAMA_LOCALE_FULL_NAMES[locale.toLowerCase()] || locale.toUpperCase();
}

/** English display names for the locales TranslateGemma's (English-language) prompt template needs. */
const TRANSLATEGEMMA_LOCALE_NAMES: Record<string, string> = { vi: "Vietnamese", en: "English" };

function translateGemmaLocaleName(locale: string): string {
  return TRANSLATEGEMMA_LOCALE_NAMES[locale.toLowerCase()] || locale;
}

/** True for any TranslateGemma variant/tag (e.g. "translategemma:12b", "translategemma3:12b-it-q4_K_M"). */
function isTranslateGemmaModel(model: string): boolean {
  return /translategemma/i.test(model);
}

/**
 * TranslateGemma (google/translategemma via Ollama) is a translation-only
 * fine-tune of Gemma 3, not a general instruction-follower — it expects its
 * own fixed English prompt template (source/target language name + code,
 * then the text after two blank lines) rather than the free-form Vietnamese
 * instructions in `buildOllamaPrompt()`. Template per the model's Ollama
 * library page.
 */
function buildTranslateGemmaPrompt(content: string, sourceLocale = "vi", targetLocale = "en"): string {
  const sourceLang = translateGemmaLocaleName(sourceLocale);
  const targetLang = translateGemmaLocaleName(targetLocale);
  const sourceCode = sourceLocale.toLowerCase();
  const targetCode = targetLocale.toLowerCase();

  return `You are a professional ${sourceLang} (${sourceCode}) to ${targetLang} (${targetCode}) translator. Your goal is to accurately convey the meaning and nuances of the original ${sourceLang} text while adhering to ${targetLang} grammar, vocabulary, and cultural sensitivities.
Produce only the ${targetLang} translation, without any additional explanations or commentary. Please translate the following ${sourceLang} text into ${targetLang}:


${content}`;
}

/**
 * The admin-specified prompt for the Ollama provider, parameterized by
 * direction so it also runs English -> Vietnamese (not just the original
 * Vietnamese -> English) — same wording and rules either way, just the
 * source/target language names swapped. Unlike `buildPrompt()` (one JSON call
 * for every field at once), this is a single-content template with no JSON
 * framing — Ollama is asked to return ONLY the translated text, so it is run
 * once per non-empty field.
 */
function buildOllamaPrompt(content: string, sourceLocale = "vi", targetLocale = "en"): string {
  const pairLabel = `${ollamaLocaleShortName(sourceLocale)}–${ollamaLocaleShortName(targetLocale)}`;
  const sourceName = ollamaLocaleFullName(sourceLocale);
  const targetName = ollamaLocaleFullName(targetLocale);

  return `Bạn là chuyên gia dịch thuật ${pairLabel} trong lĩnh vực Audio Visual Systems.
Hãy dịch CHÍNH XÁC nội dung bên dưới từ ${sourceName} sang ${targetName}.

ĐÂY LÀ NHIỆM VỤ DỊCH THUẬT, KHÔNG PHẢI VIẾT LẠI, TÓM TẮT, HAY VIẾT NỘI DUNG MARKETING. Việc DUY NHẤT
bạn cần làm là chuyển đúng nguyên ý của bản gốc sang ngôn ngữ đích — không hơn, không kém. Mọi câu, mọi
thông tin trong bản dịch PHẢI truy ngược lại được đúng nội dung có trong văn bản gốc bên dưới. TUYỆT ĐỐI
KHÔNG dùng kiến thức bạn đã biết từ trước về sản phẩm/thương hiệu này để thay thế, "sửa lại", bổ sung
hay diễn giải thêm — kể cả khi bạn nghĩ mình biết thông tin chính xác/đầy đủ hơn về sản phẩm thật. Nội
dung gốc bên dưới là nguồn thông tin DUY NHẤT; nếu bản gốc không nói điều gì, bản dịch cũng không được
tự thêm điều đó vào.

Yêu cầu:
- Không tự bổ sung, không bịa, không lược bỏ, không diễn giải mở rộng thêm ý, không thêm câu chữ mang
  tính quảng cáo/marketing mà bản gốc không có.
- Độ dài bản dịch phải tương ứng với độ dài bản gốc — nội dung gốc ngắn thì bản dịch cũng phải ngắn,
  tuyệt đối không viết thành một đoạn dài hơn hay nhiều đoạn văn.
- Văn phong trang trọng, chuyên nghiệp và mang tính kỹ thuật.
- Sử dụng thuật ngữ chính xác trong ngành AV, hội nghị truyền hình,
  âm thanh, trình chiếu và điều khiển tích hợp.
- Không dịch tên thương hiệu, tên model hoặc mã sản phẩm.
- Giữ nguyên cấu trúc tiêu đề, danh sách, Markdown, HTML và biến dữ liệu.
- Chỉ trả về bản dịch, không giải thích, không thêm ghi chú nào khác.

Nội dung cần dịch (dịch đúng nguyên văn, không thêm bớt):
${content}`;
}

export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1] : trimmed;
}

export function parseTranslationResponse(
  rawText: string,
  requestedKeys: string[]
): TranslationResult {
  const warnings: string[] = [];
  let parsed: unknown;

  try {
    parsed = JSON.parse(stripCodeFence(rawText));
  } catch {
    throw new TranslationProviderError(
      "Translation provider returned invalid JSON.",
      "INVALID_RESPONSE"
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TranslationProviderError(
      "Translation provider response was not a JSON object.",
      "INVALID_RESPONSE"
    );
  }

  const parsedObj = parsed as Record<string, unknown>;
  const fields: Record<string, string> = {};

  for (const key of requestedKeys) {
    const val = parsedObj[key];
    if (val === undefined) {
      warnings.push(`Missing field "${key}" in translation response — left empty.`);
      fields[key] = "";
    } else if (typeof val !== "string") {
      warnings.push(`Field "${key}" was not a string in translation response — coerced.`);
      fields[key] = String(val);
    } else {
      fields[key] = val;
    }
  }

  const extraKeys = Object.keys(parsedObj).filter((k) => !requestedKeys.includes(k));
  if (extraKeys.length > 0) {
    warnings.push(`Ignored unexpected field(s) in translation response: ${extraKeys.join(", ")}.`);
  }

  return { fields, warnings };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new TranslationProviderError("Translation request timed out.", "TIMEOUT")), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutHandle!);
  }
}

export class GeminiTranslationProvider implements TranslationProvider {
  private readonly ai: GoogleGenAI;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async translate(input: TranslationRequest): Promise<TranslationResult> {
    const requestedKeys = Object.keys(input.fields);
    const nonEmptyFields: Record<string, string> = {};
    let hasNonEmpty = false;
    for (const key of requestedKeys) {
      const val = input.fields[key];
      if (val && val.trim() !== "") {
        nonEmptyFields[key] = val;
        hasNonEmpty = true;
      }
    }

    if (!hasNonEmpty) {
      return { fields: Object.fromEntries(requestedKeys.map((k) => [k, ""])), warnings: [] };
    }

    const nonEmptyKeys = Object.keys(nonEmptyFields);
    const prompt = buildPrompt({ ...input, fields: nonEmptyFields });

    let response;
    try {
      response = await withTimeout(
        this.ai.models.generateContent({
          model: GEMINI_MODEL,
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "object",
              properties: Object.fromEntries(nonEmptyKeys.map((k) => [k, { type: "string" }])),
              required: nonEmptyKeys,
            },
          },
        }),
        TRANSLATE_TIMEOUT_MS
      );
    } catch (err) {
      if (err instanceof TranslationProviderError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      if (/rate limit|resource_exhausted|quota/i.test(message)) {
        throw new TranslationProviderError("Translation provider rate limit reached.", "RATE_LIMITED");
      }
      throw new TranslationProviderError(`Translation provider request failed: ${message}`, "UPSTREAM_ERROR");
    }

    const rawText = response.text;
    if (!rawText) {
      throw new TranslationProviderError("Translation provider returned an empty response.", "INVALID_RESPONSE");
    }

    const result = parseTranslationResponse(rawText, nonEmptyKeys);

    // Merge back the empty fields we skipped sending to the model.
    const fields: Record<string, string> = {};
    for (const key of requestedKeys) {
      fields[key] = key in result.fields ? result.fields[key] : "";
    }

    return { fields, warnings: result.warnings };
  }
}

export class OpenAiTranslationProvider implements TranslationProvider {
  constructor(private readonly apiKey: string) {}

  async translate(input: TranslationRequest): Promise<TranslationResult> {
    const requestedKeys = Object.keys(input.fields);
    const nonEmptyFields: Record<string, string> = {};
    let hasNonEmpty = false;
    for (const key of requestedKeys) {
      const val = input.fields[key];
      if (val && val.trim() !== "") {
        nonEmptyFields[key] = val;
        hasNonEmpty = true;
      }
    }

    if (!hasNonEmpty) {
      return { fields: Object.fromEntries(requestedKeys.map((k) => [k, ""])), warnings: [] };
    }

    const nonEmptyKeys = Object.keys(nonEmptyFields);
    const prompt = buildPrompt({ ...input, fields: nonEmptyFields });

    let response: Response;
    try {
      response = await withTimeout(
        fetch(OPENAI_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: GPT_MODEL,
            temperature: 0.2,
            response_format: { type: "json_object" },
            messages: [{ role: "user", content: prompt }],
          }),
        }),
        TRANSLATE_TIMEOUT_MS
      );
    } catch (err) {
      if (err instanceof TranslationProviderError) throw err;
      throw new TranslationProviderError(
        `Translation provider request failed: ${err instanceof Error ? err.message : String(err)}`,
        "UPSTREAM_ERROR"
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      if (response.status === 429) {
        throw new TranslationProviderError("Translation provider rate limit reached.", "RATE_LIMITED");
      }
      throw new TranslationProviderError(`Translation provider request failed: ${response.status} ${text}`, "UPSTREAM_ERROR");
    }

    const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const rawText = json.choices?.[0]?.message?.content;
    if (!rawText) {
      throw new TranslationProviderError("Translation provider returned an empty response.", "INVALID_RESPONSE");
    }

    const result = parseTranslationResponse(rawText, nonEmptyKeys);

    // Merge back the empty fields we skipped sending to the model.
    const fields: Record<string, string> = {};
    for (const key of requestedKeys) {
      fields[key] = key in result.fields ? result.fields[key] : "";
    }

    return { fields, warnings: result.warnings };
  }
}

export class OllamaTranslationProvider implements TranslationProvider {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string,
    private readonly apiKey?: string
  ) {}

  private async translateOne(content: string, sourceLocale?: string, targetLocale?: string): Promise<string> {
    if (!content || content.trim() === "") return "";

    if (isTranslateGemmaModel(this.model)) {
      return this.translateOneChat(content, sourceLocale, targetLocale);
    }
    return this.translateOneGenerate(content, sourceLocale, targetLocale);
  }

  private async translateOneGenerate(content: string, sourceLocale?: string, targetLocale?: string): Promise<string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    let response: Response;
    try {
      response = await withTimeout(
        fetch(`${this.baseUrl.replace(/\/+$/, "")}/api/generate`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: this.model,
            prompt: buildOllamaPrompt(content, sourceLocale, targetLocale),
            stream: false,
            // Hybrid-reasoning models (e.g. Qwen3) default to emitting a
            // chain-of-thought into `thinking` before the actual answer. On a
            // long prompt like this one, that reasoning alone can consume the
            // entire output budget (done_reason: "length") and leave the real
            // `response` empty. `think: false` skips straight to the answer;
            // it's a no-op for models that don't support hybrid thinking.
            think: false,
            // Low temperature to keep the model close to the literal source
            // text instead of drifting toward whatever it "already knows"
            // about a recognized real-world brand/product (see
            // buildOllamaPrompt()'s anti-hallucination rules for the primary
            // fix — this is a secondary guard against creative drift).
            options: { temperature: 0.1 },
          }),
        }),
        OLLAMA_TIMEOUT_MS
      );
    } catch (err) {
      if (err instanceof TranslationProviderError) throw err;
      throw new TranslationProviderError(
        `Translation provider request failed: ${err instanceof Error ? err.message : String(err)}`,
        "UPSTREAM_ERROR"
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      if (response.status === 429) {
        throw new TranslationProviderError("Translation provider rate limit reached.", "RATE_LIMITED");
      }
      throw new TranslationProviderError(`Translation provider request failed: ${response.status} ${text}`, "UPSTREAM_ERROR");
    }

    const json = (await response.json()) as { response?: string; done_reason?: string };
    if (!json.response) {
      const reason = json.done_reason === "length" ? " (model ran out of output tokens — try a smaller model or a shorter field)" : "";
      throw new TranslationProviderError(`Translation provider returned an empty response.${reason}`, "INVALID_RESPONSE");
    }
    return stripCodeFence(json.response).trim();
  }

  /**
   * TranslateGemma is served through Ollama's chat endpoint, not /api/generate
   * — see `buildTranslateGemmaPrompt()` for why it needs its own request shape.
   */
  private async translateOneChat(content: string, sourceLocale?: string, targetLocale?: string): Promise<string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    let response: Response;
    try {
      response = await withTimeout(
        fetch(`${this.baseUrl.replace(/\/+$/, "")}/api/chat`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: this.model,
            messages: [{ role: "user", content: buildTranslateGemmaPrompt(content, sourceLocale, targetLocale) }],
            stream: false,
            options: { temperature: 0.2, top_k: 64, top_p: 0.95, stop: ["<end_of_turn>"] },
          }),
        }),
        OLLAMA_TIMEOUT_MS
      );
    } catch (err) {
      if (err instanceof TranslationProviderError) throw err;
      throw new TranslationProviderError(
        `Translation provider request failed: ${err instanceof Error ? err.message : String(err)}`,
        "UPSTREAM_ERROR"
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      if (response.status === 429) {
        throw new TranslationProviderError("Translation provider rate limit reached.", "RATE_LIMITED");
      }
      throw new TranslationProviderError(`Translation provider request failed: ${response.status} ${text}`, "UPSTREAM_ERROR");
    }

    const json = (await response.json()) as { message?: { content?: string }; done_reason?: string };
    if (!json.message?.content) {
      const reason = json.done_reason === "length" ? " (model ran out of output tokens — try a shorter field)" : "";
      throw new TranslationProviderError(`Translation provider returned an empty response.${reason}`, "INVALID_RESPONSE");
    }
    return stripCodeFence(json.message.content).trim();
  }

  async translate(input: TranslationRequest): Promise<TranslationResult> {
    const requestedKeys = Object.keys(input.fields);
    const fields: Record<string, string> = {};

    // One plain-text call per field (the admin-specified prompt returns "just
    // the translation" for one piece of content, not a JSON object for many
    // fields at once) — run sequentially so a single Ollama instance isn't
    // hit with N concurrent generations for the same item.
    for (const key of requestedKeys) {
      fields[key] = await this.translateOne(input.fields[key], input.sourceLocale, input.targetLocale);
    }

    return { fields, warnings: [] };
  }
}

export type TranslationProviderKind = "gemini" | "gpt" | "ollama";

/**
 * Picks which provider to use. `TRANSLATION_PROVIDER` forces one explicitly;
 * otherwise, whichever was configured most recently wins: Ollama first (if
 * OLLAMA_BASE_URL is set), then GPT_API_KEY, then GEMINI_API_KEY.
 */
function resolveProviderKind(): TranslationProviderKind | null {
  const forced = process.env.TRANSLATION_PROVIDER?.trim().toLowerCase();
  if (forced === "ollama" || forced === "gpt" || forced === "gemini") return forced;
  if (process.env.OLLAMA_BASE_URL) return "ollama";
  if (process.env.GPT_API_KEY) return "gpt";
  if (process.env.GEMINI_API_KEY) return "gemini";
  return null;
}

/** Which provider `getTranslationProvider()` would return right now, or null if none is configured. */
export function getTranslationProviderKind(): TranslationProviderKind | null {
  return resolveProviderKind();
}

/** Whether any translation provider (Ollama, GPT, or Gemini) is configured. */
export function isTranslationProviderConfigured(): boolean {
  return resolveProviderKind() !== null;
}

/** The model name of the currently-active provider, or null if none is configured. */
export function getActiveTranslationModelName(): string | null {
  const kind = resolveProviderKind();
  if (kind === "ollama") return OLLAMA_MODEL;
  if (kind === "gpt") return GPT_MODEL;
  if (kind === "gemini") return GEMINI_MODEL;
  return null;
}

export interface AvailableTranslationProvider {
  kind: TranslationProviderKind;
  label: string;
  /** The model that would be used if the caller doesn't override it (env default). */
  defaultModel: string;
  /** Whether this provider's required credentials are present, independent of which one auto-resolution would pick. */
  configured: boolean;
}

/**
 * Every provider kind the admin UI could let someone pick, each flagged with
 * whether its own credentials are actually present — independent of which one
 * `resolveProviderKind()` would auto-pick. Lets the UI offer e.g. Gemini even
 * when Ollama is the auto-resolved default, as long as GEMINI_API_KEY is set.
 */
export function listAvailableTranslationProviders(): AvailableTranslationProvider[] {
  return [
    { kind: "ollama", label: "Ollama (self-hosted)", defaultModel: OLLAMA_MODEL, configured: Boolean(process.env.OLLAMA_BASE_URL) },
    { kind: "gpt", label: "GPT / OpenAI", defaultModel: GPT_MODEL, configured: Boolean(process.env.GPT_API_KEY) },
    { kind: "gemini", label: "Gemini", defaultModel: GEMINI_MODEL, configured: Boolean(process.env.GEMINI_API_KEY) },
  ];
}

/**
 * Lists model tags currently pulled on the configured Ollama server (via its
 * native /api/tags endpoint), so the UI can offer a real choice instead of
 * just the single OLLAMA_MODEL env default. Returns [] if Ollama isn't
 * configured or the server can't be reached — never throws, this is only for
 * populating an optional picker.
 */
export async function listOllamaModels(): Promise<string[]> {
  if (!process.env.OLLAMA_BASE_URL) return [];
  try {
    const headers: Record<string, string> = {};
    if (process.env.OLLAMA_API_KEY) headers.Authorization = `Bearer ${process.env.OLLAMA_API_KEY}`;
    const res = await fetch(`${process.env.OLLAMA_BASE_URL.replace(/\/+$/, "")}/api/tags`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { models?: Array<{ name: string }> };
    return (json.models || []).map((m) => m.name).filter(Boolean);
  } catch {
    return [];
  }
}

/** Explicitly picks a provider kind (and optionally a specific model), bypassing env-based auto-resolution. */
export interface TranslationProviderOverride {
  kind: TranslationProviderKind;
  model?: string;
}

// A faithful translation's length should track its source's length reasonably
// closely — VI<->EN technical text rarely swings past ~1.8x either way. A
// ratio outside this band is the same "hallucinated/rewritten instead of
// translated" failure mode the prompts above forbid, so it's flagged as a
// warning for the human reviewer even though the prompt is the primary
// defense. Source strings under this length are skipped — too short for the
// ratio to mean anything (e.g. "OK" -> "Understood." isn't a red flag).
const LENGTH_DRIFT_MIN_SOURCE_LENGTH = 20;
const LENGTH_DRIFT_MAX_RATIO = 1.8;
const LENGTH_DRIFT_MIN_RATIO = 1 / LENGTH_DRIFT_MAX_RATIO;

function checkLengthDrift(sourceFields: Record<string, string>, translatedFields: Record<string, string>): string[] {
  const warnings: string[] = [];
  for (const [key, translated] of Object.entries(translatedFields)) {
    const source = sourceFields[key];
    if (!source || source.length < LENGTH_DRIFT_MIN_SOURCE_LENGTH || !translated) continue;
    const ratio = translated.length / source.length;
    if (ratio > LENGTH_DRIFT_MAX_RATIO || ratio < LENGTH_DRIFT_MIN_RATIO) {
      warnings.push(
        `Field "${key}": bản dịch dài ${ratio.toFixed(1)}x so với bản gốc (${source.length} → ${translated.length} ký tự) — có thể AI đã bịa thêm hoặc bỏ sót nội dung, cần đối chiếu kỹ trước khi lưu.`
      );
    }
  }
  return warnings;
}

/** Wraps any provider to flag suspicious length drift between source and translated text — see `checkLengthDrift()`. */
class LengthDriftGuardProvider implements TranslationProvider {
  constructor(private readonly inner: TranslationProvider) {}

  async translate(input: TranslationRequest): Promise<TranslationResult> {
    const result = await this.inner.translate(input);
    const driftWarnings = checkLengthDrift(input.fields, result.fields);
    return { fields: result.fields, warnings: [...result.warnings, ...driftWarnings] };
  }
}

function buildProvider(kind: TranslationProviderKind, model?: string): TranslationProvider {
  let provider: TranslationProvider;
  if (kind === "ollama") {
    if (!process.env.OLLAMA_BASE_URL) {
      throw new TranslationProviderError("OLLAMA_BASE_URL is not configured.", "NOT_CONFIGURED");
    }
    provider = new OllamaTranslationProvider(process.env.OLLAMA_BASE_URL, model || OLLAMA_MODEL, process.env.OLLAMA_API_KEY);
  } else if (kind === "gpt") {
    if (!process.env.GPT_API_KEY) {
      throw new TranslationProviderError("GPT_API_KEY is not configured.", "NOT_CONFIGURED");
    }
    provider = new OpenAiTranslationProvider(process.env.GPT_API_KEY);
  } else {
    if (!process.env.GEMINI_API_KEY) {
      throw new TranslationProviderError("GEMINI_API_KEY is not configured.", "NOT_CONFIGURED");
    }
    provider = new GeminiTranslationProvider(process.env.GEMINI_API_KEY);
  }
  return new LengthDriftGuardProvider(provider);
}

let cachedProvider: TranslationProvider | null = null;
let cachedProviderKind: TranslationProviderKind | null = null;

/**
 * Returns a translation provider. With no argument, auto-resolves and caches
 * per `resolveProviderKind()` (Ollama, GPT, or Gemini — whichever env vars
 * pick). Pass `override` to explicitly pick a provider kind (and, for Ollama,
 * a specific model tag) instead — e.g. from a UI model selector; overridden
 * instances are built fresh each call, not cached, since they're one-off.
 */
export function getTranslationProvider(override?: TranslationProviderOverride): TranslationProvider {
  if (override) return buildProvider(override.kind, override.model);

  const kind = resolveProviderKind();
  if (!kind) {
    throw new TranslationProviderError(
      "None of OLLAMA_BASE_URL, GPT_API_KEY, or GEMINI_API_KEY is configured. Cannot translate content.",
      "NOT_CONFIGURED"
    );
  }
  if (cachedProvider && cachedProviderKind === kind) return cachedProvider;

  cachedProvider = buildProvider(kind);
  cachedProviderKind = kind;
  return cachedProvider;
}
