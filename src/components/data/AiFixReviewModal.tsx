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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, ExternalLink, AlertCircle, Bot, RefreshCcw, Search } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getFieldValue, computeAiFixChanges, buildUpdatesFromChanges, type AiFixFieldChange } from "@/lib/utils/aiFixUtils";
import type { AiFixSuggestion, ProductRow } from "@/types";

interface AiFixReviewModalProps {
  open: boolean;
  onClose: () => void;
  row: ProductRow | null;
  columns: string[];
  onApply: (
    updates: Partial<ProductRow>,
    fieldChanges: { field: string; oldValue: string; newValue: string }[],
    engine: AiFixSuggestion["engine"]
  ) => void;
}

const getField = getFieldValue;

export function AiFixReviewModal({ open, onClose, row, columns, onApply }: AiFixReviewModalProps) {
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [suggestion, setSuggestion] = React.useState<AiFixSuggestion | null>(null);
  const [selected, setSelected] = React.useState<Record<string, boolean>>({});

  const applySuggestion = React.useCallback((result: AiFixSuggestion, sourceRow: ProductRow) => {
    setSuggestion(result);
    // Default every genuinely-differing field to checked (select all).
    const defaults: Record<string, boolean> = {};
    computeAiFixChanges(sourceRow, result, columns).forEach((c) => {
      defaults[c.field] = true;
    });
    setSelected(defaults);
  }, [columns]);

  const runGeminiFetch = React.useCallback(async () => {
    if (!row) return;
    setIsLoading(true);
    setError(null);
    setSuggestion(null);

    const brand = getField(row, ["Brand"]);
    const product = getField(row, ["Product", "Model"]);
    const title = getField(row, ["Title"]);
    const category = getField(row, ["Category"]);

    if (!brand || !product) {
      setIsLoading(false);
      setError("Sản phẩm này thiếu Brand hoặc Product/Model nên AI không thể tra cứu chính xác.");
      return;
    }

    try {
      const res = await fetch("/api/catalog-upload/ai-fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brand, product, title: title || undefined, category: category || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || `Request failed (${res.status})`);
      }
      applySuggestion(json.suggestion as AiFixSuggestion, row);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [row, applySuggestion]);

  // If the bulk "Sửa bằng AI (qwen3.5:9b)" run already produced a suggestion for
  // this row, show it immediately — no need to wait on a live fetch. Only fall
  // back to an on-demand Gemini lookup when there's nothing pre-computed yet.
  React.useEffect(() => {
    if (!open || !row) return;
    setError(null);
    if (row.aiFixSuggestion) {
      applySuggestion(row.aiFixSuggestion, row);
    } else {
      runGeminiFetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id]);

  if (!row) return null;

  const changes: AiFixFieldChange[] = suggestion ? computeAiFixChanges(row, suggestion, columns) : [];
  const textChanges = changes.filter((c) => !c.isSpecs);
  const specsChange = changes.find((c) => c.isSpecs);
  const currentSpecs = Array.isArray(row.transformedSpecifications) ? row.transformedSpecifications : [];
  const suggestedSpecs = specsChange?.specsArray || currentSpecs;

  const handleApply = () => {
    if (!suggestion) return;
    const selectedChanges = changes.filter((c) => selected[c.field]);

    if (selectedChanges.length === 0) {
      toast.error("Chưa chọn trường nào để áp dụng.");
      return;
    }

    const updates = buildUpdatesFromChanges(selectedChanges);
    const fieldChanges = selectedChanges.map((c) => ({ field: c.field, oldValue: c.oldValue, newValue: c.newValue }));
    onApply(updates, fieldChanges, suggestion.engine);
    toast.success(`Đã áp dụng ${fieldChanges.length} thay đổi từ AI.`);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <Bot className="w-5 h-5 text-highlight" />
            AI Sửa sản phẩm: {getField(row, ["Brand"])} {getField(row, ["Product", "Model"])}
            {suggestion && (
              <span className={cn(
                "text-xs px-2 py-0.5 rounded-full font-medium normal-case",
                suggestion.engine === "gemini" ? "bg-primary/10 text-primary" : "bg-highlight/10 text-highlight"
              )}>
                {suggestion.engine === "gemini" ? "Gemini · có nguồn Google Search" : "qwen3.5:9b · cục bộ, không có Internet"}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {suggestion?.engine === "ollama"
              ? "Đề xuất từ mô hình AI cục bộ (qwen3.5:9b) — mô hình KHÔNG có Internet nên chỉ chuẩn hoá/sửa dựa trên dữ liệu đã có, không tự bịa thông số. Có thể tra cứu qua Gemini để xác thực bằng nguồn thật."
              : `AI tra cứu thông tin thực tế từ website hãng (${getField(row, ["Brand"]) || "?"}) qua Google Search để đề xuất chỉnh sửa. Kiểm tra kỹ nguồn dữ liệu bên dưới trước khi áp dụng.`}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin text-highlight" />
            <p className="text-sm">Đang tra cứu thông tin chính xác từ hãng...</p>
          </div>
        )}

        {!isLoading && error && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 gap-3">
            <AlertCircle className="w-8 h-8 text-destructive" />
            <p className="text-sm text-center text-muted-foreground max-w-md">{error}</p>
            <Button variant="outline" size="sm" className="gap-2" onClick={runGeminiFetch}>
              <RefreshCcw className="w-3.5 h-3.5" />
              Thử lại
            </Button>
          </div>
        )}

        {!isLoading && !error && suggestion && (
          <ScrollArea className="flex-1 -mx-6 px-6">
            <div className="space-y-4 pb-2">
              {textChanges.map((c) => (
                <div key={c.field} className="border rounded-lg p-3">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={Boolean(selected[c.field])}
                      onCheckedChange={(v) => setSelected((prev) => ({ ...prev, [c.field]: Boolean(v) }))}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{c.field}</span>
                        <span className="text-xs px-1.5 py-0 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium">
                          Khác dữ liệu hiện tại
                        </span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                        <div className="p-2 rounded bg-muted/40 break-words">
                          <span className="text-xs text-muted-foreground block mb-0.5">Hiện tại</span>
                          {c.oldValue || <span className="italic text-muted-foreground">(trống)</span>}
                        </div>
                        <div className="p-2 rounded bg-highlight/5 border border-highlight/20 break-words">
                          <span className="text-xs text-highlight block mb-0.5">AI đề xuất</span>
                          {c.newValue || <span className="italic text-muted-foreground">(xoá — không đủ dữ liệu để thay thế)</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {specsChange && (
                <div className="border rounded-lg p-3">
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={Boolean(selected["Technical Specifications"])}
                      onCheckedChange={(v) => setSelected((prev) => ({ ...prev, "Technical Specifications": Boolean(v) }))}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Technical Specifications</span>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                        <div className="p-2 rounded bg-muted/40 max-h-48 overflow-auto space-y-1">
                          <span className="text-xs text-muted-foreground block mb-0.5">Hiện tại ({currentSpecs.length})</span>
                          {currentSpecs.length === 0 && <span className="italic text-muted-foreground">(trống)</span>}
                          {currentSpecs.map((s, i) => (
                            <div key={i}><span className="font-medium">{s.label}:</span> {s.value}</div>
                          ))}
                        </div>
                        <div className="p-2 rounded bg-highlight/5 border border-highlight/20 max-h-48 overflow-auto space-y-1">
                          <span className="text-xs text-highlight block mb-0.5">AI đề xuất ({suggestedSpecs.length})</span>
                          {suggestedSpecs.length === 0 && (
                            <span className="italic text-muted-foreground">(xoá — nội dung cũ không đúng, không đủ dữ liệu để thay thế)</span>
                          )}
                          {suggestedSpecs.map((s, i) => (
                            <div key={i}><span className="font-medium">{s.label}:</span> {s.value}</div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {suggestion.engine === "ollama" ? (
                <div className="border rounded-lg p-3 bg-muted/20">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground block mb-2">
                    Cơ sở của AI (không có nguồn Internet)
                  </span>
                  <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                    {suggestion.note || "AI không giải thích thêm."}
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 mt-3 border-primary/30 text-primary hover:bg-primary/10"
                    onClick={runGeminiFetch}
                  >
                    <Search className="w-3.5 h-3.5" />
                    Tra cứu qua Gemini để xác thực (có nguồn thật)
                  </Button>
                </div>
              ) : (
                <div className="border rounded-lg p-3 bg-muted/20">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground block mb-2">
                    Nguồn dữ liệu AI đã tham khảo ({suggestion.sources.length})
                  </span>
                  {suggestion.sources.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">AI không trả về nguồn trích dẫn cụ thể — cân nhắc kỹ trước khi áp dụng.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {suggestion.sources.map((s, i) => (
                        <li key={i}>
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary hover:underline flex items-center gap-1.5 break-all"
                          >
                            <ExternalLink className="w-3 h-3 shrink-0" />
                            {s.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Huỷ</Button>
          <Button
            onClick={handleApply}
            disabled={isLoading || !!error || !suggestion}
            className="gap-2"
          >
            <Bot className="w-4 h-4" />
            Áp dụng đã chọn
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
