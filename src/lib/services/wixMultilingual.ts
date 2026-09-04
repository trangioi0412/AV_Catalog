/**
 * wixMultilingual.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Server-side service for the Wix Multilingual Translation APIs
 * (Translation Schema + Translation Content). Used to translate Wix CMS
 * product data (collection "Import1") into the site's "en" locale.
 *
 * IMPORTANT: translations for a translatable CMS collection can NOT be written
 * with the regular Wix Data Items API using a locale — Wix rejects that with
 * WDE0175 ("Updates to translatable collections are not supported in the
 * non-primary language"). All reads/writes here go through the dedicated
 * Translation Schema / Translation Content REST APIs instead:
 *   - List Site Schemas:        GET  /translation-schema/v1/schemas/site
 *   - Query Translation Contents: POST /translation-content/v1/contents/query
 *   - Bulk Create Content:      POST /translation-content/v1/bulk/contents/create
 *   - Bulk Update Content By Key: POST /translation-content/v1/bulk/contents/update-by-key
 *   - Query Locales:            POST /locales/v2/locale/query
 *
 * Endpoints and field shapes verified live against this site on 2026-08-26
 * (see dev.wix.com/docs/api-reference/business-management/multilingual).
 */

import type { TranslatableFieldDef } from "@/types/translation";

const TRANSLATION_SCHEMA_API = "https://www.wixapis.com/translation-schema/v1";
const TRANSLATION_CONTENT_API = "https://www.wixapis.com/translation-content/v1";
const LOCALES_API = "https://www.wixapis.com/locales/v2";
const WIX_DATA_API = "https://www.wixapis.com/wix-data/v2";

const FETCH_TIMEOUT_MS = 15000;

/**
 * Wix Multilingual field types whose value round-trips through `textValue`.
 * Anything else (IMAGE, reference/media types) is never offered for translation.
 */
const TEXT_FIELD_TYPES = new Set(["SHORT_TEXT", "LONG_TEXT", "HTML"]);

/**
 * Safety denylist applied on top of the schema, even if Wix Multilingual marks
 * these as translatable fields. `product` is the model code, `datasheet` is a
 * document URL, and `specEN`/`faqEN` are separate manually-curated English
 * fields already stored on the primary-locale item — none of these should be
 * run through machine translation.
 */
const NEVER_TRANSLATE_FIELD_KEYS = new Set(["_id", "product", "datasheet", "specEN", "faqEN"]);

export type WixMultilingualErrorCode =
  | "NOT_CONFIGURED"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "RATE_LIMITED"
  | "UPSTREAM_ERROR"
  | "SCHEMA_NOT_FOUND"
  | "LOCALE_NOT_AVAILABLE";

export class WixMultilingualError extends Error {
  readonly status: number;
  readonly code: WixMultilingualErrorCode;

  constructor(message: string, status: number, code: WixMultilingualErrorCode) {
    super(message);
    this.name = "WixMultilingualError";
    this.status = status;
    this.code = code;
  }
}

function getWixHeaders(): Record<string, string> {
  const apiKey = process.env.WIX_API_KEY;
  const siteId = process.env.WIX_SITE_ID;
  if (!apiKey || !siteId) {
    throw new WixMultilingualError(
      "Wix credentials (WIX_API_KEY, WIX_SITE_ID) are not configured.",
      503,
      "NOT_CONFIGURED"
    );
  }
  return {
    "Content-Type": "application/json",
    Authorization: apiKey,
    "wix-site-id": siteId,
  };
}

async function wixFetch(url: string, init: RequestInit): Promise<unknown> {
  const headers = getWixHeaders();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers, signal: controller.signal, cache: "no-store" });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new WixMultilingualError(`Wix API request timed out: ${url}`, 504, "TIMEOUT");
    }
    throw new WixMultilingualError(`Wix API network error: ${err instanceof Error ? err.message : String(err)}`, 502, "NETWORK_ERROR");
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const code: WixMultilingualErrorCode = res.status === 429 ? "RATE_LIMITED" : "UPSTREAM_ERROR";
    throw new WixMultilingualError(`Wix API error ${res.status} for ${url}: ${text}`, res.status, code);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// TRANSLATION SCHEMA
// ─────────────────────────────────────────────────────────────────────────────

export interface TranslationSchemaFieldDef {
  id: string;
  type: string;
  displayName: string;
  hidden?: boolean;
  displayOnly?: boolean;
}

export interface TranslationSchema {
  id: string;
  key: { appId: string; entityType: string; scope: string };
  displayName: string;
  fields: Record<string, TranslationSchemaFieldDef>;
}

let schemaListCache: { schemas: TranslationSchema[]; fetchedAt: number } | null = null;
const SCHEMA_CACHE_TTL_MS = 5 * 60 * 1000;

/** Lists every translation schema installed on the site (all apps, all scopes). */
export async function listSiteSchemas(forceRefresh = false): Promise<TranslationSchema[]> {
  if (!forceRefresh && schemaListCache && Date.now() - schemaListCache.fetchedAt < SCHEMA_CACHE_TTL_MS) {
    return schemaListCache.schemas;
  }
  const json = (await wixFetch(`${TRANSLATION_SCHEMA_API}/schemas/site`, { method: "GET" })) as {
    schemas?: TranslationSchema[];
  } | null;
  const schemas: TranslationSchema[] = json?.schemas || [];
  schemaListCache = { schemas, fetchedAt: Date.now() };
  return schemas;
}

/**
 * Finds the SITE-scope translation schema for a Wix CMS collection, matching
 * `key.entityType` to the collection ID. Honors an optional
 * `WIX_TRANSLATION_SCHEMA_ID` env override before falling back to auto-discovery,
 * per the project's "don't hard-code the schema ID unless forced to" rule.
 */
export async function findCollectionSchema(collectionId: string): Promise<TranslationSchema | null> {
  const overrideId = process.env.WIX_TRANSLATION_SCHEMA_ID;
  if (overrideId) {
    try {
      const json = (await wixFetch(`${TRANSLATION_SCHEMA_API}/schemas/${overrideId}`, { method: "GET" })) as {
        schema?: TranslationSchema;
      } | null;
      if (json?.schema) return json.schema;
    } catch (err) {
      console.warn(
        `[Wix Multilingual] WIX_TRANSLATION_SCHEMA_ID=${overrideId} could not be read, falling back to auto-discovery:`,
        err
      );
    }
  }

  const schemas = await listSiteSchemas();
  return (
    schemas.find((s) => s.key?.scope === "SITE" && s.key?.entityType === collectionId) || null
  );
}

/** Derives the machine-translatable field allowlist for a schema (text fields only, minus the denylist). */
export function getTranslatableFields(schema: TranslationSchema): TranslatableFieldDef[] {
  return Object.values(schema.fields)
    .filter(
      (f) =>
        TEXT_FIELD_TYPES.has(f.type) &&
        !f.hidden &&
        !f.displayOnly &&
        !NEVER_TRANSLATE_FIELD_KEYS.has(f.id)
    )
    .map((f) => ({ key: f.id, displayName: f.displayName || f.id }));
}

// ─────────────────────────────────────────────────────────────────────────────
// LOCALES
// ─────────────────────────────────────────────────────────────────────────────

export interface WixLocale {
  id: string;
  languageCode: string;
  visibility: string;
  primaryLocale: boolean;
}

let localesCache: { locales: WixLocale[]; fetchedAt: number } | null = null;
const LOCALES_CACHE_TTL_MS = 5 * 60 * 1000;

export async function listLocales(forceRefresh = false): Promise<WixLocale[]> {
  if (!forceRefresh && localesCache && Date.now() - localesCache.fetchedAt < LOCALES_CACHE_TTL_MS) {
    return localesCache.locales;
  }
  const json = (await wixFetch(`${LOCALES_API}/locale/query`, {
    method: "POST",
    body: JSON.stringify({ query: {} }),
  })) as { locales?: WixLocale[] } | null;
  const locales: WixLocale[] = json?.locales || [];
  localesCache = { locales, fetchedAt: Date.now() };
  return locales;
}

export async function isLocaleAvailable(localeId: string): Promise<boolean> {
  const locales = await listLocales();
  return locales.some((l) => l.id === localeId && l.visibility === "VISIBLE");
}

// ─────────────────────────────────────────────────────────────────────────────
// TRANSLATION CONTENT
// ─────────────────────────────────────────────────────────────────────────────

export interface TranslationContentField {
  id?: string;
  textValue?: string;
  published?: boolean;
  updatedBy?: string;
  numberOfWords?: number;
}

export interface TranslationContent {
  id: string;
  schemaId: string;
  entityId: string;
  locale: string;
  fields: Record<string, TranslationContentField>;
  publishStatus?: string;
}

/** Queries the existing translation content for one entity + locale (null if none exists yet). */
export async function queryContentForEntity(
  schemaId: string,
  entityId: string,
  locale: string
): Promise<TranslationContent | null> {
  const json = (await wixFetch(`${TRANSLATION_CONTENT_API}/contents/query`, {
    method: "POST",
    body: JSON.stringify({
      query: {
        filter: { schemaId, entityId, locale },
        cursorPaging: { limit: 1 },
      },
    }),
  })) as { contents?: TranslationContent[] } | null;
  const contents: TranslationContent[] = json?.contents || [];
  return contents[0] || null;
}

export interface BulkContentInput {
  schemaId: string;
  entityId: string;
  locale: string;
  fields: Record<string, { textValue: string; published: boolean }>;
}

export interface BulkContentResult {
  entityId: string;
  success: boolean;
  error?: string;
}

/** Shape of one `results[]` entry returned by the Bulk Create / Bulk Update Content By Key APIs. */
interface RawBulkResult {
  itemMetadata?: {
    originalIndex: number;
    success: boolean;
    error?: { description?: string };
  };
}

/** Maps `contents[]` inputs 1:1 to their `entityId` for correlating bulk results back by `originalIndex`. */
export function correlateResults(inputs: BulkContentInput[], results: RawBulkResult[]): BulkContentResult[] {
  return results.map((r) => {
    const idx = r.itemMetadata?.originalIndex ?? -1;
    const entityId = inputs[idx]?.entityId ?? "unknown";
    const success = !!r.itemMetadata?.success;
    return {
      entityId,
      success,
      error: success ? undefined : r.itemMetadata?.error?.description || "Unknown Wix Multilingual error.",
    };
  });
}

export async function bulkCreateContent(inputs: BulkContentInput[]): Promise<BulkContentResult[]> {
  if (inputs.length === 0) return [];
  const json = (await wixFetch(`${TRANSLATION_CONTENT_API}/bulk/contents/create`, {
    method: "POST",
    body: JSON.stringify({
      contents: inputs.map((c) => ({
        schemaId: c.schemaId,
        entityId: c.entityId,
        locale: c.locale,
        fields: Object.fromEntries(
          Object.entries(c.fields).map(([key, v]) => [
            key,
            { id: key, textValue: v.textValue, published: v.published, updatedBy: "USER" },
          ])
        ),
      })),
      returnEntity: false,
    }),
  })) as { results?: RawBulkResult[] } | null;
  return correlateResults(inputs, json?.results || []);
}

export async function bulkUpdateContentByKey(inputs: BulkContentInput[]): Promise<BulkContentResult[]> {
  if (inputs.length === 0) return [];
  const json = (await wixFetch(`${TRANSLATION_CONTENT_API}/bulk/contents/update-by-key`, {
    method: "POST",
    body: JSON.stringify({
      contents: inputs.map((c) => ({
        content: {
          schemaId: c.schemaId,
          entityId: c.entityId,
          locale: c.locale,
          fields: Object.fromEntries(
            Object.entries(c.fields).map(([key, v]) => [
              key,
              { id: key, textValue: v.textValue, published: v.published, updatedBy: "USER" },
            ])
          ),
        },
      })),
      returnEntity: false,
    }),
  })) as { results?: RawBulkResult[] } | null;
  return correlateResults(inputs, json?.results || []);
}

// ─────────────────────────────────────────────────────────────────────────────
// RAW CMS ITEM READ (bypasses the app's normalizeCmsItem() PascalCase mapping —
// Translation Schema field keys match the collection's actual, lowercase
// field names, so the raw item is what we need here).
// ─────────────────────────────────────────────────────────────────────────────

export async function getRawCmsItem(
  collectionId: string,
  itemId: string
): Promise<Record<string, unknown> | null> {
  try {
    const json = (await wixFetch(
      `${WIX_DATA_API}/items/${itemId}?dataCollectionId=${encodeURIComponent(collectionId)}`,
      { method: "GET" }
    )) as { dataItem?: { data?: Record<string, unknown> }; data?: Record<string, unknown> } | null;
    return json?.dataItem?.data || json?.data || null;
  } catch (err) {
    if (err instanceof WixMultilingualError && err.status === 404) return null;
    throw err;
  }
}
