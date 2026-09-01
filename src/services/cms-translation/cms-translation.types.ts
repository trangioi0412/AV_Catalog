/**
 * cms-translation.types.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared types for the CMS field-pair translator: reads an English field
 * directly off a Wix CMS item and writes the Vietnamese translation into a
 * separate, sibling field on the SAME item (e.g. `title_EN` -> `title_VI`).
 *
 * This is a different data model from the "Wix Multilingual Translator"
 * feature (`@/types/wix-translation`), which uses Wix's Translation Schema /
 * Translation Content APIs — one logical field with per-locale content
 * layered on top via a separate store. Here, English and Vietnamese are two
 * ordinary, independent fields that already coexist on the same CMS item, so
 * plain Wix Data Items reads/writes are enough; no Translation Content API
 * involved.
 *
 * Two-step, human-in-the-loop flow — never translate-and-write in one call:
 *   1. mode "preview": AI-translates the selected fields and returns them for
 *      review; never touches Wix.
 *   2. mode "write": writes back exactly the (admin-approved, possibly
 *      hand-edited) values from that review — never calls the AI provider
 *      again, so what gets written is what a human actually checked.
 */

export type CmsFieldContentType = "text" | "richText";

export interface FieldMapping {
  sourceField: string;
  /**
   * May equal `sourceField` for a field with no separate VI sibling — an
   * "in place" translation that overwrites the English source once approved.
   * Always requires `overwrite: true` (see `TranslateCmsOptions`), since the
   * source and target would otherwise read the same already-populated value.
   */
  targetField: string;
  type: CmsFieldContentType;
}

export type CmsTranslationMode = "preview" | "write";

export type CmsTranslationItemStatus = "translated" | "updated" | "skipped" | "failed";

/** One item's admin-approved field values, submitted back for mode "write". */
export interface TranslateCmsItemInput {
  itemId: string;
  /** targetField -> the value to write, as reviewed/edited by the admin after preview. */
  fieldValues: Record<string, string>;
}

export interface TranslateCmsOptions {
  /** Resolved server-side against the collection allowlist — never a raw Wix collection ID from the client. */
  collectionKey: string;
  fieldMappings: FieldMapping[];
  mode: CmsTranslationMode;
  /** mode "preview": items to translate. Required for "preview" — omit to auto-discover (paginated, bounded — see the service). */
  itemIds?: string[];
  /** mode "write": the admin-approved field values per item, from a prior preview. Required for "write". */
  items?: TranslateCmsItemInput[];
  /** Whether a target field that already has content may be translated (preview) or overwritten (write). Default false. */
  overwrite?: boolean;
  /** Items processed per page (when itemIds isn't given) and read concurrency. Default 5, capped at 20. */
  batchSize?: number;
}

export interface CmsTranslationFieldPreview {
  source: string;
  translated: string;
}

export interface TranslateCmsItemResult {
  itemId: string;
  name: string;
  status: CmsTranslationItemStatus;
  /** Target field keys that were (mode "write") or would be (mode "preview") written. */
  translatedFields?: string[];
  /** Only populated for mode "preview" — source/translated text per target field, for the review UI. */
  fieldValues?: Record<string, CmsTranslationFieldPreview>;
  /** Why the item was skipped, e.g. "Target field already contains data". */
  reason?: string;
  /** Failure message, e.g. an empty AI response or a Wix API error. */
  error?: string;
}

export interface TranslateCmsSummary {
  total: number;
  translated: number;
  updated: number;
  skipped: number;
  failed: number;
}

export interface TranslateCmsResult {
  success: boolean;
  mode: CmsTranslationMode;
  summary: TranslateCmsSummary;
  items: TranslateCmsItemResult[];
}
