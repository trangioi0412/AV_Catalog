/**
 * POST /api/catalog-upload/validate
 * ─────────────────────────────────────────────────────────────────────────────
 * Step 1 of catalog upload: validate file paths and match against CMS.
 *
 * Accepts JSON body: { files: Array<{ relativePath, name, sizeBytes }> }
 *
 * For each file:
 *  1. Parse webkitRelativePath → brand / category / product
 *  2. Security checks (path traversal, dangerous chars, hidden files)
 *  3. Validate file is PDF, structure has correct depth, size within limit
 *  4. Search Wix CMS for matching product
 *
 * Returns CatalogPreviewRow[] (no binary data involved at this stage).
 *
 * Security:
 *  - Does NOT accept folder IDs or collection IDs from client
 *  - Server re-validates all path segments independently
 */

import { NextRequest, NextResponse } from "next/server";
import {
  sanitizeSegment,
  searchCmsProduct,
  MAX_PDF_SIZE_BYTES,
  checkAdminSession,
  CATALOG_UPLOAD_FOLDER_NAME,
} from "@/lib/services/wixCatalogPdf";
import type {
  CatalogFileEntry,
  CatalogPreviewRow,
  ValidateResponse,
} from "@/types/catalog-upload";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Hidden file patterns to reject (OS metadata, macOS, Windows) */
const HIDDEN_FILE_PATTERNS = [
  /^\./,         // .DS_Store, .gitkeep, etc.
  /^__MACOSX/,   // macOS resource forks
  /^Thumbs\.db$/i,
  /^desktop\.ini$/i,
];

function isHiddenFile(name: string): boolean {
  return HIDDEN_FILE_PATTERNS.some((re) => re.test(name));
}

/**
 * Parse a webkitRelativePath into structured catalog entry components.
 * Expected format: Catalog/{brand}/{category}/{product}.pdf
 *
 * Returns null if the path doesn't match the expected structure.
 */
function parseRelativePath(
  relativePath: string,
  fileName: string,
  sizeBytes: number
): CatalogFileEntry | { error: string } {
  // Normalize path separators
  const normalized = relativePath.replace(/\\/g, "/").trim();
  const segments = normalized.split("/").filter(Boolean);

  // Must have at least 4 segments: rootFolder / brand / category / file.pdf
  if (segments.length < 4) {
    return {
      error: `Cấu trúc không đúng (cần ít nhất 4 cấp, nhận được ${segments.length}): "${relativePath}"`,
    };
  }

  // Take from the right: last = filename, third-last = category, fourth-last = brand
  // The root folder name is ignored (could be "Catalog" or anything else)
  const fileSegment = segments[segments.length - 1];
  const categorySegment = segments[segments.length - 2];
  const brandSegment = segments[segments.length - 3];

  // Validate filename is PDF
  if (!fileSegment.toLowerCase().endsWith(".pdf")) {
    return { error: `Chỉ chấp nhận file PDF: "${fileSegment}"` };
  }

  // Reject hidden files
  if (isHiddenFile(fileSegment)) {
    return { error: `File ẩn bị bỏ qua: "${fileSegment}"` };
  }

  // Sanitize each segment (throws on path traversal)
  let safeBrand: string;
  let safeCategory: string;
  let safeFile: string;

  try {
    safeBrand = sanitizeSegment(brandSegment);
    safeCategory = sanitizeSegment(categorySegment);
    safeFile = sanitizeSegment(fileSegment);
  } catch (err: any) {
    return { error: `Ký tự không hợp lệ trong đường dẫn: ${err.message}` };
  }

  // Extract product name (strip .pdf extension)
  const productName = safeFile.replace(/\.pdf$/i, "");

  if (!productName) {
    return { error: `Tên sản phẩm rỗng sau khi loại phần mở rộng: "${fileSegment}"` };
  }

  // File size check
  if (sizeBytes > MAX_PDF_SIZE_BYTES) {
    const mb = (sizeBytes / 1024 / 1024).toFixed(1);
    return {
      error: `File quá lớn (${mb} MB, giới hạn ${MAX_PDF_SIZE_BYTES / 1024 / 1024} MB): "${fileSegment}"`,
    };
  }

  return {
    relativePath,
    fileName: safeFile,
    brandName: safeBrand,
    categoryName: safeCategory,
    productName,
    sizeBytes,
  };
}

export async function POST(req: NextRequest) {
  try {
    if (!checkAdminSession(req)) {
      return NextResponse.json(
        { error: "Unauthorized: Administrator access required." },
        { status: 401 }
      );
    }

    const body = await req.json();
    const rawFiles: Array<{ relativePath: string; name: string; sizeBytes: number }> =
      body?.files ?? [];

    if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
      return NextResponse.json(
        { error: "files array is required and must not be empty." },
        { status: 400 }
      );
    }

    const rows: CatalogPreviewRow[] = [];
    const skipped: ValidateResponse["skipped"] = [];

    // ── Parse & validate paths ────────────────────────────────────────────────
    const validEntries: CatalogFileEntry[] = [];

    for (const raw of rawFiles) {
      // Basic type guards
      if (typeof raw.relativePath !== "string" || typeof raw.name !== "string") {
        skipped.push({ relativePath: raw.relativePath ?? "?", reason: "Dữ liệu không hợp lệ" });
        continue;
      }

      // Reject hidden files early (before segment parsing)
      if (isHiddenFile(raw.name)) {
        skipped.push({ relativePath: raw.relativePath, reason: `File ẩn: "${raw.name}"` });
        continue;
      }

      const parsed = parseRelativePath(raw.relativePath, raw.name, raw.sizeBytes ?? 0);

      if ("error" in parsed) {
        skipped.push({ relativePath: raw.relativePath, reason: parsed.error });
      } else {
        validEntries.push(parsed);
      }
    }

    // ── CMS matching (concurrent, capped at 5) ────────────────────────────────
    const MATCH_CONCURRENCY = 5;

    for (let i = 0; i < validEntries.length; i += MATCH_CONCURRENCY) {
      const chunk = validEntries.slice(i, i + MATCH_CONCURRENCY);
      const chunkResults = await Promise.allSettled(
        chunk.map((entry) => searchCmsProduct(entry.productName, entry.brandName))
      );

      for (let j = 0; j < chunk.length; j++) {
        const entry = chunk[j];
        const result = chunkResults[j];

        let cmsMatchStatus: CatalogPreviewRow["cmsMatchStatus"] = "no_match";
        let cmsItemId: string | undefined;
        let cmsProductName: string | undefined;
        let cmsSuggestions: CatalogPreviewRow["cmsSuggestions"];
        let warning: string | undefined;

        if (result.status === "fulfilled") {
          const match = result.value;
          cmsMatchStatus = match.status;
          cmsItemId = match.itemId;
          cmsProductName = match.productName;
          cmsSuggestions = match.suggestions;

          if (match.status === "multiple_match") {
            warning = `Tìm thấy nhiều sản phẩm CMS trùng tên "${entry.productName}" — chọn gợi ý bên dưới`;
          } else if (match.status === "no_match") {
            warning = match.suggestions && match.suggestions.length > 0
              ? `Không tìm thấy chuẩn "${entry.productName}" — có ${match.suggestions.length} gợi ý tương tự`
              : `Không tìm thấy sản phẩm "${entry.productName}" trong CMS`;
          }
        } else {
          warning = `Lỗi tìm kiếm CMS: ${String(result.reason)}`;
        }

        rows.push({
          entry,
          cmsMatchStatus,
          cmsItemId,
          cmsProductName,
          cmsSuggestions,
          wixFolderPath: CATALOG_UPLOAD_FOLDER_NAME,
          warning,
          selected: cmsMatchStatus === "matched", // default: only select matched items
        });
      }
    }

    const matchedCount = rows.filter((r) => r.cmsMatchStatus === "matched").length;
    const noMatchCount = rows.filter((r) => r.cmsMatchStatus === "no_match").length;
    const multipleMatchCount = rows.filter((r) => r.cmsMatchStatus === "multiple_match").length;

    const response: ValidateResponse = {
      ok: true,
      rows,
      skipped,
      totalFiles: rawFiles.length,
      validCount: validEntries.length,
      matchedCount,
      noMatchCount,
      multipleMatchCount,
    };

    return NextResponse.json(response);
  } catch (err: any) {
    console.error("[/api/catalog-upload/validate] Error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Internal server error" },
      { status: 500 }
    );
  }
}
