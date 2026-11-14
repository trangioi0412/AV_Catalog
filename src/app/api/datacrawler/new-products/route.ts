import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/auth/guard";
import { BrandSheetError, getBrandRowsByNumber, parseRowTargets } from "@/lib/services/brandSheets";
import { ensureWixBrand } from "@/lib/services/brandPublish";
import { AV_CHECK_MAX_ROWS, checkAvRelevance } from "@/lib/services/avRelevanceCheck";
import { listBrandsWithNewProducts, listNewProducts, uploadNewProductRow } from "@/lib/services/newProductUpload";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Rows per POST: a row may download up to 10 images, the client loops. */
const MAX_ROWS_PER_CALL = 1;

function fail(error: unknown) {
  const status = error instanceof BrandSheetError ? error.status : 502;
  if (status >= 500) console.error("[datacrawler/new-products] failed:", error);
  return NextResponse.json({ detail: error instanceof Error ? error.message : String(error) }, { status });
}

/**
 * GET              -> { brands }: brand tabs that still have products not on Wix CMS.
 * GET ?tab=<brand> -> that tab's products that are not on Wix CMS yet.
 */
export async function GET(request: NextRequest) {
  const denied = await authorizeRequest(request, "editor");
  if (denied) return denied;

  const tab = request.nextUrl.searchParams.get("tab")?.trim();

  try {
    if (!tab) return NextResponse.json({ brands: await listBrandsWithNewProducts() });
    return NextResponse.json(await listNewProducts(tab));
  } catch (error) {
    return fail(error);
  }
}

/**
 * Body:
 *   { tab, action: "brand", brandName }                     -> create the Wix brand if missing
 *   { tab, action: "products", cmsBrandId, mediaFolder,
 *     rows: [{ rowNumber, key }] }                          -> insert those rows into Import1
 *   { tab, action: "av-check", brandName,
 *     rows: [{ rowNumber, key }] }                          -> AI: is each row an AV product?
 */
export async function POST(request: NextRequest) {
  // Auth before touching the body: every action needs at least editor.
  const denied = await authorizeRequest(request, "editor");
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const tab = typeof body?.tab === "string" ? body.tab.trim() : "";
  if (!tab) return NextResponse.json({ detail: "Thiếu tab" }, { status: 400 });

  // Creating a brand is admin-only (same as Brand mới); adding products is editor work.
  if (body.action === "brand") {
    const deniedAdmin = await authorizeRequest(request, "admin");
    if (deniedAdmin) return deniedAdmin;
  }

  try {
    if (body.action === "brand") {
      const name = typeof body.brandName === "string" && body.brandName.trim() ? body.brandName.trim() : tab;
      return NextResponse.json(await ensureWixBrand(name, tab));
    }

    if (body.action === "products") {
      const cmsBrandId = typeof body.cmsBrandId === "string" ? body.cmsBrandId.trim() : "";
      // One Media folder named after the brand: a "/" in the brand/tab name
      // ("AV/Stumpfl") must not turn into nested folders.
      const rawFolder = typeof body.mediaFolder === "string" && body.mediaFolder.trim() ? body.mediaFolder.trim() : tab;
      const mediaFolder = rawFolder.replace(/\s*\/\s*/g, "-");
      if (!cmsBrandId) return NextResponse.json({ detail: "Thiếu cmsBrandId (hãng chưa có trên CMS)" }, { status: 400 });

      const targets = parseRowTargets(body.rows);
      if (targets.length === 0 || targets.length > MAX_ROWS_PER_CALL) {
        return NextResponse.json({ detail: `Gửi 1-${MAX_ROWS_PER_CALL} dòng mỗi lần` }, { status: 400 });
      }
      const rows = await getBrandRowsByNumber(tab, targets);
      const results = [];
      for (const row of rows) results.push(await uploadNewProductRow(row, cmsBrandId, mediaFolder));
      return NextResponse.json({ results });
    }

    if (body.action === "av-check") {
      const targets = parseRowTargets(body.rows);
      if (targets.length === 0 || targets.length > AV_CHECK_MAX_ROWS) {
        return NextResponse.json({ detail: `Gửi 1-${AV_CHECK_MAX_ROWS} dòng mỗi lần` }, { status: 400 });
      }
      const brandName = typeof body.brandName === "string" && body.brandName.trim() ? body.brandName.trim() : tab;
      const rows = await getBrandRowsByNumber(tab, targets);
      return NextResponse.json({ results: await checkAvRelevance(brandName, rows) });
    }

    return NextResponse.json({ detail: "action phải là 'brand', 'products' hoặc 'av-check'" }, { status: 400 });
  } catch (error) {
    return fail(error);
  }
}
