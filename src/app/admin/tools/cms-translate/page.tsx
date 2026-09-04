"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
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
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AlertTriangle, ArrowLeftRight, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Languages, Loader2, Plus, RefreshCw, Trash2, UploadCloud } from "lucide-react";

type FieldType = "text" | "richText" | "json";

/** "en-vi" = read English, write Vietnamese (default). "vi-en" = the reverse. */
type Direction = "en-vi" | "vi-en";
const DIRECTION_LOCALES: Record<Direction, { source: string; target: string }> = {
  "en-vi": { source: "en", target: "vi" },
  "vi-en": { source: "vi", target: "en" },
};

interface FieldMappingRow {
  sourceField: string;
  targetField: string;
  type: FieldType;
}

interface CollectionOption {
  key: string;
  label: string;
}

interface WixFieldOption {
  key: string;
  displayName: string;
  type: string;
}

interface ListItem {
  itemId: string;
  name: string;
  translated: boolean;
  untranslatedFields: string[];
}

type ItemStatus = "translated" | "updated" | "skipped" | "failed";

interface FieldPreview {
  source: string;
  translated: string;
}

interface ResultItem {
  itemId: string;
  name: string;
  status: ItemStatus;
  translatedFields?: string[];
  fieldValues?: Record<string, FieldPreview>;
  reason?: string;
  error?: string;
}

interface RunSummary {
  total: number;
  translated: number;
  updated: number;
  skipped: number;
  failed: number;
}

const STATUS_LABEL: Record<ItemStatus, { label: string; className: string }> = {
  translated: { label: "Đã dịch — chờ duyệt", className: "bg-blue-500/10 text-blue-600 border-blue-500/20" },
  updated: { label: "Đã ghi vào CMS", className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
  skipped: { label: "Bỏ qua", className: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  failed: { label: "Thất bại", className: "bg-red-500/10 text-red-600 border-red-500/20" },
};

const EMPTY_MAPPING_ROW: FieldMappingRow = { sourceField: "", targetField: "", type: "text" };
const PAGE_SIZE = 20;
// Matches MAX_ITEMS in /api/admin/cms-translate — the most one preview/write request can carry.
// Manual (checkbox) selection stays capped here to keep that the ordinary path; "Chọn toàn bộ"
// below intentionally exceeds it and is sent as multiple CHUNK_SIZE-sized requests instead.
const MAX_BATCH_SELECT = 50;
const CHUNK_SIZE = MAX_BATCH_SELECT;

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

export default function CmsTranslatePage() {
  const [collections, setCollections] = useState<CollectionOption[]>([]);
  const [collectionKey, setCollectionKey] = useState("");
  const [configLoading, setConfigLoading] = useState(true);

  const [items, setItems] = useState<ListItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [hideTranslated, setHideTranslated] = useState(false);

  const [fieldMappings, setFieldMappings] = useState<FieldMappingRow[]>([EMPTY_MAPPING_ROW]);
  const [overwrite, setOverwrite] = useState(false);
  const [direction, setDirection] = useState<Direction>("en-vi");
  const { source: sourceLocale, target: targetLocale } = DIRECTION_LOCALES[direction];

  /** Flips direction AND swaps every mapping row's source/target field — for reusing an
   * already-configured EN→VI setup to run the same field pairs in reverse. */
  const reverseDirection = () => {
    setDirection((d) => (d === "en-vi" ? "vi-en" : "en-vi"));
    setFieldMappings((prev) => prev.map((m) => ({ ...m, sourceField: m.targetField, targetField: m.sourceField })));
  };

  // sourceField may equal targetField — an "in place" translation for a field with no
  // separate VI sibling (e.g. "Main Feature"). translateCmsEnglishToVietnamese() only
  // ever writes it when overwrite=true, so it's always gated by the checkbox below.
  const validMappings = useMemo(
    () => fieldMappings.filter((m) => m.sourceField.trim() && m.targetField.trim()),
    [fieldMappings]
  );
  const targetFieldsKey = useMemo(() => validMappings.map((m) => m.targetField.trim()).sort().join(","), [validMappings]);
  const hasInPlaceMapping = useMemo(
    () => validMappings.some((m) => m.sourceField.trim() === m.targetField.trim()),
    [validMappings]
  );

  const [availableFields, setAvailableFields] = useState<WixFieldOption[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [fieldsError, setFieldsError] = useState<string | null>(null);

  // Step 1: translate -> review (editable) -> Step 2: write exactly what was approved.
  const [isTranslating, setIsTranslating] = useState(false);
  const [reviewItems, setReviewItems] = useState<ResultItem[]>([]);
  const [previewSummary, setPreviewSummary] = useState<RunSummary | null>(null);
  const [previewProgress, setPreviewProgress] = useState({ done: 0, total: 0 });

  const [isWriting, setIsWriting] = useState(false);
  const [writeItems, setWriteItems] = useState<ResultItem[]>([]);
  const [writeSummary, setWriteSummary] = useState<RunSummary | null>(null);
  const [writeProgress, setWriteProgress] = useState({ done: 0, total: 0 });
  const [confirmWrite, setConfirmWrite] = useState(false);

  const [isSelectingAll, setIsSelectingAll] = useState(false);

  // Each step auto-collapses once it's done, to keep the page tidy — the chevron in its
  // header always lets it be re-opened (e.g. to change field mappings and re-run Step 1).
  const [setupCollapsed, setSetupCollapsed] = useState(false);
  const [itemsCollapsed, setItemsCollapsed] = useState(false);
  const [reviewCollapsed, setReviewCollapsed] = useState(false);

  useEffect(() => {
    (async () => {
      setConfigLoading(true);
      const { ok, json } = await fetchJson("/api/admin/wix-translations/config");
      if (ok && json.collections) {
        setCollections(json.collections);
        setCollectionKey((prev) => prev || json.collections[0]?.key || "");
      }
      setConfigLoading(false);
    })();
  }, []);

  const loadItems = useCallback(async () => {
    if (!collectionKey) return;
    setItemsLoading(true);
    const params = new URLSearchParams({
      collectionKey,
      page: String(page),
      limit: String(PAGE_SIZE),
      search,
      targetFields: targetFieldsKey,
    });
    const { ok, json } = await fetchJson(`/api/admin/cms-translate/items?${params.toString()}`);
    if (ok) {
      setItems((json.items || []) as ListItem[]);
      setTotal(json.total || 0);
    } else {
      toast.error(json?.error || "Không thể tải danh sách sản phẩm.");
      setItems([]);
      setTotal(0);
    }
    setItemsLoading(false);
  }, [collectionKey, page, search, targetFieldsKey]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    // A new collection or search term invalidates the current page — go back to page 1.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [collectionKey, search]);

  const loadFields = useCallback(async () => {
    if (!collectionKey) return;
    setFieldsLoading(true);
    setFieldsError(null);
    const { ok, json } = await fetchJson(`/api/admin/cms-translate/fields?collectionKey=${encodeURIComponent(collectionKey)}`);
    if (ok) {
      setAvailableFields(json.fields || []);
    } else {
      setFieldsError(json?.error || "Không thể tải danh sách field.");
      setAvailableFields([]);
    }
    setFieldsLoading(false);
  }, [collectionKey]);

  useEffect(() => {
    // Field choices are collection-specific — switching collection invalidates any mapping picked so far.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFieldMappings([EMPTY_MAPPING_ROW]);
    void loadFields();
  }, [loadFields]);

  const toggleItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_BATCH_SELECT) next.add(id);
      else toast.warning(`Chỉ được chọn tối đa ${MAX_BATCH_SELECT} sản phẩm mỗi lần dịch.`);
      return next;
    });
  };

  // Selects every item matching the current search + "hide translated" filter, across every
  // page — not just the current one — so the whole collection can be translated in one run.
  // Bypasses MAX_BATCH_SELECT (that cap is for manual checkbox clicks); runPreview/runWrite
  // send this in CHUNK_SIZE-sized requests, so there's no per-request limit or cap to respect here —
  // this walks every page until the server reports no more.
  const selectAllMatching = async () => {
    if (!collectionKey || isSelectingAll) return;
    setIsSelectingAll(true);
    const collected: string[] = [];
    const FETCH_LIMIT = 50; // the /items endpoint's max — fewer round trips than the display page size
    try {
      let p = 1;
      let serverTotal = Infinity;
      while ((p - 1) * FETCH_LIMIT < serverTotal) {
        const params = new URLSearchParams({
          collectionKey,
          page: String(p),
          limit: String(FETCH_LIMIT),
          search,
          targetFields: targetFieldsKey,
        });
        const { ok, json } = await fetchJson(`/api/admin/cms-translate/items?${params.toString()}`);
        if (!ok) {
          toast.error(json?.error || "Không thể tải danh sách sản phẩm.");
          break;
        }
        const pageItems = (json.items || []) as ListItem[];
        serverTotal = json.total ?? 0;
        if (pageItems.length === 0) break;
        for (const it of pageItems) {
          if (hideTranslated && it.translated) continue;
          collected.push(it.itemId);
        }
        p++;
      }
    } finally {
      setIsSelectingAll(false);
    }

    setSelectedIds(new Set(collected));
    toast.success(`Đã chọn ${collected.length} sản phẩm.`);
  };

  const updateMapping = (index: number, patch: Partial<FieldMappingRow>) => {
    setFieldMappings((prev) => prev.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  };

  const addMapping = () => setFieldMappings((prev) => [...prev, { sourceField: "", targetField: "", type: "text" }]);
  const removeMapping = (index: number) => setFieldMappings((prev) => prev.filter((_, i) => i !== index));

  const visibleItems = useMemo(() => (hideTranslated ? items.filter((i) => !i.translated) : items), [items, hideTranslated]);
  const hiddenCount = items.length - visibleItems.length;

  const fieldDisplayNameByKey = useMemo(
    () => Object.fromEntries(availableFields.map((f) => [f.key, f.displayName])),
    [availableFields]
  );
  // Preview results only carry target-field keys, not their type — looked up here from the
  // mapping config that was in effect when this run started, so the review UI can show a
  // taller/monospace box for "json" fields.
  const fieldTypeByTargetKey = useMemo(
    () => Object.fromEntries(validMappings.map((m) => [m.targetField.trim(), m.type])),
    [validMappings]
  );

  // Per-item, per-field write inclusion — lets the admin exclude one field of
  // one product from the write without affecting its other approved fields or
  // other products. Defaults to "included" (opt-out) so the common "everything
  // looks good, write it all" case stays a single click; keyed "itemId::fieldKey".
  const [excludedFieldKeys, setExcludedFieldKeys] = useState<Set<string>>(new Set());
  const fieldInclusionKey = (itemId: string, key: string) => `${itemId}::${key}`;
  const isFieldIncluded = useCallback(
    (itemId: string, key: string) => !excludedFieldKeys.has(fieldInclusionKey(itemId, key)),
    [excludedFieldKeys]
  );
  const toggleFieldIncluded = (itemId: string, key: string) => {
    setExcludedFieldKeys((prev) => {
      const next = new Set(prev);
      const k = fieldInclusionKey(itemId, key);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  // Split preview results so review is one product at a time (Next/Prev) instead of one
  // long scrolling list, and so items that errored or were skipped never show up in that
  // browser — they land in their own list below instead, with the reason clearly stated.
  const [currentReviewIndex, setCurrentReviewIndex] = useState(0);
  const translatedReviewItems = useMemo(() => reviewItems.filter((i) => i.status === "translated"), [reviewItems]);
  const problemReviewItems = useMemo(() => reviewItems.filter((i) => i.status !== "translated"), [reviewItems]);
  const currentReviewItem = translatedReviewItems[Math.min(currentReviewIndex, translatedReviewItems.length - 1)];

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canPreview = selectedIds.size > 0 && validMappings.length > 0 && !isTranslating;
  const approvedItems = useMemo(
    () =>
      reviewItems.filter(
        (i) => i.status === "translated" && i.fieldValues && Object.keys(i.fieldValues).some((k) => isFieldIncluded(i.itemId, k))
      ),
    [reviewItems, isFieldIncluded]
  );
  const approvedFieldCount = useMemo(
    () => approvedItems.reduce((sum, i) => sum + Object.keys(i.fieldValues || {}).filter((k) => isFieldIncluded(i.itemId, k)).length, 0),
    [approvedItems, isFieldIncluded]
  );
  const canWrite = approvedItems.length > 0 && !isWriting;

  const fieldMappingsPayload = () => validMappings.map((m) => ({ sourceField: m.sourceField.trim(), targetField: m.targetField.trim(), type: m.type }));

  const emptySummary = (): RunSummary => ({ total: 0, translated: 0, updated: 0, skipped: 0, failed: 0 });
  const addSummary = (into: RunSummary, from: RunSummary | undefined) => {
    if (!from) return;
    into.total += from.total;
    into.translated += from.translated;
    into.updated += from.updated;
    into.skipped += from.skipped;
    into.failed += from.failed;
  };

  // Selecting "toàn bộ sản phẩm" can mean far more items than one request may carry
  // (MAX_ITEMS server-side), so this always runs in CHUNK_SIZE-sized requests, one at a
  // time, updating reviewItems/previewSummary/previewProgress incrementally as each
  // chunk comes back — a single click still translates everything selected.
  const runPreview = async () => {
    if (!canPreview) return;
    setIsTranslating(true);
    setReviewItems([]);
    setPreviewSummary(null);
    setWriteItems([]);
    setWriteSummary(null);
    setExcludedFieldKeys(new Set());
    setCurrentReviewIndex(0);

    const ids = Array.from(selectedIds);
    setPreviewProgress({ done: 0, total: ids.length });
    const collected: ResultItem[] = [];
    const summary = emptySummary();
    let succeeded = true;

    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      const { ok, json } = await fetchJson("/api/admin/cms-translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionKey,
          mode: "preview",
          itemIds: chunk,
          fieldMappings: fieldMappingsPayload(),
          overwrite,
          sourceLocale,
          targetLocale,
        }),
      });

      if (!ok) {
        toast.error(json?.error || "Dịch thất bại.");
        succeeded = false;
        // The request itself failed (not a per-item error) — every item still unprocessed
        // (this chunk plus anything after it) is kept as its own "failed" result instead of
        // silently vanishing, so it still shows up (with its ID) for a filtered retry below
        // rather than forcing a full re-run of the whole selection.
        const remaining = ids.slice(i);
        const failedResults: ResultItem[] = remaining.map((itemId) => ({
          itemId,
          name: itemId,
          status: "failed",
          error: json?.error || "Dịch thất bại — yêu cầu tới server không thành công.",
        }));
        collected.push(...failedResults);
        summary.total += failedResults.length;
        summary.failed += failedResults.length;
        setReviewItems([...collected]);
        setPreviewSummary({ ...summary });
        break;
      }

      collected.push(...(json.items || []));
      addSummary(summary, json.summary);
      setReviewItems([...collected]);
      setPreviewSummary({ ...summary });
      setPreviewProgress((p) => ({ done: Math.min(p.total, p.done + chunk.length), total: p.total }));
    }

    setIsTranslating(false);

    if (succeeded) {
      toast.success(`Đã dịch xong: ${summary.translated} sản phẩm — hãy kiểm tra rồi bấm "Ghi vào CMS".`);
      setSetupCollapsed(true);
      setItemsCollapsed(true);
    } else if (collected.length > 0) {
      toast.info(`Đã giữ lại ${collected.length - summary.failed} kết quả dịch thành công trước đó — các sản phẩm còn lại có thể lọc theo ID để dịch lại.`);
    }
  };

  const handleEditTranslated = (itemId: string, fieldKey: string, value: string) => {
    setReviewItems((prev) =>
      prev.map((item) => {
        if (item.itemId !== itemId || !item.fieldValues) return item;
        return { ...item, fieldValues: { ...item.fieldValues, [fieldKey]: { ...item.fieldValues[fieldKey], translated: value } } };
      })
    );
  };

  const runWrite = async () => {
    if (approvedItems.length === 0) return;
    setIsWriting(true);
    setWriteItems([]);
    setWriteSummary(null);
    setWriteProgress({ done: 0, total: approvedItems.length });

    const collected: ResultItem[] = [];
    const summary = emptySummary();
    let succeeded = true;

    for (let i = 0; i < approvedItems.length; i += CHUNK_SIZE) {
      const chunk = approvedItems.slice(i, i + CHUNK_SIZE);
      const { ok, json } = await fetchJson("/api/admin/cms-translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionKey,
          mode: "write",
          items: chunk.map((i) => ({
            itemId: i.itemId,
            fieldValues: Object.fromEntries(
              Object.entries(i.fieldValues || {})
                .filter(([k]) => isFieldIncluded(i.itemId, k))
                .map(([k, v]) => [k, v.translated])
            ),
          })),
          fieldMappings: fieldMappingsPayload(),
          overwrite,
        }),
      });

      if (!ok) {
        toast.error(json?.error || "Ghi vào CMS thất bại.");
        succeeded = false;
        // Same reasoning as runPreview(): a whole-request failure shouldn't erase the items
        // that already wrote successfully, and the ones left over (this chunk onward) still
        // need to be visible — with their ID — so they can be filtered and retried.
        const remaining = approvedItems.slice(i);
        const failedResults: ResultItem[] = remaining.map((item) => ({
          itemId: item.itemId,
          name: item.name,
          status: "failed",
          error: json?.error || "Ghi vào CMS thất bại — yêu cầu tới server không thành công.",
        }));
        collected.push(...failedResults);
        summary.total += failedResults.length;
        summary.failed += failedResults.length;
        setWriteItems([...collected]);
        setWriteSummary({ ...summary });
        break;
      }

      collected.push(...(json.items || []));
      addSummary(summary, json.summary);
      setWriteItems([...collected]);
      setWriteSummary({ ...summary });
      setWriteProgress((p) => ({ done: Math.min(p.total, p.done + chunk.length), total: p.total }));
    }

    setIsWriting(false);

    if (succeeded) {
      toast.success(`Đã ghi ${summary.updated} sản phẩm lên Wix CMS.`);
      setReviewCollapsed(true);
    } else if (collected.length > 0) {
      toast.info(`Đã giữ lại ${collected.length - summary.failed} kết quả ghi thành công trước đó — các sản phẩm còn lại có thể lọc theo ID để thử lại.`);
    }
  };

  // Lets the admin jump straight from a failed/skipped item to the item picker filtered to
  // just that product ID — so a failure can be retried on its own instead of re-running (or
  // re-searching by name for) the whole selection again.
  const retryById = (itemId: string) => {
    setSearch(itemId);
    setPage(1);
    setItemsCollapsed(false);
    setSetupCollapsed(false);
  };

  const handlePreviewClick = () => void runPreview();
  const handleWriteClick = () => setConfirmWrite(true);
  const handleConfirmedWrite = () => {
    setConfirmWrite(false);
    void runWrite();
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-6xl mx-auto pb-16">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
            <Languages className="w-6 h-6 text-primary" />
            Dịch CMS Anh → Việt
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Đọc field trực tiếp từ Wix CMS, dịch bằng AI để xem trước, rồi chỉ ghi vào field còn lại sau khi bạn đã kiểm tra và duyệt — không dùng Wix Multilingual. Hỗ trợ cả 2 chiều Anh ↔ Việt.
          </p>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="text-base">Thiết lập</CardTitle>
              <CardDescription>Chọn Collection và khai báo cặp field nguồn (EN) → đích (VI) cần dịch.</CardDescription>
            </div>
            <Button
              size="icon-sm"
              variant="ghost"
              className="shrink-0 text-muted-foreground"
              onClick={() => setSetupCollapsed((v) => !v)}
              title={setupCollapsed ? "Mở rộng" : "Thu gọn"}
            >
              <ChevronDown className={cn("w-4 h-4 transition-transform", setupCollapsed && "-rotate-90")} />
            </Button>
          </CardHeader>
          {!setupCollapsed && (
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Collection</label>
                <Select value={collectionKey} onValueChange={setCollectionKey} disabled={configLoading || collections.length === 0}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {collections.map((c) => (
                      <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Chiều dịch</label>
                <div className="flex items-center gap-2">
                  <Select value={direction} onValueChange={(v) => setDirection(v as Direction)}>
                    <SelectTrigger className="flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en-vi">Tiếng Anh → Tiếng Việt</SelectItem>
                      <SelectItem value="vi-en">Tiếng Việt → Tiếng Anh</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="icon-sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={reverseDirection}
                    title="Đảo chiều và đổi field nguồn/đích cho từng cặp đã chọn"
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Cặp field cần dịch ({sourceLocale.toUpperCase()} → {targetLocale.toUpperCase()})
                </p>
                <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={addMapping} disabled={availableFields.length === 0}>
                  <Plus className="w-3.5 h-3.5" />
                  Thêm field
                </Button>
              </div>

              {fieldsLoading ? (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Đang tải danh sách field của collection...
                </p>
              ) : fieldsError ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-600">
                  <span className="flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{fieldsError}</span>
                  <Button size="sm" variant="outline" className="h-6 text-[11px] shrink-0" onClick={() => loadFields()}>Thử lại</Button>
                </div>
              ) : availableFields.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">Collection này chưa có field nào để chọn.</p>
              ) : (
                <div className="space-y-2">
                  {fieldMappings.map((mapping, index) => {
                    const isInPlace = Boolean(mapping.sourceField) && mapping.sourceField === mapping.targetField;
                    return (
                      <div key={index} className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <Select value={mapping.sourceField} onValueChange={(v) => updateMapping(index, { sourceField: v })}>
                            <SelectTrigger className="flex-1"><SelectValue placeholder={`Field nguồn (${sourceLocale.toUpperCase()})`} /></SelectTrigger>
                            <SelectContent>
                              {availableFields.map((f) => (
                                <SelectItem key={f.key} value={f.key}>
                                  {f.displayName}
                                  <span className="text-muted-foreground text-[10px] ml-1">({f.key} · {f.type})</span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <span
                            className={cn(
                              "text-sm shrink-0 flex items-center gap-1",
                              isInPlace ? "text-amber-600 font-semibold" : "text-muted-foreground"
                            )}
                          >
                            {isInPlace ? (
                              <>
                                <RefreshCw className="w-3.5 h-3.5" />
                                ghi đè tại chỗ
                              </>
                            ) : (
                              "→"
                            )}
                          </span>
                          <Select value={mapping.targetField} onValueChange={(v) => updateMapping(index, { targetField: v })}>
                            <SelectTrigger className="flex-1"><SelectValue placeholder={`Field đích (${targetLocale.toUpperCase()}, hoặc chọn lại field nguồn để dịch tại chỗ)`} /></SelectTrigger>
                            <SelectContent>
                              {availableFields.map((f) => (
                                <SelectItem key={f.key} value={f.key}>
                                  {f.displayName}
                                  <span className="text-muted-foreground text-[10px] ml-1">({f.key} · {f.type})</span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select value={mapping.type} onValueChange={(v) => updateMapping(index, { type: v as FieldType })}>
                            <SelectTrigger className="w-32 shrink-0"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="text">text</SelectItem>
                              <SelectItem value="richText">richText</SelectItem>
                              <SelectItem value="json">json (mảng/object)</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            className="shrink-0 text-muted-foreground hover:text-red-600"
                            disabled={fieldMappings.length <= 1}
                            onClick={() => removeMapping(index)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                        {isInPlace && (
                          <p className="text-[11px] text-amber-700 flex items-center gap-1.5 pl-1">
                            <AlertTriangle className="w-3 h-3 shrink-0" />
                            Field này không có bản {targetLocale.toUpperCase()} riêng — bản dịch sẽ GHI ĐÈ vĩnh viễn lên nội dung {sourceLocale.toUpperCase()} gốc.
                            {!overwrite && ' Cần bật "Ghi đè nội dung hiện có" bên dưới, nếu không field này sẽ bị bỏ qua.'}
                          </p>
                        )}
                        {mapping.type === "json" && (
                          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 pl-1">
                            Field này phải là mảng/object (VD: danh sách FAQ) — mọi chuỗi text bên trong sẽ được dịch, giữ nguyên cấu trúc. Ở bước duyệt, nội dung hiện dưới dạng JSON, sửa tay vẫn phải là JSON hợp lệ.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {availableFields.length > 0 && validMappings.length === 0 && (
                <p className="text-xs text-muted-foreground italic">Cần ít nhất 1 cặp field hợp lệ.</p>
              )}
            </div>

            <label className={cn("flex items-center gap-2 text-sm cursor-pointer select-none w-fit", hasInPlaceMapping && !overwrite && "text-amber-700 font-semibold")}>
              <Checkbox checked={overwrite} onCheckedChange={(v) => setOverwrite(Boolean(v))} />
              Ghi đè nội dung {targetLocale.toUpperCase()} hiện có
            </label>
          </CardContent>
          )}
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="text-base">Sản phẩm trong CMS</CardTitle>
              <CardDescription>
                {total > 0
                  ? `Tổng ${total} sản phẩm trong collection — tick thủ công tối đa ${MAX_BATCH_SELECT} item, hoặc "Chọn toàn bộ" để dịch cả collection (chạy tuần tự theo từng đợt ${CHUNK_SIZE} item).`
                  : "Chọn các item cần dịch."}
              </CardDescription>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => loadItems()} disabled={itemsLoading}>
                <RefreshCw className={cn("w-3.5 h-3.5", itemsLoading && "animate-spin")} />
                Tải lại
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => setItemsCollapsed((v) => !v)}
                title={itemsCollapsed ? "Mở rộng" : "Thu gọn"}
              >
                <ChevronDown className={cn("w-4 h-4 transition-transform", itemsCollapsed && "-rotate-90")} />
              </Button>
            </div>
          </CardHeader>
          {!itemsCollapsed && (
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
              <Input placeholder="Tìm theo tên, model hoặc ID sản phẩm..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none w-fit shrink-0">
                <Checkbox checked={hideTranslated} onCheckedChange={(v) => setHideTranslated(Boolean(v))} disabled={validMappings.length === 0} />
                Ẩn sản phẩm đã dịch đủ{hiddenCount > 0 ? ` (${hiddenCount})` : ""}
              </label>
            </div>
            {hideTranslated && validMappings.length === 0 && (
              <p className="text-xs text-muted-foreground italic">Chọn ít nhất 1 cặp field ở trên để biết sản phẩm nào đã dịch đủ.</p>
            )}

            <div className="border rounded-xl overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={visibleItems.length > 0 && visibleItems.every((i) => selectedIds.has(i.itemId))}
                        onCheckedChange={() => {
                          const allSelected = visibleItems.every((i) => selectedIds.has(i.itemId));
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (allSelected) {
                              for (const i of visibleItems) next.delete(i.itemId);
                            } else {
                              for (const i of visibleItems) {
                                if (next.size >= MAX_BATCH_SELECT) {
                                  toast.warning(`Chỉ được chọn tối đa ${MAX_BATCH_SELECT} sản phẩm mỗi lần dịch.`);
                                  break;
                                }
                                next.add(i.itemId);
                              }
                            }
                            return next;
                          });
                        }}
                      />
                    </TableHead>
                    <TableHead>Tên</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {itemsLoading ? (
                    <TableRow>
                      <TableCell colSpan={2} className="text-center py-8 text-muted-foreground text-sm">
                        <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                        Đang tải...
                      </TableCell>
                    </TableRow>
                  ) : visibleItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={2} className="text-center py-8 text-muted-foreground text-sm italic">
                        {items.length > 0 ? "Tất cả sản phẩm trên trang này đã dịch đủ." : "Không có sản phẩm nào phù hợp."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    visibleItems.map((item) => {
                      const MAX_SHOWN = 3;
                      const shownMissing = item.untranslatedFields.slice(0, MAX_SHOWN);
                      const extraMissing = item.untranslatedFields.length - shownMissing.length;
                      return (
                        <TableRow key={item.itemId} className={cn(selectedIds.has(item.itemId) && "bg-primary/5")}>
                          <TableCell>
                            <Checkbox checked={selectedIds.has(item.itemId)} onCheckedChange={() => toggleItem(item.itemId)} />
                          </TableCell>
                          <TableCell className="font-medium">
                            <div className="flex flex-col gap-1">
                              <span>{item.name}</span>
                              {item.translated ? (
                                <div>
                                  <Badge variant="outline" className="text-[9px] font-bold bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                                    Đã dịch đủ
                                  </Badge>
                                </div>
                              ) : item.untranslatedFields.length > 0 ? (
                                <div className="flex flex-wrap gap-1" title={item.untranslatedFields.map((k) => fieldDisplayNameByKey[k] || k).join(", ")}>
                                  {shownMissing.map((key) => (
                                    <Badge key={key} variant="outline" className="text-[9px] font-normal bg-red-500/5 text-red-600 border-red-500/20">
                                      {fieldDisplayNameByKey[key] || key}
                                    </Badge>
                                  ))}
                                  {extraMissing > 0 && (
                                    <Badge variant="outline" className="text-[9px] font-normal">+{extraMissing}</Badge>
                                  )}
                                </div>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs text-muted-foreground">Trang {page}/{totalPages} · {total} sản phẩm</span>
                <div className="flex gap-1.5">
                  <Button variant="outline" size="sm" className="h-8" disabled={page <= 1 || itemsLoading} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </Button>
                  <Button variant="outline" size="sm" className="h-8" disabled={page >= totalPages || itemsLoading} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            )}

            {isTranslating && previewProgress.total > 0 && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-medium text-muted-foreground">
                  <span>Đang dịch với AI...</span>
                  <span>{previewProgress.done}/{previewProgress.total}</span>
                </div>
                <Progress value={(previewProgress.done / Math.max(1, previewProgress.total)) * 100} />
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs text-muted-foreground">Đã chọn {selectedIds.size} sản phẩm{total > 0 ? ` / ${total} sản phẩm trong CMS` : ""}</span>
                <button
                  type="button"
                  className="text-xs text-primary hover:underline font-semibold disabled:opacity-50 disabled:no-underline shrink-0"
                  onClick={() => void selectAllMatching()}
                  disabled={isSelectingAll || !collectionKey || itemsLoading}
                >
                  {isSelectingAll ? "Đang chọn toàn bộ..." : "Chọn toàn bộ sản phẩm"}
                </button>
                {selectedIds.size > 0 && (
                  <button type="button" className="text-xs text-muted-foreground hover:text-foreground underline shrink-0" onClick={() => setSelectedIds(new Set())}>
                    Bỏ chọn tất cả
                  </button>
                )}
              </div>
              <Button size="sm" variant="outline" className="gap-2 shrink-0" disabled={!canPreview} onClick={handlePreviewClick}>
                {isTranslating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Languages className="w-4 h-4" />}
                Bước 1 · Dịch để xem trước{selectedIds.size > MAX_BATCH_SELECT ? ` (${Math.ceil(selectedIds.size / CHUNK_SIZE)} đợt)` : ""}
              </Button>
            </div>
          </CardContent>
          )}
        </Card>

        {reviewItems.length > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
              <div>
                <CardTitle className="text-base">Bước 2 · Kiểm tra bản dịch trước khi ghi</CardTitle>
                <CardDescription>
                  {previewSummary &&
                    `Tổng ${previewSummary.total} · Đã dịch ${previewSummary.translated} · Bỏ qua ${previewSummary.skipped} · Thất bại ${previewSummary.failed}`}{" "}
                  — có thể sửa trực tiếp bản dịch bên dưới trước khi ghi.
                </CardDescription>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Button size="sm" className="gap-2" disabled={!canWrite} onClick={handleWriteClick}>
                  {isWriting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                  Ghi {approvedFieldCount} field ({approvedItems.length} sản phẩm) vào CMS
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={() => setReviewCollapsed((v) => !v)}
                  title={reviewCollapsed ? "Mở rộng" : "Thu gọn"}
                >
                  <ChevronDown className={cn("w-4 h-4 transition-transform", reviewCollapsed && "-rotate-90")} />
                </Button>
              </div>
            </CardHeader>
            {isWriting && writeProgress.total > 0 && (
              <div className="px-6 -mt-2 pb-2 space-y-1.5">
                <div className="flex justify-between text-xs font-medium text-muted-foreground">
                  <span>Đang ghi vào Wix CMS...</span>
                  <span>{writeProgress.done}/{writeProgress.total}</span>
                </div>
                <Progress value={(writeProgress.done / Math.max(1, writeProgress.total)) * 100} />
              </div>
            )}
            {!reviewCollapsed && (
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3 text-xs">
                <span className="text-muted-foreground">Tick chọn field muốn ghi đè cho từng sản phẩm — bỏ tick để loại field đó khỏi lần ghi này:</span>
                <button
                  type="button"
                  className="text-primary hover:underline font-semibold shrink-0"
                  onClick={() => setExcludedFieldKeys(new Set())}
                >
                  Chọn tất cả
                </button>
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground underline shrink-0"
                  onClick={() =>
                    setExcludedFieldKeys(
                      new Set(
                        reviewItems.flatMap((i) => Object.keys(i.fieldValues || {}).map((k) => fieldInclusionKey(i.itemId, k)))
                      )
                    )
                  }
                >
                  Bỏ chọn tất cả
                </button>
              </div>

              {translatedReviewItems.length > 1 && (
                <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/10 px-3 py-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1.5"
                    disabled={currentReviewIndex === 0}
                    onClick={() => setCurrentReviewIndex((i) => Math.max(0, i - 1))}
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    Sản phẩm trước
                  </Button>
                  <span className="text-xs font-semibold text-muted-foreground">
                    Sản phẩm {currentReviewIndex + 1}/{translatedReviewItems.length}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1.5"
                    disabled={currentReviewIndex >= translatedReviewItems.length - 1}
                    onClick={() => setCurrentReviewIndex((i) => Math.min(translatedReviewItems.length - 1, i + 1))}
                  >
                    Sản phẩm tiếp theo
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </div>
              )}

              {currentReviewItem ? (
                <div className="rounded-xl border p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold text-sm">{currentReviewItem.name}</span>
                    <Badge variant="outline" className={cn("text-[10px] font-bold", STATUS_LABEL[currentReviewItem.status].className)}>
                      {STATUS_LABEL[currentReviewItem.status].label}
                    </Badge>
                  </div>

                  {currentReviewItem.fieldValues &&
                    Object.entries(currentReviewItem.fieldValues).map(([key, field]) => {
                      const included = isFieldIncluded(currentReviewItem.itemId, key);
                      const isJson = fieldTypeByTargetKey[key] === "json";
                      const boxHeight = isJson ? "min-h-[160px]" : "min-h-[70px]";
                      return (
                        <div key={key} className="space-y-1.5 rounded-lg border border-border/60 p-3">
                          <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer select-none">
                            <Checkbox checked={included} onCheckedChange={() => toggleFieldIncluded(currentReviewItem.itemId, key)} />
                            Ghi field &quot;{fieldDisplayNameByKey[key] || key}&quot; cho sản phẩm này
                            {isJson && <span className="text-[10px] font-normal text-muted-foreground">(JSON)</span>}
                          </label>
                          <div className={cn("grid grid-cols-1 lg:grid-cols-2 gap-3", !included && "opacity-40")}>
                            <div className="space-y-1">
                              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{key} (gốc {sourceLocale.toUpperCase()})</label>
                              <div className={cn(boxHeight, "w-full p-2.5 text-xs rounded-lg border bg-muted/40 whitespace-pre-wrap", isJson && "font-mono overflow-y-auto max-h-64")}>
                                {field.source || <span className="italic text-muted-foreground">(Trống)</span>}
                              </div>
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{key} (bản dịch {targetLocale.toUpperCase()} — có thể sửa)</label>
                              <textarea
                                value={field.translated}
                                onChange={(e) => handleEditTranslated(currentReviewItem.itemId, key, e.target.value)}
                                disabled={!included}
                                className={cn(
                                  boxHeight,
                                  "w-full p-2.5 text-xs rounded-lg border-2 border-primary/25 bg-background focus:outline-none focus:ring-1 focus:ring-primary/40 resize-y disabled:cursor-not-allowed",
                                  isJson && "font-mono"
                                )}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic text-center py-6">Không có sản phẩm nào dịch thành công để duyệt.</p>
              )}

              {problemReviewItems.length > 0 && (
                <div className="space-y-2 pt-2 border-t">
                  <p className="text-xs font-bold uppercase tracking-wider text-amber-700 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {problemReviewItems.length} sản phẩm gặp lỗi hoặc bị bỏ qua — không cần duyệt, chỉ để bạn biết vì sao
                  </p>
                  <div className="border rounded-xl overflow-hidden">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Sản phẩm</TableHead>
                          <TableHead>ID sản phẩm</TableHead>
                          <TableHead>Trạng thái</TableHead>
                          <TableHead>Lý do</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {problemReviewItems.map((item) => {
                          const status = STATUS_LABEL[item.status];
                          return (
                            <TableRow key={item.itemId}>
                              <TableCell className="font-medium max-w-[220px] truncate" title={item.name}>{item.name}</TableCell>
                              <TableCell className="font-mono text-[11px] text-muted-foreground max-w-[160px] truncate" title={item.itemId}>{item.itemId}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className={cn("text-[10px] font-bold", status.className)}>{status.label}</Badge>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground max-w-[420px]">
                                {item.error ? (
                                  <span className="text-red-600 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{item.error}</span>
                                ) : (
                                  item.reason || "—"
                                )}
                              </TableCell>
                              <TableCell>
                                <button
                                  type="button"
                                  className="text-xs text-primary hover:underline font-semibold shrink-0 whitespace-nowrap"
                                  onClick={() => retryById(item.itemId)}
                                  title="Lọc danh sách sản phẩm phía trên theo ID này để dịch lại"
                                >
                                  Dịch lại
                                </button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </CardContent>
            )}
          </Card>
        )}

        {writeItems.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                Bước 3 · Kết quả ghi vào Wix CMS
              </CardTitle>
              <CardDescription>
                {writeSummary && `Tổng ${writeSummary.total} · Đã ghi ${writeSummary.updated} · Bỏ qua ${writeSummary.skipped} · Thất bại ${writeSummary.failed}`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border rounded-xl overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sản phẩm</TableHead>
                      <TableHead>ID sản phẩm</TableHead>
                      <TableHead>Trạng thái</TableHead>
                      <TableHead>Chi tiết</TableHead>
                      {writeSummary && writeSummary.failed > 0 && <TableHead />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {writeItems.map((item) => {
                      const status = STATUS_LABEL[item.status];
                      return (
                        <TableRow key={item.itemId}>
                          <TableCell className="font-medium max-w-[220px] truncate" title={item.name}>{item.name}</TableCell>
                          <TableCell className="font-mono text-[11px] text-muted-foreground max-w-[160px] truncate" title={item.itemId}>{item.itemId}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn("text-[10px] font-bold", status.className)}>{status.label}</Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[420px]">
                            {item.error ? (
                              <span className="text-red-600 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{item.error}</span>
                            ) : item.reason ? (
                              item.reason
                            ) : item.translatedFields ? (
                              `Đã ghi: ${item.translatedFields.join(", ")}`
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          {writeSummary && writeSummary.failed > 0 && (
                            <TableCell>
                              {item.status === "failed" && (
                                <button
                                  type="button"
                                  className="text-xs text-primary hover:underline font-semibold shrink-0 whitespace-nowrap"
                                  onClick={() => retryById(item.itemId)}
                                  title="Lọc danh sách sản phẩm phía trên theo ID này để dịch lại"
                                >
                                  Dịch lại
                                </button>
                              )}
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <AlertDialog open={confirmWrite} onOpenChange={setConfirmWrite}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ghi các bản dịch đã duyệt lên Wix CMS?</AlertDialogTitle>
            <AlertDialogDescription>
              Thao tác này sẽ ghi trực tiếp {approvedFieldCount} field đã tick chọn ({approvedItems.length} sản phẩm) ở Bước 2 vào Wix CMS —
              đúng nội dung bạn đang thấy (kể cả phần đã sửa tay), không dịch lại lần nữa. Field nào bạn bỏ tick sẽ KHÔNG được ghi. Có hiệu lực
              ngay trên site, không có bản nháp riêng.
              {overwrite && " Field tiếng Việt đã có nội dung sẽ bị ghi đè."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmedWrite}>Ghi vào Wix</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
