"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
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
import {
  AlertTriangle,
  CheckCircle2,
  Languages,
  Loader2,
  RefreshCw,
  Save,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { WixProduct } from "@/lib/services/wixCms";
import type { TranslationFieldPair } from "@/types/translation";

interface ItemState {
  entityId: string;
  name: string;
  status: "pending" | "translating" | "translated" | "failed" | "saving" | "saved" | "skipped";
  message?: string;
  hasExistingTranslation?: boolean;
  fields: TranslationFieldPair[];
}

interface TranslationReviewModalProps {
  open: boolean;
  products: WixProduct[];
  onClose: () => void;
  onSaved?: () => void;
}

const GENERATE_CHUNK_SIZE = 5;

function buildInitialItemsState(products: WixProduct[]): Record<string, ItemState> {
  const initial: Record<string, ItemState> = {};
  for (const p of products) {
    if (!p._id) continue;
    initial[p._id] = { entityId: p._id, name: p.Title || p.Product || p._id, status: "pending", fields: [] };
  }
  return initial;
}

export function TranslationReviewModal({ open, products, onClose, onSaved }: TranslationReviewModalProps) {
  // The parent only mounts this component while a product selection is open (see
  // CmsProductsPopupTrigger), so each open is a fresh mount — safe to seed state
  // from the initial `products` prop via a lazy initializer instead of an effect.
  const [itemsState, setItemsState] = useState<Record<string, ItemState>>(() => buildInitialItemsState(products));
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateProgress, setGenerateProgress] = useState({ done: 0, total: 0 });
  const [isSaving, setIsSaving] = useState(false);
  const [pendingOverwriteIds, setPendingOverwriteIds] = useState<string[] | null>(null);
  const [pendingPublish, setPendingPublish] = useState(false);

  const savingRef = useRef(false);
  const generatingRef = useRef(false);

  const runGenerate = useCallback(
    async (entityIds: string[], forceIds: string[] = []) => {
      if (entityIds.length === 0) return;
      const chunks: string[][] = [];
      for (let i = 0; i < entityIds.length; i += GENERATE_CHUNK_SIZE) {
        chunks.push(entityIds.slice(i, i + GENERATE_CHUNK_SIZE));
      }

      setIsGenerating(true);
      generatingRef.current = true;
      setGenerateProgress({ done: 0, total: entityIds.length });

      setItemsState((prev) => {
        const next = { ...prev };
        for (const id of entityIds) {
          next[id] = { ...next[id], status: "translating" };
        }
        return next;
      });

      let doneCount = 0;
      for (const chunk of chunks) {
        try {
          const res = await fetch("/api/admin/translations/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ itemIds: chunk, forceIds }),
          });
          const json = await res.json();

          if (!res.ok) {
            setItemsState((prev) => {
              const next = { ...prev };
              for (const id of chunk) {
                next[id] = { ...next[id], status: "failed", message: json?.error || `HTTP ${res.status}` };
              }
              return next;
            });
            toast.error(json?.error || "Translation request failed.");
          } else {
            setItemsState((prev) => {
              const next = { ...prev };
              for (const item of json.items || []) {
                next[item.entityId] = {
                  entityId: item.entityId,
                  name: item.name,
                  status: item.status === "success" ? "translated" : "failed",
                  message: item.message,
                  hasExistingTranslation: item.hasExistingTranslation,
                  fields: item.fields || next[item.entityId]?.fields || [],
                };
              }
              return next;
            });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Network error.";
          setItemsState((prev) => {
            const next = { ...prev };
            for (const id of chunk) {
              next[id] = { ...next[id], status: "failed", message };
            }
            return next;
          });
        } finally {
          doneCount += chunk.length;
          setGenerateProgress({ done: doneCount, total: entityIds.length });
        }
      }

      setIsGenerating(false);
      generatingRef.current = false;
    },
    []
  );

  // Kick off translation generation once, on mount (see the note on the lazy
  // itemsState initializer above for why a fresh mount is guaranteed here).
  // runGenerate's own setState calls only happen inside its async continuations,
  // never synchronously in this effect body.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void runGenerate(Object.keys(itemsState));
    // Intentionally run once on mount only — see the comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFieldEdit = (entityId: string, key: string, value: string) => {
    setItemsState((prev) => {
      const item = prev[entityId];
      if (!item) return prev;
      return {
        ...prev,
        [entityId]: {
          ...item,
          fields: item.fields.map((f) => (f.key === key ? { ...f, translated: value } : f)),
        },
      };
    });
  };

  const handleRetryOne = (entityId: string) => {
    if (generatingRef.current) return;
    void runGenerate([entityId], [entityId]);
  };

  const doSave = async (published: boolean, overwriteIds: string[] = []) => {
    const translatedItems = Object.values(itemsState).filter(
      (it) => it.status === "translated" || it.status === "skipped"
    );
    if (translatedItems.length === 0) {
      toast.info("No translated items to save yet.");
      return;
    }

    setIsSaving(true);
    setItemsState((prev) => {
      const next = { ...prev };
      for (const it of translatedItems) next[it.entityId] = { ...next[it.entityId], status: "saving" };
      return next;
    });

    try {
      const res = await fetch("/api/admin/translations/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          published,
          items: translatedItems.map((it) => ({
            entityId: it.entityId,
            name: it.name,
            overwrite: overwriteIds.includes(it.entityId),
            fields: Object.fromEntries(it.fields.map((f) => [f.key, f.translated])),
          })),
        }),
      });
      const json = await res.json();

      if (!res.ok) {
        toast.error(json?.error || "Failed to save translations.");
        setItemsState((prev) => {
          const next = { ...prev };
          for (const it of translatedItems) next[it.entityId] = { ...next[it.entityId], status: "failed", message: json?.error };
          return next;
        });
        return;
      }

      const needsOverwriteConfirm: string[] = [];
      let successCount = 0;
      let failedCount = 0;

      setItemsState((prev) => {
        const next = { ...prev };
        for (const result of json.items || []) {
          if (result.status === "skipped" && /overwrite/i.test(result.message || "")) {
            needsOverwriteConfirm.push(result.entityId);
            next[result.entityId] = { ...next[result.entityId], status: "skipped", message: result.message };
          } else if (result.status === "success") {
            successCount++;
            next[result.entityId] = { ...next[result.entityId], status: "saved", message: undefined };
          } else {
            failedCount++;
            next[result.entityId] = { ...next[result.entityId], status: "failed", message: result.message };
          }
        }
        return next;
      });

      if (successCount > 0) {
        toast.success(`Saved ${successCount} translation(s) to Wix Multilingual${published ? " and published" : " as draft"}.`);
        onSaved?.();
      }
      if (failedCount > 0) {
        toast.warning(`${failedCount} item(s) failed to save.`);
      }
      if (needsOverwriteConfirm.length > 0 && overwriteIds.length === 0) {
        setPendingPublish(published);
        setPendingOverwriteIds(needsOverwriteConfirm);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Network error while saving.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveClick = (published: boolean) => {
    if (savingRef.current || isSaving) return;
    savingRef.current = true;
    void doSave(published).finally(() => {
      savingRef.current = false;
    });
  };

  const handleConfirmOverwrite = () => {
    const ids = pendingOverwriteIds || [];
    setPendingOverwriteIds(null);
    if (savingRef.current) return;
    savingRef.current = true;
    void doSave(pendingPublish, ids).finally(() => {
      savingRef.current = false;
    });
  };

  const itemsList = Object.values(itemsState);
  const translatedCount = itemsList.filter((it) => it.status === "translated" || it.status === "saved").length;

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-6xl w-full max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <Languages className="w-5 h-5 text-primary" />
              Dịch sang tiếng Anh ({itemsList.length} sản phẩm)
            </DialogTitle>
            <DialogDescription>
              Đối chiếu nội dung gốc tiếng Việt (chỉ đọc) và bản dịch tiếng Anh (có thể chỉnh sửa) trước khi lưu vào Wix Multilingual.
            </DialogDescription>
          </DialogHeader>

          {isGenerating && (
            <div className="px-6 py-3 border-b bg-muted/20 shrink-0 space-y-1.5">
              <div className="flex justify-between text-xs font-medium text-muted-foreground">
                <span>Đang dịch với AI...</span>
                <span>
                  {generateProgress.done}/{generateProgress.total}
                </span>
              </div>
              <Progress value={(generateProgress.done / Math.max(1, generateProgress.total)) * 100} />
            </div>
          )}

          <div className="flex-1 overflow-y-auto divide-y">
            {itemsList.map((item) => (
              <div key={item.entityId} className="p-6 space-y-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <StatusIcon status={item.status} />
                    <span className="font-semibold text-sm">{item.name}</span>
                    {item.hasExistingTranslation && (
                      <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/20">
                        Đã có bản dịch
                      </span>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1.5"
                    disabled={isGenerating || isSaving}
                    onClick={() => handleRetryOne(item.entityId)}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Dịch lại
                  </Button>
                </div>

                {item.message && (
                  <div
                    className={cn(
                      "text-xs rounded-lg px-3 py-2 border",
                      item.status === "failed"
                        ? "bg-red-500/5 border-red-500/20 text-red-600"
                        : "bg-amber-500/5 border-amber-500/20 text-amber-600"
                    )}
                  >
                    {item.message}
                  </div>
                )}

                {item.fields.length > 0 && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {item.fields.map((field) => (
                      <React.Fragment key={field.key}>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            {field.displayName} (VI · gốc)
                          </label>
                          <div className="min-h-[70px] w-full p-3 text-xs rounded-xl border bg-muted/20 whitespace-pre-wrap text-foreground/80">
                            {field.original || <span className="italic text-muted-foreground">(Trống)</span>}
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                            {field.displayName} (EN · bản dịch)
                          </label>
                          <textarea
                            value={field.translated}
                            onChange={(e) => handleFieldEdit(item.entityId, field.key, e.target.value)}
                            disabled={isSaving}
                            className="min-h-[70px] w-full p-3 text-xs rounded-xl border bg-background focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/50 resize-y"
                          />
                        </div>
                      </React.Fragment>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          <DialogFooter className="px-6 py-4 border-t shrink-0 flex-row justify-between sm:justify-between items-center">
            <span className="text-xs text-muted-foreground">
              {translatedCount}/{itemsList.length} sản phẩm đã dịch xong
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={onClose} disabled={isSaving}>
                Đóng
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                disabled={isGenerating || isSaving || translatedCount === 0}
                onClick={() => handleSaveClick(false)}
              >
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Lưu bản nháp
              </Button>
              <Button
                className="gap-2"
                disabled={isGenerating || isSaving || translatedCount === 0}
                onClick={() => handleSaveClick(true)}
              >
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
              {pendingOverwriteIds?.length} sản phẩm đã có bản dịch tiếng Anh trong Wix Multilingual. Tiếp tục sẽ ghi đè nội dung hiện tại bằng bản dịch mới.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy bỏ</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmOverwrite}>Ghi đè</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function StatusIcon({ status }: { status: ItemState["status"] }) {
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
