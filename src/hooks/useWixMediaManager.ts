"use client";

/**
 * useWixMediaManager.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Client-side data/selection hook for the Wix Media Manager admin page.
 * Talks only to /api/admin/wix-media — never touches Wix credentials directly.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DeleteMediaFailure,
  DeleteMediaResponse,
  MediaApiErrorResponse,
  MediaFileItem,
  MediaListResponse,
  MediaTypeFilter,
} from "@/types/media-manager";
import { MAX_FILE_IDS_PER_DELETE_REQUEST } from "@/types/media-manager";

const PAGE_SIZE = 40;
const SEARCH_DEBOUNCE_MS = 400;

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export type MediaErrorType =
  | "unauthorized"
  | "not_configured"
  | "forbidden"
  | "timeout"
  | "network"
  | "unknown";

export interface MediaError {
  type: MediaErrorType;
  message: string;
}

function classifyError(status: number, body: MediaApiErrorResponse | null): MediaError {
  if (status === 401) {
    return { type: "unauthorized", message: body?.error || "Phiên đăng nhập admin đã hết hạn." };
  }
  if (body?.code === "NOT_CONFIGURED") {
    return { type: "not_configured", message: body.error };
  }
  if (body?.code === "FORBIDDEN" || body?.code === "UNAUTHORIZED") {
    return { type: "forbidden", message: body.error };
  }
  if (body?.code === "TIMEOUT") {
    return { type: "timeout", message: body.error };
  }
  return { type: "unknown", message: body?.error || `Yêu cầu thất bại (HTTP ${status}).` };
}

async function parseJsonSafe(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export interface UseWixMediaManagerResult {
  items: MediaFileItem[];
  isLoading: boolean;
  isLoadingMore: boolean;
  isRefreshing: boolean;
  error: MediaError | null;
  hasNextPage: boolean;
  loadMore: () => void;
  refresh: () => void;

  search: string;
  setSearch: (value: string) => void;
  productName: string;
  setProductName: (value: string) => void;
  mediaType: MediaTypeFilter;
  setMediaType: (value: MediaTypeFilter) => void;

  selectedIds: Set<string>;
  selectedCount: number;
  toggleSelect: (id: string) => void;
  selectAllOnPage: () => void;
  clearSelection: () => void;
  isAllOnPageSelected: boolean;
  isSomeOnPageSelected: boolean;

  isDeleting: boolean;
  /** Progress across chunked requests for a large delete (null when not deleting). */
  deleteProgress: { done: number; total: number } | null;
  deleteFiles: (ids: string[]) => Promise<DeleteFilesOutcome>;
}

export type DeleteFilesOutcome =
  | { ok: true; data: DeleteMediaResponse }
  | { ok: false; error: MediaError };

export function useWixMediaManager(): UseWixMediaManagerResult {
  const [items, setItems] = useState<MediaFileItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<MediaError | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);

  const [search, setSearchState] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [productName, setProductNameState] = useState("");
  const [debouncedProductName, setDebouncedProductName] = useState("");
  const [mediaType, setMediaType] = useState<MediaTypeFilter>("ALL");

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState<{ done: number; total: number } | null>(null);

  // Guards against a stale response overwriting a newer one (e.g. fast filter changes).
  const requestIdRef = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedProductName(productName.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [productName]);

  const buildUrl = useCallback(
    (cursorParam?: string | null) => {
      const params = new URLSearchParams();
      params.set("pageSize", String(PAGE_SIZE));
      if (cursorParam) params.set("cursor", cursorParam);
      // Filtering by product name takes priority over free-text search (see API route).
      if (debouncedProductName) {
        params.set("productName", debouncedProductName);
      } else if (debouncedSearch) {
        params.set("search", debouncedSearch);
      }
      if (mediaType !== "ALL") params.set("mediaType", mediaType);
      return `/api/admin/wix-media?${params.toString()}`;
    },
    [debouncedSearch, debouncedProductName, mediaType]
  );

  const fetchPage = useCallback(
    async (mode: "initial" | "more" | "refresh", cursorParam: string | null) => {
      const requestId = ++requestIdRef.current;

      if (mode === "initial") setIsLoading(true);
      if (mode === "more") setIsLoadingMore(true);
      if (mode === "refresh") setIsRefreshing(true);
      setError(null);

      try {
        const res = await fetch(buildUrl(cursorParam));
        const body = await parseJsonSafe(res);

        if (requestId !== requestIdRef.current) return; // superseded by a newer request

        if (!res.ok) {
          setError(classifyError(res.status, body as MediaApiErrorResponse));
          if (mode !== "more") setItems([]);
          setHasNextPage(false);
          return;
        }

        const list = body as MediaListResponse;
        const nextItems: MediaFileItem[] = list.items || [];
        setItems((prev) => (mode === "more" ? [...prev, ...nextItems] : nextItems));
        if (mode === "initial") setSelectedIds(new Set());
        setCursor(list.nextCursor ?? null);
        setHasNextPage(Boolean(list.hasNextPage));
      } catch {
        if (requestId !== requestIdRef.current) return;
        setError({ type: "network", message: "Không thể kết nối tới máy chủ." });
        if (mode !== "more") setItems([]);
        setHasNextPage(false);
      } finally {
        if (requestId !== requestIdRef.current) return;
        setIsLoading(false);
        setIsLoadingMore(false);
        setIsRefreshing(false);
      }
    },
    [buildUrl]
  );

  // Reload from page 1 whenever filters change (fetchPage also clears selection for mode "initial").
  useEffect(() => {
    void Promise.resolve().then(() => fetchPage("initial", null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, debouncedProductName, mediaType]);

  const loadMore = useCallback(() => {
    if (isLoadingMore || !hasNextPage) return;
    fetchPage("more", cursor);
  }, [cursor, hasNextPage, isLoadingMore, fetchPage]);

  const refresh = useCallback(() => {
    fetchPage("refresh", null);
  }, [fetchPage]);

  const setSearch = useCallback((value: string) => setSearchState(value), []);
  const setProductName = useCallback((value: string) => setProductNameState(value), []);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllOnPage = useCallback(() => {
    setSelectedIds((prev) => {
      const allSelected = items.length > 0 && items.every((item) => prev.has(item.id));
      if (allSelected) return new Set();
      return new Set(items.map((item) => item.id));
    });
  }, [items]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const isAllOnPageSelected = items.length > 0 && items.every((item) => selectedIds.has(item.id));
  const isSomeOnPageSelected = !isAllOnPageSelected && items.some((item) => selectedIds.has(item.id));

  /** Delete a single chunk (already within MAX_FILE_IDS_PER_DELETE_REQUEST) via one API call. */
  const deleteChunk = useCallback(async (ids: string[]): Promise<DeleteFilesOutcome> => {
    try {
      const res = await fetch("/api/admin/wix-media", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds: ids }),
      });
      const body = await parseJsonSafe(res);

      if (res.status === 400 || res.status === 401 || res.status === 503 || res.status === 504) {
        return { ok: false, error: classifyError(res.status, body as MediaApiErrorResponse) };
      }

      return { ok: true, data: body as DeleteMediaResponse };
    } catch {
      return { ok: false, error: { type: "network", message: "Không thể kết nối tới máy chủ." } };
    }
  }, []);

  /**
   * Delete any number of files, regardless of size. A selection larger than
   * MAX_FILE_IDS_PER_DELETE_REQUEST is split into sequential chunks — each is
   * its own API call (which itself batches into Wix in groups of 25) — and
   * the results are merged into a single DeleteMediaResponse. This is what
   * lets, e.g., a 700-file product selection be deleted in one action instead
   * of erroring out against a single request's cap.
   */
  const deleteFiles = useCallback(
    async (ids: string[]): Promise<DeleteFilesOutcome> => {
      if (ids.length === 0) {
        return { ok: true, data: { requested: 0, deleted: [], failed: [] } };
      }

      setIsDeleting(true);
      setDeleteProgress({ done: 0, total: ids.length });

      const aggregatedDeleted: string[] = [];
      const aggregatedFailed: DeleteMediaFailure[] = [];
      let fatalError: MediaError | null = null;
      let processed = 0;

      for (const chunkIds of chunkArray(ids, MAX_FILE_IDS_PER_DELETE_REQUEST)) {
        const outcome = await deleteChunk(chunkIds);

        if (!outcome.ok) {
          for (const fileId of chunkIds) {
            aggregatedFailed.push({ fileId, message: outcome.error.message });
          }
          // Auth/config errors won't resolve by trying more chunks — stop early.
          if (outcome.error.type !== "unknown" && outcome.error.type !== "timeout" && outcome.error.type !== "network") {
            fatalError = outcome.error;
            break;
          }
        } else {
          aggregatedDeleted.push(...outcome.data.deleted);
          aggregatedFailed.push(...outcome.data.failed);

          if (outcome.data.deleted.length > 0) {
            const deletedSet = new Set(outcome.data.deleted);
            setItems((prev) => prev.filter((item) => !deletedSet.has(item.id)));
            setSelectedIds((prev) => {
              const next = new Set(prev);
              for (const id of outcome.data.deleted) next.delete(id);
              return next;
            });
          }
        }

        processed += chunkIds.length;
        setDeleteProgress({ done: processed, total: ids.length });
      }

      setIsDeleting(false);
      setDeleteProgress(null);

      if (fatalError && aggregatedDeleted.length === 0) {
        setError(fatalError);
        return { ok: false, error: fatalError };
      }

      return {
        ok: true,
        data: { requested: ids.length, deleted: aggregatedDeleted, failed: aggregatedFailed },
      };
    },
    [deleteChunk]
  );

  return {
    items,
    isLoading,
    isLoadingMore,
    isRefreshing,
    error,
    hasNextPage,
    loadMore,
    refresh,

    search,
    setSearch,
    productName,
    setProductName,
    mediaType,
    setMediaType,

    selectedIds,
    selectedCount: selectedIds.size,
    toggleSelect,
    selectAllOnPage,
    clearSelection,
    isAllOnPageSelected,
    isSomeOnPageSelected,

    isDeleting,
    deleteProgress,
    deleteFiles,
  };
}
