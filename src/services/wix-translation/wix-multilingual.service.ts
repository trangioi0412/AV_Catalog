/**
 * wix-multilingual.service.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Re-exports the project's existing Wix Multilingual REST client
 * (`@/lib/services/wixMultilingual`) under the file location this feature's
 * spec expects, and adds a bounded-retry verification helper for the
 * eventual-consistency window right after a write.
 *
 * Writing translated content into a translatable Wix CMS collection MUST go
 * through the Translation Schema / Translation Content APIs re-exported here
 * — never the plain Wix Data Items API with a locale, which Wix rejects
 * (WDE0175) for the non-primary locale.
 */

export {
  listSiteSchemas,
  findCollectionSchema,
  getTranslatableFields,
  listLocales,
  isLocaleAvailable,
  queryContentForEntity,
  bulkCreateContent,
  bulkUpdateContentByKey,
  correlateResults,
  WixMultilingualError,
  type TranslationSchema,
  type TranslationSchemaFieldDef,
  type WixLocale,
  type TranslationContent,
  type TranslationContentField,
  type BulkContentInput,
  type BulkContentResult,
  type WixMultilingualErrorCode,
} from "@/lib/services/wixMultilingual";

import { queryContentForEntity, type TranslationContent } from "@/lib/services/wixMultilingual";

/**
 * Re-queries translation content a few times to ride out Wix's eventual
 * consistency window right after a create/update write, instead of a single
 * query that might race the write.
 */
export async function verifyTranslationContent(
  schemaId: string,
  entityId: string,
  locale: string,
  attempts = 3,
  delayMs = 400
): Promise<TranslationContent | null> {
  for (let i = 0; i < attempts; i++) {
    const content = await queryContentForEntity(schemaId, entityId, locale);
    if (content) return content;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}
