/**
 * wix-translation.config.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Server-side configuration for the "Wix Multilingual Translator" admin
 * feature. This is the ONLY place a `collectionKey` sent by a client is
 * resolved to a real Wix collection ID — the client never supplies a raw
 * collection ID directly, so it can't be pointed at an arbitrary collection.
 */

export interface AllowedCollectionDef {
  /** Real Wix CMS "dataCollectionId". */
  collectionId: string;
  /** Vietnamese label shown in the admin UI. */
  label: string;
}

/** Server-side allowlist of collections this tool is permitted to read/translate. */
export const ALLOWED_COLLECTIONS: Record<string, AllowedCollectionDef> = {
  products: {
    collectionId: process.env.WIX_PRODUCT_COLLECTION_ID || "Import1",
    label: "Sản phẩm",
  },
  brand: {
    collectionId: process.env.WIX_BRAND_COLLECTION_ID || "brand",
    label: "Thương hiệu",
  },
};

export const DEFAULT_COLLECTION_KEY = "products";

/** Max number of CMS items that can be translated/saved in a single batch. */
export const MAX_TRANSLATION_BATCH_SIZE = 20;

/** Max number of concurrent Wix/AI calls in flight while processing a batch. */
export const TRANSLATION_CONCURRENCY = 4;

/**
 * Best-effort locale hints used only until the real, verified locale list is
 * loaded from Wix Multilingual (`listLocales()`). Never written to Wix as-is —
 * see AGENTS.md §5.3 "Không tự đoán `en` hay `en-US`".
 */
export const DEFAULT_SOURCE_LOCALE_HINT = "vi";
export const DEFAULT_TARGET_LOCALE_HINT = "en";

export function resolveCollection(collectionKey: string): AllowedCollectionDef | null {
  return ALLOWED_COLLECTIONS[collectionKey] || null;
}
