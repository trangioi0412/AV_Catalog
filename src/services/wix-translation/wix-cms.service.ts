/**
 * wix-cms.service.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Read-only access to Wix CMS Live collection items for the Wix Multilingual
 * Translator feature. Always paginated — never pulls a whole collection into
 * memory — and only ever targets a `collectionId` that was resolved from the
 * server-side allowlist (see `@/config/wix-translation.config`), never one
 * supplied directly by a client.
 */

import { wixDataFetch } from "@/lib/wix/server-client";
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
