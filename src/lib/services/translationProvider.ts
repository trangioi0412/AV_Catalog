/**
 * translationProvider.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Vietnamese → English text translation for AV product content, tuned for
 * professional Audio Visual System terminology. Reuses the project's existing
 * Gemini configuration (GEMINI_API_KEY / @google/genai — see geminiEnricher.ts)
 * rather than introducing a second translation provider/config.
 *
 * Server-only: never import this from a Client Component.
 */

import { GoogleGenAI } from "@google/genai";
import { AV_GLOSSARY_TERMS } from "@/config/translation-glossary";

const GEMINI_MODEL = "gemini-2.5-pro";
const TRANSLATE_TIMEOUT_MS = 30000;

/** Brand names, protocols, and standards that must be carried over verbatim, never translated. */
const AV_PROTECTED_TERMS = AV_GLOSSARY_TERMS;

export interface TranslationRequest {
  /** field key -> Vietnamese source text */
  fields: Record<string, string>;
  context?: { brand?: string; category?: string; productName?: string };
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

Rules:
- Be technically accurate and use professional, formal AV industry English.
- Do not add, remove, or invent any information that is not in the source text.
- Never translate brand names, model numbers, units, or these protocol/standard/product names — copy them verbatim wherever they appear: ${AV_PROTECTED_TERMS.join(", ")}.
- Preserve any HTML tags, links, numbers, and formatting exactly as they appear in the source.
- If a source field is an empty string, return it as an empty string. Do not fabricate content for it.
- Return ONLY a JSON object with exactly the same field keys as the input, each mapped to its English translation.

${contextLines.length > 0 ? contextLines.join("\n") + "\n\n" : ""}Fields to translate (JSON):
${JSON.stringify(fields, null, 2)}`;
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

let cachedProvider: TranslationProvider | null = null;

/** Returns the configured translation provider, reusing the app's existing GEMINI_API_KEY. */
export function getTranslationProvider(): TranslationProvider {
  if (cachedProvider) return cachedProvider;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new TranslationProviderError(
      "GEMINI_API_KEY is not configured. Cannot translate content.",
      "NOT_CONFIGURED"
    );
  }
  cachedProvider = new GeminiTranslationProvider(apiKey);
  return cachedProvider;
}
