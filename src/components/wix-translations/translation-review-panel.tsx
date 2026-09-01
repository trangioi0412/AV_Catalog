"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Languages, Loader2, RefreshCw, RotateCcw, Save, UploadCloud, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CmsFieldValueType, TranslationItemResult } from "@/types/wix-translation";

const PREVIEW_CHUNK_SIZE = 5;

export interface ReviewFieldDef {
  key: string;
  displayName: string;
  type: CmsFieldValueType;
}

interface ReviewItemState {
  itemId: string;
  itemName: string;
  status: "pending" | "translating" | "translated" | "failed" | "saving" | "saved" | "skipped";
  message?: string;
  sourceFields: Record<string, string>;
  translatedFields: Record<string, string>;
  initialTranslatedFields: Record<string, string>;
  sourceHash?: string;
}

export interface TranslationReviewPanelProps {
  open: boolean;
  itemIds: string[];
  itemNamesById: Record<string, string>;
  fields: ReviewFieldDef[];
  collectionKey: string;
  sourceLocale: string;
  targetLocale: string;
  overwriteExisting: boolean;
  /** Explicit AI provider to translate with, instead of the env-auto-resolved default. */
  providerKind?: string;
  /** Specific model tag for `providerKind` (Ollama only). */
  providerModel?: string;
  onClose: () => void;
  onSaved: () => void;
}

function buildInitialState(itemIds: string[], names: Record<string, string>): Record<string, ReviewItemState> {
  const out: Record<string, ReviewItemState> = {};
  for (const id of itemIds) {
    out[id] = { itemId: id, itemName: names[id] || id, status: "pending", sourceFields: {}, translatedFields: {}, initialTranslatedFields: {} };
  }
  return out;
}

async function callPreview(payload: unknown) {
  const res = await fetch("/api/admin/wix-translations/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  return { ok: res.ok, json };
}

export function TranslationReviewPanel(props: TranslationReviewPanelProps) {
  const { open, itemIds, itemNamesById, fields, collectionKey, sourceLocale, targetLocale, overwriteExisting, providerKind, providerModel, onClose, onSaved } = props;

  const [itemsState, setItemsState] = useState<Record<string, ReviewItemState>>(() => buildInitialState(itemIds, itemNamesById));
  const [isTranslating, setIsTranslating] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: itemIds.length });
  const [isSaving, setIsSaving] = useState(false);
  const [pendingOverwriteIds, setPendingOverwriteIds] = useState<string[] | null>(null);
  const [pendingMode, setPendingMode] = useState<"draft" | "publish">("draft");
  const [confirmClose, setConfirmClose] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  const savingRef = useRef(false);
  const translatingRef = useRef(false);
  const startedRef = useRef(false);
  const hasEditsRef = useRef(false);

  const applyPreviewResult = useCallback((items: TranslationItemResult[], names: Record<string, string>) => {
    setItemsState((prev) => {
      const next = { ...prev };
      for (const it of items) {
        const translated = it.translatedFields || {};
        next[it.itemId] = {
          itemId: it.itemId,
          itemName: it.itemName || names[it.itemId] || it.itemId,
          status: it.status === "success" ? "translated" : "failed",
          message: it.message,
          sourceFields: it.sourceFields || {},
          translatedFields: { ...translated },
          initialTranslatedFields: { ...translated },
          sourceHash: it.sourceHash,
        };
      }
      return next;
    });
  }, []);

  const runPreview = useCallback(
    async (ids: string[], forceOverwrite = false) => {
      if (ids.length === 0) return;
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += PREVIEW_CHUNK_SIZE) chunks.push(ids.slice(i, i + PREVIEW_CHUNK_SIZE));

      setIsTranslating(true);
      translatingRef.current = true;
      setProgress({ done: 0, total: ids.length });
      setItemsState((prev) => {
        const next = { ...prev };
        for (const id of ids) next[id] = { ...next[id], status: "translating" };
        return next;
      });

      let done = 0;
      for (const chunk of chunks) {
        const { ok, json } = await callPreview({
          collectionKey,
          itemIds: chunk,
          sourceLocale,
          targetLocale,
          fieldKeys: fields.map((f) => f.key),
          overwriteExisting: forceOverwrite || overwriteExisting,
          providerKind,
          providerModel,
        });

        if (!ok) {
          setItemsState((prev) => {
            const next = { ...prev };
            for (const id of chunk) next[id] = { ...next[id], status: "failed", message: json?.error || `HTTP error` };
            return next;
          });
          toast.error(json?.error || "Không thể tạo bản dịch xem trước.");
        } else {
          applyPreviewResult(json.items || [], itemNamesById);
        }
        done += chunk.length;
        setProgress({ done, total: ids.length });
      }

      setIsTranslating(false);
      translatingRef.current = false;
    },
    [collectionKey, sourceLocale, targetLocale, fields, overwriteExisting, providerKind, providerModel, applyPreviewResult, itemNamesById]
  );

  useEffect(() => {
    if (startedRef.current || !open) return;
    startedRef.current = true;
    void runPreview(itemIds);
    // Intentionally run once when the panel opens — see startedRef guard above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleFieldEdit = (itemId: string, key: string, value: string) => {
    hasEditsRef.current = true;
    setItemsState((prev) => {
      const item = prev[itemId];
      if (!item) return prev;
      return { ...prev, [itemId]: { ...item, translatedFields: { ...item.translatedFields, [key]: value } } };
    });
  };

  const handleRestore = (itemId: string) => {
    setItemsState((prev) => {
      const item = prev[itemId];
      if (!item) return prev;
      return { ...prev, [itemId]: { ...item, translatedFields: { ...item.initialTranslatedFields } } };
    });
  };

  const handleRetry = (itemId: string) => {
    if (translatingRef.current) return;
    void runPreview([itemId], true);
  };

  const doSave = async (mode: "draft" | "publish", overwriteIds: string[] = []) => {
    const eligible = Object.values(itemsState).filter((it) => it.status === "translated" || it.status === "skipped");
    if (eligible.length === 0) {
      toast.info("Chưa có mục nào được dịch xong để lưu.");
      return;
    }

    setIsSaving(true);
    setItemsState((prev) => {
      const next = { ...prev };
      for (const it of eligible) next[it.itemId] = { ...next[it.itemId], status: "saving" };
      return next;
    });

    try {
      const res = await fetch("/api/admin/wix-translations/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionKey,
          sourceLocale,
          targetLocale,
          fieldKeys: fields.map((f) => f.key),
          mode,
          overwriteExisting: overwriteIds.length > 0 ? true : overwriteExisting,
          items: eligible.map((it) => ({
            itemId: it.itemId,
            fieldValues: it.translatedFields,
            sourceHash: it.sourceHash,
          })),
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        toast.error(json?.error || "Lưu bản dịch thất bại.");
        setItemsState((prev) => {
          const next = { ...prev };
          for (const it of eligible) next[it.itemId] = { ...next[it.itemId], status: "failed", message: json?.error };
          return next;
        });
        return;
      }

      const needsOverwrite: string[] = [];
      let successCount = 0;
      let failedCount = 0;

      setItemsState((prev) => {
        const next = { ...prev };
        for (const result of (json.items || []) as TranslationItemResult[]) {
          if (result.status === "skipped" && /ghi đè|overwrite/i.test(result.message || "")) {
            needsOverwrite.push(result.itemId);
            next[result.itemId] = { ...next[result.itemId], status: "skipped", message: result.message };
          } else if (result.status === "success") {
            successCount++;
            next[result.itemId] = { ...next[result.itemId], status: "saved", message: undefined };
          } else {
            failedCount++;
            next[result.itemId] = { ...next[result.itemId], status: "failed", message: result.message };
          }
        }
        return next;
      });

      if (successCount > 0) {
        toast.success(`Đã lưu ${successCount} bản dịch vào Wix Multilingual${mode === "publish" ? " và xuất bản" : " (bản nháp)"}.`);
        hasEditsRef.current = false;
        onSaved();
      }
      if (failedCount > 0) toast.warning(`${failedCount} mục gặp lỗi khi lưu.`);
      if (needsOverwrite.length > 0 && overwriteIds.length === 0) {
        setPendingMode(mode);
        setPendingOverwriteIds(needsOverwrite);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Lỗi kết nối khi lưu bản dịch.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveClick = (mode: "draft" | "publish") => {
    if (savingRef.current || isSaving) return;
    savingRef.current = true;
    void doSave(mode).finally(() => {
      savingRef.current = false;
    });
  };

  const handleConfirmOverwrite = () => {
    const ids = pendingOverwriteIds || [];
    setPendingOverwriteIds(null);
    if (savingRef.current) return;
    savingRef.current = true;
    void doSave(pendingMode, ids).finally(() => {
      savingRef.current = false;
    });
  };

  const handleRequestClose = () => {
    if (hasEditsRef.current) {
      setConfirmClose(true);
    } else {
      onClose();
    }
  };

  const itemsList = Object.values(itemsState);
  const translatedCount = itemsList.filter((it) => it.status === "translated" || it.status === "saved").length;
  const currentItem = itemsState[itemIds[currentIndex]];
  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < itemIds.length - 1;

  const handlePrevItem = () => setCurrentIndex((i) => Math.max(0, i - 1));
  const handleNextItem = () => setCurrentIndex((i) => Math.min(itemIds.length - 1, i + 1));

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && handleRequestClose()}>
        <DialogContent className="max-w-6xl w-full max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <Languages className="w-5 h-5 text-primary" />
              Xem trước & chỉnh sửa bản dịch ({itemsList.length} sản phẩm)
            </DialogTitle>
            <DialogDescription>
              Đối chiếu nội dung gốc ({sourceLocale.toUpperCase()}, chỉ đọc) và bản dịch ({targetLocale.toUpperCase()}, có thể chỉnh sửa) trước khi lưu vào Wix Multilingual.
            </DialogDescription>
          </DialogHeader>

          {isTranslating && (
            <div className="px-6 py-3 border-b bg-muted/20 shrink-0 space-y-1.5">
              <div className="flex justify-between text-xs font-medium text-muted-foreground">
                <span>Đang dịch với AI...</span>
                <span>{progress.done}/{progress.total}</span>
              </div>
              <Progress value={(progress.done / Math.max(1, progress.total)) * 100} />
            </div>
          )}

          {itemIds.length > 1 && (
            <div className="px-6 py-2.5 border-b shrink-0 flex items-center justify-between gap-3 bg-muted/10">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5"
                disabled={!canGoPrev}
                onClick={handlePrevItem}
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Sản phẩm trước
              </Button>
              <span className="text-xs font-semibold text-muted-foreground">
                Sản phẩm {currentIndex + 1}/{itemIds.length}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5"
                disabled={!canGoNext}
                onClick={handleNextItem}
              >
                Sản phẩm tiếp theo
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}

          <div className="flex-1 overflow-y-auto">
            {currentItem && (
              <div className="p-6 space-y-5">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <StatusIcon status={currentItem.status} />
                    <span className="font-semibold text-sm">{currentItem.itemName}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1.5"
                      disabled={isTranslating || isSaving}
                      onClick={() => handleRestore(currentItem.itemId)}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Khôi phục
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1.5"
                      disabled={isTranslating || isSaving}
                      onClick={() => handleRetry(currentItem.itemId)}
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Dịch lại
                    </Button>
                  </div>
                </div>

                {currentItem.message && (
                  <div
                    className={cn(
                      "text-xs rounded-lg px-3 py-2 border",
                      currentItem.status === "failed" ? "bg-red-500/5 border-red-500/20 text-red-600" : "bg-amber-500/5 border-amber-500/20 text-amber-600"
                    )}
                  >
                    {currentItem.message}
                  </div>
                )}

                {fields.map((field) => {
                  const original = currentItem.sourceFields[field.key] || "";
                  const translated = currentItem.translatedFields[field.key] ?? "";
                  const isHtml = field.type === "HTML";
                  // Only rich-text (HTML) fields need full width, stacked — they contain
                  // paragraphs/lists that need room to breathe. Plain text (SHORT_TEXT,
                  // LONG_TEXT) reads better in a narrower column where lines wrap sooner,
                  // so it keeps the side-by-side layout.
                  const isStacked = isHtml;
                  return (
                    <div key={field.key} className="rounded-xl border bg-card/40 p-4">
                      <p className="text-xs font-bold text-foreground mb-3">{field.displayName}</p>
                      <div className={cn("grid gap-4", isStacked ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2")}>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                            {sourceLocale.toUpperCase()} · gốc (chỉ đọc)
                          </label>
                          <div
                            className={cn(
                              "w-full p-3 text-sm leading-relaxed rounded-lg border bg-muted/50 text-foreground overflow-y-auto",
                              isStacked ? "min-h-[110px] max-h-[320px]" : "min-h-[90px] max-h-[240px]"
                            )}
                          >
                            {!original ? (
                              <span className="italic text-muted-foreground">(Trống)</span>
                            ) : isHtml ? (
                              <div
                                className="[&_p]:mb-2 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:mb-1 [&_strong]:font-semibold [&_a]:underline [&_a]:text-primary"
                                dangerouslySetInnerHTML={{ __html: original }}
                              />
                            ) : (
                              <div className="whitespace-pre-wrap">{original}</div>
                            )}
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                            <span>{targetLocale.toUpperCase()} · bản dịch (có thể sửa)</span>
                            <span className="normal-case font-medium text-muted-foreground/70">{translated.length} ký tự</span>
                          </label>
                          <textarea
                            value={translated}
                            onChange={(e) => handleFieldEdit(currentItem.itemId, field.key, e.target.value)}
                            disabled={isSaving}
                            className={cn(
                              "w-full p-3 text-sm leading-relaxed rounded-lg border-2 border-primary/25 bg-background focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/60 resize-y",
                              isStacked ? "min-h-[110px]" : "min-h-[90px]"
                            )}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <DialogFooter className="px-6 py-4 border-t shrink-0 flex-row justify-between sm:justify-between items-center">
            <span className="text-xs text-muted-foreground">{translatedCount}/{itemsList.length} sản phẩm đã dịch xong</span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={handleRequestClose} disabled={isSaving}>
                Hủy
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                disabled={isTranslating || isSaving || translatedCount === 0}
                onClick={() => handleSaveClick("draft")}
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Lưu bản nháp
              </Button>
              <Button className="gap-2" disabled={isTranslating || isSaving || translatedCount === 0} onClick={() => handleSaveClick("publish")}>
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                Xuất bản lên Wix
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!pendingOverwriteIds} onOpenChange={(v) => !v && setPendingOverwriteIds(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ghi đè bản dịch đã tồn tại?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingOverwriteIds?.length} sản phẩm đã có bản dịch trong Wix Multilingual. Tiếp tục sẽ ghi đè nội dung hiện tại bằng bản dịch mới.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy bỏ</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmOverwrite}>Ghi đè</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Đóng mà không lưu?</AlertDialogTitle>
            <AlertDialogDescription>Bạn có thay đổi chưa lưu trong bản dịch. Đóng cửa sổ sẽ mất các thay đổi này.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Tiếp tục chỉnh sửa</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmClose(false);
                onClose();
              }}
            >
              Đóng, bỏ thay đổi
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function StatusIcon({ status }: { status: ReviewItemState["status"] }) {
  switch (status) {
    case "translating":
    case "saving":
      return <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />;
    case "translated":
      return <CheckCircle2 className="w-4 h-4 text-blue-500 shrink-0" />;
    case "saved":
      return <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />;
    case "failed":
      return <XCircle className="w-4 h-4 text-red-500 shrink-0" />;
    case "skipped":
      return <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />;
    default:
      return <Loader2 className="w-4 h-4 text-muted-foreground shrink-0" />;
  }
}
