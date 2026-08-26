/**
 * POST /api/catalog-upload/upload
 * ─────────────────────────────────────────────────────────────────────────────
 * Step 2: Upload a single PDF file to Wix Media Manager and patch CMS.
 *
 * Accepts multipart FormData:
 *   - file         : the PDF binary
 *   - cmsItemId    : Wix CMS item _id to patch
 *   - brandName    : brand name (used only to pick the CMS field to patch, not the folder)
 *   - categoryName : category name (server re-validates; maps to the CMS field to patch)
 *   - fileName     : original filename (for naming the Wix file)
 *
 * All PDFs are uploaded flat into the existing "Document" folder in Wix Media
 * Manager (see CATALOG_UPLOAD_FOLDER_NAME) — brand/category no longer create
 * Media Manager subfolders, they only decide which CMS column gets patched.
 *
 * Security:
 *  - Server re-validates brandName and categoryName (sanitizes path segments)
 *  - Does NOT accept parentFolderId from client — derived server-side
 *  - Validates cmsItemId format
 *  - Re-checks file is a PDF by MIME type and extension
 *  - Enforces file size limit
 */

import { NextRequest, NextResponse } from "next/server";
import {
  sanitizeSegment,
  getCatalogUploadFolderId,
  uploadPdfToWix,
  updateProductDocument,
  categoryToCmsField,
  MAX_PDF_SIZE_BYTES,
  checkAdminSession,
  CATALOG_UPLOAD_FOLDER_NAME,
} from "@/lib/services/wixCatalogPdf";
import { withRetry } from "@/lib/services/imageSyncService";
import type { UploadFileResponse } from "@/types/catalog-upload";

export const runtime = "nodejs";
// Allow up to 5 minutes for large batches
export const maxDuration = 300;

/** Validate that a CMS item ID looks like a Wix _id (basic sanity check). */
function isValidCmsItemId(id: string): boolean {
  if (!id || typeof id !== "string") return false;
  // Wix item IDs are typically UUID-like or alphanumeric strings
  return /^[a-zA-Z0-9\-_]{8,64}$/.test(id.trim());
}

export async function POST(req: NextRequest) {
  try {
    if (!checkAdminSession(req)) {
      return NextResponse.json(
        { error: "Unauthorized: Administrator access required." },
        { status: 401 }
      );
    }

    const formData = await req.formData();

    // ── Extract and validate inputs ───────────────────────────────────────────
    const file = formData.get("file");
    const cmsItemId = (formData.get("cmsItemId") as string | null)?.trim() ?? "";
    const rawBrandName = (formData.get("brandName") as string | null)?.trim() ?? "";
    const rawCategoryName = (formData.get("categoryName") as string | null)?.trim() ?? "";
    const rawFileName = (formData.get("fileName") as string | null)?.trim() ?? "";

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "file field is required and must be a File." },
        { status: 400 }
      );
    }

    if (!isValidCmsItemId(cmsItemId)) {
      return NextResponse.json(
        { error: `Invalid cmsItemId: "${cmsItemId}"` },
        { status: 400 }
      );
    }

    // ── Re-validate path segments server-side (do NOT trust client) ───────────
    let safeBrand: string;
    let safeCategory: string;
    let safeFileName: string;

    try {
      safeBrand = sanitizeSegment(rawBrandName);
      safeCategory = sanitizeSegment(rawCategoryName);
      // Validate filename separately (allow dot for extension)
      safeFileName = rawFileName.replace(/[<>:"|?*\\/\x00-\x1f]/g, "").trim();
      if (!safeFileName.toLowerCase().endsWith(".pdf")) {
        throw new Error("Filename must end with .pdf");
      }
    } catch (err: any) {
      return NextResponse.json(
        { error: `Path validation failed: ${err.message}` },
        { status: 400 }
      );
    }

    // ── File type validation ──────────────────────────────────────────────────
    const mimeType = file.type;
    if (mimeType && mimeType !== "application/pdf" && !mimeType.includes("pdf")) {
      return NextResponse.json(
        { error: `Invalid file type: "${mimeType}". Only PDFs are accepted.` },
        { status: 400 }
      );
    }

    // ── File size check ───────────────────────────────────────────────────────
    if (file.size > MAX_PDF_SIZE_BYTES) {
      const mb = (file.size / 1024 / 1024).toFixed(1);
      return NextResponse.json(
        {
          error: `File too large: ${mb} MB (max ${
            MAX_PDF_SIZE_BYTES / 1024 / 1024
          } MB)`,
        },
        { status: 413 }
      );
    }

    // ── Resolve the "Document" Media Manager folder (flat — no brand/category subfolders) ──
    const folderId = await getCatalogUploadFolderId();
    if (!folderId) {
      console.warn(`[catalog-upload/upload] Could not resolve "${CATALOG_UPLOAD_FOLDER_NAME}" folder for ${safeBrand}/${safeCategory}, uploading PDF to root Media Manager.`);
    }

    // ── Upload PDF to Wix ─────────────────────────────────────────────────────
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    let uploadResult;
    try {
      uploadResult = await withRetry(
        () => uploadPdfToWix(fileBuffer, safeFileName, folderId),
        2,    // max 2 retries
        1000  // 1s base delay
      );
    } catch (err: any) {
      return NextResponse.json(
        { error: `Wix upload failed: ${err.message}` },
        { status: 502 }
      );
    }

    // ── Patch CMS item ────────────────────────────────────────────────────────
    const cmsField = categoryToCmsField(safeCategory);
    const patchResult = await updateProductDocument(
      cmsItemId,
      uploadResult.wixUrl,
      uploadResult.fileId,
      uploadResult.fileName,
      cmsField
    );

    if (!patchResult.success) {
      // Upload succeeded but CMS patch failed — still report the wix URL
      console.error(
        `[catalog-upload/upload] CMS patch failed for ${cmsItemId}: ${patchResult.error}`
      );
      const response: UploadFileResponse = {
        ok: false,
        cmsItemId,
        wixFileId: uploadResult.fileId,
        wixUrl: uploadResult.wixUrl,
        error: `CMS update failed: ${patchResult.error}`,
      };
      return NextResponse.json(response, { status: 207 }); // 207 Multi-Status
    }

    const response: UploadFileResponse = {
      ok: true,
      cmsItemId,
      wixFileId: uploadResult.fileId,
      wixUrl: uploadResult.wixUrl,
      updatedAt: patchResult.updatedAt,
    };

    return NextResponse.json(response);
  } catch (err: any) {
    console.error("[/api/catalog-upload/upload] Fatal error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Internal server error" },
      { status: 500 }
    );
  }
}
