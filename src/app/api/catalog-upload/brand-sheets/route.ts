import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/auth/guard";
import { BrandSheetError, listBrandTabs } from "@/lib/services/brandSheets";

export const runtime = "nodejs";

/** Brand tabs crawled by DataCrawler, most recently synced first. */
export async function GET(request: NextRequest) {
  const denied = await authorizeRequest(request, "editor");
  if (denied) return denied;

  try {
    return NextResponse.json({ brands: await listBrandTabs() });
  } catch (error) {
    const status = error instanceof BrandSheetError ? error.status : 502;
    console.error("[brand-sheets] list failed:", error);
    return NextResponse.json({ detail: error instanceof Error ? error.message : String(error) }, { status });
  }
}
