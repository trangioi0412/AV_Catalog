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
import { Badge } from "@/components/ui/badge";
import { Loader2, AlertCircle, GitCompare, RefreshCcw } from "lucide-react";
import { compareProductWithCmsAction } from "@/app/actions/discovery";
import type { CmsCompareResult } from "@/lib/services/wixCms";
import type { ProductRow } from "@/types";
import { cn } from "@/lib/utils";

interface CmsCompareModalProps {
  open: boolean;
  onClose: () => void;
  row: ProductRow | null;
}

function getField(row: ProductRow, candidates: string[]): string {
  for (const c of candidates) {
    const key = Object.keys(row).find((k) => k.toLowerCase() === c.toLowerCase());
    if (key && row[key] != null && String(row[key]).trim() !== "") return String(row[key]);
  }
  return "";
}

const STATUS_META: Record<CmsCompareResult["diffs"][number]["status"], { label: string; className: string }> = {
  same: { label: "Trùng khớp", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
  different: { label: "Khác nhau", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  missing_in_cms: { label: "Thiếu trên CMS", className: "bg-rose-500/10 text-rose-600 dark:text-rose-400" },
  missing_locally: { label: "Thiếu ở local", className: "bg-muted text-muted-foreground dark:text-muted-foreground" },
};

export function CmsCompareModal({ open, onClose, row }: CmsCompareModalProps) {
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<CmsCompareResult | null>(null);

  const runCompare = React.useCallback(async () => {
    if (!row) return;
    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const specsText = Array.isArray(row.transformedSpecifications)
        ? JSON.stringify(row.transformedSpecifications)
        : "";
      const res = await compareProductWithCmsAction({
        Category: getField(row, ["Category"]),
        Product: getField(row, ["Product", "Model"]),
        Title: getField(row, ["Title"]),
        Series: getField(row, ["Series"]),
        MainFeature: getField(row, ["Main Feature", "MainFeature"]),
        ProductOverview: getField(row, ["Product Overview", "ProductOverview"]),
        TechnicalSpecifications: specsText,
        Brand: getField(row, ["Brand"]),
        productItem: getField(row, ["product (item)", "productItem"]),
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [row]);

  React.useEffect(() => {
    if (open && row) runCompare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id]);

  if (!row) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompare className="w-5 h-5 text-primary" />
            So sánh với CMS: {getField(row, ["Brand"])} {getField(row, ["Product", "Model"])}
          </DialogTitle>
          <DialogDescription>
            So sánh dữ liệu hiện tại (đã qua AI sửa nếu có) với bản ghi tương ứng trên Wix CMS, khớp theo tên sản phẩm/model.
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-sm">Đang tra cứu CMS...</p>
          </div>
        )}

        {!isLoading && error && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 gap-3">
            <AlertCircle className="w-8 h-8 text-destructive" />
            <p className="text-sm text-center text-muted-foreground max-w-md">{error}</p>
            <Button variant="outline" size="sm" className="gap-2" onClick={runCompare}>
              <RefreshCcw className="w-3.5 h-3.5" />
              Thử lại
            </Button>
          </div>
        )}

        {!isLoading && !error && result && !result.found && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 gap-3 text-center">
            <AlertCircle className="w-8 h-8 text-amber-500" />
            <p className="text-sm text-muted-foreground max-w-md">
              Không tìm thấy sản phẩm này trên Wix CMS (khớp theo tên sản phẩm/model). Sản phẩm này chưa được đẩy lên CMS.
            </p>
          </div>
        )}

        {!isLoading && !error && result?.found && (
          <div className="flex-1 overflow-y-auto space-y-2 pb-2">
            {result.diffs.map((diff) => {
              const meta = STATUS_META[diff.status];
              return (
                <div key={diff.field} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{diff.field}</span>
                    <Badge variant="outline" className={cn("text-xs px-1.5 py-0 h-5 border-0", meta.className)}>
                      {meta.label}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                    <div className="p-2 rounded bg-muted/40 break-words max-h-32 overflow-auto">
                      <span className="text-xs text-muted-foreground block mb-0.5">Local (catalog)</span>
                      {diff.localValue || <span className="italic text-muted-foreground">(trống)</span>}
                    </div>
                    <div className="p-2 rounded bg-primary/5 border border-primary/20 break-words max-h-32 overflow-auto">
                      <span className="text-xs text-primary block mb-0.5">CMS (Wix)</span>
                      {diff.cmsValue || <span className="italic text-muted-foreground">(trống)</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Đóng</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
