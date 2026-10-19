"use client";

import React from "react";
import { GitCompare, Loader2, UploadCloud, ChevronRight, ChevronDown, Info, Languages, ArrowLeft, AlertTriangle, FileSpreadsheet, FileWarning, CheckCircle2, XCircle, Search, ClipboardCopy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useDataStore } from "@/store/useDataStore";
import { updateCmsProductFieldsAction } from "@/app/actions/discovery";
import { toast } from "sonner";
import type { CmsSyncDiff } from "@/lib/services/cmsSyncCompare";
import { parseCmsCsvFile, normalizeProductKey, type CmsCsvRow } from "@/lib/utils/cmsCsvUtils";
import { Pager, PAGER_SHOW_ALL, PAGER_PAGE_SIZE_OPTIONS } from "./Pager";

function getField(row: Record<string, unknown>, candidates: string[]): string {
  for (const c of candidates) {
    const key = Object.keys(row).find((k) => k.toLowerCase() === c.toLowerCase());
    if (key && row[key] != null && String(row[key]).trim() !== "") return String(row[key]);
  }
  return "";
}

/** Maps a diff's display field label back to the property updateCmsProductFields expects. */
const CMS_FIELD_PROP: Record<string, "Title" | "MainFeature" | "ProductOverview"> = {
  Title: "Title",
  "Main Feature": "MainFeature",
  "Product Overview": "ProductOverview",
};

interface PushFailure {
  product: string;
  brand: string;
  fields: string[];
  error: string;
}

interface PushReport {
  totalProducts: number;
  successCount: number;
  failCount: number;
  failures: PushFailure[];
}

interface SyncEntry {
  key: string;
  rowId: string;
  brand: string;
  product: string;
  field: string;
  localValue: string;
  cmsValue: string;
  status: "different" | "missing_in_cms" | "missing_locally";
  wasTranslated?: boolean;
  translationFailed?: boolean;
}

/**
 * Bulk-compares the whole catalog against a CSV the admin exported from the
 * Wix CMS Content Manager and uploads here (natural-language fields only —
 * Title / Main Feature / Product Overview), normalizing whichever side isn't
 * Vietnamese before comparing (see cmsSyncCompare.ts), and lets a reviewer
 * approve pushing the Vietnamese-normalized local value to CMS. This is the
 * intended step after "Kiểm tra AI" / "Sửa bằng AI": those clean up the local
 * catalog; this compares the result against what's live in Wix.
 *
 * CSV instead of a live per-product Wix lookup on purpose — looking up every
 * product one at a time over the network was the real bottleneck for any
 * catalog of real size (hundreds of round-trips). Matching against an
 * uploaded CSV is pure in-memory work, so the whole catalog compares in
 * seconds instead of minutes; only the AI language-normalization step (when
 * needed) still costs real time.
 */
interface CmsSyncDashboardProps {
  /** Called whenever a comparison is running/showing results, so the page can hide the regular Catalog Data table and let this dashboard's comparison table take its place. */
  onActiveChange?: (active: boolean) => void;
}

export function CmsSyncDashboard({ onActiveChange }: CmsSyncDashboardProps) {
  const { sheets } = useDataStore();
  const [isChecking, setIsChecking] = React.useState(false);
  const [progress, setProgress] = React.useState({ done: 0, total: 0 });
  const [hasRun, setHasRun] = React.useState(false);
  const [notFoundCount, setNotFoundCount] = React.useState(0);
  const [entries, setEntries] = React.useState<SyncEntry[]>([]);
  const [selected, setSelected] = React.useState<Record<string, boolean>>({});
  const [collapsedProducts, setCollapsedProducts] = React.useState<Record<string, boolean>>({});
  const [isPushing, setIsPushing] = React.useState(false);
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState<number>(PAGER_PAGE_SIZE_OPTIONS[0]);
  const [csvMeta, setCsvMeta] = React.useState<{ fileName: string; rowCount: number; matchedColumnCount: number } | null>(null);
  const csvInputRef = React.useRef<HTMLInputElement>(null);
  const [pushReport, setPushReport] = React.useState<PushReport | null>(null);
  const [isPushReportOpen, setIsPushReportOpen] = React.useState(false);
  const [pushErrorSearch, setPushErrorSearch] = React.useState("");

  React.useEffect(() => {
    onActiveChange?.(hasRun);
    // Clear the page-level flag on unmount so it never gets stuck hiding Catalog Data.
    return () => onActiveChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRun]);

  const handleBackToCatalog = () => {
    setHasRun(false);
    setEntries([]);
    setSelected({});
    setPage(1);
    setCsvMeta(null);
  };

  if (sheets.length === 0) return null;

  const totalProducts = sheets.reduce((acc, s) => acc + s.rows.length, 0);

  // Gate: only usable after "Kiểm tra AI" (review) and "Sửa bằng AI" (fix)
  // have actually run — comparing against CMS before the local catalog has
  // been cleaned up would just surface the same issues AI Review/Fix already
  // handle, and could tempt overwriting CMS with not-yet-corrected data.
  const hasReviewed = sheets.some((s) => s.rows.some((r) => r.aiReviewFindings !== undefined));
  const hasFixed = sheets.some((s) => s.rows.some((r) => r.aiFixSuggestion || (r.aiAppliedFixes?.length ?? 0) > 0));
  const isUnlocked = hasReviewed && hasFixed;

  const handleCsvSelected = async (file: File) => {
    if (!isUnlocked) {
      toast.error("Cần chạy \"Kiểm tra AI\" và \"Sửa bằng AI\" trước khi so sánh với CMS.");
      return;
    }

    let csv;
    try {
      csv = await parseCmsCsvFile(file);
    } catch (err) {
      toast.error(`Không đọc được file CSV: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (csv.byProduct.size === 0) {
      toast.error("File CSV không có dòng nào có tên sản phẩm/model hợp lệ.");
      return;
    }

    const items: { id: string; brand: string; product: string; localFields: CmsCsvRow; cmsFields: CmsCsvRow | null }[] = [];
    sheets.forEach((sheet) => {
      sheet.rows.forEach((row) => {
        const product = getField(row, ["Product", "Model"]);
        if (!product) return;
        items.push({
          id: row.id,
          brand: getField(row, ["Brand"]),
          product,
          localFields: {
            Title: getField(row, ["Title"]),
            MainFeature: getField(row, ["Main Feature", "MainFeature"]),
            ProductOverview: getField(row, ["Product Overview", "ProductOverview"]),
          },
          cmsFields: csv.byProduct.get(normalizeProductKey(product)) ?? null,
        });
      });
    });

    if (items.length === 0) {
      toast.error("Không có sản phẩm nào có tên/model trong catalog để so sánh.");
      return;
    }

    setIsChecking(true);
    setHasRun(false);
    setProgress({ done: 0, total: items.length });
    setEntries([]);
    setNotFoundCount(0);
    setCsvMeta({ fileName: file.name, rowCount: csv.rowCount, matchedColumnCount: csv.matchedColumnCount });

    // Pure in-memory diffing (no Wix I/O) — this batch size is only about
    // request/response size, not rate limits, so it can be generous.
    const batchSize = 40;
    const newEntries: SyncEntry[] = [];
    let notFound = 0;
    let failedBatches = 0;

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      try {
        const res = await fetch("/api/catalog-upload/cms-sync-check-csv", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: batch.map((b) => ({ id: b.id, localFields: b.localFields, cmsFields: b.cmsFields })),
          }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);

        const results: { id: string; found: boolean; diffs: CmsSyncDiff[] }[] = json.results || [];
        const byId = new Map(results.map((r) => [r.id, r]));

        batch.forEach((item) => {
          const result = byId.get(item.id);
          if (!result) return;
          if (!result.found) {
            notFound++;
            return;
          }
          result.diffs
            .filter((d) => d.status !== "same")
            .forEach((d) => {
              newEntries.push({
                key: `${item.id}::${d.field}`,
                rowId: item.id,
                brand: item.brand,
                product: item.product,
                field: d.field,
                localValue: d.localValue,
                cmsValue: d.cmsValue,
                status: d.status as SyncEntry["status"],
                wasTranslated: d.wasTranslated,
                translationFailed: d.translationFailed,
              });
            });
        });
      } catch (err) {
        failedBatches++;
        console.error("[CMS Sync] Batch failed:", err);
      }
      setProgress((prev) => ({ done: Math.min(prev.done + batch.length, items.length), total: items.length }));
    }

    setEntries(newEntries);
    setNotFoundCount(notFound);
    const defaults: Record<string, boolean> = {};
    newEntries.forEach((e) => { defaults[e.key] = true; });
    setSelected(defaults);
    setPage(1);
    setIsChecking(false);
    setHasRun(true);

    if (failedBatches > 0) {
      toast.warning(`So sánh CMS hoàn tất với ${failedBatches} lô lỗi. Tìm thấy ${newEntries.length} khác biệt.`);
    } else {
      toast.success(`So sánh CMS hoàn tất — ${newEntries.length} khác biệt trên ${new Set(newEntries.map((e) => e.rowId)).size} sản phẩm.`);
    }
  };

  const selectedCount = entries.filter((e) => selected[e.key]).length;
  const allSelected = entries.length > 0 && selectedCount === entries.length;

  const toggleAll = () => {
    const next: Record<string, boolean> = {};
    entries.forEach((e) => { next[e.key] = !allSelected; });
    setSelected(next);
  };

  const toggleProduct = (rowId: string, value: boolean) => {
    const next = { ...selected };
    entries.filter((e) => e.rowId === rowId).forEach((e) => { next[e.key] = value; });
    setSelected(next);
  };

  const handlePushSelected = async () => {
    const toPush = entries.filter((e) => selected[e.key]);
    if (toPush.length === 0) {
      toast.error("Chưa chọn thay đổi nào để ghi đè lên CMS.");
      return;
    }

    const byProduct = new Map<string, SyncEntry[]>();
    toPush.forEach((e) => {
      if (!byProduct.has(e.product)) byProduct.set(e.product, []);
      byProduct.get(e.product)!.push(e);
    });

    setIsPushing(true);
    let successCount = 0;
    let failCount = 0;
    const failures: PushFailure[] = [];

    for (const [modelName, productEntries] of byProduct) {
      const fieldsToPush: Partial<Record<"Title" | "MainFeature" | "ProductOverview", string>> = {};
      productEntries.forEach((e) => {
        const prop = CMS_FIELD_PROP[e.field];
        if (prop) fieldsToPush[prop] = e.localValue;
      });
      try {
        const result = await updateCmsProductFieldsAction(modelName, fieldsToPush);
        if (result.success) {
          successCount += productEntries.length;
          setEntries((prev) => prev.filter((e) => e.product !== modelName || !selected[e.key]));
        } else {
          failCount += productEntries.length;
          console.error(`[CMS Sync] Push failed for ${modelName}:`, result.error);
          failures.push({
            product: modelName,
            brand: productEntries[0].brand,
            fields: productEntries.map((e) => e.field),
            error: result.error || "Lỗi không xác định.",
          });
        }
      } catch (err) {
        failCount += productEntries.length;
        console.error(`[CMS Sync] Push failed for ${modelName}:`, err);
        failures.push({
          product: modelName,
          brand: productEntries[0].brand,
          fields: productEntries.map((e) => e.field),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    setIsPushing(false);
    setPushReport({ totalProducts: byProduct.size, successCount, failCount, failures });
    setPushErrorSearch("");
    // A dashboard report, not just a toast — a toast disappears before the
    // admin can see WHICH product failed and why, which matters here since a
    // failed push means that product's CMS record still has the old,
    // uncorrected content.
    setIsPushReportOpen(true);

    if (failCount > 0) {
      toast.warning(`Đã ghi đè ${successCount} trường lên CMS, ${failCount} trường thất bại — xem chi tiết trong báo cáo.`);
    } else {
      toast.success(`Đã ghi đè ${successCount} trường lên ${byProduct.size} sản phẩm trên CMS.`);
    }
  };

  const productOrder: string[] = [];
  const entriesByProduct = new Map<string, SyncEntry[]>();
  entries.forEach((e) => {
    if (!entriesByProduct.has(e.rowId)) {
      entriesByProduct.set(e.rowId, []);
      productOrder.push(e.rowId);
    }
    entriesByProduct.get(e.rowId)!.push(e);
  });

  // Clamped inline rather than via a setState-in-effect, so a page left out
  // of range by a shrinking result set or a page-size change self-corrects
  // on the next render instead of flashing an empty page first.
  const totalPages = pageSize === PAGER_SHOW_ALL ? 1 : Math.max(1, Math.ceil(productOrder.length / pageSize));
  const effectivePage = Math.min(page, totalPages);
  const pagedProductOrder = pageSize === PAGER_SHOW_ALL
    ? productOrder
    : productOrder.slice((effectivePage - 1) * pageSize, effectivePage * pageSize);

  const failedPushSearchResults = pushReport
    ? pushReport.failures.filter(
        (f) =>
          !pushErrorSearch ||
          f.product.toLowerCase().includes(pushErrorSearch.toLowerCase()) ||
          f.error.toLowerCase().includes(pushErrorSearch.toLowerCase())
      )
    : [];

  return (
    <>
    <Card className="border border-primary/20 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <GitCompare className="w-4 h-4 text-primary" />
            So sánh & Đồng bộ CMS
            {hasRun && (
              <>
                <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">{productOrder.length} sản phẩm khác biệt</Badge>
                <Badge variant="outline" className="text-xs px-1.5 py-0 h-5">{entries.length} trường</Badge>
                {notFoundCount > 0 && (
                  <Badge variant="outline" className="text-xs px-1.5 py-0 h-5 border-border text-muted-foreground">
                    {notFoundCount} không khớp trong CSV
                  </Badge>
                )}
              </>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <input
              ref={csvInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) handleCsvSelected(file);
              }}
            />
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-7 text-xs border-primary/30 text-primary hover:bg-primary/10"
              onClick={() => csvInputRef.current?.click()}
              disabled={isChecking || !isUnlocked}
              title={isUnlocked ? "Chọn file CSV export từ Wix CMS (collection Import1)" : "Cần chạy \"Kiểm tra AI\" và \"Sửa bằng AI\" trước"}
            >
              {isChecking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileSpreadsheet className="w-3.5 h-3.5" />}
              {isChecking ? `Đang so sánh (${progress.done}/${progress.total})` : `Tải file CSV từ Wix CMS (${totalProducts} sản phẩm local)`}
            </Button>
            {hasRun && entries.length > 0 && (
              <Button
                size="sm"
                className="gap-1.5 h-7 text-xs bg-primary hover:bg-primary/90"
                onClick={handlePushSelected}
                disabled={isPushing || selectedCount === 0}
              >
                {isPushing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
                Ghi đè lên CMS ({selectedCount})
              </Button>
            )}
            {hasRun && (
              <Button variant="ghost" size="sm" className="gap-1.5 h-7 text-xs" onClick={handleBackToCatalog}>
                <ArrowLeft className="w-3.5 h-3.5" />
                Quay lại Catalog Data
              </Button>
            )}
          </div>
        </div>
      </CardHeader>

      {!isUnlocked && (
        <CardContent>
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <Info className="w-4 h-4 shrink-0" />
            {!hasReviewed && !hasFixed
              ? "Chạy \"Kiểm tra AI\" rồi \"Sửa bằng AI\" trước để mở khoá so sánh với CMS."
              : !hasReviewed
              ? "Chạy \"Kiểm tra AI\" trước để mở khoá so sánh với CMS."
              : "Chạy \"Sửa bằng AI\" trước để mở khoá so sánh với CMS."}
          </div>
        </CardContent>
      )}

      {isUnlocked && !hasRun && !isChecking && (
        <CardContent>
          <div className="flex items-start gap-2 text-xs text-muted-foreground py-2">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              Xuất collection sản phẩm (Import1) từ Wix Content Manager sang CSV rồi tải lên đây — cần ít nhất cột{" "}
              <span className="font-medium text-foreground">Product/Model</span> để khớp sản phẩm, cùng{" "}
              <span className="font-medium text-foreground">Title</span>,{" "}
              <span className="font-medium text-foreground">Main Feature</span>,{" "}
              <span className="font-medium text-foreground">Product Overview</span> để so sánh. So sánh qua CSV không cần gọi API Wix cho từng sản phẩm nên nhanh hơn nhiều so với tra cứu trực tiếp.
            </span>
          </div>
        </CardContent>
      )}

      {isUnlocked && hasRun && (
        <CardContent className="space-y-2">
          {csvMeta && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground px-1 pb-1">
              <FileSpreadsheet className="w-3 h-3 shrink-0" />
              <span className="font-mono truncate max-w-[220px]">{csvMeta.fileName}</span>
              <span>— {csvMeta.rowCount} dòng, khớp {csvMeta.matchedColumnCount}/3 cột nội dung</span>
              {csvMeta.matchedColumnCount < 3 && (
                <Badge variant="outline" className="text-xs px-1 py-0 h-4 border-0 bg-amber-500/10 text-amber-600 dark:text-amber-400 gap-0.5">
                  <FileWarning className="w-2.5 h-2.5" /> Thiếu cột
                </Badge>
              )}
            </div>
          )}
          {pushReport && pushReport.failCount > 0 && (
            <div className="flex items-center justify-between gap-2 text-xs rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2">
              <span className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400 font-medium">
                <XCircle className="w-3.5 h-3.5 shrink-0" />
                {pushReport.failures.length} sản phẩm ghi đè CMS thất bại ở lần gần nhất — nội dung trên CMS CHƯA được cập nhật cho các sản phẩm này.
              </span>
              <Button variant="outline" size="sm" className="h-6 text-xs shrink-0 border-rose-500/30 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400" onClick={() => setIsPushReportOpen(true)}>
                Xem chi tiết
              </Button>
            </div>
          )}
          {entries.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
              <Info className="w-4 h-4 shrink-0" />
              Không có khác biệt nào giữa catalog local và CSV
              {notFoundCount > 0 && ` (${notFoundCount} sản phẩm không khớp trong CSV, không tính vào so sánh này)`}.
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground px-1">
                <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
                <span onClick={toggleAll} className="cursor-pointer hover:text-foreground">
                  {allSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"}
                </span>
              </div>

              <div className="max-h-[520px] overflow-y-auto pr-2">
                <div className="space-y-3">
                  {pagedProductOrder.map((rowId) => {
                    const productEntries = entriesByProduct.get(rowId)!;
                    const { brand, product } = productEntries[0];
                    const productSelectedCount = productEntries.filter((e) => selected[e.key]).length;
                    const productAllSelected = productSelectedCount === productEntries.length;
                    const isCollapsed = collapsedProducts[rowId];

                    return (
                      <div key={rowId} className="border rounded-lg overflow-hidden">
                        <div className="flex items-center gap-2 bg-muted/40 px-3 py-2">
                          <button onClick={() => setCollapsedProducts((p) => ({ ...p, [rowId]: !p[rowId] }))}>
                            {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>
                          <Checkbox checked={productAllSelected} onCheckedChange={(v) => toggleProduct(rowId, Boolean(v))} />
                          <span className="text-xs font-semibold">{brand} {product}</span>
                          <span className="text-xs text-muted-foreground ml-auto">{productSelectedCount}/{productEntries.length}</span>
                        </div>

                        {!isCollapsed && (
                          <div className="divide-y">
                            {productEntries.map((e) => (
                              <div key={e.key} className="flex items-start gap-3 px-3 py-2.5">
                                <Checkbox
                                  checked={Boolean(selected[e.key])}
                                  onCheckedChange={(v) => setSelected((prev) => ({ ...prev, [e.key]: Boolean(v) }))}
                                  className="mt-1"
                                />
                                <div className="flex-1 min-w-0 space-y-1">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{e.field}</span>
                                    <Badge variant="outline" className="text-xs px-1 py-0 h-4 border-0 bg-amber-500/10 text-amber-600 dark:text-amber-400">
                                      {e.status === "missing_in_cms" ? "CMS chưa có" : e.status === "missing_locally" ? "Local trống" : "Khác nhau"}
                                    </Badge>
                                    {e.wasTranslated && (
                                      <Badge variant="outline" className="text-xs px-1 py-0 h-4 border-0 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 gap-0.5">
                                        <Languages className="w-2.5 h-2.5" /> Đã dịch sang Việt
                                      </Badge>
                                    )}
                                    {e.translationFailed && (
                                      <Badge
                                        variant="outline"
                                        className="text-xs px-1 py-0 h-4 border-0 bg-amber-500/10 text-amber-600 dark:text-amber-400 gap-0.5"
                                        title="Không kết nối được dịch vụ dịch (Ollama) — đang hiển thị nguyên văn chưa dịch, khác biệt này có thể chỉ do khác ngôn ngữ chứ không phải nội dung thật sự khác."
                                      >
                                        <AlertTriangle className="w-2.5 h-2.5" /> Dịch lỗi, hiện nguyên văn
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                                    <div className="p-2 rounded bg-primary/5 border border-primary/20 break-words max-h-28 overflow-auto">
                                      <span className="text-xs text-primary block mb-0.5">CMS hiện tại</span>
                                      {e.cmsValue || <span className="italic text-muted-foreground">(trống)</span>}
                                    </div>
                                    <div className="p-2 rounded bg-emerald-500/5 border border-emerald-500/20 break-words max-h-28 overflow-auto">
                                      <span className="text-xs text-emerald-600 dark:text-emerald-400 block mb-0.5">Local (tiếng Việt, sẽ ghi đè)</span>
                                      {e.localValue || <span className="italic text-muted-foreground">(trống)</span>}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
              <Pager
                page={effectivePage}
                pageSize={pageSize}
                total={productOrder.length}
                unitLabel="sản phẩm"
                onPageChange={setPage}
                onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
              />
            </>
          )}
        </CardContent>
      )}
    </Card>

    {/* Push-to-CMS result dashboard — a toast disappears before an admin can
        see WHICH product failed and why; this stays open until dismissed and
        is re-openable from the banner above even after closing it. */}
    <Dialog open={isPushReportOpen} onOpenChange={setIsPushReportOpen}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UploadCloud className="w-5 h-5 text-primary" />
            Kết quả ghi đè lên Wix CMS
          </DialogTitle>
          <DialogDescription>
            Báo cáo chi tiết các trường/sản phẩm vừa được ghi đè lên CMS từ kết quả so sánh CSV.
          </DialogDescription>
        </DialogHeader>

        {pushReport && (
          <div className="flex-1 overflow-y-auto space-y-4 pb-2">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-primary/10 border border-primary/20 rounded-xl p-3 text-center">
                <span className="text-xs text-primary/80 font-medium block mb-1">Sản phẩm đã xử lý</span>
                <strong className="text-xl font-extrabold text-primary">{pushReport.totalProducts}</strong>
              </div>
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-center">
                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium block mb-1">Trường thành công</span>
                <strong className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400">{pushReport.successCount}</strong>
              </div>
              <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 text-center">
                <span className="text-xs text-rose-600 dark:text-rose-400 font-medium block mb-1">Trường thất bại</span>
                <strong className="text-xl font-extrabold text-rose-600 dark:text-rose-400">{pushReport.failCount}</strong>
              </div>
            </div>

            {pushReport.failures.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300 rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                Tất cả sản phẩm đã chọn được ghi đè lên CMS thành công.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                    Sản phẩm ghi đè thất bại ({pushReport.failures.length})
                  </h3>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-7 gap-1.5"
                    onClick={() => {
                      const text = pushReport.failures.map((f) => `${f.brand} ${f.product} [${f.fields.join(", ")}] - ${f.error}`).join("\n");
                      navigator.clipboard.writeText(text);
                      toast.success("Đã sao chép danh sách lỗi vào bộ nhớ tạm!");
                    }}
                  >
                    <ClipboardCopy className="w-3.5 h-3.5" />
                    Sao chép tất cả lỗi
                  </Button>
                </div>

                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Tìm theo tên sản phẩm hoặc nội dung lỗi..."
                    value={pushErrorSearch}
                    onChange={(e) => setPushErrorSearch(e.target.value)}
                    className="pl-10 text-sm"
                  />
                </div>

                <div className="max-h-[280px] overflow-y-auto border border-rose-500/10 rounded-xl bg-card text-xs divide-y divide-border">
                  {failedPushSearchResults.length === 0 ? (
                    <div className="p-4 text-center text-muted-foreground italic">Không tìm thấy lỗi nào khớp với tìm kiếm.</div>
                  ) : (
                    failedPushSearchResults.map((f, i) => (
                      <div key={i} className="p-3 hover:bg-muted/20 transition-colors flex gap-3 items-start">
                        <XCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-foreground">{f.brand} {f.product}</span>
                            {f.fields.map((field) => (
                              <Badge key={field} variant="outline" className="text-xs px-1 py-0 h-4">{field}</Badge>
                            ))}
                          </div>
                          <span className="text-muted-foreground leading-relaxed break-words">{f.error}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="mt-2 border-t pt-4">
          <Button variant="default" onClick={() => setIsPushReportOpen(false)} className="w-full sm:w-auto">
            Đóng báo cáo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
