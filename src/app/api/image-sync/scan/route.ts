/**
 * POST /api/image-sync/scan
 * ─────────────────────────────────────────────────────────────────────────────
 * Accepts a list of file names, fetches the Wix CMS product map, and
 * returns a scan preview (matched / unmatched / missing) — NO uploads.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAllProductsForImageSync } from "@/lib/services/wixCms";
import { buildScanPreview } from "@/lib/services/imageSyncService";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const fileNames: string[] = body.fileNames ?? [];
    const collectionId: string = body.collectionId ?? "Import2";

    if (!Array.isArray(fileNames) || fileNames.length === 0) {
      return NextResponse.json(
        { error: "fileNames array is required and must not be empty." },
        { status: 400 }
      );
    }

    // Fetch ALL products from CMS and build O(1) lookup Map
    const productMap = await getAllProductsForImageSync(collectionId);

    // Run matching algorithm (no IO, pure computation)
    const preview = buildScanPreview(fileNames, productMap);

    return NextResponse.json({
      ok: true,
      collectionId,
      totalFiles: fileNames.length,
      totalProducts: productMap.size,
      matchedCount: preview.matched.length,
      unmatchedCount: preview.unmatched.length,
      missingCount: preview.missing.length,
      preview,
    });
  } catch (err: any) {
    console.error("[/api/image-sync/scan] Error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Internal server error" },
      { status: 500 }
    );
  }
}
