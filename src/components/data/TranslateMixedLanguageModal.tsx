"use client";

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle, Languages, RefreshCcw, UploadCloud, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { compareProductWithCmsAction, updateCmsProductFieldsAction } from "@/app/actions/discovery";
import type { CmsFieldDiff } from "@/lib/services/wixCms";
import type { ProductRow } from "@/types";

/** Maps a TRANSLATE_FIELDS label to the property name compareProductWithCms/updateCmsProductFields expect. */
const CMS_FIELD_PROP: Record<string, "Title" | "MainFeature" | "ProductOverview"> = {
  Title: "Title",
  "Main Feature": "MainFeature",
  "Product Overview": "ProductOverview",
};

interface TranslateMixedLanguageModalProps {
  open: boolean;
  onClose: () => void;
  row: ProductRow | null;
  columns: string[];
  onApply: (updates: Partial<ProductRow>, fieldChanges: { field: string; oldValue: string; newValue: string }[]) => void;
}

interface FieldDef {
  label: string;
  columnCandidates: string[];
}

const TRANSLATE_FIELDS: FieldDef[] = [
  { label: "Title", columnCandidates: ["Title"] },
  { label: "Main Feature", columnCandidates: ["Main Feature", "MainFeature"] },
  { label: "Product Overview", columnCandidates: ["Product Overview", "ProductOverview"] },
];

function resolveColumnKey(columns: string[], candidates: string[]): string {
  const normalize = (s: string) => s.toLowerCase().replace(/[\s_]/g, "");
  for (const candidate of candidates) {
    const match = columns.find((c) => normalize(c) === normalize(candidate));
    if (match) return match;
  }
  return candidates[0];
}

function getField(row: ProductRow, candidates: string[]): string {
  for (const c of candidates) {
    const key = Object.keys(row).find((k) => k.toLowerCase() === c.toLowerCase());
    if (key && row[key] != null && String(row[key]).trim() !== "") return String(row[key]);
  }
  return "";
}

export function TranslateMixedLanguageModal({ open, onClose, row, columns, onApply }: TranslateMixedLanguageModalProps) {
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [translated, setTranslated] = React.useState<Record<string, string> | null>(null);
  const [selected, setSelected] = React.useState<Record<string, boolean>>({});
  // CMS diff computed against the NEW translated values (not the current
  // mixed-language local values) — undefined = not checked yet, null = no
  // matching CMS record found.
  const [cmsDiffs, setCmsDiffs] = React.useState<CmsFieldDiff[] | null | undefined>(undefined);
  const [cmsSelected, setCmsSelected] = React.useState<Record<string, boolean>>({});
  const [isPushingToCms, setIsPushingToCms] = React.useState(false);

  const runTranslate = React.useCallback(async () => {
    if (!row) return;
    setIsLoading(true);
    setError(null);
    setTranslated(null);
    setCmsDiffs(undefined);
    setCmsSelected({});

    const fieldsToTranslate: Record<string, string> = {};
    TRANSLATE_FIELDS.forEach((f) => {
      const val = getField(row, f.columnCandidates);
      if (val) fieldsToTranslate[f.label] = val;
    });

    if (Object.keys(fieldsToTranslate).length === 0) {
      setIsLoading(false);
      setError("Sản phẩm này không có nội dung ở Title/Main Feature/Product Overview để dịch.");
      return;
    }

    try {
      const res = await fetch("/api/catalog-upload/translate-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: fieldsToTranslate,
          brand: getField(row, ["Brand"]) || undefined,
          category: getField(row, ["Category"]) || undefined,
          productName: getField(row, ["Product", "Model"]) || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || `Request failed (${res.status})`);
      }
      const result = json.fields as Record<string, string>;
      setTranslated(result);
      const defaults: Record<string, boolean> = {};
      TRANSLATE_FIELDS.forEach((f) => {
        const newVal = result[f.label];
        defaults[f.label] = Boolean(newVal) && newVal !== getField(row, f.columnCandidates);
      });
      setSelected(defaults);

      // Compare the NEW translated values against what's currently on Wix CMS
      // (not the old mixed-language local values) — so a reviewer sees "does
      // this translation also need to go to CMS" right away, not as a
      // separate manual step.
      const modelName = getField(row, ["Product", "Model"]);
      if (modelName) {
        const cmsResult = await compareProductWithCmsAction({
          Product: modelName,
          Category: getField(row, ["Category"]) || undefined,
          Brand: getField(row, ["Brand"]) || undefined,
          Title: result["Title"] ?? getField(row, ["Title"]),
          MainFeature: result["Main Feature"] ?? getField(row, ["Main Feature", "MainFeature"]),
          ProductOverview: result["Product Overview"] ?? getField(row, ["Product Overview", "ProductOverview"]),
        });
        if (cmsResult.found) {
          const relevantDiffs = cmsResult.diffs.filter(
            (d) => ["Title", "Main Feature", "Product Overview"].includes(d.field) && d.status !== "same"
          );
          setCmsDiffs(relevantDiffs);
          const cmsDefaults: Record<string, boolean> = {};
          relevantDiffs.forEach((d) => { cmsDefaults[d.field] = true; });
          setCmsSelected(cmsDefaults);
        } else {
          setCmsDiffs(null);
        }
      } else {
        setCmsDiffs(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [row]);

  React.useEffect(() => {
    if (open && row) runTranslate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id]);

  if (!row) return null;

  const handleApply = () => {
    if (!translated) return;
    const updates: Partial<ProductRow> = {};
    const fieldChanges: { field: string; oldValue: string; newValue: string }[] = [];

    TRANSLATE_FIELDS.forEach((f) => {
      if (!selected[f.label]) return;
      const newVal = translated[f.label];
      if (newVal === undefined) return;
      const columnKey = resolveColumnKey(columns, f.columnCandidates);
      updates[columnKey] = newVal;
      fieldChanges.push({ field: f.label, oldValue: getField(row, f.columnCandidates), newValue: newVal });
    });

    if (fieldChanges.length === 0) {
      toast.error("Chưa chọn trường nào để áp dụng.");
      return;
    }

    onApply(updates, fieldChanges);
    toast.success(`Đã áp dụng bản dịch cho ${fieldChanges.length} trường.`);
    onClose();
  };

  const handlePushToCms = async () => {
    if (!cmsDiffs) return;
    const modelName = getField(row, ["Product", "Model"]);
    if (!modelName || !translated) return;

    const fieldsToPush: Partial<Record<"Title" | "MainFeature" | "ProductOverview", string>> = {};
    cmsDiffs.forEach((d) => {
      if (!cmsSelected[d.field]) return;
      const prop = CMS_FIELD_PROP[d.field];
      const newVal = translated[d.field];
      if (prop && newVal !== undefined) fieldsToPush[prop] = newVal;
    });

    if (Object.keys(fieldsToPush).length === 0) {
      toast.error("Chưa chọn trường nào để ghi đè lên CMS.");
      return;
    }

    setIsPushingToCms(true);
    try {
      const result = await updateCmsProductFieldsAction(modelName, fieldsToPush);
      if (result.success) {
        toast.success(`Đã ghi đè ${Object.keys(fieldsToPush).length} trường lên CMS cho "${modelName}".`);
        // Reflect the push so the section doesn't keep offering already-pushed fields.
        setCmsDiffs((prev) => (prev ? prev.filter((d) => !cmsSelected[d.field]) : prev));
      } else {
        toast.error(`Ghi CMS thất bại: ${result.error || "Lỗi không xác định"}`);
      }
    } catch (err) {
      toast.error(`Ghi CMS thất bại: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsPushingToCms(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Languages className="w-5 h-5 text-cyan-500" />
            Dịch đồng nhất tiếng Việt: {getField(row, ["Brand"])} {getField(row, ["Product", "Model"])}
          </DialogTitle>
          <DialogDescription>
            Dịch lại Title / Main Feature / Product Overview sang tiếng Việt nhất quán bằng AI, cho nội dung đang bị lẫn cả tiếng Anh và tiếng Việt.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
            <p className="text-sm">Đang dịch...</p>
          </div>
        )}

        {!isLoading && error && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 gap-3">
            <AlertCircle className="w-8 h-8 text-destructive" />
            <p className="text-sm text-center text-muted-foreground max-w-md">{error}</p>
            <Button variant="outline" size="sm" className="gap-2" onClick={runTranslate}>
              <RefreshCcw className="w-3.5 h-3.5" />
              Thử lại
            </Button>
          </div>
        )}

        {!isLoading && !error && translated && (
          <div className="flex-1 overflow-y-auto space-y-4 pb-2">
            {TRANSLATE_FIELDS.map((f) => {
              const currentVal = getField(row, f.columnCandidates);
              const newVal = translated[f.label];
              const isDifferent = newVal !== undefined && newVal !== currentVal;
              if (!isDifferent) return null;
              return (
                <div key={f.label} className="border rounded-lg p-3">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={Boolean(selected[f.label])}
                      onCheckedChange={(v) => setSelected((prev) => ({ ...prev, [f.label]: Boolean(v) }))}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{f.label}</span>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                        <div className="p-2 rounded bg-muted/40 break-words">
                          <span className="text-xs text-muted-foreground block mb-0.5">Hiện tại (lẫn ngôn ngữ)</span>
                          {currentVal}
                        </div>
                        <div className="p-2 rounded bg-cyan-500/5 border border-cyan-500/20 break-words">
                          <span className="text-xs text-cyan-600 dark:text-cyan-400 block mb-0.5">Bản dịch AI</span>
                          {newVal}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {TRANSLATE_FIELDS.every((f) => translated[f.label] === getField(row, f.columnCandidates)) && (
              <p className="text-sm text-muted-foreground text-center py-8">Bản dịch AI trùng với nội dung hiện tại — không có gì để áp dụng.</p>
            )}

            {cmsDiffs === null && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground p-3 rounded-lg bg-muted/20 border border-dashed">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                Không tìm thấy sản phẩm này trên Wix CMS (khớp theo tên sản phẩm/model) — chỉ có thể áp dụng bản dịch vào catalog local.
              </div>
            )}

            {Array.isArray(cmsDiffs) && cmsDiffs.length > 0 && (
              <div className="border rounded-lg p-3 bg-primary/5 border-primary/20 space-y-2">
                <div className="flex items-center gap-2">
                  <UploadCloud className="w-4 h-4 text-primary" />
                  <span className="text-xs font-semibold uppercase tracking-wide text-primary">
                    Bản dịch khác với CMS hiện tại ({cmsDiffs.length})
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">Đề xuất ghi đè các trường sau lên Wix CMS cho khớp với bản dịch mới:</p>
                {cmsDiffs.map((d) => (
                  <div key={d.field} className="flex items-start gap-3 bg-background/60 rounded p-2">
                    <Checkbox
                      checked={Boolean(cmsSelected[d.field])}
                      onCheckedChange={(v) => setCmsSelected((prev) => ({ ...prev, [d.field]: Boolean(v) }))}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{d.field}</span>
                        <Badge variant="outline" className="text-xs px-1 py-0 h-4 border-0 bg-amber-500/10 text-amber-600 dark:text-amber-400">
                          {d.status === "missing_in_cms" ? "CMS chưa có" : "Khác CMS"}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground break-words">
                        <span className="opacity-70">CMS hiện tại:</span> {d.cmsValue || <span className="italic">(trống)</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {Array.isArray(cmsDiffs) && cmsDiffs.length === 0 && (
              <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                Bản dịch đã khớp với nội dung hiện có trên CMS — không cần ghi đè.
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={onClose}>Huỷ</Button>
          {Array.isArray(cmsDiffs) && cmsDiffs.length > 0 && (
            <Button
              variant="outline"
              onClick={handlePushToCms}
              disabled={isPushingToCms}
              className="gap-2 border-primary/30 text-primary hover:bg-primary/10"
            >
              {isPushingToCms ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
              Ghi đè lên CMS
            </Button>
          )}
          <Button onClick={handleApply} disabled={isLoading || !!error || !translated} className="gap-2">
            <Languages className="w-4 h-4" />
            Áp dụng bản dịch đã chọn
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
