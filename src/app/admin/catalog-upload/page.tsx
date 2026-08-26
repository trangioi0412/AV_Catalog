"use client";

/**
 * /admin/catalog-upload
 * ─────────────────────────────────────────────────────────────────────────────
 * Admin page for uploading a structured catalog folder of PDF files to Wix.
 * Styled consistently with the Dashboard theme (bg-card, text-foreground,
 * text-muted-foreground, border-border/60).
 */

import React, { useCallback, useRef, useState, useMemo } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  FileText,
  FolderOpen,
  Upload,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Play,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  BarChart3,
  Info,
  Download,
  RefreshCw,
  Folder,
  FileWarning,
  Search,
  CheckSquare,
  Square,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type {
  CatalogPreviewRow,
  UploadQueueItem,
  UploadItemStatus,
  CatalogUploadReport,
  CmsSuggestion,
} from "@/types/catalog-upload";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type Phase = "select" | "validating" | "preview" | "uploading" | "done";

interface SkippedEntry {
  relativePath: string;
  reason: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s % 60}s`;
}

function getStatusIcon(status: UploadItemStatus) {
  switch (status) {
    case "success":
      return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
    case "failed":
      return <XCircle className="w-4 h-4 text-rose-500" />;
    case "skipped":
      return <AlertTriangle className="w-4 h-4 text-amber-500" />;
    case "queued":
      return <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30" />;
    case "uploading":
    case "validating":
    case "updating_cms":
      return <Loader2 className="w-4 h-4 text-primary animate-spin" />;
    default:
      return null;
  }
}

function getStatusLabel(status: UploadItemStatus): string {
  const labels: Record<UploadItemStatus, string> = {
    queued: "Chờ",
    validating: "Xác thực",
    uploading: "Đang upload",
    updating_cms: "Cập nhật CMS",
    success: "Thành công",
    skipped: "Bỏ qua",
    failed: "Thất bại",
  };
  return labels[status] ?? status;
}

function getCmsMatchBadge(status: CatalogPreviewRow["cmsMatchStatus"]) {
  switch (status) {
    case "matched":
      return (
        <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-[10px] font-semibold">
          ✓ Khớp CMS
        </Badge>
      );
    case "no_match":
      return (
        <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-[10px] font-semibold">
          ⚠ Không tìm thấy
        </Badge>
      );
    case "multiple_match":
      return (
        <Badge className="bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 text-[10px] font-semibold">
          ✕ Trùng nhiều
        </Badge>
      );
    case "pending":
      return (
        <Badge className="bg-muted text-muted-foreground border border-border text-[10px]">
          Đang kiểm tra
        </Badge>
      );
  }
}

function StatCard({
  label,
  value,
  color,
  active,
  onClick,
}: {
  label: string;
  value: number;
  color: "primary" | "emerald" | "amber" | "rose";
  active?: boolean;
  onClick?: () => void;
}) {
  const styles = {
    primary: "bg-primary/5 border-primary/20 text-primary hover:border-primary/50",
    emerald: "bg-emerald-500/5 border-emerald-500/20 text-emerald-600 dark:text-emerald-400 hover:border-emerald-500/50",
    amber: "bg-amber-500/5 border-amber-500/20 text-amber-600 dark:text-amber-400 hover:border-amber-500/50",
    rose: "bg-rose-500/5 border-rose-500/20 text-rose-600 dark:text-rose-400 hover:border-rose-500/50",
  };

  const activeStyles = {
    primary: "ring-2 ring-primary border-primary font-bold shadow-md",
    emerald: "ring-2 ring-emerald-500 border-emerald-500 font-bold shadow-md",
    amber: "ring-2 ring-amber-500 border-amber-500 font-bold shadow-md",
    rose: "ring-2 ring-rose-500 border-rose-500 font-bold shadow-md",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl border p-4 flex flex-col gap-1 shadow-sm bg-card text-left transition-all duration-200 cursor-pointer",
        styles[color],
        active && activeStyles[color]
      )}
    >
      <span className="text-2xl font-bold tabular-nums">{value}</span>
      <span className="text-xs text-muted-foreground font-medium">{label}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SELECT PHASE
// ─────────────────────────────────────────────────────────────────────────────

function SelectPhase({ onFilesSelected }: { onFilesSelected: (files: FileList) => void }) {
  const singleRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        onFilesSelected(e.dataTransfer.files);
      }
    },
    [onFilesSelected]
  );

  return (
    <div className="space-y-6">
      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          "border-2 border-dashed rounded-2xl p-12 text-center transition-all duration-300 cursor-pointer bg-card shadow-sm",
          isDragging
            ? "border-primary bg-primary/5 scale-[1.01]"
            : "border-border/80 hover:border-primary/50 hover:bg-accent/40"
        )}
      >
        <div className="flex flex-col items-center gap-4">
          <div
            className={cn(
              "w-16 h-16 rounded-2xl flex items-center justify-center transition-colors shadow-sm",
              isDragging ? "bg-primary/20 text-primary" : "bg-primary/10 text-primary"
            )}
          >
            <Folder className="w-8 h-8" />
          </div>
          <div>
            <p className="text-foreground font-semibold text-base">
              Kéo thả folder hoặc file PDF vào đây
            </p>
            <p className="text-muted-foreground text-sm mt-1">
              Hoặc chọn từ nút tải bên dưới
            </p>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Single PDF */}
        <button
          onClick={() => singleRef.current?.click()}
          className="group flex flex-col gap-3 p-6 rounded-2xl bg-card border border-border/60 hover:border-primary/40 hover:bg-accent/40 transition-all duration-200 cursor-pointer text-left shadow-sm"
        >
          <div className="w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
            <FileText className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="font-semibold text-foreground text-sm">Chọn file PDF đơn lẻ</p>
            <p className="text-muted-foreground text-xs mt-1">
              Upload một file PDF cho một sản phẩm cụ thể
            </p>
          </div>
          <input
            ref={singleRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={(e) => e.target.files && onFilesSelected(e.target.files)}
          />
        </button>

        {/* Folder */}
        <button
          onClick={() => folderRef.current?.click()}
          className="group flex flex-col gap-3 p-6 rounded-2xl bg-card border border-border/60 hover:border-primary/40 hover:bg-accent/40 transition-all duration-200 cursor-pointer text-left shadow-sm"
        >
          <div className="w-11 h-11 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center group-hover:bg-indigo-500/20 transition-colors">
            <FolderOpen className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <p className="font-semibold text-foreground text-sm">Chọn toàn bộ folder</p>
            <p className="text-muted-foreground text-xs mt-1">
              Upload theo cấu trúc Catalog/Hãng/Danh mục/Sản phẩm.pdf
            </p>
          </div>
          <input
            ref={folderRef}
            type="file"
            multiple
            // @ts-ignore
            webkitdirectory="true"
            className="hidden"
            onChange={(e) => e.target.files && onFilesSelected(e.target.files)}
          />
        </button>
      </div>

      {/* Structure guide */}
      <Card className="border-border/60 bg-card shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2 text-foreground">
            <Info className="w-4 h-4 text-primary" />
            Cấu trúc folder quy định
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <pre className="text-xs text-muted-foreground font-mono bg-muted/50 border border-border/50 rounded-xl p-4 overflow-x-auto leading-relaxed">
{`Catalog/
└── Crestron/                    ← Tên hãng
    └── Bộ xử lý trình chiếu/   ← Danh mục
        └── DMPS3-4K-350-C.pdf  ← Tên sản phẩm`}
          </pre>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-muted-foreground">
            {[
              { icon: CheckCircle2, color: "text-emerald-500", text: "Chỉ chấp nhận file định dạng .pdf" },
              { icon: CheckCircle2, color: "text-emerald-500", text: "Giới hạn dung lượng 25 MB mỗi file" },
              { icon: CheckCircle2, color: "text-emerald-500", text: "File ẩn (.DS_Store, Thumbs.db) được loại bỏ" },
              { icon: AlertTriangle, color: "text-amber-500", text: "Yêu cầu 4 cấp thư mục: root/hãng/danh mục/file.pdf" },
            ].map(({ icon: Icon, color, text }) => (
              <li key={text} className="flex items-center gap-2">
                <Icon className={cn("w-3.5 h-3.5 shrink-0", color)} />
                {text}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PREVIEW PHASE
// ─────────────────────────────────────────────────────────────────────────────

interface PreviewPhaseProps {
  rows: CatalogPreviewRow[];
  skipped: SkippedEntry[];
  onToggleRow: (index: number) => void;
  onToggleAll: (selected: boolean) => void;
  onSelectSuggestion: (index: number, suggestion: CmsSuggestion) => void;
  onStartUpload: () => void;
  onReset: () => void;
}

type CmsFilterStatus = "all" | "matched" | "no_match" | "multiple_match";

function PreviewPhase({
  rows,
  skipped,
  onToggleRow,
  onToggleAll,
  onSelectSuggestion,
  onStartUpload,
  onReset,
}: PreviewPhaseProps) {
  const [showSkipped, setShowSkipped] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<CmsFilterStatus>("all");

  const matchedCount = rows.filter((r) => r.cmsMatchStatus === "matched").length;
  const noMatchCount = rows.filter((r) => r.cmsMatchStatus === "no_match").length;
  const multipleCount = rows.filter((r) => r.cmsMatchStatus === "multiple_match").length;
  const selectedCount = rows.filter((r) => r.selected).length;

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.cmsMatchStatus !== statusFilter) {
        return false;
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          r.entry.brandName.toLowerCase().includes(q) ||
          r.entry.categoryName.toLowerCase().includes(q) ||
          r.entry.productName.toLowerCase().includes(q) ||
          r.entry.fileName.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [rows, searchQuery, statusFilter]);

  const allSelected =
    filteredRows.length > 0 &&
    filteredRows.filter((r) => r.cmsMatchStatus === "matched").every((r) => r.selected);

  return (
    <div className="space-y-5">
      {/* Summary stats — clickable filter cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Tổng hợp lệ"
          value={rows.length}
          color="primary"
          active={statusFilter === "all"}
          onClick={() => setStatusFilter("all")}
        />
        <StatCard
          label="Khớp CMS"
          value={matchedCount}
          color="emerald"
          active={statusFilter === "matched"}
          onClick={() => setStatusFilter("matched")}
        />
        <StatCard
          label="Không tìm thấy"
          value={noMatchCount}
          color="amber"
          active={statusFilter === "no_match"}
          onClick={() => setStatusFilter("no_match")}
        />
        <StatCard
          label="Trùng nhiều"
          value={multipleCount}
          color="rose"
          active={statusFilter === "multiple_match"}
          onClick={() => setStatusFilter("multiple_match")}
        />
      </div>

      {/* Skipped files */}
      {skipped.length > 0 && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-5 py-3.5 text-left"
            onClick={() => setShowSkipped(!showSkipped)}
          >
            <span className="text-amber-700 dark:text-amber-400 text-xs font-semibold flex items-center gap-2">
              <FileWarning className="w-4 h-4" />
              {skipped.length} file bị bỏ qua (cấu trúc không đúng hoặc không phải PDF)
            </span>
            {showSkipped ? (
              <ChevronDown className="w-4 h-4 text-amber-500" />
            ) : (
              <ChevronRight className="w-4 h-4 text-amber-500" />
            )}
          </button>
          {showSkipped && (
            <div className="px-5 pb-4 space-y-1.5 border-t border-amber-500/10">
              {skipped.map((s, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-300 pt-1.5">
                  <span className="shrink-0 mt-0.5">•</span>
                  <span>
                    <span className="font-mono">{s.relativePath}</span>
                    <span className="opacity-70 ml-2">— {s.reason}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Table controls & Status filter tabs */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* Search box */}
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Tìm kiếm hãng, danh mục, sản phẩm..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-card border border-border/60 rounded-xl text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary transition-colors shadow-sm"
            />
          </div>

          {/* CMS Status Filter Pills */}
          <div className="flex items-center gap-1 bg-muted/40 border border-border/50 p-1 rounded-xl overflow-x-auto text-xs">
            {[
              { id: "all", label: "Tất cả", count: rows.length },
              { id: "matched", label: "✓ Khớp CMS", count: matchedCount },
              { id: "no_match", label: "⚠ Không thấy", count: noMatchCount },
              { id: "multiple_match", label: "✕ Trùng nhiều", count: multipleCount },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id as CmsFilterStatus)}
                className={cn(
                  "px-2.5 py-1 rounded-lg font-medium text-xs whitespace-nowrap transition-all cursor-pointer",
                  statusFilter === tab.id
                    ? "bg-card text-foreground shadow-sm font-semibold border border-border/60"
                    : "text-muted-foreground hover:text-foreground hover:bg-card/50"
                )}
              >
                {tab.label} <span className="opacity-60 text-[10px]">({tab.count})</span>
              </button>
            ))}
          </div>
        </div>

        <p className="text-xs text-muted-foreground self-end sm:self-center">
          Hiển thị <span className="text-foreground font-semibold">{filteredRows.length}</span> / {rows.length} file |{" "}
          <span className="text-primary font-semibold">{selectedCount}</span> đã chọn
        </p>
      </div>

      {/* Table */}
      <Card className="border-border/60 bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/60 bg-muted/40">
                <th className="px-4 py-3 w-10">
                  <button
                    onClick={() => onToggleAll(!allSelected)}
                    title={allSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {allSelected ? (
                      <CheckSquare className="w-4 h-4 text-primary" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                </th>
                {["Hãng", "Danh mục", "Sản phẩm", "Tên file", "Dung lượng", "Trạng thái CMS", "Folder đích"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left font-semibold text-muted-foreground uppercase tracking-wider text-[10px]">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground text-xs">
                    Không tìm thấy file nào khớp với từ khóa
                  </td>
                </tr>
              ) : (
                filteredRows.map((row, i) => {
                  const originalIndex = rows.indexOf(row);
                  const isDisabled =
                    row.cmsMatchStatus === "no_match" ||
                    row.cmsMatchStatus === "multiple_match";

                  return (
                    <tr
                      key={i}
                      className={cn(
                        "transition-colors",
                        row.selected && !isDisabled
                          ? "bg-primary/5"
                          : "hover:bg-muted/30",
                        isDisabled && "opacity-50"
                      )}
                    >
                      <td className="px-4 py-3">
                        <button
                          disabled={isDisabled}
                          onClick={() => onToggleRow(originalIndex)}
                          className="text-muted-foreground hover:text-foreground transition-colors disabled:cursor-not-allowed"
                        >
                          {row.selected && !isDisabled ? (
                            <CheckSquare className="w-4 h-4 text-primary" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-foreground font-medium">{row.entry.brandName}</td>
                      <td className="px-4 py-3 text-muted-foreground">{row.entry.categoryName}</td>
                      <td className="px-4 py-3 text-foreground font-semibold">{row.entry.productName}</td>
                      <td className="px-4 py-3 font-mono text-muted-foreground">{row.entry.fileName}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{formatBytes(row.entry.sizeBytes)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          {getCmsMatchBadge(row.cmsMatchStatus)}
                          {row.cmsProductName && (
                            <span className="text-[10px] text-muted-foreground truncate max-w-[170px]">
                              {row.cmsProductName}
                            </span>
                          )}
                          {row.warning && row.cmsMatchStatus !== "matched" && (
                            <span className="text-[10px] text-amber-600 dark:text-amber-400 truncate max-w-[170px]" title={row.warning}>
                              {row.warning}
                            </span>
                          )}

                          {/* Fuzzy Suggestions */}
                          {row.cmsMatchStatus !== "matched" && row.cmsSuggestions && row.cmsSuggestions.length > 0 && (
                            <div className="mt-1.5 space-y-1 pt-1 border-t border-border/40">
                              <span className="text-[10px] font-semibold text-muted-foreground flex items-center gap-1">
                                <Sparkles className="w-3 h-3 text-amber-500" />
                                Gợi ý gần giống:
                              </span>
                              <div className="space-y-1">
                                {row.cmsSuggestions.map((sugg) => (
                                  <button
                                    key={sugg.itemId}
                                    type="button"
                                    onClick={() => onSelectSuggestion(originalIndex, sugg)}
                                    className="w-full text-left flex items-center justify-between gap-1.5 px-2 py-1 rounded bg-muted/60 hover:bg-primary/15 hover:border-primary/40 border border-border/40 transition-colors text-[10px] group cursor-pointer"
                                    title={`Bấm để chọn sản phẩm CMS này: ${sugg.productName} (${sugg.score}% khớp)`}
                                  >
                                    <span className="font-medium truncate group-hover:text-primary max-w-[120px]">
                                      {sugg.productName}
                                    </span>
                                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 shrink-0 bg-primary/10 text-primary border-primary/30">
                                      {sugg.score}%
                                    </Badge>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-muted-foreground">
                        {row.wixFolderPath ?? "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-between pt-2">
        <Button
          variant="outline"
          onClick={onReset}
          className="gap-2 shadow-sm"
        >
          <RefreshCw className="w-4 h-4" />
          Chọn lại
        </Button>
        <Button
          onClick={onStartUpload}
          disabled={selectedCount === 0}
          className="gap-2 shadow-sm px-6 font-semibold"
        >
          <Play className="w-4 h-4" />
          Bắt đầu Upload ({selectedCount} file)
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UPLOAD PHASE
// ─────────────────────────────────────────────────────────────────────────────

function UploadPhase({
  queue,
  onRetry,
  totalProgress,
}: {
  queue: UploadQueueItem[];
  onRetry: (index: number) => void;
  totalProgress: number;
}) {
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());

  const successCount = queue.filter((q) => q.status === "success").length;
  const failedCount = queue.filter((q) => q.status === "failed").length;
  const activeCount = queue.filter(
    (q) => q.status === "uploading" || q.status === "updating_cms" || q.status === "validating"
  ).length;

  const toggleExpand = (i: number) => {
    setExpandedItems((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* Overall progress */}
      <Card className="border-border/60 bg-card shadow-sm">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-foreground font-bold text-base">Tiến trình Upload</span>
            <span className="text-muted-foreground text-sm font-medium tabular-nums">
              {successCount + failedCount} / {queue.length} file
            </span>
          </div>
          <Progress value={totalProgress} className="h-3" />
          <div className="flex items-center gap-6 text-xs font-semibold pt-1">
            <span className="text-emerald-600 dark:text-emerald-400">✓ {successCount} thành công</span>
            {failedCount > 0 && <span className="text-rose-600 dark:text-rose-400">✕ {failedCount} thất bại</span>}
            {activeCount > 0 && (
              <span className="text-primary flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {activeCount} đang tiến hành
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Per-file list */}
      <Card className="border-border/60 bg-card shadow-sm overflow-hidden">
        <ScrollArea className="h-[460px]">
          <div className="divide-y divide-border/50">
            {queue.map((item, i) => (
              <div key={i} className="px-5 py-4 hover:bg-muted/30 transition-colors">
                <div className="flex items-center gap-3">
                  {getStatusIcon(item.status)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-foreground font-semibold text-sm truncate">
                        {item.entry.productName}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        ({item.entry.brandName} / {item.entry.categoryName})
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span
                        className={cn(
                          "text-[10px] px-2 py-0.5 rounded-full border font-bold",
                          item.status === "success"
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                            : item.status === "failed"
                            ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20"
                            : item.status === "skipped"
                            ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                            : item.status === "queued"
                            ? "bg-muted text-muted-foreground border-border"
                            : "bg-primary/10 text-primary border-primary/20"
                        )}
                      >
                        {getStatusLabel(item.status)}
                      </span>
                      <span className="text-muted-foreground font-mono text-[11px]">{item.entry.fileName}</span>
                      <span className="text-muted-foreground text-[11px]">{formatBytes(item.entry.sizeBytes)}</span>
                    </div>

                    {(item.status === "uploading" || item.status === "updating_cms") && (
                      <Progress value={item.progress} className="h-1.5 mt-2.5" />
                    )}

                    {item.status === "failed" && item.error && (
                      <div className="mt-2">
                        <button
                          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                          onClick={() => toggleExpand(i)}
                        >
                          {expandedItems.has(i) ? (
                            <ChevronDown className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5" />
                          )}
                          Chi tiết lỗi
                        </button>
                        {expandedItems.has(i) && (
                          <p className="mt-1 text-xs text-rose-600 dark:text-rose-400 font-mono bg-rose-500/10 border border-rose-500/20 rounded-lg p-2.5">
                            {item.error}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  {item.status === "failed" && item.retryCount < 3 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onRetry(i)}
                      className="shrink-0 h-8 text-xs gap-1.5 shadow-sm"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Thử lại
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DONE PHASE
// ─────────────────────────────────────────────────────────────────────────────

function ReportSection({
  title,
  icon,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-border/60 bg-card shadow-sm overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-muted/20 transition-colors"
        onClick={onToggle}
      >
        <span className="text-foreground text-sm font-semibold flex items-center gap-2">
          {icon}
          {title}
        </span>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        )}
      </button>
      {expanded && (
        <div className="px-5 pb-4 space-y-2 border-t border-border/40 max-h-60 overflow-y-auto">
          {children}
        </div>
      )}
    </Card>
  );
}

function ReportRow({ item, showError }: { item: CatalogPreviewRow | UploadQueueItem; showError?: boolean }) {
  const queueItem = item as UploadQueueItem;
  return (
    <div className="flex items-start gap-2 text-xs py-2 border-b border-border/40 last:border-0">
      <div className="flex-1">
        <span className="text-foreground font-semibold">{item.entry.productName}</span>
        <span className="text-muted-foreground ml-2">
          ({item.entry.brandName} / {item.entry.categoryName})
        </span>
        <span className="text-muted-foreground font-mono ml-2">{item.entry.fileName}</span>
      </div>
      {showError && queueItem.error && (
        <span className="text-rose-600 dark:text-rose-400 shrink-0 max-w-xs truncate" title={queueItem.error}>
          {queueItem.error}
        </span>
      )}
      {!showError && item.warning && (
        <span className="text-amber-600 dark:text-amber-400 shrink-0 max-w-xs truncate" title={item.warning}>
          {item.warning}
        </span>
      )}
    </div>
  );
}

function DonePhase({
  report,
  onDownloadCsv,
  onReset,
  isDownloading,
}: {
  report: CatalogUploadReport;
  onDownloadCsv: () => void;
  onReset: () => void;
  isDownloading: boolean;
}) {
  const [showFailed, setShowFailed] = useState(true);
  const [showNoMatch, setShowNoMatch] = useState(false);
  const [showMultiple, setShowMultiple] = useState(false);

  return (
    <div className="space-y-6">
      {/* Summary card */}
      <Card className="border-border/60 bg-card shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground text-lg">
            <BarChart3 className="w-5 h-5 text-primary" />
            Kết quả upload Catalog
          </CardTitle>
          <CardDescription>
            Hoàn thành quá trình upload trong {formatDuration(report.durationMs)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Tổng file" value={report.total} color="primary" />
            <StatCard label="Thành công" value={report.success} color="emerald" />
            <StatCard label="Bỏ qua" value={report.skipped} color="amber" />
            <StatCard label="Thất bại" value={report.failed} color="rose" />
          </div>

          {(report.noMatchItems.length > 0 || report.multipleMatchItems.length > 0) && (
            <div className="mt-4 pt-4 border-t border-border/60 flex flex-wrap gap-4 text-xs font-medium">
              {report.noMatchItems.length > 0 && (
                <span className="text-amber-600 dark:text-amber-400">
                  ⚠ {report.noMatchItems.length} file không tìm thấy trong Wix CMS
                </span>
              )}
              {report.multipleMatchItems.length > 0 && (
                <span className="text-rose-600 dark:text-rose-400">
                  ✕ {report.multipleMatchItems.length} file trùng khớp nhiều sản phẩm
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail sections */}
      {report.failedItems.length > 0 && (
        <ReportSection
          title={`${report.failedItems.length} file upload thất bại`}
          icon={<XCircle className="w-4 h-4 text-rose-500" />}
          expanded={showFailed}
          onToggle={() => setShowFailed(!showFailed)}
        >
          {report.failedItems.map((item, i) => (
            <ReportRow key={i} item={item} showError />
          ))}
        </ReportSection>
      )}

      {report.noMatchItems.length > 0 && (
        <ReportSection
          title={`${report.noMatchItems.length} file không tìm thấy sản phẩm tương ứng trong CMS`}
          icon={<AlertTriangle className="w-4 h-4 text-amber-500" />}
          expanded={showNoMatch}
          onToggle={() => setShowNoMatch(!showNoMatch)}
        >
          {report.noMatchItems.map((item, i) => (
            <ReportRow key={i} item={item} />
          ))}
        </ReportSection>
      )}

      {report.multipleMatchItems.length > 0 && (
        <ReportSection
          title={`${report.multipleMatchItems.length} file trùng tên với nhiều sản phẩm`}
          icon={<FileWarning className="w-4 h-4 text-amber-500" />}
          expanded={showMultiple}
          onToggle={() => setShowMultiple(!showMultiple)}
        >
          {report.multipleMatchItems.map((item, i) => (
            <ReportRow key={i} item={item} />
          ))}
        </ReportSection>
      )}

      {/* Actions */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
        <Button variant="outline" onClick={onReset} className="gap-2 shadow-sm">
          <RefreshCw className="w-4 h-4" />
          Upload đợt khác
        </Button>
        <Button onClick={onDownloadCsv} disabled={isDownloading} className="gap-2 shadow-sm font-semibold">
          {isDownloading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          Tải báo cáo chi tiết CSV
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────

export default function CatalogUploadPage() {
  const [phase, setPhase] = useState<Phase>("select");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewRows, setPreviewRows] = useState<CatalogPreviewRow[]>([]);
  const [skippedEntries, setSkippedEntries] = useState<SkippedEntry[]>([]);
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const [report, setReport] = useState<CatalogUploadReport | null>(null);
  const [isDownloadingCsv, setIsDownloadingCsv] = useState(false);

  const startTimeRef = useRef<number>(0);

  const totalProgress = useMemo(() => {
    if (uploadQueue.length === 0) return 0;
    const done = uploadQueue.filter(
      (q) => q.status === "success" || q.status === "failed" || q.status === "skipped"
    ).length;
    return Math.round((done / uploadQueue.length) * 100);
  }, [uploadQueue]);

  // ── Handle file selection ────────────────────────────────────────────────
  const handleFilesSelected = useCallback(async (fileList: FileList) => {
    const files = Array.from(fileList);
    setSelectedFiles(files);
    setPhase("validating");

    try {
      const filesPayload = files.map((f) => ({
        relativePath: (f as any).webkitRelativePath || f.name,
        name: f.name,
        sizeBytes: f.size,
      }));

      const res = await fetch("/api/catalog-upload/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: filesPayload }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? `Validate failed: ${res.status}`);
      }

      const data = await res.json();
      setPreviewRows(data.rows ?? []);
      setSkippedEntries(data.skipped ?? []);
      setPhase("preview");

      if ((data.rows ?? []).length === 0) {
        toast.warning("Không tìm thấy file PDF hợp lệ nào để upload.", { duration: 5000 });
      } else {
        toast.success(`Đã kiểm tra ${data.validCount} file — ${data.matchedCount} khớp CMS.`);
      }
    } catch (err: any) {
      toast.error(`Lỗi xác thực: ${err.message}`);
      setPhase("select");
    }
  }, []);

  // ── Toggle rows ──────────────────────────────────────────────────────────
  const handleToggleRow = useCallback((index: number) => {
    setPreviewRows((prev) =>
      prev.map((r, i) =>
        i === index && r.cmsMatchStatus === "matched" ? { ...r, selected: !r.selected } : r
      )
    );
  }, []);

  const handleToggleAll = useCallback((selected: boolean) => {
    setPreviewRows((prev) =>
      prev.map((r) => (r.cmsMatchStatus === "matched" ? { ...r, selected } : r))
    );
  }, []);

  const handleSelectSuggestion = useCallback((index: number, suggestion: CmsSuggestion) => {
    setPreviewRows((prev) =>
      prev.map((r, i) =>
        i === index
          ? {
              ...r,
              cmsMatchStatus: "matched",
              cmsItemId: suggestion.itemId,
              cmsProductName: suggestion.productName,
              selected: true,
              warning: `Đã nối thủ công với: ${suggestion.productName} (${suggestion.score}% khớp)`,
            }
          : r
      )
    );
    toast.success(`Đã nối file "${previewRows[index]?.entry.fileName}" với CMS: ${suggestion.productName}`);
  }, [previewRows]);

  // ── Start upload ─────────────────────────────────────────────────────────
  const handleStartUpload = useCallback(async () => {
    const selectedRows = previewRows.filter((r) => r.selected && r.cmsMatchStatus === "matched");
    if (selectedRows.length === 0) return;

    const initialQueue: UploadQueueItem[] = [
      ...selectedRows.map((r) => ({
        ...r,
        status: "queued" as UploadItemStatus,
        progress: 0,
        retryCount: 0,
      })),
      ...previewRows
        .filter((r) => r.cmsMatchStatus === "matched" && !r.selected)
        .map((r) => ({
          ...r,
          status: "skipped" as UploadItemStatus,
          progress: 0,
          retryCount: 0,
        })),
    ];

    setUploadQueue(initialQueue);
    setPhase("uploading");
    startTimeRef.current = Date.now();

    const fileMap = new Map<string, File>();
    for (const f of selectedFiles) {
      const rp = (f as any).webkitRelativePath || f.name;
      fileMap.set(rp, f);
      fileMap.set(f.name, f);
    }

    const CONCURRENCY = 3;

    const updateItem = (index: number, updates: Partial<UploadQueueItem>) => {
      setUploadQueue((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], ...updates };
        return next;
      });
    };

    const processItem = async (item: UploadQueueItem, queuePos: number) => {
      updateItem(queuePos, { status: "validating", progress: 10 });

      const file = fileMap.get(item.entry.relativePath) || fileMap.get(item.entry.fileName);
      if (!file) {
        updateItem(queuePos, {
          status: "failed",
          error: `File không tìm thấy: ${item.entry.fileName}`,
        });
        return;
      }

      updateItem(queuePos, { status: "uploading", progress: 30 });

      try {
        const formData = new FormData();
        formData.append("file", file, item.entry.fileName);
        formData.append("cmsItemId", item.cmsItemId!);
        formData.append("brandName", item.entry.brandName);
        formData.append("categoryName", item.entry.categoryName);
        formData.append("fileName", item.entry.fileName);

        updateItem(queuePos, { progress: 60 });

        const res = await fetch("/api/catalog-upload/upload", {
          method: "POST",
          body: formData,
        });

        updateItem(queuePos, { status: "updating_cms", progress: 80 });

        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

        updateItem(queuePos, {
          status: "success",
          progress: 100,
          wixFileId: data.wixFileId,
          wixUrl: data.wixUrl,
        });
      } catch (err: any) {
        updateItem(queuePos, {
          status: "failed",
          error: err.message ?? String(err),
          retryCount: item.retryCount,
        });
      }
    };

    const queued = initialQueue
      .map((item, i) => ({ item, i }))
      .filter(({ item }) => item.status === "queued");

    for (let i = 0; i < queued.length; i += CONCURRENCY) {
      const chunk = queued.slice(i, i + CONCURRENCY);
      await Promise.allSettled(chunk.map(({ item, i: qi }) => processItem(item, qi)));
    }

    setUploadQueue((finalQueue) => {
      const durationMs = Date.now() - startTimeRef.current;
      const successItems = finalQueue.filter((q) => q.status === "success");
      const failedItems = finalQueue.filter((q) => q.status === "failed");
      const skippedItems = finalQueue.filter((q) => q.status === "skipped");
      const noMatchItems = previewRows.filter((r) => r.cmsMatchStatus === "no_match");
      const multipleMatchItems = previewRows.filter((r) => r.cmsMatchStatus === "multiple_match");

      const finalReport: CatalogUploadReport = {
        total: selectedRows.length,
        success: successItems.length,
        skipped: skippedItems.length,
        failed: failedItems.length,
        durationMs,
        noMatchItems,
        multipleMatchItems,
        successItems,
        failedItems,
        skippedItems,
      };

      setReport(finalReport);
      setPhase("done");

      if (failedItems.length === 0) {
        toast.success(`Upload hoàn tất! ${successItems.length} file thành công.`);
      } else {
        toast.warning(`Upload xong: ${successItems.length} thành công, ${failedItems.length} thất bại.`);
      }

      return finalQueue;
    });
  }, [previewRows, selectedFiles]);

  // ── Retry ────────────────────────────────────────────────────────────────
  const handleRetry = useCallback(async (index: number) => {
    const item = uploadQueue[index];
    if (!item || item.status !== "failed") return;

    const fileMap = new Map<string, File>();
    for (const f of selectedFiles) {
      const rp = (f as any).webkitRelativePath || f.name;
      fileMap.set(rp, f);
      fileMap.set(f.name, f);
    }

    const updateItem = (updates: Partial<UploadQueueItem>) => {
      setUploadQueue((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], ...updates };
        return next;
      });
    };

    updateItem({ status: "validating", progress: 10, retryCount: item.retryCount + 1 });

    const file = fileMap.get(item.entry.relativePath) || fileMap.get(item.entry.fileName);
    if (!file) {
      updateItem({ status: "failed", error: "File không tìm thấy", retryCount: item.retryCount + 1 });
      return;
    }

    updateItem({ status: "uploading", progress: 30 });

    try {
      const formData = new FormData();
      formData.append("file", file, item.entry.fileName);
      formData.append("cmsItemId", item.cmsItemId!);
      formData.append("brandName", item.entry.brandName);
      formData.append("categoryName", item.entry.categoryName);
      formData.append("fileName", item.entry.fileName);
      updateItem({ progress: 60 });

      const res = await fetch("/api/catalog-upload/upload", { method: "POST", body: formData });
      updateItem({ status: "updating_cms", progress: 80 });

      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

      updateItem({ status: "success", progress: 100, wixFileId: data.wixFileId, wixUrl: data.wixUrl, error: undefined });
      toast.success(`Thử lại thành công: ${item.entry.productName}`);
    } catch (err: any) {
      updateItem({ status: "failed", error: err.message ?? String(err), retryCount: item.retryCount + 1 });
      toast.error(`Thử lại thất bại: ${item.entry.productName}`);
    }
  }, [uploadQueue, selectedFiles]);

  // ── Download CSV ─────────────────────────────────────────────────────────
  const handleDownloadCsv = useCallback(async () => {
    if (!report) return;
    setIsDownloadingCsv(true);
    try {
      const res = await fetch("/api/catalog-upload/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = url;
      a.download = res.headers.get("Content-Disposition")?.split("filename=")[1]?.replace(/"/g, "") ?? "catalog-report.csv";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        if (document.body.contains(a)) document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 60000);
    } catch (err: any) {
      toast.error(`Lỗi tải báo cáo: ${err.message}`);
    } finally {
      setIsDownloadingCsv(false);
    }
  }, [report]);

  // ── Reset ────────────────────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    setPhase("select");
    setSelectedFiles([]);
    setPreviewRows([]);
    setSkippedEntries([]);
    setUploadQueue([]);
    setReport(null);
  }, []);

  // ── Step indicator ───────────────────────────────────────────────────────
  const steps = [
    { key: "select", label: "Chọn file" },
    { key: "validating", label: "Xác thực" },
    { key: "preview", label: "Xem trước" },
    { key: "uploading", label: "Upload" },
    { key: "done", label: "Hoàn tất" },
  ] as const;

  const currentStepIndex = steps.findIndex((s) => s.key === phase);

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-6xl mx-auto pb-10">
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gradient-brand flex items-center gap-2.5">
              <FileText className="w-6 h-6 text-primary" />
              Upload Catalog PDF
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Upload tài liệu PDF sản phẩm vào Wix Media Manager và tự động cập nhật Wix CMS (Import1).
            </p>
          </div>
        </div>

        {/* Step Indicator */}
        <Card className="border-border/60 bg-card shadow-sm p-4">
          <div className="flex items-center gap-2 overflow-x-auto">
            {steps.map((step, i) => {
              const isActive = step.key === phase;
              const isDone = i < currentStepIndex;
              return (
                <React.Fragment key={step.key}>
                  <div
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all",
                      isActive
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : isDone
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                        : "bg-muted/50 text-muted-foreground border border-border/50"
                    )}
                  >
                    {isDone ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : isActive && phase === "validating" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[10px]">
                        {i + 1}
                      </span>
                    )}
                    {step.label}
                  </div>
                  {i < steps.length - 1 && (
                    <div
                      className={cn(
                        "h-px flex-1 max-w-12 min-w-[16px] transition-colors",
                        i < currentStepIndex ? "bg-emerald-500/40" : "bg-border/60"
                      )}
                    />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </Card>

        {/* Phase Content */}
        {phase === "select" && (
          <SelectPhase onFilesSelected={handleFilesSelected} />
        )}

        {phase === "validating" && (
          <Card className="border-border/60 bg-card shadow-sm p-16">
            <div className="flex flex-col items-center justify-center gap-4 text-center">
              <div className="relative w-14 h-14">
                <div className="absolute inset-0 rounded-full border-3 border-primary/20 border-t-primary animate-spin" />
                <Search className="absolute inset-0 m-auto w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-foreground font-bold text-base">Đang kiểm tra và đối chiếu CMS...</p>
                <p className="text-muted-foreground text-sm mt-1">Đang xử lý {selectedFiles.length} file</p>
              </div>
            </div>
          </Card>
        )}

        {phase === "preview" && (
          <PreviewPhase
            rows={previewRows}
            skipped={skippedEntries}
            onToggleRow={handleToggleRow}
            onToggleAll={handleToggleAll}
            onSelectSuggestion={handleSelectSuggestion}
            onStartUpload={handleStartUpload}
            onReset={handleReset}
          />
        )}

        {phase === "uploading" && (
          <UploadPhase
            queue={uploadQueue}
            onRetry={handleRetry}
            totalProgress={totalProgress}
          />
        )}

        {phase === "done" && report && (
          <DonePhase
            report={report}
            onDownloadCsv={handleDownloadCsv}
            onReset={handleReset}
            isDownloading={isDownloadingCsv}
          />
        )}
      </div>
    </DashboardLayout>
  );
}
