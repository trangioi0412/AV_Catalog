/**
 * POST /api/image-sync/upload
 * ─────────────────────────────────────────────────────────────────────────────
 * Receives multipart FormData containing:
 *   - files[]          : image files to upload
 *   - matchedJson      : JSON string of matched items from scan preview
 *   - collectionId     : Wix CMS collection ID (default: "product")
 *
 * Process per matched product:
 *   1. Upload mainImage → Wix Media Manager → get wix:image://v1/...
 *   2. Upload each galleryImage → get wix:image://v1/...
 *   3. PATCH CMS item with image + galleryImages
 *   4. Accumulate into SyncReport
 *
 * Returns the full SyncReport as JSON.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  uploadToWixMedia,
  updateProductImages,
} from "@/lib/services/wixCms";
import {
  withRetry,
  processBatch,
  SyncReport,
} from "@/lib/services/imageSyncService";
import { jobStore } from "@/lib/services/imageSyncJobStore";

export const runtime = "nodejs";
// Allow up to 5 minutes for large batches
export const maxDuration = 300;

/** Typed shape of a single matched item from the scan preview. */
interface MatchedPreviewItem {
  normalizedKey: string;
  displayName: string;
  mainFileName: string;
  galleryFileNames: string[];
  cmsId: string;
  productName: string;
}

/** Determine MIME type from file extension. */
function mimeFromName(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg"; // default for .jpg / .jpeg
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();

  try {
    // ── Parse multipart form data ─────────────────────────────────────────────
    const formData = await req.formData();
    const collectionId = (formData.get("collectionId") as string) ?? "Import1";
    const jobId = (formData.get("jobId") as string) ?? crypto.randomUUID();
    const matchedJsonRaw = formData.get("matchedJson") as string;

    if (!matchedJsonRaw) {
      return NextResponse.json(
        { error: "matchedJson field is required." },
        { status: 400 }
      );
    }

    const matchedItems: MatchedPreviewItem[] = JSON.parse(matchedJsonRaw);

    // Build a filename → File map for fast lookup
    const fileMap = new Map<string, File>();
    for (const [key, value] of formData.entries()) {
      if (key === "files" || key.startsWith("file_")) {
        if (value instanceof File) {
          fileMap.set(value.name, value);
        }
      }
    }

    if (fileMap.size === 0) {
      return NextResponse.json(
        { error: "No files uploaded. Include files in FormData." },
        { status: 400 }
      );
    }

    // ── Initialize job store entry ────────────────────────────────────────────
    jobStore.set(jobId, {
      jobId,
      status: "running",
      total: matchedItems.length,
      processed: 0,
      successCount: 0,
      failedCount: 0,
      logs: [],
      startedAt: new Date().toISOString(),
    });

    // ── Process in batches of 5 concurrent uploads ────────────────────────────
    const BATCH_SIZE = 5;
    const reportMatched: SyncReport["matched"] = [];

    const results = await processBatch(
      matchedItems,
      BATCH_SIZE,
      async (item) => {
        const mainFile = fileMap.get(item.mainFileName);
        if (!mainFile) {
          throw new Error(`File not found in upload: ${item.mainFileName}`);
        }

        // ── Upload main image ─────────────────────────────────────────────
        const mainBuffer = Buffer.from(await mainFile.arrayBuffer());
        const { wixUrl: mainWixUrl } = await withRetry(() =>
          uploadToWixMedia(mainBuffer, mainFile.name, mimeFromName(mainFile.name))
        );

        // ── Upload gallery images ─────────────────────────────────────────
        const galleryWixUrls: string[] = [];
        for (const galleryFileName of item.galleryFileNames) {
          const galleryFile = fileMap.get(galleryFileName);
          if (!galleryFile) continue;
          const galleryBuffer = Buffer.from(await galleryFile.arrayBuffer());
          const { wixUrl } = await withRetry(() =>
            uploadToWixMedia(
              galleryBuffer,
              galleryFile.name,
              mimeFromName(galleryFile.name)
            )
          );
          galleryWixUrls.push(wixUrl);
        }

        // ── PATCH CMS item ────────────────────────────────────────────────
        // Include both main image and additional gallery images in galleryImages field as requested
        const patchResult = await updateProductImages(
          item.cmsId,
          collectionId,
          mainWixUrl,
          [mainWixUrl, ...galleryWixUrls]
        );

        // Update job store progress
        const job = jobStore.get(jobId)!;
        job.processed += 1;
        if (patchResult.success) {
          job.successCount += 1;
        } else {
          job.failedCount += 1;
        }
        job.logs.push({
          productName: item.productName,
          fileName: item.mainFileName,
          status: patchResult.success ? "success" : "error",
          wixUrl: mainWixUrl,
          error: patchResult.error,
          timestamp: new Date().toISOString(),
        });

        return {
          productName: item.productName,
          cmsId: item.cmsId,
          imageFile: item.mainFileName,
          galleryFiles: item.galleryFileNames,
          status: patchResult.success ? ("success" as const) : ("error" as const),
          wixUrl: mainWixUrl,
          galleryWixUrls,
          error: patchResult.error,
        };
      }
    );

    // ── Collect results ───────────────────────────────────────────────────────
    for (const result of results) {
      if (result.status === "fulfilled") {
        reportMatched.push(result.value);
      } else {
        // Find which item failed
        const idx = results.indexOf(result);
        const item = matchedItems[idx];
        reportMatched.push({
          productName: item?.productName ?? "Unknown",
          cmsId: item?.cmsId ?? "",
          imageFile: item?.mainFileName ?? "",
          galleryFiles: item?.galleryFileNames ?? [],
          status: "error",
          error: String((result as PromiseRejectedResult).reason?.message ?? result),
        });
      }
    }

    const durationMs = Date.now() - startTime;
    const successCount = reportMatched.filter((r) => r.status === "success").length;

    const report: SyncReport = {
      matched: reportMatched,
      unmatched: [],  // Passed separately from scan, not re-computed here
      missing: [],
      summary: {
        total: matchedItems.length,
        success: successCount,
        failed: matchedItems.length - successCount,
        unmatched: 0,
        missing: 0,
        durationMs,
      },
    };

    // Mark job complete
    const job = jobStore.get(jobId);
    if (job) {
      job.status = "done";
      job.completedAt = new Date().toISOString();
    }

    return NextResponse.json({ ok: true, jobId, report });
  } catch (err: any) {
    console.error("[/api/image-sync/upload] Fatal error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Internal server error" },
      { status: 500 }
    );
  }
}
