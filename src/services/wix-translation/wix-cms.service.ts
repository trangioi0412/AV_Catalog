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
import { waitForWixWriteRateLimitSlot } from "@/lib/wix/rateLimiter";

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const WRITE_RATE_LIMIT_MAX_RETRIES = 3;
// Wix's quota here (WDE0014) is per MINUTE, not per second — a short backoff wouldn't have
// cleared it, so this starts at 3s and escalates (3s, 6s, 12s) instead of the sub-second
// backoff that's enough for typical per-second rate limits elsewhere in this codebase.
const WRITE_RATE_LIMIT_BASE_DELAY_MS = 3000;

/**
 * Partially updates one or more plain fields on an existing CMS item (PATCH —
 * fields not listed here are left untouched). Used for collections that keep
 * separate physical fields per language on the same item (e.g. `title_EN` /
 * `title_VI`) rather than Wix Multilingual's translation-schema model —
 * that model still must go through the Translation Content API instead (see
 * `wix-multilingual.service.ts`). A value may be a plain string or, for an
 * array/object-typed field, the parsed array/object itself.
 *
 * Two layers of defense against Wix's own per-minute write quota (429 / e.g. "WDE0014:
 * Requests per minute quota exceeded"), which a bulk translation run writing many items
 * back to back can realistically hit:
 *   1. Paced proactively (`waitForWixWriteRateLimitSlot()`) so writes don't fire faster
 *      than the quota can plausibly absorb in the first place — concurrency limits alone
 *      only cap how many are in flight at once, not how many happen per minute.
 *   2. If a 429 slips through anyway, retried with escalating backoff — transient, not a
 *      reason to fail that item. Any other error (validation, permissions, item not
 *      found, ...) fails immediately, no retry.
 */
export async function updateWixCmsItemFields(
  collectionId: string,
  itemId: string,
  fields: Record<string, unknown>
): Promise<WixCmsUpdateResult> {
  const fieldModifications = Object.entries(fields).map(([fieldPath, value]) => ({
    fieldPath,
    action: "SET_FIELD" as const,
    setFieldOptions: { value },
  }));
  if (fieldModifications.length === 0) return { success: true };

  for (let attempt = 0; ; attempt++) {
    try {
      await waitForWixWriteRateLimitSlot();
      await wixDataFetch(
        `items/${encodeURIComponent(itemId)}`,
        { dataCollectionId: collectionId, patch: { fieldModifications } },
        "PATCH"
      );
      return { success: true };
    } catch (err) {
      const rateLimited = err instanceof WixServerClientError && err.code === "RATE_LIMITED";
      if (rateLimited && attempt < WRITE_RATE_LIMIT_MAX_RETRIES) {
        await sleep(WRITE_RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt);
        continue;
      }
      if (err instanceof WixServerClientError) return { success: false, error: err.message };
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
