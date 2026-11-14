/**
 * "Upload sản phẩm mới lên CMS" (DataCrawler): takes one brand tab of the
 * shared Google Spreadsheet (written by the crawler), finds the rows that do
 * not exist in the Wix CMS (`Import1`) yet and uploads them:
 *   0. listBrandsWithNewProducts -- brand tabs that still have new rows;
 *   1. listNewProducts      -- the tab's rows that are not on the CMS yet;
 *   2. uploadNewProductRow  -- insert one new row into Import1 (Brand = Wix
 *                              brand id), then upload its image URLs to Wix
 *                              Media (folder = brand) and attach them.
 *
 * Products already on the CMS are never touched: the existence check mirrors
 * findExistingProductForUpsert (model code first, then Product), so
 * insertProduct can never turn into an update of a curated product.
 */
import {
  readBrandRows,
  readRowsOfTabs,
  listSheetTabTitles,
  looksLikeBrandId,
  type BrandSheetRow,
} from "./brandSheets";
import { NON_BRAND_TAB_COUNT } from "./dataCrawlerNewBrands";
import {
  brandMatchKey,
  downloadImage,
  EXT_BY_MIME,
  isFetchableImageUrl,
  listWixBrands,
  rowImageUrls,
} from "./brandPublish";
import {
  findExistingProductForUpsert,
  getAllProductsCached,
  insertProduct,
  invalidateAdminCmsCache,
  updateProductImages,
  uploadToWixMedia,
  type WixProduct,
} from "./wixCms";
import { findMediaFilesByProductName } from "./wixMediaManager";
import { parseImageName, withRetry } from "./imageSyncService";
import { matchKey, normalizeName } from "../utils/productName";

const PRODUCT_COLLECTION = "Import1";

export interface NewProductRow {
  rowNumber: number;
  key: string;
  title: string;
  item: string;
  category: string;
  imageCount: number;
  hasSpecs: boolean;
  hasOverview: boolean;
}

export interface NewProductsResult {
  tab: string;
  brandName: string;
  brandInCms: boolean;
  cmsBrandId: string | null;
  counts: { total: number; new: number; onCms: number };
  rows: NewProductRow[];
}

export type UploadRowStatus = "created" | "exists" | "failed";

export interface UploadRowResult {
  rowNumber: number;
  title: string;
  status: UploadRowStatus;
  cmsId: string | null;
  imagesUploaded: number;
  errors: string[];
}

type CmsRecord = WixProduct & Record<string, unknown>;

function pick(p: CmsRecord, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = p[k];
    if (v != null && v !== "") return v;
  }
  return "";
}

function text(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function key(v: unknown): string {
  return matchKey(normalizeName(text(v)));
}

function hasContent(v: string | undefined): boolean {
  return (v || "").replace(/<[^>]*>/g, "").trim().length > 0;
}

function indexBy(products: CmsRecord[], getter: (p: CmsRecord) => unknown): Map<string, CmsRecord> {
  const map = new Map<string, CmsRecord>();
  for (const p of products) {
    const k = key(getter(p));
    if (k && !map.has(k)) map.set(k, p);
  }
  return map;
}

/**
 * Same rule as findExistingProductForUpsert (model code, else Product), over
 * the whole CMS -- the upsert is global, so a model code used by another
 * brand would otherwise be overwritten. Title is checked within the brand.
 */
function makeMatcher(all: CmsRecord[], brandProducts: CmsRecord[]) {
  const byItem = indexBy(all, (p) => pick(p, "productItem", "ProductItem"));
  const byProduct = indexBy(all, (p) => pick(p, "Product", "product"));
  const byTitle = indexBy(brandProducts, (p) => pick(p, "Title", "title"));
  return (row: BrandSheetRow): CmsRecord | null => {
    const item = key(row.values["product (item)"]);
    if (item) return byItem.get(item) || byProduct.get(item) || null;
    const product = key(row.values["Product"]);
    if (product && byProduct.has(product)) return byProduct.get(product)!;
    const title = key(row.values["Title"]);
    return (title && byTitle.get(title)) || null;
  };
}

type WixBrandList = Awaited<ReturnType<typeof listWixBrands>>;

function resolveBrand(tab: string, rows: BrandSheetRow[], wixBrands: WixBrandList) {
  const brandCell = rows.map((r) => (r.values["Brand"] || "").trim()).find(Boolean) || "";
  const brandIdInSheet = brandCell && looksLikeBrandId(brandCell) ? brandCell : "";
  const brandName = brandCell && !brandIdInSheet ? brandCell : tab;
  const wanted = new Set([brandMatchKey(brandName), brandMatchKey(tab)].filter(Boolean));
  const cmsBrand =
    wixBrands.find((b) => brandIdInSheet && b._id === brandIdInSheet) ||
    wixBrands.find((b) => [b.data.title, b.data.name, b.data.id].some((n) => wanted.has(brandMatchKey(n)))) ||
    null;
  return { brandName, cmsBrand };
}

/** Splits one tab's rows into new / on_cms against the given CMS snapshot. */
function classifyTab(tab: string, rows: BrandSheetRow[], all: CmsRecord[], wixBrands: WixBrandList) {
  const { brandName, cmsBrand } = resolveBrand(tab, rows, wixBrands);
  const brandProducts = cmsBrand ? all.filter((p) => text(pick(p, "Brand", "brand")) === cmsBrand._id) : [];
  const match = makeMatcher(all, brandProducts);
  const newRows = rows.filter((row) => !match(row));
  return {
    brandName: cmsBrand?.data.title || brandName,
    cmsBrand,
    newRows,
    onCms: rows.length - newRows.length,
  };
}

function toNewProductRow(row: BrandSheetRow): NewProductRow {
  return {
    rowNumber: row.rowNumber,
    key: row.key,
    title: (row.values["Title"] || "").trim(),
    item: (row.values["product (item)"] || "").trim(),
    category: (row.values["Category"] || "").trim(),
    imageCount: rowImageUrls(row).length,
    hasSpecs: hasContent(row.values["Technical Specifications"]),
    hasOverview: hasContent(row.values["Product Overview"]),
  };
}

export interface BrandWithNewProducts {
  tab: string;
  brandName: string;
  brandInCms: boolean;
  newCount: number;
  total: number;
}

/** Brand tabs (after the work tabs) that still have products missing on the CMS. */
export async function listBrandsWithNewProducts(): Promise<BrandWithNewProducts[]> {
  const [titles, allProducts, wixBrands] = await Promise.all([
    listSheetTabTitles(),
    getAllProductsCached(),
    listWixBrands(),
  ]);
  const tabs = await readRowsOfTabs(titles.slice(NON_BRAND_TAB_COUNT));
  const all = allProducts as CmsRecord[];

  const out: BrandWithNewProducts[] = [];
  for (const { tab, rows } of tabs) {
    const c = classifyTab(tab, rows, all, wixBrands);
    if (c.newRows.length === 0) continue;
    out.push({ tab, brandName: c.brandName, brandInCms: !!c.cmsBrand, newCount: c.newRows.length, total: rows.length });
  }
  return out.sort((a, b) => b.newCount - a.newCount || a.brandName.localeCompare(b.brandName));
}

/** Only the tab's rows that are not on the CMS yet. */
export async function listNewProducts(tab: string): Promise<NewProductsResult> {
  const [{ rows }, allProducts, wixBrands] = await Promise.all([
    readBrandRows(tab),
    getAllProductsCached(),
    listWixBrands(),
  ]);
  const c = classifyTab(tab, rows, allProducts as CmsRecord[], wixBrands);
  return {
    tab,
    brandName: c.brandName,
    brandInCms: !!c.cmsBrand,
    cmsBrandId: c.cmsBrand?._id ?? null,
    counts: { total: rows.length, new: c.newRows.length, onCms: c.onCms },
    rows: c.newRows.map(toNewProductRow),
  };
}

function cmsItemId(item: unknown): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Wix item shapes vary (v1/v2)
  const i = item as any;
  const id = i?._id || i?.id || i?.dataItem?._id || i?.dataItem?.id;
  return id ? String(id) : null;
}

function rowToProduct(row: BrandSheetRow, cmsBrandId: string): WixProduct {
  const v = (k: string) => (row.values[k] || "").trim();
  const title = v("Title");
  const item = v("product (item)");
  const product: WixProduct = {
    Category: v("Category"),
    Product: v("Product") || item || title,
    Title: title || item,
    Brand: cmsBrandId,
  };
  if (item) product.productItem = item;
  if (v("Series")) product.Series = v("Series");
  if (v("Main Feature")) product.MainFeature = v("Main Feature");
  if (v("Product Overview")) product.ProductOverview = v("Product Overview");
  if (v("Technical Specifications")) product.TechnicalSpecifications = v("Technical Specifications");
  if (v("Datasheet")) product.Datasheet = v("Datasheet");
  return product;
}

/** Uploads the row's image URLs to Wix Media; names follow Image Sync ("<Title>", "<Title>-2"). */
async function uploadImages(row: BrandSheetRow, title: string, mediaFolder: string, errors: string[]): Promise<string[]> {
  // Images for this product may already be on Wix Media (a previous run, or a
  // manual Image Sync upload): never duplicate them, attach the existing ones
  // instead (main = index 0/1, then -2, -3 ... like Image Sync).
  const existing = await findMediaFilesByProductName(title, "IMAGE");
  if (existing.length > 0) {
    return existing
      .map((f) => ({ f, index: parseImageName(f.displayName).index }))
      .sort((a, b) => a.index - b.index)
      .map(({ f }) => `wix:image://v1/${f.id}/${encodeURIComponent(f.displayName)}`);
  }

  const urls = rowImageUrls(row).filter((u) => {
    if (isFetchableImageUrl(u)) return true;
    errors.push(`${u}: URL ảnh không hợp lệ`);
    return false;
  });
  if (urls.length === 0) return [];

  const wixUrls: string[] = [];
  for (const [i, url] of urls.entries()) {
    try {
      const { buffer, mime } = await withRetry(() => downloadImage(url));
      const name = `${title}${i === 0 ? "" : `-${i + 1}`}${EXT_BY_MIME[mime]}`;
      wixUrls.push((await withRetry(() => uploadToWixMedia(buffer, name, mime, mediaFolder))).wixUrl);
    } catch (err) {
      errors.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return wixUrls;
}

/** Inserts one sheet row as a new CMS product. Skips it when the CMS already has it. */
export async function uploadNewProductRow(
  row: BrandSheetRow,
  cmsBrandId: string,
  mediaFolder: string
): Promise<UploadRowResult> {
  const product = rowToProduct(row, cmsBrandId);
  const result: UploadRowResult = {
    rowNumber: row.rowNumber,
    title: product.Title,
    status: "failed",
    cmsId: null,
    imagesUploaded: 0,
    errors: [],
  };
  if (!product.Title) {
    result.errors.push("Dòng không có Title và product (item)");
    return result;
  }

  try {
    // Re-check live (the list may be stale): insertProduct would update a match.
    const existing = await findExistingProductForUpsert(product);
    if (existing) {
      result.status = "exists";
      result.cmsId = cmsItemId(existing);
      return result;
    }

    const inserted = await insertProduct(product);
    // insertProduct clears the cache before writing; clear again now the row
    // exists so listNewProducts / brand counts stop showing it as new.
    invalidateAdminCmsCache();
    result.cmsId = cmsItemId(inserted);
    result.status = "created";
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
    return result;
  }

  // The product exists now; an image failure only adds a note to the result.
  try {
    const wixUrls = await uploadImages(row, product.Title, mediaFolder, result.errors);
    result.imagesUploaded = wixUrls.length;
    if (wixUrls.length > 0 && result.cmsId) {
      const patch = await updateProductImages(result.cmsId, PRODUCT_COLLECTION, wixUrls[0], wixUrls);
      if (!patch.success) result.errors.push(`Gắn ảnh vào CMS lỗi: ${patch.error}`);
    }
  } catch (err) {
    result.errors.push(`Upload ảnh lỗi: ${err instanceof Error ? err.message : String(err)}`);
  }
  return result;
}
