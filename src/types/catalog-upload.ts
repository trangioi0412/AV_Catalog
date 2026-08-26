/**
 * catalog-upload.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared type definitions for the Catalog PDF folder upload feature.
 *
 * Folder structure expected from client:
 *   Catalog/
 *   └── {brandName}/
 *       └── {categoryName}/
 *           └── {productName}.pdf
 */

// ─────────────────────────────────────────────────────────────────────────────
// INPUT / PARSING
// ─────────────────────────────────────────────────────────────────────────────

/** Metadata extracted from a single file's webkitRelativePath. */
export interface CatalogFileEntry {
  /** Original webkitRelativePath, e.g. "Catalog/Crestron/Bộ xử lý/DMPS3-4K.pdf" */
  relativePath: string;
  /** Original filename including extension, e.g. "DMPS3-4K.pdf" */
  fileName: string;
  /** Brand folder name, e.g. "Crestron" */
  brandName: string;
  /** Category folder name, e.g. "Bộ xử lý trình chiếu" */
  categoryName: string;
  /** Product name derived from filename without extension, e.g. "DMPS3-4K" */
  productName: string;
  /** File size in bytes */
  sizeBytes: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CMS MATCHING
// ─────────────────────────────────────────────────────────────────────────────

/** Result of attempting to match a catalog entry to a Wix CMS product item. */
export type CmsMatchStatus =
  | "matched"         // Exactly 1 CMS item found
  | "no_match"        // 0 CMS items found
  | "multiple_match"  // >1 CMS items found (ambiguous — skip)
  | "pending";        // Not yet checked

export interface CmsSuggestion {
  itemId: string;
  productName: string;
  brandName?: string;
  score: number;
}

/** A single row in the pre-upload preview table. */
export interface CatalogPreviewRow {
  /** Parsed file entry */
  entry: CatalogFileEntry;
  /** CMS lookup result */
  cmsMatchStatus: CmsMatchStatus;
  /** CMS item _id (only when status === "matched") */
  cmsItemId?: string;
  /** CMS product display name (only when status === "matched") */
  cmsProductName?: string;
  /** Top fuzzy match suggestions when status === "no_match" or "multiple_match" */
  cmsSuggestions?: CmsSuggestion[];
  /** Wix Media folder path (brand/category) — resolved server-side */
  wixFolderPath?: string;
  /** Human-readable warning or note */
  warning?: string;
  /** Whether user has selected this item for upload */
  selected: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// UPLOAD QUEUE
// ─────────────────────────────────────────────────────────────────────────────

/** Status of a single file in the upload queue. */
export type UploadItemStatus =
  | "queued"
  | "validating"
  | "uploading"
  | "updating_cms"
  | "success"
  | "skipped"
  | "failed";

/** An item in the live upload queue, extending a preview row with runtime state. */
export interface UploadQueueItem extends CatalogPreviewRow {
  /** Current upload status */
  status: UploadItemStatus;
  /** Upload progress 0–100 */
  progress: number;
  /** Wix file ID after successful upload */
  wixFileId?: string;
  /** Full Wix document URL after successful upload */
  wixUrl?: string;
  /** Error message if status === "failed" */
  error?: string;
  /** How many times this item has been retried */
  retryCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// API REQUEST / RESPONSE SHAPES
// ─────────────────────────────────────────────────────────────────────────────

/** Request body sent to POST /api/catalog-upload/validate */
export interface ValidateRequestBody {
  /** Metadata only — no binary content sent at this stage */
  files: Array<{
    relativePath: string;
    name: string;
    sizeBytes: number;
  }>;
}

/** Response from POST /api/catalog-upload/validate */
export interface ValidateResponse {
  ok: boolean;
  rows: CatalogPreviewRow[];
  skipped: Array<{
    relativePath: string;
    reason: string;
  }>;
  totalFiles: number;
  validCount: number;
  matchedCount: number;
  noMatchCount: number;
  multipleMatchCount: number;
  error?: string;
}

/** Response from POST /api/catalog-upload/upload (single file) */
export interface UploadFileResponse {
  ok: boolean;
  cmsItemId: string;
  wixFileId?: string;
  wixUrl?: string;
  updatedAt?: string;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORT
// ─────────────────────────────────────────────────────────────────────────────

/** Final report after a full upload batch completes. */
export interface CatalogUploadReport {
  total: number;
  success: number;
  skipped: number;
  failed: number;
  durationMs: number;
  /** Items where no CMS product was found */
  noMatchItems: CatalogPreviewRow[];
  /** Items where multiple CMS products matched (ambiguous) */
  multipleMatchItems: CatalogPreviewRow[];
  /** Upload queue items that ended in success */
  successItems: UploadQueueItem[];
  /** Upload queue items that ended in failure */
  failedItems: UploadQueueItem[];
  /** Items that were skipped (deselected or invalid) */
  skippedItems: UploadQueueItem[];
}
