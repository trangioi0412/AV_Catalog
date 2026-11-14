/**
 * "Brand mới" (DataCrawler): finds manufacturer tabs in the shared Google
 * Spreadsheet that have no matching record in the Wix `brand` collection,
 * and uploads a logo for them to Media Manager folder "Brand/Logo".
 *
 * The first NON_BRAND_TAB_COUNT tabs of the spreadsheet are work tabs
 * (New_brand, product_new, product_delete, Sync_Logs, System_Config,
 * DataCrawler_*), not manufacturers; every tab after them is one brand.
 */
import { listBrandTabs, listSheetTabTitles } from "./brandSheets";
import {
  brandMatchKey,
  downloadImage,
  ensureWixBrand,
  EXT_BY_MIME,
  isFetchableImageUrl,
  listWixBrands,
} from "./brandPublish";
import { updateProductImages, uploadToWixMedia } from "./wixCms";

export const NON_BRAND_TAB_COUNT = 8;
export const BRAND_LOGO_FOLDER = "Brand/Logo";
const MAX_LOGO_BYTES = 15 * 1024 * 1024;

export interface SheetBrandStatus {
  tab: string;
  brandName: string;
  productCount: number;
  inCms: boolean;
  cmsBrand: { _id: string; title: string; logo: string } | null;
}

export interface BrandLogoResult {
  wixUrl: string;
  fileName: string;
  folder: string;
  /** Set when attachToCms was requested. */
  cms?: { brandId: string; brandCreated: boolean; logoAttached: boolean; note?: string };
}

/** Every brand tab (after the first 8) with its Wix CMS match, new brands first. */
export async function listSheetBrandsVsCms(): Promise<SheetBrandStatus[]> {
  const [titles, summaries, wixBrands] = await Promise.all([
    listSheetTabTitles(),
    listBrandTabs(),
    listWixBrands(),
  ]);
  const summaryByTab = new Map(summaries.map((s) => [s.tab, s]));

  const byKey = new Map<string, { _id: string; title: string; logo: string }>();
  for (const b of wixBrands) {
    const record = { _id: b._id, title: b.data.title || b.data.name || "", logo: b.data.logo || "" };
    for (const k of [b.data.title, b.data.name, b.data.id].map(brandMatchKey)) {
      if (k && !byKey.has(k)) byKey.set(k, record);
    }
  }

  const out = titles.slice(NON_BRAND_TAB_COUNT).map((tab): SheetBrandStatus => {
    const summary = summaryByTab.get(tab);
    const brandName = summary?.brandName || tab;
    const cmsBrand = byKey.get(brandMatchKey(brandName)) || byKey.get(brandMatchKey(tab)) || null;
    return { tab, brandName, productCount: summary?.productCount ?? 0, inCms: !!cmsBrand, cmsBrand };
  });

  return out.sort((a, b) => Number(a.inCms) - Number(b.inCms) || a.tab.localeCompare(b.tab));
}

export type LogoSource = { url: string } | { buffer: Buffer; mime: string };

async function resolveLogo(source: LogoSource): Promise<{ buffer: Buffer; mime: string }> {
  if ("url" in source) {
    if (!isFetchableImageUrl(source.url)) throw new Error("URL ảnh không hợp lệ (chỉ http/https công khai)");
    return downloadImage(source.url);
  }
  if (!EXT_BY_MIME[source.mime]) throw new Error(`Định dạng ảnh không hỗ trợ (${source.mime || "không rõ"})`);
  if (source.buffer.length === 0) throw new Error("File rỗng");
  if (source.buffer.length > MAX_LOGO_BYTES) throw new Error("Ảnh lớn hơn 15MB");
  return source;
}

/**
 * Uploads the logo to "Brand/Logo" as "logo_<brand>.<ext>". With
 * attachToCms, also creates the Wix brand when missing and sets its `logo`
 * field. A logo that is already set is only overwritten with replaceExisting.
 */
export async function uploadBrandLogo(params: {
  tab: string;
  brandName: string;
  source: LogoSource;
  attachToCms: boolean;
  replaceExisting?: boolean;
}): Promise<BrandLogoResult> {
  const brandName = params.brandName.trim() || params.tab;
  const { buffer, mime } = await resolveLogo(params.source);
  const { wixUrl, fileName } = await uploadToWixMedia(
    buffer,
    `logo_${brandName}${EXT_BY_MIME[mime]}`,
    mime,
    BRAND_LOGO_FOLDER
  );
  const result: BrandLogoResult = { wixUrl, fileName, folder: BRAND_LOGO_FOLDER };
  if (!params.attachToCms) return result;

  const { created, brand } = await ensureWixBrand(brandName, params.tab);
  const current = (await listWixBrands()).find((b) => b._id === brand._id);
  if (current?.data.logo && !params.replaceExisting) {
    result.cms = { brandId: brand._id, brandCreated: created, logoAttached: false, note: "Brand đã có logo trên CMS, không ghi đè" };
    return result;
  }
  const patch = await updateProductImages(brand._id, "brand", wixUrl, [], "logo");
  result.cms = {
    brandId: brand._id,
    brandCreated: created,
    logoAttached: patch.success,
    note: patch.success ? undefined : `Gắn logo lỗi: ${patch.error}`,
  };
  return result;
}
