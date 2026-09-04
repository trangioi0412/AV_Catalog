/**
 * translation-provider.service.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Adapts the project's existing translation provider selection
 * (`@/lib/services/translationProvider` — GPT or Gemini, whichever is
 * configured) to the `TranslationProvider` interface this feature's spec
 * defines. No separate AI provider/config is introduced here — this is a
 * thin shape adapter over the one already in use.
 */

import {
  getTranslationProvider as getConfiguredProvider,
  getTranslationProviderKind,
  getActiveTranslationModelName,
  getSafeConcurrency,
  isTranslationProviderConfigured as isAnyProviderConfigured,
  listAvailableTranslationProviders,
  listOllamaModels,
  TranslationProviderError,
  type TranslationProviderKind,
  type TranslationProviderOverride,
} from "@/lib/services/translationProvider";

export { listAvailableTranslationProviders, listOllamaModels, getTranslationProviderKind, getSafeConcurrency };
export type { TranslationProviderKind, TranslationProviderOverride };

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
  /** Non-fatal issues from the translation (e.g. suspicious length drift vs. source) for the reviewer to check. */
  warnings: string[];
}

export interface TranslationProvider {
  translate(request: TranslationRequest): Promise<TranslationResult>;
}

export { TranslationProviderError };

/** Whether a translation provider (GPT or Gemini) is configured (checked without throwing). */
export function isTranslationProviderConfigured(): boolean {
  return isAnyProviderConfigured();
}

/** Name of whichever provider is currently active ("ollama" | "gpt" | "gemini"), or "none". */
export function getTranslationProviderName(): string {
  return getTranslationProviderKind() || "none";
}

class ConfiguredTranslationProviderAdapter implements TranslationProvider {
  constructor(private readonly override?: TranslationProviderOverride) {}

  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const provider = getConfiguredProvider(this.override);
    const result = await provider.translate({
      fields: request.fields,
      sourceLocale: request.sourceLocale,
      targetLocale: request.targetLocale,
      context: {
        brand: request.context?.brand,
        category: request.context?.category,
        productName: request.context?.itemName,
      },
    });
    return {
      fields: result.fields,
      provider: this.override?.kind ?? getTranslationProviderName(),
      model: this.override?.model ?? getActiveTranslationModelName() ?? undefined,
      translatedAt: new Date().toISOString(),
      warnings: result.warnings,
    };
  }
}

let cached: TranslationProvider | null = null;

/**
 * Returns the translation provider adapter. With no argument, uses whichever
 * provider is env-auto-resolved (cached) — throws NOT_CONFIGURED if none of
 * OLLAMA_BASE_URL, GPT_API_KEY, or GEMINI_API_KEY is set. Pass `override` to
 * explicitly pick a provider kind (and, for Ollama, a specific model tag)
 * instead, e.g. from a UI model selector — bypasses the NOT_CONFIGURED check
 * above since `getTranslationProvider()` validates the override's own
 * credentials itself.
 */
export function getWixTranslationProvider(override?: TranslationProviderOverride): TranslationProvider {
  if (override) return new ConfiguredTranslationProviderAdapter(override);

  if (!isTranslationProviderConfigured()) {
    throw new TranslationProviderError(
      "Translation provider chưa được cấu hình (thiếu OLLAMA_BASE_URL, GPT_API_KEY, hoặc GEMINI_API_KEY).",
      "NOT_CONFIGURED"
    );
  }
  if (!cached) cached = new ConfiguredTranslationProviderAdapter();
  return cached;
}
