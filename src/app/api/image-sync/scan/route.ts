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
    const collectionId: string = body.collectionId ?? "Import1";
    const matchField: string = body.matchField ?? "Product";
    const imageField: string = body.imageField ?? "image";
    const galleryField: string = body.galleryField ?? "galleryImages";

    if (!Array.isArray(fileNames) || fileNames.length === 0) {
      return NextResponse.json(
        { error: "fileNames array is required and must not be empty." },
        { status: 400 }
      );
    }

    // Fetch ALL products from CMS and build O(1) lookup Map
    const productMap = await getAllProductsForImageSync(collectionId, matchField, imageField, galleryField);

    // Run matching algorithm (no IO, pure computation)
    const preview = buildScanPreview(fileNames, productMap);

    // Count products that already have images on Wix CMS
    let productsWithImagesCount = 0;
    for (const p of productMap.values()) {
      if (p.image && p.image.trim() !== "") {
        productsWithImagesCount++;
      }
    }

    return NextResponse.json({
      ok: true,
      collectionId,
      totalFiles: fileNames.length,
      totalProducts: productMap.size,
      productsWithImagesCount,
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
