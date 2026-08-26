/**
 * translation-provider.service.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Adapts the project's existing Gemini-backed translation provider
 * (`@/lib/services/translationProvider`) to the `TranslationProvider`
 * interface this feature's spec defines. No second AI provider/config is
 * introduced — this is a thin shape adapter over the one already in use.
 */

import {
  getTranslationProvider as getGeminiProvider,
  TranslationProviderError,
} from "@/lib/services/translationProvider";

export interface TranslationRequest {
  sourceLocale: string;
  targetLocale: string;
  fields: Record<string, string>;
  context?: { itemName?: string; brand?: string; category?: string };
}

export interface TranslationResult {
  fields: Record<string, string>;
  provider: string;
  model?: string;
  translatedAt: string;
}

export interface TranslationProvider {
  translate(request: TranslationRequest): Promise<TranslationResult>;
}

const PROVIDER_NAME = "gemini";
const MODEL_NAME = "gemini-2.5-pro";

export { TranslationProviderError };

/** Whether a translation provider is configured (checked without throwing). */
export function isTranslationProviderConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function getTranslationProviderName(): string {
  return PROVIDER_NAME;
}

class GeminiTranslationProviderAdapter implements TranslationProvider {
  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const provider = getGeminiProvider();
    const result = await provider.translate({
      fields: request.fields,
      context: {
        brand: request.context?.brand,
        category: request.context?.category,
        productName: request.context?.itemName,
      },
    });
    return {
      fields: result.fields,
      provider: PROVIDER_NAME,
      model: MODEL_NAME,
      translatedAt: new Date().toISOString(),
    };
  }
}

let cached: TranslationProvider | null = null;

/** Returns the configured translation provider adapter. Throws NOT_CONFIGURED if no API key is set. */
export function getWixTranslationProvider(): TranslationProvider {
  if (!isTranslationProviderConfigured()) {
    throw new TranslationProviderError(
      "Translation provider chưa được cấu hình (thiếu GEMINI_API_KEY).",
      "NOT_CONFIGURED"
    );
  }
  if (!cached) cached = new GeminiTranslationProviderAdapter();
  return cached;
}
