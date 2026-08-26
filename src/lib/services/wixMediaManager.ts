/**
 * wixMediaManager.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Server-side service for browsing and bulk-trashing files in the Wix Media
 * Manager (Site Media). Every function here talks to Wix using WIX_API_KEY /
 * WIX_SITE_ID and must only ever be imported from server code (API routes,
 * server actions) — never from a Client Component.
 *
 * Endpoints used (verified against dev.wix.com/docs/api-reference/assets/media
 * on 2026-08-26 — see the "media-manager/files" REST reference):
 *   - GET  /site-media/v1/files          (ListFiles    — no free-text search)
 *   - POST /site-media/v1/files/search   (SearchFiles  — free-text search,
 *                                          but no parentFolderId scoping)
 *   - POST /site-media/v1/bulk/files/delete (BulkDeleteFiles — trash/permanent)
 *
 * BulkDeleteFiles returns an empty object on success — Wix does not report
 * per-file results. To still support "partial success" reporting, requests
 * are chunked into small batches; a batch's success/failure is applied to
 * every file ID in that batch.
 */

import type {
  DeleteMediaFailure,
  MediaFileItem,
  MediaListResponse,
  MediaSortOrder,
  MediaTypeFilter,
  WixMediaType,
} from "@/types/media-manager";
import { normalizeName } from "@/lib/services/wixCms";
import { parseImageName } from "@/lib/services/imageSyncService";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const WIX_MEDIA_API_BASE = "https://www.wixapis.com/site-media/v1";
const LIST_FILES_URL = `${WIX_MEDIA_API_BASE}/files`;
const SEARCH_FILES_URL = `${WIX_MEDIA_API_BASE}/files/search`;
const BULK_DELETE_URL = `${WIX_MEDIA_API_BASE}/bulk/files/delete`;

/** Wix hard limit on `paging.limit` for both ListFiles and SearchFiles. */
const WIX_MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 50;

/** Wix hard limit on `search` free-text length. */
const WIX_MAX_SEARCH_LENGTH = 200;
/** Wix hard limit on a cursor token's length. */
const WIX_MAX_CURSOR_LENGTH = 16000;
/** Wix hard limit on a parentFolderId's length. */
const WIX_MAX_FOLDER_ID_LENGTH = 100;
/** Wix hard limit on a single fileId's length (per BulkDeleteFiles validation). */
const WIX_MAX_FILE_ID_LENGTH = 1000;
/** Wix hard limit on how many IDs BulkDeleteFiles accepts in one call. */
const WIX_MAX_BULK_DELETE_IDS = 1000;

/** Safety cap on how many SearchFiles pages we scan when filtering by product name. */
const MAX_PRODUCT_SEARCH_PAGES = 5;
/** Page size used while scanning for a product name (Wix's hard max). */
const PRODUCT_SEARCH_PAGE_SIZE = 100;
/** Chunk size sent to Wix per bulkDeleteFiles call — keeps partial-success reporting granular. */
const DELETE_BATCH_SIZE = 25;
/** How many batches may be in flight at once. */
const DELETE_BATCH_CONCURRENCY = 3;

/** Timeout applied to every outbound Wix API call. */
const FETCH_TIMEOUT_MS = 15000;

const MEDIA_TYPE_FILTER_MAP: Record<MediaTypeFilter, WixMediaType[] | undefined> = {
  ALL: undefined,
  IMAGE: ["IMAGE"],
  VIDEO: ["VIDEO"],
  DOCUMENT: ["DOCUMENT"],
};

/** Best-effort extension → MIME type map (Wix's FileDescriptor has no mimeType field). */
const EXTENSION_MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  zip: "application/zip",
};

// ─────────────────────────────────────────────────────────────────────────────
// ERRORS
// ─────────────────────────────────────────────────────────────────────────────

export type WixMediaErrorCode =
  | "NOT_CONFIGURED"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "UPSTREAM_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN";

export class WixMediaError extends Error {
  readonly status: number;
  readonly code: WixMediaErrorCode;

  constructor(message: string, status: number, code: WixMediaErrorCode) {
    super(message);
    this.name = "WixMediaError";
    this.status = status;
    this.code = code;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH / HTTP HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Whether Wix credentials are present — used to render a dedicated "not configured" empty state. */
export function isWixMediaConfigured(): boolean {
  return Boolean(process.env.WIX_API_KEY && process.env.WIX_SITE_ID);
}

function getWixHeaders(): Record<string, string> {
  const apiKey = process.env.WIX_API_KEY;
  const siteId = process.env.WIX_SITE_ID;

  if (!apiKey || !siteId) {
    throw new WixMediaError(
      "Wix credentials (WIX_API_KEY, WIX_SITE_ID) are not configured.",
      503,
      "NOT_CONFIGURED"
    );
  }

  return {
    "Content-Type": "application/json",
    Authorization: apiKey,
    "wix-site-id": siteId,
  };
}

async function fetchWixApi(url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: controller.signal, cache: "no-store" });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new WixMediaError(
        `Wix Media API request timed out after ${FETCH_TIMEOUT_MS}ms.`,
        504,
        "TIMEOUT"
      );
    }
    throw new WixMediaError(
      "Network error while contacting Wix Media API.",
      502,
      "NETWORK_ERROR"
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // Never log response bodies verbatim — they may echo back request data. Only status is logged.
    console.error(`[WixMediaManager] ${init.method ?? "GET"} ${url} → HTTP ${res.status}`);

    if (res.status === 401) {
      throw new WixMediaError("Wix rejected the request: invalid API key.", 502, "UNAUTHORIZED");
    }
    if (res.status === 403) {
      throw new WixMediaError(
        "Wix rejected the request: insufficient Media Manager permissions.",
        502,
        "FORBIDDEN"
      );
    }
    throw new WixMediaError(`Wix Media API returned HTTP ${res.status}.`, 502, "UPSTREAM_ERROR");
  }

  try {
    return await res.json();
  } catch {
    return {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NORMALIZATION
// ─────────────────────────────────────────────────────────────────────────────

/** Raw shape of a single `FileDescriptor`, as returned by Wix's ListFiles/SearchFiles REST APIs. */
interface WixRawFileDescriptor {
  id: string;
  displayName?: string;
  url?: string;
  parentFolderId?: string;
  sizeInBytes?: string;
  mediaType?: string;
  thumbnailUrl?: string;
  createdDate?: string;
  updatedDate?: string;
}

/** Raw shape shared by ListFilesResponse and SearchFilesResponse (both use `files` + `nextCursor`). */
interface WixRawListResponse {
  files?: WixRawFileDescriptor[];
  nextCursor?: { cursors?: { next?: string }; total?: number };
}

function guessMimeType(displayName: string): string | undefined {
  const ext = displayName.split(".").pop()?.toLowerCase();
  return ext ? EXTENSION_MIME_MAP[ext] : undefined;
}

function normalizeFile(raw: WixRawFileDescriptor): MediaFileItem {
  const displayName: string = raw.displayName || raw.id || "unnamed";
  return {
    id: raw.id,
    displayName,
    fileName: displayName,
    mediaType: (raw.mediaType || "UNKNOWN") as WixMediaType,
    mimeType: guessMimeType(displayName),
    thumbnailUrl: raw.thumbnailUrl || undefined,
    url: raw.url || undefined,
    size: raw.sizeInBytes !== undefined ? Number(raw.sizeInBytes) : undefined,
    createdDate: raw.createdDate || undefined,
    updatedDate: raw.updatedDate || undefined,
    parentFolderId: raw.parentFolderId || undefined,
  };
}

function normalizeListResponse(json: unknown): MediaListResponse {
  const raw = (json || {}) as WixRawListResponse;
  const files = Array.isArray(raw.files) ? raw.files : [];
  const nextCursorToken: string = raw.nextCursor?.cursors?.next || "";

  return {
    items: files.map(normalizeFile),
    nextCursor: nextCursorToken ? nextCursorToken : null,
    hasNextPage: Boolean(nextCursorToken),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LIST / SEARCH FILES
// ─────────────────────────────────────────────────────────────────────────────

export interface ListMediaFilesOptions {
  pageSize?: number;
  cursor?: string;
  search?: string;
  mediaType?: MediaTypeFilter;
  parentFolderId?: string;
  sortOrder?: MediaSortOrder;
}

/** Clamp a requested page size into Wix's accepted [1, 100] range. */
export function clampPageSize(pageSize?: number): number {
  if (!pageSize || Number.isNaN(pageSize)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(pageSize), 1), WIX_MAX_PAGE_SIZE);
}

export function isValidCursor(cursor: string): boolean {
  return cursor.length > 0 && cursor.length <= WIX_MAX_CURSOR_LENGTH;
}

export function isValidFolderId(folderId: string): boolean {
  return (
    folderId.length > 0 &&
    folderId.length <= WIX_MAX_FOLDER_ID_LENGTH &&
    /^[A-Za-z0-9._-]+$/.test(folderId)
  );
}

export function isValidSearchTerm(search: string): boolean {
  return search.length > 0 && search.length <= WIX_MAX_SEARCH_LENGTH;
}

/** Same bound as a free-text search term — productName also feeds into Wix's `search` field. */
export function isValidProductNameTerm(productName: string): boolean {
  return isValidSearchTerm(productName);
}

/**
 * List (or search) files in the Media Manager.
 *
 * Wix exposes two different endpoints with non-overlapping capabilities:
 *   - ListFiles supports `parentFolderId` but has no free-text search.
 *   - SearchFiles supports free-text `search` but cannot be scoped to a folder
 *     (only to a root: MEDIA_ROOT / TRASH_ROOT / VISITOR_UPLOADS_ROOT).
 * When `search` is provided we use SearchFiles, and `parentFolderId` is
 * intentionally ignored (there's no equivalent parameter on that endpoint).
 */
export async function listMediaFiles(options: ListMediaFilesOptions): Promise<MediaListResponse> {
  const headers = getWixHeaders();
  const pageSize = clampPageSize(options.pageSize);
  const mediaTypes = MEDIA_TYPE_FILTER_MAP[options.mediaType ?? "ALL"];
  const sortOrder: MediaSortOrder = options.sortOrder ?? "DESC";

  if (options.search) {
    const body: {
      search: string;
      sort: { fieldName: string; order: MediaSortOrder };
      paging: { limit: number; cursor?: string };
      mediaTypes?: WixMediaType[];
    } = {
      search: options.search,
      sort: { fieldName: "updatedDate", order: sortOrder },
      paging: { limit: pageSize },
    };
    if (mediaTypes) body.mediaTypes = mediaTypes;
    if (options.cursor) body.paging.cursor = options.cursor;

    const json = await fetchWixApi(SEARCH_FILES_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    return normalizeListResponse(json);
  }

  const params = new URLSearchParams();
  params.set("paging.limit", String(pageSize));
  params.set("sort.fieldName", "updatedDate");
  params.set("sort.order", sortOrder);
  if (options.parentFolderId) params.set("parentFolderId", options.parentFolderId);
  if (options.cursor) params.set("paging.cursor", options.cursor);
  if (mediaTypes) {
    for (const type of mediaTypes) params.append("mediaTypes", type);
  }

  const json = await fetchWixApi(`${LIST_FILES_URL}?${params.toString()}`, {
    method: "GET",
    headers,
  });
  return normalizeListResponse(json);
}

// ─────────────────────────────────────────────────────────────────────────────
// FILTER BY PRODUCT NAME (same grouping rule as the Image Sync feature)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find every media file that belongs to a given product name, using the exact
 * same "base name" grouping rule as Image Sync (`parseImageName` +
 * `normalizeName` from wixCms.ts): a file's display name minus a trailing
 * gallery index ("-2", " (2)", "_2", ...) is normalized and compared to the
 * normalized product name. Equality must be exact — Image Sync itself only
 * ever matches products this way (fuzzy similarity there is used purely to
 * *suggest* a candidate, never to actually match/act on one), so the same
 * rule is used here since this filter feeds a delete action.
 *
 * Wix's Media Manager has no "group by parsed product name" endpoint, so we
 * pre-filter with Wix's own free-text `search` (matches the product name
 * against displayName) and then re-check every candidate ourselves. This is
 * bounded to a handful of pages — enough for any real product's images/docs,
 * without ever scanning the entire Media Manager.
 */
export async function findMediaFilesByProductName(
  productName: string,
  mediaType?: MediaTypeFilter
): Promise<MediaFileItem[]> {
  const headers = getWixHeaders();
  const targetKey = normalizeName(productName);
  const mediaTypes = MEDIA_TYPE_FILTER_MAP[mediaType ?? "ALL"];

  const matches: MediaFileItem[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_PRODUCT_SEARCH_PAGES; page++) {
    const body: {
      search: string;
      sort: { fieldName: string; order: MediaSortOrder };
      paging: { limit: number; cursor?: string };
      mediaTypes?: WixMediaType[];
    } = {
      search: productName,
      sort: { fieldName: "updatedDate", order: "DESC" },
      paging: { limit: PRODUCT_SEARCH_PAGE_SIZE },
    };
    if (mediaTypes) body.mediaTypes = mediaTypes;
    if (cursor) body.paging.cursor = cursor;

    const json = await fetchWixApi(SEARCH_FILES_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const page_ = normalizeListResponse(json);

    for (const item of page_.items) {
      const { base } = parseImageName(item.displayName);
      if (normalizeName(base) === targetKey) matches.push(item);
    }

    if (!page_.hasNextPage || !page_.nextCursor) break;
    cursor = page_.nextCursor;
  }

  return matches;
}

// ─────────────────────────────────────────────────────────────────────────────
// BULK DELETE (MOVE TO TRASH)
// ─────────────────────────────────────────────────────────────────────────────

/** Wix Media file IDs are opaque tokens like "w8ide0_abc123.pdf" — never a URL. */
export function isValidMediaFileId(id: unknown): id is string {
  if (typeof id !== "string") return false;
  if (id !== id.trim()) return false;
  if (id.length === 0 || id.length > WIX_MAX_FILE_ID_LENGTH) return false;
  if (/[:/\\]/.test(id)) return false; // reject URL-like or path-like values
  if (/[\x00-\x1f\x7f]/.test(id)) return false; // reject control characters
  // Wix file GUIDs look like "w8ide0_abc123.pdf" or, for images, "e95aca_abc123~mv2.jpg".
  return /^[A-Za-z0-9._~-]+$/.test(id);
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** Run async tasks with a bounded concurrency (never spawns unlimited requests in flight). */
async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const current = nextIndex++;
      if (current >= tasks.length) return;
      results[current] = await tasks[current]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

interface BatchResult {
  ids: string[];
  success: boolean;
  message?: string;
}

/**
 * Move the given files to the Media Manager's Trash (never permanent).
 * IDs are chunked into small batches so a failure only affects the files in
 * that batch — Wix's bulkDeleteFiles returns no per-file result, so a whole
 * batch is treated as one unit of success/failure.
 */
export async function bulkTrashMediaFiles(
  fileIds: string[]
): Promise<{ deleted: string[]; failed: DeleteMediaFailure[] }> {
  const headers = getWixHeaders();
  const batches = chunk(fileIds, DELETE_BATCH_SIZE);

  const tasks = batches.map((batchIds) => async (): Promise<BatchResult> => {
    try {
      await fetchWixApi(BULK_DELETE_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          fileIds: batchIds.slice(0, WIX_MAX_BULK_DELETE_IDS),
          permanent: false, // hard-coded: this feature never permanently deletes
        }),
      });
      return { ids: batchIds, success: true };
    } catch (err: unknown) {
      const message = err instanceof WixMediaError ? err.message : "Unexpected error.";
      return { ids: batchIds, success: false, message };
    }
  });

  const results = await runWithConcurrency(tasks, DELETE_BATCH_CONCURRENCY);

  const deleted: string[] = [];
  const failed: DeleteMediaFailure[] = [];

  for (const result of results) {
    if (result.success) {
      deleted.push(...result.ids);
    } else {
      for (const fileId of result.ids) {
        failed.push({ fileId, message: result.message || "Failed to move file to trash." });
      }
    }
  }

  return { deleted, failed };
}
