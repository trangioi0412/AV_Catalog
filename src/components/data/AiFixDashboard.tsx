"use client";

import React from "react";
import { Bot, Wrench, Download, ChevronRight, ChevronDown, Info, History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useDataStore } from "@/store/useDataStore";
import { collectPendingAiFixChanges, buildUpdatesFromChanges } from "@/lib/utils/aiFixUtils";
import { exportAiFixSuggestionsToExcel, exportAiFixesToExcel } from "@/lib/utils/exportUtils";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Pager, PAGER_SHOW_ALL, PAGER_PAGE_SIZE_OPTIONS } from "./Pager";

interface AppliedFixEntry {
  key: string;
  rowId: string;
  brand: string;
  product: string;
  field: string;
  oldValue: string;
  newValue: string;
  engine: string;
  appliedAt: number;
}

/**
 * The review/approval workspace for AI Fix suggestions ("Sửa bằng AI
 * (qwen3.5:9b)" or Gemini): shows every pending change AI proposed, before vs
 * after, grouped by product, with a checkbox per field so a reviewer can
 * approve only what they trust before it touches the catalog. Nothing here
 * writes to the catalog until "Áp dụng đã chọn" is clicked.
 */
export function AiFixDashboard() {
  const { sheets, fileName, applyAiFix } = useDataStore();
  const [selected, setSelected] = React.useState<Record<string, boolean>>({});
  const [collapsedProducts, setCollapsedProducts] = React.useState<Record<string, boolean>>({});
  const [view, setView] = React.useState<"pending" | "applied">("pending");
  const [pendingPage, setPendingPage] = React.useState(1);
  const [pendingPageSize, setPendingPageSize] = React.useState<number>(PAGER_PAGE_SIZE_OPTIONS[0]);
  const [appliedPage, setAppliedPage] = React.useState(1);
  const [appliedPageSize, setAppliedPageSize] = React.useState<number>(PAGER_PAGE_SIZE_OPTIONS[0]);

  const { changes, declinedCount, productCount } = React.useMemo(() => collectPendingAiFixChanges(sheets), [sheets]);

  // Every AI Fix change actually applied so far (see applyAiFix in useDataStore.ts),
  // regardless of whether it's still pending review elsewhere — this is the
  // complete "what has AI changed" history, viewable even after a suggestion
  // that produced it is long gone (e.g. after "Kiểm tra AI" is re-run).
  const appliedFixes: AppliedFixEntry[] = React.useMemo(() => {
    const entries: AppliedFixEntry[] = [];
    sheets.forEach((sheet) => {
      sheet.rows.forEach((row) => {
        (row.aiAppliedFixes || []).forEach((fix, i) => {
          entries.push({
            key: `${row.id}::${fix.field}::${i}`,
            rowId: row.id,
            brand: String(row.Brand ?? row.brand ?? ""),
            product: String(row.Product ?? row.product ?? ""),
            field: fix.field,
            oldValue: fix.oldValue,
            newValue: fix.newValue,
            engine: fix.engine,
            appliedAt: fix.appliedAt,
          });
        });
      });
    });
    return entries.sort((a, b) => b.appliedAt - a.appliedAt);
  }, [sheets]);
  const appliedProductCount = new Set(appliedFixes.map((f) => f.rowId)).size;

  if (sheets.every((s) => s.rows.every((r) => !r.aiFixSuggestion)) && appliedFixes.length === 0) return null;

  // A change with no entry in `selected` yet (e.g. one from a suggestion
  // batch that just arrived) defaults to approved — read this way instead of
  // syncing defaults into state via an effect, so a fresh batch shows up
  // pre-selected on the very first render without an extra render pass.
  const isSelected = (key: string) => selected[key] ?? true;

  const selectedCount = changes.filter((c) => isSelected(c.key)).length;
  const allSelected = changes.length > 0 && selectedCount === changes.length;

  const toggleAll = () => {
    const next: Record<string, boolean> = {};
    changes.forEach((c) => { next[c.key] = !allSelected; });
    setSelected(next);
  };

  const toggleProduct = (rowId: string, value: boolean) => {
    const next = { ...selected };
    changes.filter((c) => c.rowId === rowId).forEach((c) => { next[c.key] = value; });
    setSelected(next);
  };

  const handleApplySelected = () => {
    const selectedChanges = changes.filter((c) => isSelected(c.key));
    if (selectedChanges.length === 0) {
      toast.error("Chưa chọn thay đổi nào để áp dụng.");
      return;
    }

    const byRow = new Map<string, typeof selectedChanges>();
    selectedChanges.forEach((c) => {
      const groupKey = `${c.sheetIndex}::${c.rowIndex}`;
      if (!byRow.has(groupKey)) byRow.set(groupKey, []);
      byRow.get(groupKey)!.push(c);
    });

    byRow.forEach((rowChanges) => {
      const { sheetIndex, rowIndex, engine } = rowChanges[0];
      const updates = buildUpdatesFromChanges(rowChanges);
      const fieldChanges = rowChanges.map((c) => ({ field: c.field, oldValue: c.oldValue, newValue: c.newValue }));
      applyAiFix(sheetIndex, rowIndex, updates, fieldChanges, engine);
    });

    toast.success(`Đã áp dụng ${selectedChanges.length} thay đổi trên ${byRow.size} sản phẩm.`);
  };

  const handleExport = async () => {
    const success = await exportAiFixSuggestionsToExcel(sheets, fileName || "catalog");
    if (success) {
      toast.success("Đã xuất file đề xuất AI!");
    } else {
      toast.error("Chưa có đề xuất AI nào để xuất.");
    }
  };

  const handleExportApplied = async () => {
    const success = await exportAiFixesToExcel(sheets, fileName || "catalog");
    if (success) {
      toast.success("Đã xuất báo cáo AI đã sửa!");
    } else {
      toast.error("Chưa có thay đổi nào được áp dụng để xuất.");
    }
  };

  // Group changes by product in encounter order for display.
  const productOrder: string[] = [];
  const changesByProduct = new Map<string, typeof changes>();
  changes.forEach((c) => {
    if (!changesByProduct.has(c.rowId)) {
      changesByProduct.set(c.rowId, []);
      productOrder.push(c.rowId);
    }
    changesByProduct.get(c.rowId)!.push(c);
  });

  // Clamped inline (not via a setState-in-effect) so a page that's now out of
  // range — e.g. after applying changes shrinks the list, or after switching
  // page size — self-corrects on the very next render instead of flashing an
  // empty page first.
  const pendingTotalPages = pendingPageSize === PAGER_SHOW_ALL ? 1 : Math.max(1, Math.ceil(productOrder.length / pendingPageSize));
  const effectivePendingPage = Math.min(pendingPage, pendingTotalPages);
  const pagedProductOrder = pendingPageSize === PAGER_SHOW_ALL
    ? productOrder
    : productOrder.slice((effectivePendingPage - 1) * pendingPageSize, effectivePendingPage * pendingPageSize);

  const appliedTotalPages = appliedPageSize === PAGER_SHOW_ALL ? 1 : Math.max(1, Math.ceil(appliedFixes.length / appliedPageSize));
  const effectiveAppliedPage = Math.min(appliedPage, appliedTotalPages);
  const pagedAppliedFixes = appliedPageSize === PAGER_SHOW_ALL
    ? appliedFixes
    : appliedFixes.slice((effectiveAppliedPage - 1) * appliedPageSize, effectiveAppliedPage * appliedPageSize);

  return (
    <Card className="border border-highlight/20 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Bot className="w-4 h-4 text-highlight" />
            AI Fix
          </CardTitle>
          <div className="flex items-center gap-2">
            {view === "pending" ? (
              <>
                <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={handleExport}>
                  <Download className="w-3.5 h-3.5" />
                  Xuất Excel
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5 h-7 text-xs bg-highlight hover:bg-highlight/90 text-highlight-foreground"
                  onClick={handleApplySelected}
                  disabled={selectedCount === 0}
                >
                  <Wrench className="w-3.5 h-3.5" />
                  Áp dụng đã chọn ({selectedCount})
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" className="gap-1.5 h-7 text-xs" onClick={handleExportApplied}>
                <Download className="w-3.5 h-3.5" />
                Xuất Excel
              </Button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 mt-2 p-1 bg-muted/40 rounded-lg w-fit">
          <button
            onClick={() => setView("pending")}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
              view === "pending" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Wrench className="w-3 h-3" />
            Đang chờ duyệt
            <Badge variant="outline" className="text-xs px-1 py-0 h-4">{productCount}</Badge>
          </button>
          <button
            onClick={() => setView("applied")}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
              view === "applied" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
            )}
          >
            <History className="w-3 h-3" />
            Đã áp dụng
            <Badge variant="outline" className="text-xs px-1 py-0 h-4">{appliedProductCount}</Badge>
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {view === "applied" ? (
          appliedFixes.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
              <Info className="w-4 h-4 shrink-0" />
              Chưa có thay đổi nào được áp dụng.
            </div>
          ) : (
            <>
              <div className="max-h-[520px] overflow-y-auto pr-2">
                <div className="space-y-2">
                  {pagedAppliedFixes.map((f) => (
                    <div key={f.key} className="border rounded-lg p-2.5">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs font-semibold">{f.brand} {f.product}</span>
                        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{f.field}</span>
                        <Badge variant="outline" className="text-xs px-1.5 py-0 h-4">
                          {f.engine === "gemini" ? "Gemini" : f.engine === "translation" ? "Dịch AI" : "qwen3.5:9b"}
                        </Badge>
                        <span className="text-xs text-muted-foreground ml-auto">{new Date(f.appliedAt).toLocaleString("vi-VN")}</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                        <div className="p-2 rounded bg-muted/40 break-words max-h-28 overflow-auto">
                          <span className="text-xs text-muted-foreground block mb-0.5">Trước</span>
                          {f.oldValue || <span className="italic text-muted-foreground">(trống)</span>}
                        </div>
                        <div className="p-2 rounded bg-emerald-500/5 border border-emerald-500/20 break-words max-h-28 overflow-auto">
                          <span className="text-xs text-emerald-600 dark:text-emerald-400 block mb-0.5">Sau</span>
                          {f.newValue || <span className="italic text-muted-foreground">(đã xoá)</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <Pager
                page={effectiveAppliedPage}
                pageSize={appliedPageSize}
                total={appliedFixes.length}
                unitLabel="thay đổi"
                onPageChange={setAppliedPage}
                onPageSizeChange={(size) => { setAppliedPageSize(size); setAppliedPage(1); }}
              />
            </>
          )
        ) : changes.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
            <Info className="w-4 h-4 shrink-0" />
            AI không đề xuất sửa trường nào đủ chắc chắn cho {declinedCount} sản phẩm đã quét — dữ liệu quá thiếu/rác để AI tự sửa mà không bịa thêm thông tin. Cân nhắc dùng &quot;AI Sửa&quot; tra cứu qua Gemini cho từng sản phẩm, hoặc sửa thủ công.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground px-1">
              <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
              <span
                onClick={toggleAll}
                className="cursor-pointer hover:text-foreground"
              >
                {allSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"}
              </span>
              {declinedCount > 0 && (
                <span className="text-muted-foreground ml-2">({declinedCount} sản phẩm AI không sửa được gì)</span>
              )}
            </div>

            <div className="max-h-[520px] overflow-y-auto pr-2">
              <div className="space-y-3">
                {pagedProductOrder.map((rowId) => {
                  const productChanges = changesByProduct.get(rowId)!;
                  const { brand, product, engine } = productChanges[0];
                  const productSelectedCount = productChanges.filter((c) => isSelected(c.key)).length;
                  const productAllSelected = productSelectedCount === productChanges.length;
                  const isCollapsed = collapsedProducts[rowId];

                  return (
                    <div key={rowId} className="border rounded-lg overflow-hidden">
                      <div className="flex items-center gap-2 bg-muted/40 px-3 py-2">
                        <button onClick={() => setCollapsedProducts((p) => ({ ...p, [rowId]: !p[rowId] }))}>
                          {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                        <Checkbox
                          checked={productAllSelected}
                          onCheckedChange={(v) => toggleProduct(rowId, Boolean(v))}
                        />
                        <span className="text-xs font-semibold">{brand} {product}</span>
                        <Badge variant="outline" className="text-xs px-1.5 py-0 h-4 ml-auto">
                          {engine === "gemini" ? "Gemini" : "qwen3.5:9b"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{productSelectedCount}/{productChanges.length}</span>
                      </div>

                      {!isCollapsed && (
                        <div className="divide-y">
                          {productChanges.map((c) => (
                            <div key={c.key} className="flex items-start gap-3 px-3 py-2.5">
                              <Checkbox
                                checked={isSelected(c.key)}
                                onCheckedChange={(v) => setSelected((prev) => ({ ...prev, [c.key]: Boolean(v) }))}
                                className="mt-1"
                              />
                              <div className="flex-1 min-w-0 space-y-1">
                                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{c.field}</span>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                                  <div className="p-2 rounded bg-muted/40 break-words max-h-28 overflow-auto">
                                    <span className="text-xs text-muted-foreground block mb-0.5">Trước</span>
                                    {c.oldValue || <span className="italic text-muted-foreground">(trống)</span>}
                                  </div>
                                  <div className="p-2 rounded bg-highlight/5 border border-highlight/20 break-words max-h-28 overflow-auto">
                                    <span className="text-xs text-highlight block mb-0.5">Sau (AI đề xuất)</span>
                                    {c.newValue || <span className="italic text-muted-foreground">(xoá)</span>}
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
              page={effectivePendingPage}
              pageSize={pendingPageSize}
              total={productOrder.length}
              unitLabel="sản phẩm"
              onPageChange={setPendingPage}
              onPageSizeChange={(size) => { setPendingPageSize(size); setPendingPage(1); }}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
