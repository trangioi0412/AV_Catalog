"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Sentinel page size meaning "show everything on one page". */
export const PAGER_SHOW_ALL = -1;

/** Standard page-size choices for the AI Fix / CMS Sync review dashboards. */
export const PAGER_PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

/**
 * Compact pagination bar shared by AiFixDashboard and CmsSyncDashboard — both
 * render a review list that can run into the hundreds of products, which
 * previously relied on a Radix ScrollArea given only a `max-h-*` (no base
 * height), so the viewport never got a definite height to scroll within and
 * the list was effectively clipped with no way to reach the rest. Paginating
 * the list (in addition to the fixed-height scroll container each dashboard
 * now wraps its page in) is the real fix for "can't see all products".
 */
export function Pager({
  page,
  pageSize,
  total,
  unitLabel,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  unitLabel: string;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  const isShowingAll = pageSize === PAGER_SHOW_ALL;
  const totalPages = isShowingAll ? 1 : Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-2 px-1 pt-1">
      <p className="text-xs text-muted-foreground order-2 sm:order-1">
        {isShowingAll ? (
          <>Hiển thị tất cả <strong>{total}</strong> {unitLabel}</>
        ) : (
          <>
            Hiển thị <strong>{Math.min((page - 1) * pageSize + 1, total)}–{Math.min(page * pageSize, total)}</strong> / <strong>{total}</strong> {unitLabel}
          </>
        )}
      </p>
      <div className="flex items-center gap-2 order-1 sm:order-2">
        <Select value={String(pageSize)} onValueChange={(val) => onPageSizeChange(val === "all" ? PAGER_SHOW_ALL : Number(val))}>
          <SelectTrigger size="sm" className="h-7 w-[86px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGER_PAGE_SIZE_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>{n} / trang</SelectItem>
            ))}
            <SelectItem value="all">Tất cả</SelectItem>
          </SelectContent>
        </Select>
        {!isShowingAll && totalPages > 1 && (
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={page <= 1}
              onClick={() => onPageChange(Math.max(1, page - 1))}
            >
              Trước
            </Button>
            <span className="text-xs text-muted-foreground px-1">{page}/{totalPages}</span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={page >= totalPages}
              onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            >
              Sau
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
