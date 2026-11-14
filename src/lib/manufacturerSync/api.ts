/**
 * Thin fetch wrapper around the external DataCrawler FastAPI sync engine
 * (see D:\DataCrawler\backend). Every Next.js API route under
 * /api/manufacturer-sync goes through this module instead of hard-coding
 * the service URL, so MANUFACTURER_SYNC_API_URL is the only place it's
 * configured. This module (and everything under manufacturer-sync/) is
 * intentionally kept separate from the rest of AV_Catalog's lib/ so the
 * DataCrawler FE/BE can keep evolving independently of this app.
 */

const MANUFACTURER_SYNC_API_URL =
  process.env.MANUFACTURER_SYNC_API_URL ?? "http://localhost:8000";
// Must equal the sync service's API_KEY; sent as X-API-Key. Server-only.
const MANUFACTURER_SYNC_API_KEY = process.env.MANUFACTURER_SYNC_API_KEY;

export class ManufacturerSyncApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown) {
    super(`Manufacturer sync API request failed with status ${status}`);
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  let text: string;
  try {
    response = await fetch(`${MANUFACTURER_SYNC_API_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(MANUFACTURER_SYNC_API_KEY ? { "X-API-Key": MANUFACTURER_SYNC_API_KEY } : {}),
        ...init?.headers,
      },
      cache: "no-store",
    });
    text = await response.text();
  } catch (error) {
    // Routes turn this into a bare "unreachable" 502, so log the real cause
    // (connection refused, timeout, ...) here.
    console.error(`Manufacturer sync API request failed: ${MANUFACTURER_SYNC_API_URL}${path}`, error);
    throw error;
  }

  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (error) {
    console.error(`Manufacturer sync API returned non-JSON (${response.status}) for ${path}:`, text.slice(0, 500));
    // Error statuses (e.g. a proxy's plain-text/HTML 401) still go through the
    // status mapping below; only a non-JSON success body is a hard failure.
    if (response.ok) throw error;
    body = { detail: text.slice(0, 500) };
  }

  if (response.status === 401 || response.status === 403) {
    // The sync service rejected our X-API-Key -- a server misconfiguration,
    // not the admin's session. Routes pass error.status straight through, so
    // a 401 here would look like AV_Catalog's own "not logged in".
    console.error("Manufacturer sync API rejected MANUFACTURER_SYNC_API_KEY", response.status, body);
    throw new ManufacturerSyncApiError(502, {
      detail: "Manufacturer sync API rejected this server's API key (check MANUFACTURER_SYNC_API_KEY).",
    });
  }

  if (!response.ok) {
    throw new ManufacturerSyncApiError(response.status, body);
  }

  return body as T;
}

export interface Manufacturer {
  key: string;
  display_name: string;
  base_url: string;
}

export interface SyncAcceptedResponse {
  success: boolean;
  job_id: string;
  status: string;
  manufacturer: string;
}

export interface SyncStatus {
  job_id: string;
  manufacturer: string;
  mode: string;
  status: "queued" | "running" | "completed" | "completed_with_warnings" | "failed";
  total: number;
  processed: number;
  success: number;
  failed: number;
  skipped: number;
  progress: number;
  error: string | null;
  warnings: string[];
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export function listManufacturers(): Promise<Manufacturer[]> {
  return request<Manufacturer[]>("/api/manufacturers");
}

/** `categories`: category paths/URLs on the brand's site; empty = every product. */
export function startSync(manufacturer: string, mode = "full", categories: string[] = []): Promise<SyncAcceptedResponse> {
  return request<SyncAcceptedResponse>("/api/sync/manufacturer", {
    method: "POST",
    body: JSON.stringify({ manufacturer, mode, categories }),
  });
}

export interface SyncAllAcceptedResponse {
  success: boolean;
  jobs: SyncAcceptedResponse[];
  skipped: string[];
}

export function startSyncAll(): Promise<SyncAllAcceptedResponse> {
  return request<SyncAllAcceptedResponse>("/api/sync/all", { method: "POST" });
}

export function getSyncStatus(jobId: string): Promise<SyncStatus> {
  return request<SyncStatus>(`/api/sync/status/${jobId}`);
}

// Mirrors one row of the backend's New_brand Google Sheet -- `id` is a slug
// of the brand name (Sheets rows have no database auto-increment id), see
// av-crawler-api/services/admin_sheets.py::NewBrandStore. `status` is one
// of NewBrandStatus's Vietnamese values there (e.g. "Chờ duyệt", "Duyệt",
// "Đang cào dữ liệu", "Đã cào xong", "Lỗi cào dữ liệu", "Từ chối").
export interface ManufacturerRequest {
  id: string;
  name: string;
  website_url: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function listManufacturerRequests(): Promise<ManufacturerRequest[]> {
  return request<ManufacturerRequest[]>("/api/manufacturer-requests");
}

export function createManufacturerRequest(name: string, websiteUrl: string): Promise<ManufacturerRequest> {
  return request<ManufacturerRequest>("/api/manufacturer-requests", {
    method: "POST",
    body: JSON.stringify({ name, website_url: websiteUrl || null }),
  });
}

export interface AiPreviewProduct {
  source_url: string;
  ok: boolean;
  name: string | null;
  model: string | null;
  category: string | null;
  description: string | null;
  features: string[];
  specifications: Record<string, string>;
  image_urls: string[];
  error: string | null;
}

export interface AiPreviewResponse {
  manufacturer_key: string;
  checked_urls: number;
  products: AiPreviewProduct[];
}

export interface AiApproveResponse {
  success: boolean;
  manufacturer_key: string;
  job_id: string;
  status: string;
}

// AI preview/approve calls run a local LLM against real pages (~1-2 min per
// page observed on the DataCrawler backend) -- much longer than the rest of
// the API, so callers need a generous timeout instead of relying on fetch
// defaults.
const AI_REQUEST_TIMEOUT_MS = 10 * 60 * 1000;

export function previewManufacturerRequest(requestId: string): Promise<AiPreviewResponse> {
  return request<AiPreviewResponse>(`/api/manufacturer-requests/${requestId}/preview`, {
    method: "POST",
    signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
  });
}

export function approveManufacturerRequest(requestId: string): Promise<AiApproveResponse> {
  return request<AiApproveResponse>(`/api/manufacturer-requests/${requestId}/approve`, {
    method: "POST",
    signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
  });
}

// See av-crawler-api/api/routes/images.py -- downloads every URL in a
// manufacturer's sheet "image" column into Data/<manufacturer>/ on the
// backend. Runs synchronously (no job/polling like sync), so a brand with
// a lot of product images can take a while -- give it a generous timeout
// rather than relying on fetch defaults.
const IMAGE_DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

export interface ImageDownloadResult {
  success: boolean;
  manufacturer: string;
  products_with_images: number;
  downloaded: number;
  skipped_existing: number;
  skipped_no_title: number;
  failed: string[];
  /** "<Title>: <n> ảnh" for products left with fewer than 2 images. */
  under_min_images?: string[];
}

export function downloadManufacturerImages(manufacturer: string): Promise<ImageDownloadResult> {
  return request<ImageDownloadResult>(`/api/images/download?manufacturer=${encodeURIComponent(manufacturer)}`, {
    method: "POST",
    signal: AbortSignal.timeout(IMAGE_DOWNLOAD_TIMEOUT_MS),
  });
}
