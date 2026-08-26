/**
 * wix-translation.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared types for the standalone "Wix Multilingual Translator" admin feature
 * (/admin/wix-translations). Distinct from the older, product-popup-embedded
 * `@/types/translation.ts` types, which a different entry point still uses.
 */

export type TranslationMode = "preview" | "draft" | "publish";

export type CmsFieldValueType = "SHORT_TEXT" | "LONG_TEXT" | "HTML";

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

export interface WixTranslationConfigResponse {
  collections: Array<{ key: string; label: string }>;
  locales: Array<{ id: string; languageCode: string; label: string; isPrimary: boolean }>;
  defaultSourceLocale: string | null;
  defaultTargetLocale: string | null;
  fields: TranslatableFieldDef[];
  maxBatchSize: number;
  translationProvider: { name: string; configured: boolean };
  wixConfigured: boolean;
  multilingualReady: boolean;
  warnings: string[];
}

// ── /items response ──────────────────────────────────────────────────────────

export interface WixTranslationListItem {
  itemId: string;
  name: string;
  model?: string;
  brand?: string;
  updatedDate?: string;
  translationStatus: CmsTranslationStatus;
}

export interface WixTranslationItemsResponse {
  items: WixTranslationListItem[];
  page: number;
  limit: number;
  total: number;
}
