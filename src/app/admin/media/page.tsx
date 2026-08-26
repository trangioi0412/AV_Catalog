"use client";

import React, { useState } from "react";
import { toast } from "sonner";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { MediaFileCard } from "@/components/data/MediaFileCard";
import { useWixMediaManager } from "@/hooks/useWixMediaManager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Search,
  RefreshCw,
  Trash2,
  Loader2,
  Inbox,
  AlertTriangle,
  ServerCrash,
  ShieldAlert,
  LogIn,
  Tag,
  X,
} from "lucide-react";
import type { MediaFileItem } from "@/types/media-manager";

export default function WixMediaManagerPage() {
  const {
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
    selectedCount,
    toggleSelect,
    selectAllOnPage,
    clearSelection,
    isAllOnPageSelected,
    isSomeOnPageSelected,
    isDeleting,
    deleteProgress,
    deleteFiles,
  } = useWixMediaManager();

  const isProductFilterActive = Boolean(productName.trim());

  const [confirmTargets, setConfirmTargets] = useState<MediaFileItem[] | null>(null);
  const [confirmProductName, setConfirmProductName] = useState<string | null>(null);

  const openConfirmForSelection = () => {
    const targets = items.filter((item) => selectedIds.has(item.id));
    if (targets.length > 0) {
      setConfirmProductName(null);
      setConfirmTargets(targets);
    }
  };

  const openConfirmForSingle = (file: MediaFileItem) => {
    setConfirmProductName(null);
    setConfirmTargets([file]);
  };

  const openConfirmForProduct = () => {
    if (items.length === 0) return;
    setConfirmProductName(productName.trim());
    setConfirmTargets(items);
  };

  const handleConfirmDelete = async () => {
    if (!confirmTargets) return;
    const ids = confirmTargets.map((f) => f.id);
    const outcome = await deleteFiles(ids);
    setConfirmTargets(null);
    setConfirmProductName(null);

    if (!outcome.ok) {
      toast.error(outcome.error.message);
      return;
    }

    const { deleted, failed } = outcome.data;
    if (failed.length === 0) {
      toast.success(`Đã chuyển ${deleted.length} file vào thùng rác.`);
    } else if (deleted.length > 0) {
      toast.warning(`Đã xóa ${deleted.length}/${deleted.length + failed.length} file. Có ${failed.length} file không thể xóa.`);
    } else {
      toast.error(`Không thể xóa file nào. ${failed[0]?.message ?? ""}`);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Wix Media Manager</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Quản lý hình ảnh, PDF và tài liệu trong Wix Media Manager. File bị xóa sẽ được chuyển vào Trash, không xóa vĩnh viễn.
          </p>
        </div>

        {/* ── Toolbar ─────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 ring-1 ring-foreground/10 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative w-full sm:max-w-xs">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm theo tên file..."
                disabled={isProductFilterActive}
                className="pl-8"
              />
            </div>

            <div className="relative w-full sm:max-w-xs">
              <Tag className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="Lọc theo tên sản phẩm (vd: Neat Board Pro)..."
                className="pl-8 pr-7"
              />
              {isProductFilterActive && (
                <button
                  type="button"
                  onClick={() => setProductName("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="Bỏ lọc theo sản phẩm"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <Select value={mediaType} onValueChange={(v) => setMediaType(v as typeof mediaType)}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Tất cả</SelectItem>
                <SelectItem value="IMAGE">Hình ảnh</SelectItem>
                <SelectItem value="VIDEO">Video</SelectItem>
                <SelectItem value="DOCUMENT">PDF / Tài liệu</SelectItem>
              </SelectContent>
            </Select>

            <Button variant="outline" size="default" onClick={refresh} disabled={isRefreshing || isLoading}>
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
              Tải lại
            </Button>
          </div>

          <div className="flex items-center gap-2">
            {selectedCount > 0 && (
              <Badge variant="outline" className="h-8 px-3 text-sm">
                Đã chọn {selectedCount}
              </Badge>
            )}
            <Button
              variant="destructive"
              onClick={openConfirmForSelection}
              disabled={selectedCount === 0 || isDeleting}
            >
              {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Xóa file đã chọn
            </Button>
          </div>
        </div>

        {/* ── Product filter banner ───────────────────────────────────── */}
        {isProductFilterActive && !isLoading && !error && (
          <div className="flex flex-col gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm">
              <Tag className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span>
                Đang lọc theo sản phẩm <span className="font-medium text-foreground">&ldquo;{productName.trim()}&rdquo;</span> —{" "}
                {items.length} file khớp
              </span>
            </div>
            {items.length > 0 && (
              <Button variant="destructive" size="sm" onClick={openConfirmForProduct} disabled={isDeleting}>
                <Trash2 className="w-3.5 h-3.5" />
                Xóa tất cả file của sản phẩm này
              </Button>
            )}
          </div>
        )}

        {/* ── Select-all row ──────────────────────────────────────────── */}
        {items.length > 0 && (
          <div className="flex items-center gap-2.5 px-1">
            <Checkbox
              checked={isAllOnPageSelected ? true : isSomeOnPageSelected ? "indeterminate" : false}
              onCheckedChange={selectAllOnPage}
              aria-label="Chọn tất cả"
            />
            <span className="text-sm text-muted-foreground">
              {isProductFilterActive
                ? `Chọn tất cả file của sản phẩm này (${items.length} file)`
                : `Chọn tất cả trong trang hiện tại (${items.length} file)`}
            </span>
            {selectedCount > 0 && (
              <Button variant="ghost" size="sm" onClick={clearSelection} className="ml-2">
                Bỏ chọn tất cả
              </Button>
            )}
          </div>
        )}

        {/* ── Content states ──────────────────────────────────────────── */}
        {isLoading ? (
          <LoadingGrid />
        ) : error ? (
          <ErrorState errorType={error.type} message={error.message} onRetry={refresh} />
        ) : items.length === 0 ? (
          <EmptyState hasSearch={Boolean(search.trim())} productName={isProductFilterActive ? productName.trim() : undefined} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
              {items.map((file) => (
                <MediaFileCard
                  key={file.id}
                  file={file}
                  selected={selectedIds.has(file.id)}
                  onToggleSelect={toggleSelect}
                  onDeleteSingle={openConfirmForSingle}
                />
              ))}
            </div>

            {hasNextPage && (
              <div className="flex justify-center pt-2">
                <Button variant="outline" onClick={loadMore} disabled={isLoadingMore}>
                  {isLoadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Tải thêm
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Confirm delete dialog ───────────────────────────────────── */}
      <AlertDialog open={confirmTargets !== null} onOpenChange={(open) => !open && !isDeleting && setConfirmTargets(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmProductName
                ? `Xóa tất cả file của sản phẩm "${confirmProductName}"?`
                : "Chuyển file vào thùng rác?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-left">
                {confirmProductName ? (
                  <p>
                    Bạn đang xóa toàn bộ{" "}
                    <span className="font-medium text-foreground">{confirmTargets?.length ?? 0} file</span> khớp với
                    tên sản phẩm <span className="font-medium text-foreground">&ldquo;{confirmProductName}&rdquo;</span>{" "}
                    (ảnh chính, ảnh phụ, tài liệu...). Các file này sẽ được chuyển vào Trash của Wix Media Manager.
                  </p>
                ) : confirmTargets && confirmTargets.length === 1 ? (
                  <p>
                    Bạn đang chọn file <span className="font-medium text-foreground">&ldquo;{confirmTargets[0].displayName}&rdquo;</span>.
                    File này sẽ được chuyển vào Trash của Wix Media Manager và có thể ảnh hưởng đến sản phẩm hoặc trang đang sử dụng nó.
                  </p>
                ) : (
                  <p>
                    Bạn đang chọn <span className="font-medium text-foreground">{confirmTargets?.length ?? 0} file</span>.
                    Các file này sẽ được chuyển vào Trash của Wix Media Manager và có thể ảnh hưởng đến sản phẩm hoặc trang đang sử dụng chúng.
                  </p>
                )}
                {confirmTargets && confirmTargets.length > 0 && !(confirmTargets.length === 1 && !confirmProductName) && (
                  <ul className="list-disc pl-4 text-xs">
                    {confirmTargets.slice(0, 5).map((f) => (
                      <li key={f.id} className="truncate">{f.displayName}</li>
                    ))}
                    {confirmTargets.length > 5 && <li>... và {confirmTargets.length - 5} file khác</li>}
                  </ul>
                )}
                <p>Bạn có thể khôi phục file từ Trash nếu cần.</p>
                {isDeleting && deleteProgress && (
                  <p className="text-xs text-muted-foreground">
                    Đang xóa... {deleteProgress.done}/{deleteProgress.total} file
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Hủy</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isDeleting}
              onClick={(e) => {
                e.preventDefault();
                handleConfirmDelete();
              }}
            >
              {isDeleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Chuyển vào thùng rác
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}

function LoadingGrid() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="aspect-square animate-pulse rounded-xl bg-muted/60" />
      ))}
    </div>
  );
}

function EmptyState({ hasSearch, productName }: { hasSearch: boolean; productName?: string }) {
  const title = productName
    ? `Không tìm thấy file nào của sản phẩm "${productName}"`
    : hasSearch
    ? "Không tìm thấy file phù hợp"
    : "Chưa có file nào";
  const description = productName
    ? "Kiểm tra lại tên sản phẩm — file phải có tên bắt đầu bằng tên sản phẩm (vd: \"Tên Sản Phẩm-2.jpg\")."
    : hasSearch
    ? "Thử từ khóa khác hoặc đổi bộ lọc."
    : "Media Manager hiện chưa có file nào ở đây.";

  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-16 text-center">
      <Inbox className="h-8 w-8 text-muted-foreground/50" />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-md text-xs text-muted-foreground">{description}</p>
    </div>
  );
}

function ErrorState({
  errorType,
  message,
  onRetry,
}: {
  errorType: string;
  message: string;
  onRetry: () => void;
}) {
  const config: Record<string, { icon: React.ElementType; title: string }> = {
    unauthorized: { icon: LogIn, title: "Phiên đăng nhập đã hết hạn" },
    not_configured: { icon: ServerCrash, title: "Wix chưa được cấu hình" },
    forbidden: { icon: ShieldAlert, title: "Không đủ quyền Wix" },
    timeout: { icon: AlertTriangle, title: "Wix API không phản hồi kịp thời" },
    network: { icon: AlertTriangle, title: "Lỗi kết nối mạng" },
    unknown: { icon: AlertTriangle, title: "Đã xảy ra lỗi" },
  };
  const { icon: Icon, title } = config[errorType] || config.unknown;

  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-16 text-center">
      <Icon className="h-8 w-8 text-destructive/70" />
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 max-w-md text-xs text-muted-foreground">{message}</p>
      </div>
      {errorType === "unauthorized" ? (
        <Button asChild size="sm" className="mt-1">
          <a href="/login">Đăng nhập lại</a>
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-1">
          <RefreshCw className="w-3.5 h-3.5" />
          Thử lại
        </Button>
      )}
    </div>
  );
}
