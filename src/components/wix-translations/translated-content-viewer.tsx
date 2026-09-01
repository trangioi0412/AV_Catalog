"use client";

import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Languages, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CmsTranslationStatus, WixTranslatedContentResponse } from "@/types/wix-translation";

const STATUS_LABEL: Record<CmsTranslationStatus, { label: string; className: string }> = {
  none: { label: "Chưa dịch", className: "bg-muted text-muted-foreground border-border" },
  draft: { label: "Nháp", className: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  published: { label: "Đã xuất bản", className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
};

export interface TranslatedContentViewerProps {
  open: boolean;
  itemId: string;
  collectionKey: string;
  targetLocale: string;
  onClose: () => void;
}

export function TranslatedContentViewer({ open, itemId, collectionKey, targetLocale, onClose }: TranslatedContentViewerProps) {
  const [data, setData] = useState<WixTranslatedContentResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !itemId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    const params = new URLSearchParams({ collectionKey, itemId, targetLocale });
    fetch(`/api/admin/wix-translations/content?${params.toString()}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(json?.error || "Không thể tải nội dung bản dịch.");
        } else {
          setData(json as WixTranslatedContentResponse);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Lỗi kết nối.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, itemId, collectionKey, targetLocale]);

  const status = data ? STATUS_LABEL[data.status] : null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl w-full max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <Languages className="w-5 h-5 text-primary" />
            {data ? data.itemName : "Bản dịch đã lưu"}
            {status && (
              <Badge variant="outline" className={cn("text-[10px] font-bold ml-1", status.className)}>
                {status.label}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            Nội dung đã lưu trong Wix Multilingual cho ngôn ngữ {targetLocale.toUpperCase()} — chỉ xem, không gọi AI dịch lại.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {loading && (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-2 text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              Đang tải...
            </div>
          )}

          {!loading && error && (
            <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-600">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          {!loading && !error && data && (
            <>
              {data.fields.every((f) => !f.translatedValue) && (
                <p className="text-xs text-muted-foreground italic">Item này chưa có bản dịch nào được lưu cho ngôn ngữ này.</p>
              )}
              {data.fields.map((field) => {
                const isHtml = field.type === "HTML";
                // Only rich-text (HTML) fields need full width, stacked. Plain text
                // reads better in a narrower column where lines wrap sooner.
                const isStacked = isHtml;
                const richTextClass =
                  "[&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:mb-1 [&_strong]:font-semibold [&_a]:underline [&_a]:text-primary";
                return (
                  <div key={field.key} className="rounded-xl border bg-card/40 p-4">
                    <p className="text-xs font-bold text-foreground mb-3">{field.displayName}</p>
                    <div className={cn("grid gap-4", isStacked ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2")}>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Gốc</label>
                        <div
                          className={cn(
                            "w-full p-3 text-sm leading-relaxed rounded-lg border bg-muted/50 text-foreground overflow-y-auto",
                            isStacked ? "min-h-[100px] max-h-[320px]" : "min-h-[80px] max-h-[240px]"
                          )}
                        >
                          {!field.sourceValue ? (
                            <span className="italic text-muted-foreground">(Trống)</span>
                          ) : isHtml ? (
                            <div className={richTextClass} dangerouslySetInnerHTML={{ __html: field.sourceValue }} />
                          ) : (
                            <div className="whitespace-pre-wrap">{field.sourceValue}</div>
                          )}
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                          <span>{targetLocale.toUpperCase()}</span>
                          {field.translatedValue != null && (
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[9px] font-bold",
                                field.published
                                  ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                                  : "bg-amber-500/10 text-amber-600 border-amber-500/20"
                              )}
                            >
                              {field.published ? "Đã xuất bản" : "Nháp"}
                            </Badge>
                          )}
                        </label>
                        <div
                          className={cn(
                            "w-full p-3 text-sm leading-relaxed rounded-lg border bg-background overflow-y-auto",
                            isStacked ? "min-h-[100px] max-h-[320px]" : "min-h-[80px] max-h-[240px]"
                          )}
                        >
                          {!field.translatedValue ? (
                            <span className="italic text-muted-foreground">(Chưa dịch)</span>
                          ) : isHtml ? (
                            <div className={richTextClass} dangerouslySetInnerHTML={{ __html: field.translatedValue }} />
                          ) : (
                            <div className="whitespace-pre-wrap">{field.translatedValue}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
