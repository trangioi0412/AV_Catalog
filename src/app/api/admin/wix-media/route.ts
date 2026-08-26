/**
 * /api/admin/wix-media
 * ─────────────────────────────────────────────────────────────────────────────
 * GET    — list (or search) files in the Wix Media Manager.
 * DELETE — move one or more files to the Media Manager's Trash.
 *
 * Both admin-only. `proxy.ts` (this project's middleware) explicitly excludes
 * `/api/*` from its route protection, so admin_session is re-checked here.
 */

import { NextRequest, NextResponse } from "next/server";
import { checkAdminSession } from "@/lib/services/wixCatalogPdf";
import {
  bulkTrashMediaFiles,
  clampPageSize,
  findMediaFilesByProductName,
  isValidCursor,
  isValidFolderId,
  isValidMediaFileId,
  isValidProductNameTerm,
  isValidSearchTerm,
  isWixMediaConfigured,
  listMediaFiles,
  WixMediaError,
} from "@/lib/services/wixMediaManager";
import { MAX_FILE_IDS_PER_DELETE_REQUEST } from "@/types/media-manager";
import type {
  DeleteMediaResponse,
  MediaListResponse,
  MediaSortOrder,
  MediaTypeFilter,
} from "@/types/media-manager";

export const runtime = "nodejs";

const VALID_MEDIA_TYPE_FILTERS: MediaTypeFilter[] = ["ALL", "IMAGE", "VIDEO", "DOCUMENT"];
const VALID_SORT_ORDERS: MediaSortOrder[] = ["ASC", "DESC"];

function noStore(json: unknown, init?: ResponseInit) {
  const res = NextResponse.json(json, init);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function errorResponse(err: unknown): NextResponse {
  if (err instanceof WixMediaError) {
    return noStore({ error: err.message, code: err.code }, { status: err.status });
  }
  console.error("[/api/admin/wix-media] Unexpected error:", err);
  return noStore({ error: "Internal server error." }, { status: 500 });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — list / search files
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!checkAdminSession(req)) {
    return noStore({ error: "Unauthorized: Administrator access required." }, { status: 401 });
  }

  if (!isWixMediaConfigured()) {
    return noStore(
      { error: "Wix credentials (WIX_API_KEY, WIX_SITE_ID) are not configured.", code: "NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  const { searchParams } = req.nextUrl;

  const pageSizeRaw = searchParams.get("pageSize");
  const pageSize = clampPageSize(pageSizeRaw ? Number(pageSizeRaw) : undefined);

  const cursor = searchParams.get("cursor")?.trim() || undefined;
  if (cursor && !isValidCursor(cursor)) {
    return noStore({ error: "Invalid cursor." }, { status: 400 });
  }

  const search = searchParams.get("search")?.trim() || undefined;
  if (search && !isValidSearchTerm(search)) {
    return noStore({ error: "Search term is empty or too long (max 200 characters)." }, { status: 400 });
  }

  const productName = searchParams.get("productName")?.trim() || undefined;
  if (productName && !isValidProductNameTerm(productName)) {
    return noStore({ error: "Product name is empty or too long (max 200 characters)." }, { status: 400 });
  }

  const mediaTypeRaw = searchParams.get("mediaType")?.trim().toUpperCase() || "ALL";
  if (!VALID_MEDIA_TYPE_FILTERS.includes(mediaTypeRaw as MediaTypeFilter)) {
    return noStore(
      { error: `Invalid mediaType. Expected one of: ${VALID_MEDIA_TYPE_FILTERS.join(", ")}.` },
      { status: 400 }
    );
  }
  const mediaType = mediaTypeRaw as MediaTypeFilter;

  const parentFolderId = searchParams.get("parentFolderId")?.trim() || undefined;
  if (parentFolderId && !isValidFolderId(parentFolderId)) {
    return noStore({ error: "Invalid parentFolderId." }, { status: 400 });
  }

  const sortOrderRaw = searchParams.get("sortOrder")?.trim().toUpperCase() || "DESC";
  if (!VALID_SORT_ORDERS.includes(sortOrderRaw as MediaSortOrder)) {
    return noStore({ error: `Invalid sortOrder. Expected one of: ${VALID_SORT_ORDERS.join(", ")}.` }, { status: 400 });
  }
  const sortOrder = sortOrderRaw as MediaSortOrder;

  try {
    // Filtering by product name takes priority over free-text search — it returns the
    // complete set of matching files (main + gallery images, grouped the same way Image
    // Sync groups them), not a single page, so `cursor`/pagination don't apply to it.
    if (productName) {
      const items = await findMediaFilesByProductName(productName, mediaType);
      const result: MediaListResponse = { items, nextCursor: null, hasNextPage: false };
      return noStore(result);
    }

    const result: MediaListResponse = await listMediaFiles({
      pageSize,
      cursor,
      search,
      mediaType,
      parentFolderId,
      sortOrder,
    });
    return noStore(result);
  } catch (err) {
    return errorResponse(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE — bulk move files to Trash
// ─────────────────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  if (!checkAdminSession(req)) {
    return noStore({ error: "Unauthorized: Administrator access required." }, { status: 401 });
  }

  if (!isWixMediaConfigured()) {
    return noStore(
      { error: "Wix credentials (WIX_API_KEY, WIX_SITE_ID) are not configured.", code: "NOT_CONFIGURED" },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return noStore({ error: "Invalid JSON body." }, { status: 400 });
  }

  const fileIds = (body as { fileIds?: unknown } | null)?.fileIds;
  if (!Array.isArray(fileIds)) {
    return noStore({ error: "fileIds must be an array." }, { status: 400 });
  }
  if (fileIds.length === 0) {
    return noStore({ error: "fileIds must not be empty." }, { status: 400 });
  }

  const dedupedIds = Array.from(new Set(fileIds));

  if (dedupedIds.length > MAX_FILE_IDS_PER_DELETE_REQUEST) {
    return noStore(
      { error: `Too many fileIds. Max ${MAX_FILE_IDS_PER_DELETE_REQUEST} per request.` },
      { status: 400 }
    );
  }

  const invalidIds = dedupedIds.filter((id) => !isValidMediaFileId(id));
  if (invalidIds.length > 0) {
    return noStore(
      {
        error:
          "One or more fileIds are invalid. Expected a Wix file GUID (not a URL), " +
          `e.g. "w8ide0_abc123.pdf". Invalid count: ${invalidIds.length}.`,
      },
      { status: 400 }
    );
  }

  const validIds = dedupedIds as string[];

  try {
    const { deleted, failed } = await bulkTrashMediaFiles(validIds);

    const response: DeleteMediaResponse = {
      requested: validIds.length,
      deleted,
      failed,
    };

    if (deleted.length === 0 && failed.length > 0) {
      return noStore(response, { status: 502 });
    }
    if (failed.length > 0) {
      return noStore(response, { status: 207 });
    }
    return noStore(response, { status: 200 });
  } catch (err) {
    return errorResponse(err);
  }
}
