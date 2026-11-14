import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/auth/guard";
import { BrandSheetError, getBrandRowsByNumber, listBrandTabs, parseRowTargets } from "@/lib/services/brandSheets";
import { ensureWixBrand, uploadRowImagesToWix } from "@/lib/services/brandPublish";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Rows per call: the client loops in batches so no request nears maxDuration. */
const MAX_ROWS_PER_CALL = 10;

type Ctx = { params: Promise<{ brand: string }> };

async function brandDisplayName(tab: string): Promise<string> {
  const summary = (await listBrandTabs()).find((b) => b.tab === tab);
  if (!summary) throw new BrandSheetError(404, `Không tìm thấy tab hãng "${tab}"`);
  return summary.brandName;
}

/**
 * Body:
 *   { action: "brand" }                                         -> create the Wix brand if missing
 *   { action: "images", rows: [{ rowNumber, key }], brandName } -> upload those rows' images
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  const denied = await authorizeRequest(request, "admin");
  if (denied) return denied;
  const { brand } = await params;
  const tab = decodeURIComponent(brand);

  const body = await request.json().catch(() => null);

  try {
    if (body?.action === "brand") {
      const name = await brandDisplayName(tab);
      return NextResponse.json(await ensureWixBrand(name, tab));
    }

    if (body?.action === "images") {
      const targets = parseRowTargets(body.rows);
      if (targets.length === 0 || targets.length > MAX_ROWS_PER_CALL) {
        return NextResponse.json({ detail: `Gửi 1-${MAX_ROWS_PER_CALL} dòng mỗi lần` }, { status: 400 });
      }
      const brandName =
        typeof body.brandName === "string" && body.brandName.trim() ? body.brandName.trim() : await brandDisplayName(tab);
      const sheetRows = await getBrandRowsByNumber(tab, targets);

      const results = [];
      for (const row of sheetRows) results.push(await uploadRowImagesToWix(row, brandName));
      return NextResponse.json({ results });
    }

    return NextResponse.json({ detail: "action phải là 'brand' hoặc 'images'" }, { status: 400 });
  } catch (error) {
    const status = error instanceof BrandSheetError ? error.status : 502;
    if (status >= 500) console.error("[brand-sheets] publish failed:", error);
    return NextResponse.json({ detail: error instanceof Error ? error.message : String(error) }, { status });
  }
}
