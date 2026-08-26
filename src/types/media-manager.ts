/**
 * media-manager.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared type definitions for the Wix Media Manager admin page
 * (list / select / bulk-trash files in Wix Site Media).
 */

// ─────────────────────────────────────────────────────────────────────────────
// WIX ENUMS (verbatim from Wix Media Manager REST API)
// ─────────────────────────────────────────────────────────────────────────────

/** Wix `MediaType` enum, as returned by the Media Manager API. */
export type WixMediaType =
  | "UNKNOWN"
  | "IMAGE"
  | "VIDEO"
  | "AUDIO"
  | "DOCUMENT"
  | "VECTOR"
  | "ARCHIVE"
  | "MODEL3D"
  | "OTHER";

/** Filter accepted by our API — a narrowed subset of WixMediaType relevant to this UI. */
export type MediaTypeFilter = "ALL" | "IMAGE" | "VIDEO" | "DOCUMENT";

export type MediaSortOrder = "ASC" | "DESC";

// ─────────────────────────────────────────────────────────────────────────────
// NORMALIZED FILE SHAPE (frontend-facing — decoupled from Wix's raw response)
// ─────────────────────────────────────────────────────────────────────────────

export interface MediaFileItem {
  id: string;
  displayName: string;
  fileName: string;
  mediaType: WixMediaType;
  /** Best-effort guess derived from the file extension — Wix doesn't return a MIME type directly. */
  mimeType?: string;
  thumbnailUrl?: string;
  url?: string;
  /** Size in bytes. */
  size?: number;
  createdDate?: string;
  updatedDate?: string;
  parentFolderId?: string;
}

export interface MediaListResponse {
  items: MediaFileItem[];
  nextCursor: string | null;
  hasNextPage: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE (MOVE TO TRASH)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Max number of fileIds accepted by a single DELETE /api/admin/wix-media call.
 * Wix's own bulkDeleteFiles hard limit is 1000 ids/call (and our server already
 * re-batches into groups of 25 before calling Wix), so this is just a sane
 * per-HTTP-request ceiling — not a limit on how many files a user can delete in
 * one action. The client hook auto-splits larger selections into multiple
 * sequential calls of this size and merges the results.
 */
export const MAX_FILE_IDS_PER_DELETE_REQUEST = 500;

export interface DeleteMediaRequest {
  fileIds: string[];
}

export interface DeleteMediaFailure {
  fileId: string;
  message: string;
}

export interface DeleteMediaResponse {
  requested: number;
  deleted: string[];
  failed: DeleteMediaFailure[];
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERIC API ERROR SHAPE
// ─────────────────────────────────────────────────────────────────────────────

export interface MediaApiErrorResponse {
  error: string;
  code?: string;
}
