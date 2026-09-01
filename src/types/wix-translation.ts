/**
 * wix-translation.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared types for the standalone "Wix Multilingual Translator" admin feature
 * (/admin/wix-translations). Distinct from the older, product-popup-embedded
 * `@/types/translation.ts` types, which a different entry point still uses.
 */

export type TranslationMode = "preview" | "draft" | "publish";

export type CmsFieldValueType = "SHORT_TEXT" | "LONG_TEXT" | "HTML";

export type TranslationProviderKindValue = "gemini" | "gpt" | "ollama";

export interface TranslatableFieldDef {
  key: string;
  displayName: string;
  type: CmsFieldValueType;
}

/** One item's edited translation submitted back to the server for draft/publish. */
export interface TranslateAndSyncItemInput {
  itemId: string;
  /** Field values as reviewed/edited by the admin. Required for draft/publish, ignored for preview. */
  fieldValues?: Record<string, string>;
  /** sha256 hash of the source fields at preview time, used to detect a stale/changed source. */
  sourceHash?: string;
}

export interface TranslateAndSyncWixCmsItemsInput {
  collectionKey: string;
  /** Item IDs to process. For draft/publish, `items[].itemId` is used instead if provided. */
  itemIds: string[];
  /** Per-item edited field values + source hash — required for draft/publish. */
  items?: TranslateAndSyncItemInput[];
  sourceLocale: string;
  targetLocale: string;
  fieldKeys: string[];
  mode: TranslationMode;
  /** Re-translate/overwrite fields that already have a saved translation. */
  overwriteExisting?: boolean;
  /** Explicit AI provider to translate with, instead of the env-auto-resolved default. Only consulted in preview mode — draft/publish never call the provider. */
  providerKind?: TranslationProviderKindValue;
  /** Specific model tag to use with `providerKind` (Ollama only — Gemini/GPT have one fixed model each). Ignored without providerKind. */
  providerModel?: string;
}

export type TranslationItemStatus = "success" | "failed" | "skipped";

export type TranslationItemAction =
  | "previewed"
  | "created"
  | "updated"
  | "published"
  | "skipped";

export interface TranslationItemResult {
  itemId: string;
  itemName?: string;
  status: TranslationItemStatus;
  action: TranslationItemAction;
  sourceFields?: Record<string, string>;
  translatedFields?: Record<string, string>;
  sourceHash?: string;
  message?: string;
}

export interface TranslateAndSyncWixCmsItemsResult {
  success: boolean;
  mode: TranslationMode;
  sourceLocale: string;
  targetLocale: string;
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  items: TranslationItemResult[];
}

// ── /config response ────────────────────────────────────────────────────────

export type CmsTranslationStatus = "none" | "draft" | "published";

export interface AvailableTranslationProviderInfo {
  kind: TranslationProviderKindValue;
  label: string;
  defaultModel: string;
  configured: boolean;
}

export interface WixTranslationConfigResponse {
  collections: Array<{ key: string; label: string }>;
  locales: Array<{ id: string; languageCode: string; label: string; isPrimary: boolean }>;
  defaultSourceLocale: string | null;
  defaultTargetLocale: string | null;
  fields: TranslatableFieldDef[];
  maxBatchSize: number;
  translationProvider: { name: string; configured: boolean };
  /** Every provider kind the model picker can offer, each flagged with whether its own credentials are configured. */
  availableProviders: AvailableTranslationProviderInfo[];
  /** Model tags currently pulled on the configured Ollama server, for the model picker (empty if Ollama isn't configured/reachable). */
  ollamaModels: string[];
  wixConfigured: boolean;
  multilingualReady: boolean;
  warnings: string[];
}

// ── /items response ──────────────────────────────────────────────────────────

export interface WixTranslationListItem {
  itemId: string;
  name: string;
  updatedDate?: string;
  translationStatus: CmsTranslationStatus;
  /** Display names of translatable fields with no saved translation yet for the requested target locale, e.g. "Product Overview", "Series". */
  untranslatedFields: string[];
}

export interface WixTranslationItemsResponse {
  items: WixTranslationListItem[];
  page: number;
  limit: number;
  total: number;
}

// ── /content response (read-only viewer for an item's saved translation) ────

export interface WixTranslatedContentField {
  key: string;
  displayName: string;
  type: CmsFieldValueType;
  sourceValue: string;
  translatedValue: string | null;
  published: boolean;
}

export interface WixTranslatedContentResponse {
  itemId: string;
  itemName: string;
  targetLocale: string;
  status: CmsTranslationStatus;
  fields: WixTranslatedContentField[];
}
