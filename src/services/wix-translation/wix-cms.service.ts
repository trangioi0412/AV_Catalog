/**
 * wix-cms.service.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Read/write access to Wix CMS Live collection items, shared by both the Wix
 * Multilingual Translator feature and the CMS field-pair translator
 * (`@/services/cms-translation`). Listing is always paginated — never pulls a
 * whole collection into memory — and every function here only ever targets a
 * `collectionId` that was resolved from a server-side allowlist (see
 * `@/config/wix-translation.config`), never one supplied directly by a client.
 */

import { wixDataFetch, WixServerClientError } from "@/lib/wix/server-client";
import { getRawCmsItem, findCollectionSchema, type TranslationSchema } from "@/lib/services/wixMultilingual";

export interface WixCmsListItem {
  itemId: string;
  data: Record<string, unknown>;
  updatedDate?: string;
}

export interface WixCmsItemsPage {
  items: WixCmsListItem[];
  total: number;
}

function toListItem(raw: Record<string, unknown>): WixCmsListItem {
  const data = (raw.data as Record<string, unknown>) || raw;
  const itemId = String(raw._id ?? data._id ?? "");
  const updatedDate = (data._updatedDate as string) || (raw._updatedDate as string) || undefined;
  return { itemId, data, updatedDate };
}

/**
 * Lists items from a Wix CMS collection with offset paging and an optional
 * free-text search across `title` / `product`. Bounded to `limit` per call.
 */
export async function getWixCmsItems(params: {
  collectionId: string;
  page: number;
  limit: number;
  search?: string;
}): Promise<WixCmsItemsPage> {
  const { collectionId, page, limit, search } = params;
  const offset = Math.max(0, (page - 1) * limit);

  const filter = search?.trim()
    ? {
        $or: [
          { title: { $contains: search.trim() } },
          { product: { $contains: search.trim() } },
        ],
      }
    : undefined;

  const json = (await wixDataFetch("items/query", {
    dataCollectionId: collectionId,
    query: {
      ...(filter ? { filter } : {}),
      paging: { limit, offset },
    },
    returnTotalCount: true,
  })) as { dataItems?: unknown[]; items?: unknown[]; pagingMetadata?: { total?: number } } | null;

  const rawItems = (json?.dataItems || json?.items || []) as Record<string, unknown>[];
  return {
    items: rawItems.map(toListItem),
    total: json?.pagingMetadata?.total ?? rawItems.length,
  };
}

/** Fetches one CMS item's raw (actual field-key-cased) data, or null if it doesn't exist. */
export async function getWixCmsItemById(
  collectionId: string,
  itemId: string
): Promise<Record<string, unknown> | null> {
  return getRawCmsItem(collectionId, itemId);
}

/** Re-exported for callers that only need the schema lookup from this module. */
export async function getWixCollectionSchema(collectionId: string): Promise<TranslationSchema | null> {
  return findCollectionSchema(collectionId);
}

export interface WixCmsFieldDef {
  key: string;
  displayName: string;
  type: string;
}

/**
 * Lists every plain field defined on a Wix CMS collection (its raw Data
 * Collection schema — every column, not just the ones Wix Multilingual has
 * marked translatable). Used so a UI can offer a real dropdown of field
 * names instead of letting an admin type a field key that might not exist.
 *
 * Wix's Data Collections API only exposes a "list all collections" endpoint,
 * not a per-collection lookup, so this fetches the full site list and
 * filters to the one requested — same call already proven working in
 * `/api/image-sync/collections`.
 */
export async function getWixCollectionFields(collectionId: string): Promise<WixCmsFieldDef[]> {
  const json = (await wixDataFetch("collections", undefined, "GET")) as {
    collections?: Array<{ id: string; fields?: Array<{ key: string; displayName?: string; type?: string }> }>;
  } | null;
  const match = json?.collections?.find((c) => c.id === collectionId);
  if (!match?.fields) return [];
  return match.fields.map((f) => ({ key: f.key, displayName: f.displayName || f.key, type: f.type || "TEXT" }));
}

export interface WixCmsUpdateResult {
  success: boolean;
  error?: string;
}

/**
 * Partially updates one or more plain fields on an existing CMS item (PATCH —
 * fields not listed here are left untouched). Used for collections that keep
 * separate physical fields per language on the same item (e.g. `title_EN` /
 * `title_VI`) rather than Wix Multilingual's translation-schema model —
 * that model still must go through the Translation Content API instead (see
 * `wix-multilingual.service.ts`).
 */
export async function updateWixCmsItemFields(
  collectionId: string,
  itemId: string,
  fields: Record<string, string>
): Promise<WixCmsUpdateResult> {
  const fieldModifications = Object.entries(fields).map(([fieldPath, value]) => ({
    fieldPath,
    action: "SET_FIELD" as const,
    setFieldOptions: { value },
  }));
  if (fieldModifications.length === 0) return { success: true };

  try {
    await wixDataFetch(
      `items/${encodeURIComponent(itemId)}`,
      { dataCollectionId: collectionId, patch: { fieldModifications } },
      "PATCH"
    );
    return { success: true };
  } catch (err) {
    if (err instanceof WixServerClientError) return { success: false, error: err.message };
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
