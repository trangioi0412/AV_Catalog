"use client";

import React from "react";
import { GitCompare, Loader2, UploadCloud, ChevronRight, ChevronDown, Info, Languages, ArrowLeft, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useDataStore } from "@/store/useDataStore";
import { updateCmsProductFieldsAction } from "@/app/actions/discovery";
import { toast } from "sonner";
import type { CmsSyncDiff } from "@/app/api/catalog-upload/cms-sync-check/route";
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
 * Bulk-compares the whole catalog against Wix CMS (natural-language fields
 * only — Title / Main Feature / Product Overview), normalizing whichever side
 * isn't Vietnamese before comparing (see cms-sync-check route), and lets a
 * reviewer approve pushing the Vietnamese-normalized local value to CMS. This
 * is the intended step after "Kiểm tra AI" / "Sửa bằng AI": those clean up
 * the local catalog; this syncs the result to the live CMS record.
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

  const handleRunCheck = async () => {
    if (!isUnlocked) {
      toast.error("Cần chạy \"Kiểm tra AI\" và \"Sửa bằng AI\" trước khi so sánh với CMS.");
      return;
    }

    const items: { id: string; sheetIndex: number; rowIndex: number; fields: Record<string, string> }[] = [];
    sheets.forEach((sheet, sheetIndex) => {
      sheet.rows.forEach((row, rowIndex) => {
        const product = getField(row, ["Product", "Model"]);
        if (!product) return;
        items.push({
          id: row.id,
          sheetIndex,
          rowIndex,
          fields: {
            Product: product,
            Category: getField(row, ["Category"]),
            Title: getField(row, ["Title"]),
            Series: getField(row, ["Series"]),
            MainFeature: getField(row, ["Main Feature", "MainFeature"]),
            ProductOverview: getField(row, ["Product Overview", "ProductOverview"]),
            Brand: getField(row, ["Brand"]),
          },
        });
      });
    });

    if (items.length === 0) {
      toast.error("Không có sản phẩm nào có tên/model để tra cứu CMS.");
      return;
    }

    setIsChecking(true);
    setHasRun(false);
    setProgress({ done: 0, total: items.length });
    setEntries([]);
    setNotFoundCount(0);

    const batchSize = 10;
    const newEntries: SyncEntry[] = [];
    let notFound = 0;
    let failedBatches = 0;

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      try {
        const res = await fetch("/api/catalog-upload/cms-sync-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: batch.map((b) => ({ id: b.id, fields: b.fields })) }),
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
                brand: item.fields.Brand,
                product: item.fields.Product,
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
        }
      } catch (err) {
        failCount += productEntries.length;
        console.error(`[CMS Sync] Push failed for ${modelName}:`, err);
      }
    }

    setIsPushing(false);
    if (failCount > 0) {
      toast.warning(`Đã ghi đè ${successCount} trường lên CMS, ${failCount} trường thất bại.`);
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

  return (
    <Card className="border border-blue-500/20 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <GitCompare className="w-4 h-4 text-blue-500" />
            So sánh & Đồng bộ CMS
            {hasRun && (
              <>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5">{productOrder.length} sản phẩm khác biệt</Badge>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5">{entries.length} trường</Badge>
                {notFoundCount > 0 && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 border-slate-400/30 text-muted-foreground">
                    {notFoundCount} chưa có trên CMS
                  </Badge>
                )}
              </>
            )}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-7 text-xs border-blue-500/30 text-blue-600 hover:bg-blue-500/10 dark:text-blue-400"
              onClick={handleRunCheck}
              disabled={isChecking || !isUnlocked}
              title={isUnlocked ? undefined : "Cần chạy \"Kiểm tra AI\" và \"Sửa bằng AI\" trước"}
            >
              {isChecking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitCompare className="w-3.5 h-3.5" />}
              {isChecking ? `Đang so sánh (${progress.done}/${progress.total})` : `So sánh toàn bộ với CMS (${totalProducts})`}
            </Button>
            {hasRun && entries.length > 0 && (
              <Button
                size="sm"
                className="gap-1.5 h-7 text-xs bg-blue-600 hover:bg-blue-700"
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

      {isUnlocked && hasRun && (
        <CardContent className="space-y-2">
          {entries.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
              <Info className="w-4 h-4 shrink-0" />
              Không có khác biệt nào giữa catalog local và CMS
              {notFoundCount > 0 && ` (${notFoundCount} sản phẩm chưa có trên CMS, không tính vào so sánh này)`}.
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
                          <span className="text-[10px] text-muted-foreground ml-auto">{productSelectedCount}/{productEntries.length}</span>
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
                                    <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{e.field}</span>
                                    <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-0 bg-amber-500/10 text-amber-600 dark:text-amber-400">
                                      {e.status === "missing_in_cms" ? "CMS chưa có" : e.status === "missing_locally" ? "Local trống" : "Khác nhau"}
                                    </Badge>
                                    {e.wasTranslated && (
                                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-0 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 gap-0.5">
                                        <Languages className="w-2.5 h-2.5" /> Đã dịch sang Việt
                                      </Badge>
                                    )}
                                    {e.translationFailed && (
                                      <Badge
                                        variant="outline"
                                        className="text-[9px] px-1 py-0 h-4 border-0 bg-amber-500/10 text-amber-600 dark:text-amber-400 gap-0.5"
                                        title="Không kết nối được dịch vụ dịch (Ollama) — đang hiển thị nguyên văn chưa dịch, khác biệt này có thể chỉ do khác ngôn ngữ chứ không phải nội dung thật sự khác."
                                      >
                                        <AlertTriangle className="w-2.5 h-2.5" /> Dịch lỗi, hiện nguyên văn
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                                    <div className="p-2 rounded bg-blue-500/5 border border-blue-500/20 break-words max-h-28 overflow-auto">
                                      <span className="text-[9px] text-blue-600 dark:text-blue-400 block mb-0.5">CMS hiện tại</span>
                                      {e.cmsValue || <span className="italic text-muted-foreground">(trống)</span>}
                                    </div>
                                    <div className="p-2 rounded bg-emerald-500/5 border border-emerald-500/20 break-words max-h-28 overflow-auto">
                                      <span className="text-[9px] text-emerald-600 dark:text-emerald-400 block mb-0.5">Local (tiếng Việt, sẽ ghi đè)</span>
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
  );
}
