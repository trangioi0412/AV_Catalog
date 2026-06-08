import { cache } from "react";

export interface WixBrand {
  _id: string;
  name: string;
  websiteUrl: string;
  sitemapUrl: string;
  apiUrl: string;
  isActive: boolean;
}

export interface WixProduct {
  _id?: string;
  Category: string;
  Product: string;
  Title: string;
  productItem?: string;
  Series?: string;
  MainFeature?: string;
  ProductOverview?: string;
  TechnicalSpecifications?: string; // Stored as stringified JSON or text
  image?: string;
  Brand: string; // Wix Brand CMS ID
  Datasheet?: string;
  slug?: string;
  galleryImages?: string[];
  Manual?: string;
  Brochure?: string;
  Firmware?: string;
  Videos?: string;
  CompatibleProducts?: string;
  CompatibleRooms?: string;
  CompatibleSolutions?: string;
}

/** Lightweight product record used for image-sync (only fields we need). */
export interface ProductImageItem {
  _id: string;
  productName: string;
  image?: string;
  galleryImages?: string[];
}

/** Result from uploading a single file to Wix Media Manager. */
export interface WixMediaUploadResult {
  wixUrl: string;      // e.g. wix:image://v1/xxxxxxxx/filename.jpg
  fileName: string;
}

/** Result of patching image fields on a single CMS item. */
export interface WixPatchResult {
  _id: string;
  success: boolean;
  error?: string;
}

function getWixHeaders(): Record<string, string> | null {
  const apiKey = process.env.WIX_API_KEY;
  const siteId = process.env.WIX_SITE_ID;

  if (!apiKey || !siteId) {
    return null;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: apiKey,
    "wix-site-id": siteId,
  };

  return headers;
}

/**
 * Defensive parser to extract item data regardless of flat or nested structure.
 */
function normalizeCmsItem<T>(item: any): T {
  if (!item) return {} as T;

  // Extract ID
  const id = item._id || item.id || item.dataItem?._id || item.dataItem?.id;

  // Extract data fields
  const rawData = item.data || item.dataItem?.data || item;

  // Defensively align field casing for crucial properties
  const Title = rawData.Title || rawData.title || "";
  const Product = rawData.Product || rawData.product || "";

  return {
    _id: id,
    ...rawData,
    Title,
    Product,
  } as T;
}

/**
 * Fetch all active brands from the Wix "Brand" collection.
 */
export async function getActiveBrands(): Promise<WixBrand[]> {
  const headers = getWixHeaders();
  if (!headers) {
    console.warn("Wix credentials not configured — skipping getActiveBrands");
    return [];
  }
  const url = "https://www.wixapis.com/wix-data/v2/items/query";

  // Fetch all brands from Import1. We query without filters so it won't fail if fields are missing in CMS schema
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      dataCollectionId: "Import1",
      query: {
        paging: {
          limit: 100,
        },
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`[Wix CMS] getActiveBrands failed. Status: ${response.status}, text: ${text}`);
    throw new Error(`Failed to query Wix Brands: ${response.statusText} (${text})`);
  }

  const json = await response.json();
  const items = json.items || json.dataItems || [];
  console.log(`[Wix CMS] getActiveBrands succeeded, returned ${items.length} items`);

  // Default URLs fallback for known brands if the user hasn't added these fields to Wix CMS yet
  const fallbackBrandUrls: Record<string, { websiteUrl?: string; sitemapUrl?: string; apiUrl?: string }> = {
    "crestron": {
      websiteUrl: "https://www.crestron.com",
      sitemapUrl: "https://www.crestron.com/sitemap.xml",
    },
    "extron": {
      websiteUrl: "https://www.extron.com",
      sitemapUrl: "https://www.extron.com/sitemap.xml",
    },
    "neat": {
      websiteUrl: "https://neat.no",
      sitemapUrl: "https://neat.no/sitemap.xml",
    },
    "shure": {
      websiteUrl: "https://www.shure.com",
      sitemapUrl: "https://www.shure.com/sitemap.xml",
    },
  };

  const brands = items.map((item: any) => {
    const brand = normalizeCmsItem<WixBrand>(item);

    // Fallback display title to name if missing
    if (!brand.name && (item.title || item.data?.title)) {
      brand.name = item.title || item.data?.title;
    }

    const key = (brand.name || "").toLowerCase().trim();
    const fallback = fallbackBrandUrls[key];
    if (fallback) {
      if (!brand.websiteUrl) brand.websiteUrl = fallback.websiteUrl || "";
      if (!brand.sitemapUrl) brand.sitemapUrl = fallback.sitemapUrl || "";
      if (!brand.apiUrl) brand.apiUrl = fallback.apiUrl || "";
    }

    return brand;
  });

  // Filter in-memory: default to true unless explicitly marked as inactive
  return brands.filter((b: WixBrand) => b.isActive !== false);
}

/**
 * Fetch all products from the Wix "Products" collection, handles automatic pagination.
 */
export async function getAllProducts(): Promise<WixProduct[]> {
  const headers = getWixHeaders();
  if (!headers) {
    console.warn("Wix credentials not configured — skipping getAllProducts");
    return [];
  }
  const url = "https://www.wixapis.com/wix-data/v2/items/query";

  let allProducts: WixProduct[] = [];
  let offset = 0;
  let hasMore = true;
  const limit = 100;

  while (hasMore) {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        dataCollectionId: "Import2",
        query: {
          paging: {
            limit,
            offset,
          },
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[Wix CMS] getAllProducts query failed. Status: ${response.status}, text: ${text}`);
      throw new Error(`Failed to query Wix Products: ${response.statusText} (${text})`);
    }

    const json = await response.json();
    const items = json.items || json.dataItems || [];
    console.log(`[Wix CMS] getAllProducts batch succeeded, offset: ${offset}, items: ${items.length}`);
    const normalized = items.map((item: any) => normalizeCmsItem<WixProduct>(item));
    allProducts = allProducts.concat(normalized);

    // Pagination check
    const count = json.pagingMetadata?.count ?? items.length;
    if (count < limit) {
      hasMore = false;
    } else {
      offset += limit;
    }
  }

  return allProducts;
}

/**
 * Inserts a new product into the Wix "Products" collection.
 */
export async function insertProduct(product: WixProduct): Promise<WixProduct> {
  const headers = getWixHeaders();
  if (!headers) {
    throw new Error("Wix credentials not configured. Cannot insert product.");
  }
  const url = "https://www.wixapis.com/wix-data/v2/items";

  // Construct request body according to the Wix API v2 specs
  const body = {
    dataItem: {
      collectionId: "Import2",
      data: {
        Category: product.Category,
        Product: product.Product,
        Title: product.Title,
        productItem: product.productItem || "",
        Series: product.Series || "",
        MainFeature: product.MainFeature || "",
        ProductOverview: product.ProductOverview || "",
        TechnicalSpecifications: product.TechnicalSpecifications || "",
        image: product.image || "",
        Brand: product.Brand,
        Datasheet: product.Datasheet || "",
      },
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to insert Wix Product: ${response.statusText} (${text})`);
  }

  const json = await response.json();
  const insertedItem = json.dataItem || json;
  return normalizeCmsItem<WixProduct>(insertedItem);
}

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE SYNC FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch ALL products from the Wix CMS collection used for image sync.
 * Supports collections named "Products" or "product" (existing alias).
 * Returns a Map<normalizedProductName, ProductImageItem> for O(1) lookup.
 */
export async function getAllProductsForImageSync(
  collectionId = "Import2"
): Promise<Map<string, ProductImageItem>> {
  const headers = getWixHeaders();
  if (!headers) {
    throw new Error("Wix credentials not configured.");
  }

  const url = "https://www.wixapis.com/wix-data/v2/items/query";
  const map = new Map<string, ProductImageItem>();
  let offset = 0;
  let hasMore = true;
  const limit = 100;

  while (hasMore) {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        dataCollectionId: collectionId,
        query: {
          paging: { limit, offset },
        },
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`[Wix CMS] getAllProductsForImageSync failed: ${response.status} — ${text}`);
    }

    const json = await response.json();
    const items: any[] = json.items || json.dataItems || [];

    for (const item of items) {
      const normalized = normalizeCmsItem<any>(item);
      const id: string = normalized._id || "";
      // Primary match field is "Product" (exact CMS field name)
      const productName: string =
        normalized.Product ||
        normalized.product ||
        normalized.productName ||
        normalized.Title ||
        normalized.title ||
        "";

      if (!id || !productName) continue;

      const key = normalizeName(productName);
      map.set(key, {
        _id: id,
        productName,
        image: normalized.Image || normalized.image,
        galleryImages: normalized.galleryImages,
      });
    }

    const count = json.pagingMetadata?.count ?? items.length;
    if (count < limit) {
      hasMore = false;
    } else {
      offset += limit;
    }
  }

  console.log(`[ImageSync] Loaded ${map.size} products into lookup Map.`);
  return map;
}

/**
 * Normalize a product name for case-insensitive, format-agnostic matching.
 *
 * Handles:
 *   - ALL_CAPS, Title Case, camelCase, PascalCase
 *   - Hyphens, underscores, slashes → space
 *   - Parentheses / brackets removed
 *   - Number–letter boundaries: "MXA920" → "mxa 920", "Gen2" → "gen 2"
 *   - Extra whitespace collapsed
 *
 * Examples:
 *   "Neat Board Pro"      → "neat board pro"
 *   "NEAT-BOARD-PRO"      → "neat board pro"
 *   "Neat_Board_Pro"      → "neat board pro"
 *   "Shure MXA920"        → "shure mxa 920"
 *   "Logitech RallyBarMini" → "logitech rally bar mini"
 *   "Neat Bar (Gen 2)"    → "neat bar gen 2"
 */
export function normalizeName(name: string): string {
  return (
    name
      // 1. Remove parentheses and their contents if they contain only non-alphanumeric
      //    e.g. "(Gen 2)" → "Gen 2", "(USB-C)" → "USB-C"
      .replace(/[()[\]{}]/g, " ")
      // 2. Replace separators with space
      .replace(/[-_/\\|]/g, " ")
      // 3. Insert space between letter→digit boundary: "MXA920" → "MXA 920", "Gen2" → "Gen 2"
      .replace(/([a-zA-Z])(\d)/g, "$1 $2")
      // 4. Insert space between digit→letter boundary: "920A" → "920 A"
      .replace(/(\d)([a-zA-Z])/g, "$1 $2")
      // 5. Insert space at CamelCase boundaries: "RallyBar" → "Rally Bar"
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      // 6. Lowercase everything
      .toLowerCase()
      // 7. Remove any remaining non-alphanumeric characters (except space)
      .replace(/[^a-z0-9\s]/g, "")
      // 8. Collapse multiple spaces
      .replace(/\s+/g, " ")
      .trim()
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE DIMENSION & FOLDER HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getPngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24) return null;
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { width, height };
  }
  return null;
}

function getJpgDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4) return null;
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

  let offset = 2;
  while (offset < buffer.length - 8) {
    if (buffer[offset] !== 0xff) {
      break;
    }
    const marker = buffer[offset + 1];
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;

    if (isSof) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return { width, height };
    }

    if (marker === 0xda || marker === 0xd9) {
      break;
    }

    const length = buffer.readUInt16BE(offset + 2);
    offset += length + 2;
  }
  return null;
}

function getWebpDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 30) return null;
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    const type = buffer.toString("ascii", 12, 16);
    if (type === "VP8 ") {
      const width = buffer.readUInt16LE(26) & 0x3fff;
      const height = buffer.readUInt16LE(28) & 0x3fff;
      return { width, height };
    } else if (type === "VP8L") {
      const b0 = buffer[21];
      const b1 = buffer[22];
      const b2 = buffer[23];
      const b3 = buffer[24];
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return { width, height };
    } else if (type === "VP8X") {
      const width = (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)) + 1;
      const height = (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)) + 1;
      return { width, height };
    }
  }
  return null;
}

export function getImageDimensions(buffer: Buffer): { width: number; height: number } | null {
  try {
    return (
      getPngDimensions(buffer) ||
      getJpgDimensions(buffer) ||
      getWebpDimensions(buffer)
    );
  } catch (err) {
    console.warn("[Image Dimension Parser] Failed to parse:", err);
    return null;
  }
}

let folderPromise: Promise<string | null> | null = null;

export async function getOrCreateFolder(folderName = "product_image"): Promise<string | null> {
  const headers = getWixHeaders();
  if (!headers) {
    console.warn("Wix credentials not configured — skipping getOrCreateFolder");
    return null;
  }

  try {
    const listRes = await fetch("https://www.wixapis.com/site-media/v1/folders", {
      method: "GET",
      headers,
    });

    if (listRes.ok) {
      const data = await listRes.json();
      const folders = data.folders || [];
      const found = folders.find(
        (f: any) =>
          (f.displayName || f.name || "").toLowerCase().trim() === folderName.toLowerCase().trim()
      );
      if (found) {
        return found.id;
      }
    }

    const createRes = await fetch("https://www.wixapis.com/site-media/v1/folders", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: folderName,
      }),
    });

    if (!createRes.ok) {
      const text = await createRes.text();
      console.error(`[Wix Media] Create folder failed: ${createRes.status} — ${text}`);
      return null;
    }

    const createdData = await createRes.json();
    const folder = createdData.folder || createdData;
    return folder.id || null;
  } catch (err) {
    console.error("[Wix Media] getOrCreateFolder error:", err);
    return null;
  }
}

export function getProductImageFolderId(): Promise<string | null> {
  if (!folderPromise) {
    folderPromise = getOrCreateFolder("product_image");
  }
  return folderPromise;
}

/**
 * Upload a single image file to Wix Media Manager.
 * Uses the 2-step process:
 *   1. Generate upload URL via Wix Media API
 *   2. PUT raw bytes to that URL
 *   3. Return the wix:image://v1/... URL
 */
export async function uploadToWixMedia(
  fileBuffer: Buffer,
  originalFileName: string,
  mimeType: string
): Promise<WixMediaUploadResult> {
  const apiKey = process.env.WIX_API_KEY;
  const siteId = process.env.WIX_SITE_ID;

  if (!apiKey || !siteId) {
    throw new Error("Wix credentials (API key, site ID) not fully configured.");
  }

  // Sanitize filename for Wix
  const safeFileName = originalFileName
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9.\-_]/g, "");

  // ── Step 1: Generate upload URL ──────────────────────────────────────────
  const requestBody: Record<string, any> = {
    mimeType,
    fileName: safeFileName,
  };

  const parentFolderId = await getProductImageFolderId();
  if (parentFolderId) {
    requestBody.parentFolderId = parentFolderId;
  }

  const generateRes = await fetch(
    `https://www.wixapis.com/site-media/v1/files/generate-upload-url`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
        "wix-site-id": siteId,
      },
      body: JSON.stringify(requestBody),
    }
  );

  if (!generateRes.ok) {
    const text = await generateRes.text();
    throw new Error(`[Wix Media] Generate upload URL failed: ${generateRes.status} — ${text}`);
  }

  const generateJson = await generateRes.json();
  const uploadUrl: string = generateJson.uploadUrl;
  if (!uploadUrl) {
    throw new Error(`[Wix Media] No uploadUrl returned: ${JSON.stringify(generateJson)}`);
  }

  // ── Step 2: PUT raw bytes to the pre-signed URL ───────────────────────────
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": mimeType },
    body: new Uint8Array(fileBuffer),
  });

  if (!putRes.ok) {
    const text = await putRes.text();
    throw new Error(`[Wix Media] File PUT failed: ${putRes.status} — ${text}`);
  }

  // ── Step 3: Parse the Wix media URL from the response ────────────────────
  let fileId = "";
  try {
    const putJson = await putRes.json();
    fileId = putJson?.file?.id || putJson?.fileId || putJson?.id || "";
  } catch {
    // Fallback if JSON parsing fails
  }

  // Fallback: get fileId from generateJson if available
  if (!fileId && generateJson.fileId) {
    fileId = generateJson.fileId;
  }

  if (!fileId) {
    throw new Error(`[Wix Media] Could not determine file ID after upload.`);
  }

  // Retrieve dimensions and build correct Wix media URL query hash parameters
  const dims = getImageDimensions(fileBuffer);
  const suffix = dims ? `#originWidth=${dims.width}&originHeight=${dims.height}` : "";
  const wixUrl = `wix:image://v1/${fileId}/${safeFileName}${suffix}`;

  console.log(`[Wix Media] Uploaded "${safeFileName}" → ${wixUrl}`);
  return { wixUrl, fileName: safeFileName };
}

/**
 * Patch the image and galleryImages fields of a single CMS item.
 * Uses PATCH (partial update) — other fields are untouched.
 */
export async function updateProductImages(
  itemId: string,
  collectionId: string,
  image: string,
  galleryImages: string[]
): Promise<WixPatchResult> {
  const headers = getWixHeaders();
  if (!headers) {
    return { _id: itemId, success: false, error: "Wix credentials not configured." };
  }

  const url = `https://www.wixapis.com/wix-data/v2/items/${itemId}`;

  // Build field modifications for partial update (PATCH) using Wix Data API v2 format
  const fieldModifications: Array<{ fieldPath: string; action: "SET_FIELD"; setFieldOptions: { value: any } }> = [];
  if (image) {
    fieldModifications.push({
      fieldPath: "image",
      action: "SET_FIELD",
      setFieldOptions: { value: image }
    });
  }
  if (galleryImages && galleryImages.length > 0) {
    const formattedGallery = galleryImages.map((img) => ({
      src: img,
      type: "image"
    }));
    fieldModifications.push({
      fieldPath: "galleryImages",
      action: "SET_FIELD",
      setFieldOptions: { value: formattedGallery }
    });
  }

  if (fieldModifications.length === 0) {
    return { _id: itemId, success: true }; // Nothing to update
  }

  try {
    const response = await fetch(url, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        dataCollectionId: collectionId,
        patch: {
          fieldModifications
        }
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { _id: itemId, success: false, error: `HTTP ${response.status}: ${text}` };
    }

    console.log(`[Wix CMS] Patched item ${itemId} with image fields.`);
    return { _id: itemId, success: true };
  } catch (err: any) {
    return { _id: itemId, success: false, error: err?.message ?? String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA FETCHING HELPERS (MEMOIZED WITH REACT CACHE)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch a single brand by its ID from Wix CMS.
 * Memoized per request using React cache.
 */
export const getBrandById = cache(async (brandId: string): Promise<WixBrand | null> => {
  const headers = getWixHeaders();
  if (!headers) return null;

  const url = `https://www.wixapis.com/wix-data/v2/items/${brandId}?dataCollectionId=Import1`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
    });

    if (!response.ok) {
      if (response.status === 404) return null;
      console.error(`[Wix CMS] getBrandById failed for ${brandId}: ${response.status} ${response.statusText}`);
      return null;
    }

    const json = await response.json();
    const item = json.dataItem || json;
    return normalizeCmsItem<WixBrand>(item);
  } catch (err) {
    console.error(`[Wix CMS] getBrandById error for ${brandId}:`, err);
    return null;
  }
});

/**
 * Fetch a product by its slug from the Products collection (Import2).
 * Searches by both the 'slug' field and falls back to normalized 'Product' field match.
 * Memoized per request using React cache.
 */
export const getProductBySlug = cache(async (slug: string): Promise<WixProduct | null> => {
  const headers = getWixHeaders();
  if (!headers) return null;

  const url = "https://www.wixapis.com/wix-data/v2/items/query";
  const normalizedSlug = slug.toLowerCase().trim();

  try {
    // 1. Direct query using filter on slug or model name (Product)
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        dataCollectionId: "Import2",
        query: {
          filter: {
            $or: [
              { slug: { $eq: slug } },
              { slug: { $eq: normalizedSlug } },
              { Product: { $eq: slug } },
              { Product: { $eq: normalizedSlug } },
            ],
          },
          paging: { limit: 1 },
        },
      }),
    });

    if (response.ok) {
      const json = await response.json();
      const items = json.items || json.dataItems || [];
      if (items.length > 0) {
        return normalizeCmsItem<WixProduct>(items[0]);
      }
    } else {
      console.warn(`[Wix CMS] getProductBySlug query failed: ${response.status} — falling back to full scan.`);
    }

    // 2. Fallback in-memory scan (robust against missing slug index / database mismatches)
    const allProducts = await getAllProducts();
    const normalizedTarget = normalizeName(slug);

    const found = allProducts.find((p) => {
      if (p.slug && normalizeName(p.slug) === normalizedTarget) return true;
      if (p.Product && normalizeName(p.Product) === normalizedTarget) return true;
      if (p.Title && normalizeName(p.Title) === normalizedTarget) return true;
      return false;
    });

    return found || null;
  } catch (err) {
    console.error(`[Wix CMS] getProductBySlug error for ${slug}:`, err);
    return null;
  }
});
