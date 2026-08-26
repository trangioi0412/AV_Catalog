/**
 * translation.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared type definitions for the Wix CMS → Wix Multilingual product
 * translation feature (VI → EN, review + save to Wix Multilingual).
 */

/** A single translatable field, as declared by the Wix Multilingual translation schema. */
export interface TranslatableFieldDef {
  key: string;
  displayName: string;
}

/** Per-field VI source + EN draft, shown side by side in the review UI. */
export interface TranslationFieldPair {
  key: string;
  displayName: string;
  original: string;
  translated: string;
}

export type TranslationItemStatus = "success" | "failed" | "skipped";

/** One row of the generate/save batch result, returned per selected CMS item. */
export interface TranslationItemResult {
  entityId: string;
  name: string;
  status: TranslationItemStatus;
  message?: string;
  /** Present only on a successful /generate result. */
  fields?: TranslationFieldPair[];
  /** Whether an "en" translation already exists in Wix Multilingual for this item. */
  hasExistingTranslation?: boolean;
}

export interface GenerateTranslationsResponse {
  schemaId: string;
  collectionId: string;
  locale: string;
  translatableFields: TranslatableFieldDef[];
  items: TranslationItemResult[];
}

export interface SaveTranslationItemInput {
  entityId: string;
  name: string;
  fields: Record<string, string>;
  /** User has confirmed overwriting an existing "en" translation for this item. */
  overwrite: boolean;
}

export interface SaveTranslationsResponse {
  schemaId: string;
  collectionId: string;
  locale: string;
  published: boolean;
  items: TranslationItemResult[];
}
