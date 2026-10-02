/**
 * wixCatalogPdf.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Server-side service for uploading PDF catalog files to Wix Media Manager
 * and updating CMS product items.
 *
 * Responsibilities:
 *  - Resolve the existing top-level "Document" folder in Wix Media Manager
 *  - Upload PDF binary into that folder (flat — no brand/category subfolders)
 *  - PATCH the CMS item's Datasheet (or other document) field
 *
 * Security:
 *  - Sanitizes all path segments before calling Wix API
 *  - Does NOT accept folder IDs from client — derives them server-side
 *  - Guards against path traversal in segment names
 */

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface WixPdfUploadResult {
  fileId: string;
  wixUrl: string; // wix:document://v1/{fileId}/{safeFileName}
  fileName: string;
}

export interface WixCmsPatchResult {
  _id: string;
  success: boolean;
  updatedAt?: string;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Max file size allowed (25 MB — Wix document upload limit) */
export const MAX_PDF_SIZE_BYTES = 25 * 1024 * 1024;

/** CMS collection ID for products */
const COLLECTION_ID = "Import1";

/**
 * Map category names (normalized) to CMS field names.
 * Maps document/datasheet/catalog categories to the "document" column in Import1.
 */
const CATEGORY_TO_CMS_FIELD: Record<string, string> = {
  document: "document",
  datasheet: "document",
  "data sheet": "document",
  catalog: "document",
  manual: "Manual",
  "user manual": "Manual",
  "installation manual": "Manual",
  brochure: "Brochure",
  firmware: "Firmware",
};

/** Existing top-level Wix Media Manager folder that all catalog PDFs are uploaded into. */
export const CATALOG_UPLOAD_FOLDER_NAME = "Document";

/** Module-level folder ID cache: "parentFolderId::folderName" → Wix folder ID */
const folderIdCache = new Map<string, string | null>();

// ─────────────────────────────────────────────────────────────────────────────
// AUTH & HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verify that incoming API request carries a valid administrator session cookie.
 */
export function checkAdminSession(req: import("next/server").NextRequest): boolean {
  const sessionCookie = req.cookies.get("admin_session");
  return Boolean(sessionCookie && sessionCookie.value === "true");
}

function getWixHeaders(): Record<string, string> {
  const apiKey = process.env.WIX_API_KEY;
  const siteId = process.env.WIX_SITE_ID;

  if (!apiKey || !siteId) {
    throw new Error("Wix credentials (WIX_API_KEY, WIX_SITE_ID) are not configured.");
  }

  return {
    "Content-Type": "application/json",
    Authorization: apiKey,
    "wix-site-id": siteId,
  };
}

/**
 * Sanitize a single path segment.
 * - Removes null bytes, control characters
 * - Collapses ".." sequences
 * - Trims whitespace
 * - Restricts to safe characters
 * Throws if the result is empty or unsafe.
 */
export function sanitizeSegment(segment: string): string {
  // Strip null bytes and ASCII control characters
  let s = segment.replace(/[\x00-\x1f\x7f]/g, "");

  // Reject absolute paths
  if (s.startsWith("/") || s.startsWith("\\")) {
    throw new Error(`Path traversal attempt detected: "${segment}"`);
  }

  // Reject ".." sequences
  if (/(?:^|[/\\])\.\.(?:[/\\]|$)/.test(s) || s === "..") {
    throw new Error(`Path traversal attempt detected: "${segment}"`);
  }

  // Remove dangerous filename characters (Windows + Unix)
  s = s.replace(/[<>:"|?*\\/]/g, "").trim();

  if (!s) {
    throw new Error(`Path segment is empty or invalid after sanitization: "${segment}"`);
  }

  return s;
}

/**
 * Sanitize a filename for Wix upload.
 * Lowercases, replaces spaces with hyphens, removes unsafe characters.
 */
export function sanitizeFileName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9.\-_]/g, "")
    .trim();
}

/**
 * Map a category name to a CMS field key.
 */
export function categoryToCmsField(categoryName: string): string {
  const normalized = categoryName.toLowerCase().trim();
  for (const [key, field] of Object.entries(CATEGORY_TO_CMS_FIELD)) {
    if (normalized.includes(key)) return field;
  }
  return "document"; // default to document column in Import1
}

// ─────────────────────────────────────────────────────────────────────────────
// FOLDER MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List all Wix Media Manager folders.
 */
async function listWixFolders(): Promise<Array<{ id: string; displayName: string; parentFolderId?: string }>> {
  const headers = getWixHeaders();
  const url = "https://www.wixapis.com/site-media/v1/folders";

  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn(`[CatalogPdf] listWixFolders failed: ${res.status} — ${text}`);
      return [];
    }

    const data = await res.json();
    const folders: any[] = data.folders || [];

    return folders.map((f) => ({
      id: f.id || f._id,
      displayName: f.displayName || f.name || "",
      parentFolderId: f.parentFolderId || f.parentId || f.parent_folder_id || undefined,
    }));
  } catch (err: any) {
    console.warn(`[CatalogPdf] listWixFolders error: ${err.message}`);
    return [];
  }
}

/**
 * Check if a parentFolderId value represents root level.
 */
function isRootParent(parentId?: string): boolean {
  if (!parentId) return true;
  const p = parentId.trim().toLowerCase();
  return p === "" || p === "media_root" || p === "00000000-0000-0000-0000-000000000000" || p === "root";
}

/**
 * Find a folder by name within a given parent (or root MEDIA_ROOT if no parent).
 */
async function findFolder(name: string, parentFolderId?: string): Promise<string | null> {
  const folders = await listWixFolders();
  const targetName = name.toLowerCase().trim();

  // 1. Try exact name match + parent match
  let match = folders.find((f) => {
    const nameMatch = f.displayName.toLowerCase().trim() === targetName;
    if (!nameMatch) return false;
    if (parentFolderId) {
      return f.parentFolderId === parentFolderId;
    }
    return isRootParent(f.parentFolderId);
  });

  // 2. Fallback: match by name alone if parent matching was strict
  if (!match) {
    match = folders.find((f) => f.displayName.toLowerCase().trim() === targetName);
  }

  return match ? match.id : null;
}

/**
 * Create a folder under an optional parent.
 * Returns the new folder's ID, or existing folder ID on 409/400.
 */
async function createFolder(name: string, parentFolderId?: string): Promise<string | null> {
  const headers = getWixHeaders();

  const body: Record<string, any> = { name };
  if (parentFolderId && !isRootParent(parentFolderId)) {
    body.parentFolderId = parentFolderId;
  }

  try {
    const res = await fetch("https://www.wixapis.com/site-media/v1/folders", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json();
      const folder = data.folder || data;
      return folder.id || folder._id || null;
    }

    const text = await res.text();
    console.warn(`[CatalogPdf] createFolder "${name}" (parent: ${parentFolderId ?? "ROOT"}) returned ${res.status}: ${text}`);

    // If folder already exists or parent invalid, try to find folder by name
    return await findFolder(name, parentFolderId);
  } catch (err: any) {
    console.error(`[CatalogPdf] createFolder "${name}" error:`, err.message);
    return await findFolder(name, parentFolderId);
  }
}

/**
 * Find or create a folder by name under an optional parent.
 * Caches results in-session to avoid redundant Wix API calls.
 */
async function getOrCreateFolder(name: string, parentFolderId?: string): Promise<string | null> {
  const cacheKey = `${parentFolderId ?? "ROOT"}::${name.toLowerCase().trim()}`;

  if (folderIdCache.has(cacheKey)) {
    const cachedId = folderIdCache.get(cacheKey);
    if (cachedId) return cachedId;
  }

  let folderId = await findFolder(name, parentFolderId);

  if (!folderId) {
    folderId = await createFolder(name, parentFolderId);
  }

  if (folderId) {
    folderIdCache.set(cacheKey, folderId);
  }
  return folderId;
}

/**
 * Resolve the ID of the existing top-level "Document" folder in Wix Media
 * Manager — the single flat destination all catalog PDFs are uploaded into.
 * Falls back to creating it if it was ever deleted; returns null (root
 * Media Manager) only if that also fails.
 */
export async function getCatalogUploadFolderId(): Promise<string | null> {
  try {
    return await getOrCreateFolder(CATALOG_UPLOAD_FOLDER_NAME);
  } catch (err: any) {
    console.error("[CatalogPdf] getCatalogUploadFolderId error:", err.message);
    return null;
  }
}

/** Reset the in-session folder cache (useful for testing). */
export function clearFolderCache(): void {
  folderIdCache.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF UPLOAD
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upload a PDF file to Wix Media Manager using the 2-step process:
 *  1. Generate a pre-signed upload URL
 *  2. PUT the binary to that URL
 *
 * Returns the Wix document URL and file ID.
 */
export async function uploadPdfToWix(
  fileBuffer: Buffer,
  originalFileName: string,
  parentFolderId: string | null
): Promise<WixPdfUploadResult> {
  const apiKey = process.env.WIX_API_KEY;
  const siteId = process.env.WIX_SITE_ID;

  if (!apiKey || !siteId) {
    throw new Error("Wix credentials are not configured.");
  }

  const safeFileName = sanitizeFileName(originalFileName);

  // ── Step 1: Generate upload URL ───────────────────────────────────────────
  const requestBody: Record<string, any> = {
    mimeType: "application/pdf",
    fileName: safeFileName,
  };

  if (parentFolderId) {
    requestBody.parentFolderId = parentFolderId;
  }

  const generateRes = await fetch(
    "https://www.wixapis.com/site-media/v1/files/generate-upload-url",
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
    throw new Error(
      `[CatalogPdf] Generate upload URL failed: ${generateRes.status} — ${text}`
    );
  }

  const generateJson = await generateRes.json();
  const uploadUrl: string = generateJson.uploadUrl;

  if (!uploadUrl) {
    throw new Error(
      `[CatalogPdf] No uploadUrl returned: ${JSON.stringify(generateJson)}`
    );
  }

  // ── Step 2: PUT binary to pre-signed URL ──────────────────────────────────
  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/pdf" },
    body: new Uint8Array(fileBuffer),
  });

  if (!putRes.ok) {
    const text = await putRes.text();
    throw new Error(
      `[CatalogPdf] File PUT failed: ${putRes.status} — ${text}`
    );
  }

  // ── Step 3: Extract file ID ───────────────────────────────────────────────
  let fileId = "";

  try {
    const putJson = await putRes.json();
    fileId =
      putJson?.file?.id ||
      putJson?.fileId ||
      putJson?.id ||
      "";
  } catch {
    // JSON parse failed — try generateJson fallback
  }

  if (!fileId && generateJson.fileId) {
    fileId = generateJson.fileId;
  }

  if (!fileId) {
    throw new Error(
      "[CatalogPdf] Could not determine file ID after upload."
    );
  }

  const wixUrl = `wix:document://v1/${fileId}/${safeFileName}`;
  console.log(`[CatalogPdf] Uploaded "${safeFileName}" → ${wixUrl}`);

  return { fileId, wixUrl, fileName: safeFileName };
}

// ─────────────────────────────────────────────────────────────────────────────
// CMS UPDATE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PATCH a single CMS product item's document field (Datasheet, Manual, etc.)
 * with the Wix document URL after a successful upload.
 *
 * Uses the Wix Data API v2 PATCH format with fieldModifications.
 */
export async function updateProductDocument(
  cmsItemId: string,
  wixUrl: string,
  fileId: string,
  safeFileName: string,
  cmsField = "document"
): Promise<WixCmsPatchResult> {
  let headers: Record<string, string>;
  try {
    headers = getWixHeaders();
  } catch {
    return { _id: cmsItemId, success: false, error: "Wix credentials not configured." };
  }

  const url = `https://www.wixapis.com/wix-data/v2/items/${cmsItemId}`;
  const updatedAt = new Date().toISOString();

  // Build field modifications (patch target column, e.g. "document" in collection Import1)
  const fieldModifications: Array<{
    fieldPath: string;
    action: "SET_FIELD";
    setFieldOptions: { value: any };
  }> = [
    {
      fieldPath: cmsField,
      action: "SET_FIELD",
      setFieldOptions: { value: wixUrl },
    },
  ];

  // If patching "document", also patch "Document" in case column casing is capitalized in CMS
  if (cmsField === "document") {
    fieldModifications.push({
      fieldPath: "Document",
      action: "SET_FIELD",
      setFieldOptions: { value: wixUrl },
    });
  }

  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        dataCollectionId: COLLECTION_ID,
        patch: { fieldModifications },
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return {
        _id: cmsItemId,
        success: false,
        error: `HTTP ${res.status}: ${text}`,
      };
    }

    console.log(
      `[CatalogPdf] Patched CMS item ${cmsItemId} field "${cmsField}" → ${wixUrl}`
    );
    return { _id: cmsItemId, success: true, updatedAt };
  } catch (err: any) {
    return {
      _id: cmsItemId,
      success: false,
      error: err?.message ?? String(err),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CMS PRODUCT SEARCH & FUZZY MATCHING
// ─────────────────────────────────────────────────────────────────────────────

import type { CmsSuggestion } from "@/types/catalog-upload";
import { getAllProducts, normalizeName, matchKey, type WixProduct } from "./wixCms";

export interface CmsSearchResult {
  status: "matched" | "no_match" | "multiple_match";
  itemId?: string;
  productName?: string;
  suggestions?: CmsSuggestion[];
}

/**
 * The whole Import1 collection, fetched once per server process and reused
 * across every file in a batch (was previously 1 Wix Data API query per
 * file, with a raw case-sensitive `$eq`/`$contains` filter -- see the
 * `searchCmsProduct` doc below for why that undercounted real matches).
 * Concurrent calls during the same validate batch share one in-flight
 * fetch instead of racing separate requests.
 */
let cmsProductListPromise: Promise<WixProduct[]> | null = null;

async function getCmsProductListForMatching(): Promise<WixProduct[]> {
  if (!cmsProductListPromise) {
    cmsProductListPromise = getAllProducts().catch((err) => {
      cmsProductListPromise = null; // allow the next call to retry
      throw err;
    });
  }
  return cmsProductListPromise;
}

/** Drop the cached product list (new upload batch, or tests). */
export function clearCmsProductListCache(): void {
  cmsProductListPromise = null;
}

/**
 * Compute similarity percentage (0 - 100) between two product strings.
 */
export function computeSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;

  const s1 = str1.toLowerCase().replace(/[^a-z0-9]/g, "");
  const s2 = str2.toLowerCase().replace(/[^a-z0-9]/g, "");

  if (s1 === s2) return 100;
  if (!s1 || !s2) return 0;

  // Substring containment check
  if (s1.includes(s2) || s2.includes(s1)) {
    const minLen = Math.min(s1.length, s2.length);
    const maxLen = Math.max(s1.length, s2.length);
    return Math.round((minLen / maxLen) * 90);
  }

  // Bigram Dice Coefficient
  const getBigrams = (str: string) => {
    const bigrams = new Set<string>();
    for (let i = 0; i < str.length - 1; i++) {
      bigrams.add(str.substring(i, i + 2));
    }
    return bigrams;
  };

  const b1 = getBigrams(s1);
  const b2 = getBigrams(s2);
  let intersection = 0;
  b1.forEach((bg) => {
    if (b2.has(bg)) intersection++;
  });

  const dice = (2 * intersection) / (b1.size + b2.size || 1);
  return Math.round(dice * 100);
}

function extractItemData(item: WixProduct): {
  id: string;
  productName: string;
  brandName?: string;
  names: string[];
} {
  // Which column holds the model name depends on the brand's import:
  // e.g. EIZO rows have title "FlexScan EV2490" / product "Premium" (series),
  // while others have product "UD-1" / title "Relacart UD-1 Wireless ...".
  // So both columns are candidate names to match a filename against.
  const names = [item.Product, item.Title].filter((n): n is string => !!n && !!n.trim());
  return {
    id: item._id || "",
    productName: item.Product || item.Title || "",
    brandName: item.Brand || "",
    names,
  };
}

/**
 * Search Wix CMS for a product by normalized product name and brand.
 * Returns exact match or top fuzzy suggestions for unmatched/multiple matches.
 *
 * Matches locally against the full product list using `normalizeName()`
 * (the same normalizer validated against all 1014 real CMS products for
 * the Image Sync feature) instead of a raw Wix Data API `$eq`/`$contains`
 * filter. The old filter compared the filename-derived product name
 * byte-for-byte (only `.trim()`ed) against the CMS `Product` field, so any
 * trivial difference -- casing, a "™" symbol, "/" vs "-" (path segments
 * can't contain "/", see `sanitizeSegment` above, so a CMS name like
 * "4x1 4K60 HDMI™ Switcher (ARC/eARC)" could only ever reach here as
 * "...(ARC-eARC)" or similar) -- silently pushed a real product into
 * "no_match"/"multiple_match". Those buckets are then dropped from the
 * upload queue entirely (see `handleStartUpload` in the admin page), so
 * every such miss looked like a product that was simply never attempted,
 * not a reported failure.
 *
 * Note: `WixProduct.Brand` is a CMS *reference id*, not a brand display
 * name, so it can't be compared against the folder's brand name string --
 * brand is therefore not used to narrow candidates here (it wasn't
 * effectively doing so before either, since the old comparison was against
 * that same id).
 */
export async function searchCmsProduct(
  productName: string,
  _brandName: string
): Promise<CmsSearchResult> {
  let allProducts: WixProduct[];
  try {
    allProducts = await getCmsProductListForMatching();
  } catch (err: any) {
    console.error("[CatalogPdf] Failed to load CMS product list for matching:", err.message);
    return { status: "no_match" };
  }

  const normalizedProduct = productName.trim();
  const targetKey = matchKey(normalizeName(normalizedProduct));

  // Match on either Product or Title (see extractItemData); remember which
  // name matched so the preview shows the name the user actually recognizes.
  const exactMatches: Array<{ item: WixProduct; matchedName: string }> = [];
  for (const item of allProducts) {
    const matchedName = extractItemData(item).names.find((n) => matchKey(normalizeName(n)) === targetKey);
    if (matchedName) exactMatches.push({ item, matchedName });
  }

  if (exactMatches.length === 1) {
    const { id } = extractItemData(exactMatches[0].item);
    return {
      status: "matched",
      itemId: id,
      productName: exactMatches[0].matchedName,
    };
  }

  if (exactMatches.length > 1) {
    // Same normalized name shared by >1 CMS item (e.g. same model under
    // different brands/categories) — ambiguous, let the user pick.
    const suggestions: CmsSuggestion[] = exactMatches
      .map(({ item, matchedName }) => {
        const { id, brandName: itemBrand } = extractItemData(item);
        return {
          itemId: id,
          productName: matchedName,
          brandName: itemBrand,
          score: 100,
        };
      })
      .slice(0, 3);

    return { status: "multiple_match", suggestions };
  }

  // No exact normalized match — offer fuzzy suggestions from the full list.
  const candidateSuggestions: CmsSuggestion[] = [];
  for (const item of allProducts) {
    const { id, brandName: itemBrand, names } = extractItemData(item);

    // Best-scoring of the item's candidate names
    let best: { name: string; score: number } | null = null;
    for (const name of names) {
      const score = computeSimilarity(normalizedProduct, name);
      if (!best || score > best.score) best = { name, score };
    }
    if (best && best.score >= 30) {
      candidateSuggestions.push({ itemId: id, productName: best.name, brandName: itemBrand, score: best.score });
    }
  }

  candidateSuggestions.sort((a, b) => b.score - a.score);
  const topSuggestions = candidateSuggestions.slice(0, 3);

  return {
    status: "no_match",
    suggestions: topSuggestions.length > 0 ? topSuggestions : undefined,
  };
}
