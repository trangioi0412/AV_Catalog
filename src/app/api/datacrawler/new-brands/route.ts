import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/auth/guard";
import { BrandSheetError, listSheetTabTitles } from "@/lib/services/brandSheets";
import {
  listSheetBrandsVsCms,
  NON_BRAND_TAB_COUNT,
  uploadBrandLogo,
  type LogoSource,
} from "@/lib/services/dataCrawlerNewBrands";

export const runtime = "nodejs";
export const maxDuration = 60;

function fail(error: unknown, scope: string) {
  const status = error instanceof BrandSheetError ? error.status : 502;
  if (status >= 500) console.error(`[datacrawler/new-brands] ${scope} failed:`, error);
  return NextResponse.json({ detail: error instanceof Error ? error.message : String(error) }, { status });
}

/** Brand tabs (skipping the first 8 work tabs) with their Wix CMS match. */
export async function GET(request: NextRequest) {
  const denied = await authorizeRequest(request, "editor");
  if (denied) return denied;
  try {
    return NextResponse.json({ brands: await listSheetBrandsVsCms() });
  } catch (error) {
    return fail(error, "list");
  }
}

/**
 * multipart/form-data:
 *   tab, brandName, attachToCms ("true"|"false"),
 *   replaceLogo ("true" overwrites an existing CMS logo), and either
 *   imageUrl (downloaded server-side) or file (uploaded from the computer).
 * Uploads the logo to Media Manager "Brand/Logo".
 */
export async function POST(request: NextRequest) {
  const denied = await authorizeRequest(request, "admin");
  if (denied) return denied;

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ detail: "Body phải là multipart/form-data" }, { status: 400 });

  const tab = String(form.get("tab") ?? "").trim();
  const brandName = String(form.get("brandName") ?? "").trim();
  const imageUrl = String(form.get("imageUrl") ?? "").trim();
  const file = form.get("file");
  const attachToCms = form.get("attachToCms") === "true";
  const replaceLogo = form.get("replaceLogo") === "true";

  try {
    // Only real brand tabs: never let a work tab (product_new, ...) become a brand.
    const brandTabs = (await listSheetTabTitles()).slice(NON_BRAND_TAB_COUNT);
    if (!brandTabs.includes(tab)) {
      return NextResponse.json({ detail: `"${tab}" không phải tab hãng` }, { status: 400 });
    }

    let source: LogoSource;
    if (file instanceof File && file.size > 0) {
      source = { buffer: Buffer.from(await file.arrayBuffer()), mime: file.type.toLowerCase() };
    } else if (imageUrl) {
      source = { url: imageUrl };
    } else {
      return NextResponse.json({ detail: "Cần URL ảnh hoặc file ảnh" }, { status: 400 });
    }

    return NextResponse.json(await uploadBrandLogo({ tab, brandName: brandName || tab, source, attachToCms, replaceExisting: replaceLogo }));
  } catch (error) {
    return fail(error, "logo");
  }
}
