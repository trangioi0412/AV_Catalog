"use client";

import { PageHeader } from "@/components/layout/PageHeader";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Info,
  Languages,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { TranslatedContentViewer } from "@/components/wix-translations/translated-content-viewer";
import { BrandMultiSelect } from "@/components/data/BrandMultiSelect";
import type {
  CmsTranslationStatus,
  TranslationItemResult,
  WixTranslationConfigResponse,
  WixTranslationListItem,
} from "@/types/wix-translation";

const PAGE_SIZE = 20;
// Must match MAX_TRANSLATION_BATCH_SIZE in @/config/wix-translation.config — the server hard-caps
// both /preview's itemIds and /save's items at this many per request (not importable here: that
// config module also reads server-only env vars that shouldn't end up in the client bundle).
// Only bounds manual (checkbox) selection now — every network call below sends exactly one item
// at a time, so it's well under this cap regardless of how many are selected.
const MAX_BATCH_SELECT = 20;

const STATUS_LABEL: Record<CmsTranslationStatus, { label: string; className: string }> = {
  none: { label: "Chưa dịch", className: "bg-muted text-muted-foreground border-border" },
  draft: { label: "Nháp", className: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  published: { label: "Đã xuất bản", className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
};

type ReviewItemStatus = "pending" | "translating" | "translated" | "failed" | "saving" | "saved" | "skipped";

interface ReviewItemState {
  itemId: string;
  itemName: string;
  status: ReviewItemStatus;
  message?: string;
  sourceFields: Record<string, string>;
  translatedFields: Record<string, string>;
  initialTranslatedFields: Record<string, string>;
  sourceHash?: string;
}

/** Bước 1 (chọn sản phẩm) -> Bước 2 (tiến độ dịch, chạy tự động) -> Bước 3 (duyệt & đẩy lên Wix). */
type FlowStep = "select" | "translating" | "review";

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

export function WixTranslationPage() {
  const [config, setConfig] = useState<WixTranslationConfigResponse | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  const [collectionKey, setCollectionKey] = useState<string>("");
  const [sourceLocale, setSourceLocale] = useState<string>("");
  const [targetLocale, setTargetLocale] = useState<string>("");
  const [selectedFieldKeys, setSelectedFieldKeys] = useState<Set<string>>(new Set());
  const [overwriteMode, setOverwriteMode] = useState<"missing-only" | "overwrite">("missing-only");
  /** "" = auto (env-resolved default provider) */
  const [providerKind, setProviderKind] = useState<string>("");
  /** "" = use that provider's default model */
  const [ollamaModel, setOllamaModel] = useState<string>("");

  const [items, setItems] = useState<WixTranslationListItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  // Brand filter — only the products collection references a brand. Empty = all brands.
  const [brandIds, setBrandIds] = useState<string[]>([]);
  // Sorted, comma-joined — a stable string for effect deps and the `brandIds` query param.
  const activeBrandIds = collectionKey === "products" ? [...brandIds].sort().join(",") : "";
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // "Chọn toàn bộ" can select items well beyond the current page, so their display name isn't
  // in `items` (only the current page's 20 rows) — collected alongside itemId there so Bước 2/3
  // can still show a real product name for every item, not just the ones on the visible page.
  const [selectedNamesById, setSelectedNamesById] = useState<Record<string, string>>({});
  const [isSelectingAll, setIsSelectingAll] = useState(false);
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
  const [isSelectingRange, setIsSelectingRange] = useState(false);

  const [viewingItemId, setViewingItemId] = useState<string | null>(null);

  // Each step auto-collapses once it's done, to keep the page tidy — the chevron in its
  // header always lets it be re-opened.
  const [setupCollapsed, setSetupCollapsed] = useState(false);
  const [itemsCollapsed, setItemsCollapsed] = useState(false);
  const [translateCollapsed, setTranslateCollapsed] = useState(false);

  const [flowStep, setFlowStep] = useState<FlowStep>("select");
  const [orderedItemIds, setOrderedItemIds] = useState<string[]>([]);
  const [itemsState, setItemsState] = useState<Record<string, ReviewItemState>>({});

  // Bước 2 — one Wix API call per single product, so this ticks up one-by-one instead of
  // jumping in batches: as soon as a product finishes translating, it's reflected here.
  const [isTranslating, setIsTranslating] = useState(false);
  const [translateProgress, setTranslateProgress] = useState({ done: 0, total: 0, lastItemName: "" });

  // Bước 3 — same one-at-a-time behavior for saving/publishing to Wix.
  const [isSaving, setIsSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState({ done: 0, total: 0, lastItemName: "" });
  const [pendingOverwriteIds, setPendingOverwriteIds] = useState<string[] | null>(null);
  const [pendingMode, setPendingMode] = useState<"draft" | "publish">("draft");
  const [confirmReset, setConfirmReset] = useState(false);
  const [currentReviewIndex, setCurrentReviewIndex] = useState(0);
  const hasEditsRef = useRef(false);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fieldsCollectionRef = useRef<string>("");

  const loadConfig = useCallback(async () => {
    setConfigLoading(true);
    setConfigError(null);
    const { ok, json } = await fetchJson("/api/admin/wix-translations/config");
    if (!ok) {
      setConfigError(json?.error || "Không thể tải cấu hình.");
      setConfigLoading(false);
      return;
    }
    const cfg = json as WixTranslationConfigResponse;
    setConfig(cfg);
    const initialKey = cfg.collections[0]?.key || "";
    fieldsCollectionRef.current = initialKey;
    setCollectionKey((prev) => prev || initialKey);
    setSourceLocale((prev) => prev || cfg.defaultSourceLocale || "vi");
    setTargetLocale((prev) => prev || cfg.defaultTargetLocale || "en");
    setSelectedFieldKeys((prev) => (prev.size > 0 ? prev : new Set(cfg.fields.map((f) => f.key))));
    setConfigLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadConfig();
  }, [loadConfig]);

  // Every collection has its own translation schema/field list, so switching
  // "Collection" must re-fetch fields for that collection — the initial
  // /config call above only ever resolves fields for the default collection.
  const loadFieldsForCollection = useCallback(async (key: string) => {
    const { ok, json } = await fetchJson(`/api/admin/wix-translations/config?collectionKey=${encodeURIComponent(key)}`);
    fieldsCollectionRef.current = key;
    if (!ok) {
      toast.error(json?.error || "Không thể tải field cho collection này.");
      return;
    }
    const cfg = json as WixTranslationConfigResponse;
    setConfig((prev) => (prev ? { ...prev, fields: cfg.fields, multilingualReady: cfg.multilingualReady, warnings: cfg.warnings } : prev));
    setSelectedFieldKeys(new Set(cfg.fields.map((f) => f.key)));
  }, []);

  useEffect(() => {
    if (!collectionKey || !config) return;
    if (fieldsCollectionRef.current === collectionKey) return;
    void loadFieldsForCollection(collectionKey);
  }, [collectionKey, config, loadFieldsForCollection]);

  const loadItems = useCallback(async () => {
    if (!collectionKey || !targetLocale) return;
    setItemsLoading(true);
    setItemsError(null);
    const params = new URLSearchParams({
      collectionKey,
      targetLocale,
      page: String(page),
      limit: String(PAGE_SIZE),
      search,
    });
    if (activeBrandIds) params.set("brandIds", activeBrandIds);
    const { ok, json } = await fetchJson(`/api/admin/wix-translations/items?${params.toString()}`);
    if (!ok) {
      setItemsError(json?.error || "Không thể tải danh sách sản phẩm.");
      setItems([]);
      setTotal(0);
    } else {
      setItems(json.items || []);
      setTotal(json.total || 0);
    }
    setItemsLoading(false);
  }, [collectionKey, targetLocale, page, search, activeBrandIds]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadItems();
  }, [loadItems]);

  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setPage(1);
      setSearch(value);
    }, 350);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const toggleItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_BATCH_SELECT) next.add(id);
      else toast.warning(`Chỉ được chọn tối đa ${MAX_BATCH_SELECT} sản phẩm mỗi lần tick.`);
      return next;
    });
  };

  const toggleAllOnPage = () => {
    const pageIds = items.map((i) => i.itemId);
    const allChecked = pageIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allChecked) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        for (const id of pageIds) {
          if (next.size >= MAX_BATCH_SELECT) {
            toast.warning(`Chỉ được chọn tối đa ${MAX_BATCH_SELECT} sản phẩm mỗi lần tick.`);
            break;
          }
          next.add(id);
        }
      }
      return next;
    });
  };

  // Selects every item matching the current search across the WHOLE collection, not just the
  // current page — no cap here (MAX_BATCH_SELECT is for manual checkbox clicks only), since
  // Bước 2 below processes the selection one product at a time regardless of how many there are.
  const selectAllMatching = async () => {
    if (!collectionKey || !targetLocale || isSelectingAll) return;
    setIsSelectingAll(true);
    const collectedIds: string[] = [];
    const collectedNames: Record<string, string> = {};
    const FETCH_LIMIT = 50; // fewer round trips than the display page size
    try {
      let p = 1;
      let serverTotal = Infinity;
      while ((p - 1) * FETCH_LIMIT < serverTotal) {
        const params = new URLSearchParams({ collectionKey, targetLocale, page: String(p), limit: String(FETCH_LIMIT), search });
        if (activeBrandIds) params.set("brandIds", activeBrandIds);
        const { ok, json } = await fetchJson(`/api/admin/wix-translations/items?${params.toString()}`);
        if (!ok) {
          toast.error(json?.error || "Không thể tải danh sách sản phẩm.");
          break;
        }
        const pageItems = (json.items || []) as WixTranslationListItem[];
        serverTotal = json.total ?? 0;
        if (pageItems.length === 0) break;
        for (const it of pageItems) {
          collectedIds.push(it.itemId);
          collectedNames[it.itemId] = it.name;
        }
        p++;
      }
    } finally {
      setIsSelectingAll(false);
    }

    setSelectedIds(new Set(collectedIds));
    setSelectedNamesById(collectedNames);
    toast.success(`Đã chọn ${collectedIds.length} sản phẩm.`);
  };

  // Selects the sub-range [from, to] (1-based, inclusive) of the CURRENT search-filtered
  // listing's order — e.g. "100 -> 200" picks the 100th through 200th product in the same
  // order "Chọn toàn bộ" would enumerate them. Jumps straight to the page containing `from`
  // instead of walking from page 1, since every earlier page is guaranteed full (FETCH_LIMIT
  // items) once the server has reported a total that big.
  const selectRange = async () => {
    if (!collectionKey || !targetLocale || isSelectingRange) return;
    const from = Number.parseInt(rangeFrom, 10);
    const to = Number.parseInt(rangeTo, 10);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 1 || to < from) {
      toast.error('Nhập khoảng thứ tự hợp lệ, ví dụ "Từ 100 đến 200".');
      return;
    }

    setIsSelectingRange(true);
    const collectedIds: string[] = [];
    const collectedNames: Record<string, string> = {};
    const FETCH_LIMIT = 50;
    const startPage = Math.floor((from - 1) / FETCH_LIMIT) + 1;
    try {
      let p = startPage;
      let serverTotal = Infinity;
      let index = (startPage - 1) * FETCH_LIMIT; // count of items on every page before startPage
      while (index < to && (p - 1) * FETCH_LIMIT < serverTotal) {
        const params = new URLSearchParams({ collectionKey, targetLocale, page: String(p), limit: String(FETCH_LIMIT), search });
        if (activeBrandIds) params.set("brandIds", activeBrandIds);
        const { ok, json } = await fetchJson(`/api/admin/wix-translations/items?${params.toString()}`);
        if (!ok) {
          toast.error(json?.error || "Không thể tải danh sách sản phẩm.");
          break;
        }
        const pageItems = (json.items || []) as WixTranslationListItem[];
        serverTotal = json.total ?? 0;
        if (pageItems.length === 0) break;
        for (const it of pageItems) {
          index++;
          if (index < from) continue;
          if (index > to) break;
          collectedIds.push(it.itemId);
          collectedNames[it.itemId] = it.name;
        }
        p++;
      }
    } finally {
      setIsSelectingRange(false);
    }

    if (collectedIds.length === 0) {
      toast.warning(`Không có sản phẩm nào ở thứ tự ${from}–${to} (kiểm tra lại tổng số sản phẩm đang có).`);
      return;
    }
    setSelectedIds(new Set(collectedIds));
    setSelectedNamesById(collectedNames);
    toast.success(`Đã chọn ${collectedIds.length} sản phẩm (thứ tự ${from}–${to}).`);
  };

  const toggleField = (key: string) => {
    setSelectedFieldKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // Current page's names take priority (freshest), falling back to whatever selectAllMatching()
  // collected for ids that are outside the current page.
  const itemNamesById = useMemo(
    () => ({ ...selectedNamesById, ...Object.fromEntries(items.map((i) => [i.itemId, i.name])) }),
    [items, selectedNamesById]
  );
  const selectedFieldDefs = useMemo(
    () => (config?.fields || []).filter((f) => selectedFieldKeys.has(f.key)).map((f) => ({ key: f.key, displayName: f.displayName, type: f.type })),
    [config, selectedFieldKeys]
  );

  const ollamaProviderInfo = config?.availableProviders.find((p) => p.kind === "ollama");
  const effectiveOllamaModel = ollamaModel || ollamaProviderInfo?.defaultModel || "";
  const ollamaModelOptions = (config?.ollamaModels?.length ? config.ollamaModels : [ollamaProviderInfo?.defaultModel].filter(Boolean)) as string[];

  // Whichever provider will actually run the translation: the explicitly
  // selected one, or the env-auto-resolved default when left on "Tự động".
  const selectedProviderConfigured = providerKind
    ? Boolean(config?.availableProviders.find((p) => p.kind === providerKind)?.configured)
    : Boolean(config?.translationProvider.configured);

  const canTranslate =
    selectedIds.size > 0 &&
    selectedFieldDefs.length > 0 &&
    Boolean(sourceLocale) &&
    Boolean(targetLocale) &&
    sourceLocale !== targetLocale &&
    Boolean(config?.wixConfigured) &&
    Boolean(config?.multilingualReady) &&
    selectedProviderConfigured &&
    !isTranslating;

  function resetToSelect() {
    setFlowStep("select");
    setItemsState({});
    setOrderedItemIds([]);
    setCurrentReviewIndex(0);
    setSetupCollapsed(false);
    setItemsCollapsed(false);
    setTranslateCollapsed(false);
    setSelectedIds(new Set());
    setSelectedNamesById({});
    hasEditsRef.current = false;
    void loadItems();
  }

  const handleResetClick = () => {
    if (hasEditsRef.current) setConfirmReset(true);
    else resetToSelect();
  };

  // Bước 2 · Tiến độ dịch — one /preview call per single product, updating itemsState and
  // translateProgress right after each one comes back, so the run visibly advances one product
  // at a time instead of jumping in blocks. A failed item never stops the run — it's marked
  // "failed" and the loop moves straight on to the next selected product.
  const startTranslate = async () => {
    if (!canTranslate) return;
    const ids = Array.from(selectedIds);
    const names = itemNamesById;

    const initial: Record<string, ReviewItemState> = {};
    for (const id of ids) {
      initial[id] = { itemId: id, itemName: names[id] || id, status: "pending", sourceFields: {}, translatedFields: {}, initialTranslatedFields: {} };
    }
    setItemsState(initial);
    setOrderedItemIds(ids);
    setCurrentReviewIndex(0);
    hasEditsRef.current = false;
    setFlowStep("translating");
    setSetupCollapsed(true);
    setItemsCollapsed(true);
    setTranslateCollapsed(false);
    setIsTranslating(true);
    setTranslateProgress({ done: 0, total: ids.length, lastItemName: "" });

    const fieldKeys = selectedFieldDefs.map((f) => f.key);

    for (const id of ids) {
      const name = names[id] || id;
      setItemsState((prev) => ({ ...prev, [id]: { ...prev[id], status: "translating" } }));

      const { ok, json } = await fetchJson("/api/admin/wix-translations/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionKey,
          itemIds: [id],
          sourceLocale,
          targetLocale,
          fieldKeys,
          overwriteExisting: overwriteMode === "overwrite",
          providerKind: providerKind || undefined,
          providerModel: providerKind === "ollama" ? effectiveOllamaModel || undefined : undefined,
        }),
      });

      if (!ok) {
        setItemsState((prev) => ({ ...prev, [id]: { ...prev[id], status: "failed", message: json?.error || "Dịch thất bại." } }));
      } else {
        const result = (json.items || [])[0] as TranslationItemResult | undefined;
        if (!result) {
          setItemsState((prev) => ({ ...prev, [id]: { ...prev[id], status: "failed", message: "Không nhận được kết quả dịch." } }));
        } else {
          const translated = result.translatedFields || {};
          setItemsState((prev) => ({
            ...prev,
            [id]: {
              itemId: id,
              itemName: result.itemName || name,
              status: result.status === "success" ? "translated" : result.status === "skipped" ? "skipped" : "failed",
              message: result.message,
              sourceFields: result.sourceFields || {},
              translatedFields: { ...translated },
              initialTranslatedFields: { ...translated },
              sourceHash: result.sourceHash,
            },
          }));
        }
      }

      setTranslateProgress((p) => ({ done: p.done + 1, total: p.total, lastItemName: name }));
    }

    setIsTranslating(false);
    setFlowStep("review");
    setTranslateCollapsed(true);
  };

  const retryTranslateOne = async (itemId: string) => {
    if (isTranslating) return;
    const name = itemsState[itemId]?.itemName || itemId;
    setItemsState((prev) => ({ ...prev, [itemId]: { ...prev[itemId], status: "translating" } }));
    const { ok, json } = await fetchJson("/api/admin/wix-translations/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        collectionKey,
        itemIds: [itemId],
        sourceLocale,
        targetLocale,
        fieldKeys: selectedFieldDefs.map((f) => f.key),
        overwriteExisting: true,
        providerKind: providerKind || undefined,
        providerModel: providerKind === "ollama" ? effectiveOllamaModel || undefined : undefined,
      }),
    });
    if (!ok) {
      setItemsState((prev) => ({ ...prev, [itemId]: { ...prev[itemId], status: "failed", message: json?.error || "Dịch thất bại." } }));
      return;
    }
    const result = (json.items || [])[0] as TranslationItemResult | undefined;
    if (!result) {
      setItemsState((prev) => ({ ...prev, [itemId]: { ...prev[itemId], status: "failed", message: "Không nhận được kết quả dịch." } }));
      return;
    }
    const translated = result.translatedFields || {};
    setItemsState((prev) => ({
      ...prev,
      [itemId]: {
        itemId,
        itemName: result.itemName || name,
        status: result.status === "success" ? "translated" : result.status === "skipped" ? "skipped" : "failed",
        message: result.message,
        sourceFields: result.sourceFields || {},
        translatedFields: { ...translated },
        initialTranslatedFields: { ...translated },
        sourceHash: result.sourceHash,
      },
    }));
  };

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

  // Bước 3 · Duyệt và đẩy lên Wix — same one-item-per-request behavior as Bước 2: every product
  // is written with its own /save call, and saveProgress advances by exactly one as soon as
  // THAT product lands in Wix — never waiting for a whole batch before showing anything moved.
  const runSave = async (mode: "draft" | "publish", forceOverwriteIds: string[] = []) => {
    const isRetry = forceOverwriteIds.length > 0;
    const idsToSave = isRetry
      ? forceOverwriteIds
      : orderedItemIds.filter((id) => {
          const it = itemsState[id];
          return it && (it.status === "translated" || it.status === "skipped");
        });

    if (idsToSave.length === 0) {
      toast.info("Chưa có mục nào được dịch xong để lưu.");
      return;
    }

    setIsSaving(true);
    setSaveProgress({ done: 0, total: idsToSave.length, lastItemName: "" });
    setItemsState((prev) => {
      const next = { ...prev };
      for (const id of idsToSave) next[id] = { ...next[id], status: "saving" };
      return next;
    });

    const needsOverwrite: string[] = [];
    let successCount = 0;
    let failedCount = 0;
    const fieldKeys = selectedFieldDefs.map((f) => f.key);

    for (const id of idsToSave) {
      const it = itemsState[id];
      const name = it?.itemName || id;
      const { ok, json } = await fetchJson("/api/admin/wix-translations/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionKey,
          sourceLocale,
          targetLocale,
          fieldKeys,
          mode,
          overwriteExisting: isRetry ? true : overwriteMode === "overwrite",
          items: [{ itemId: id, fieldValues: it?.translatedFields || {}, sourceHash: it?.sourceHash }],
        }),
      });

      if (!ok) {
        failedCount++;
        setItemsState((prev) => ({ ...prev, [id]: { ...prev[id], status: "failed", message: json?.error || "Lưu thất bại." } }));
      } else {
        const result = (json.items || [])[0] as TranslationItemResult | undefined;
        if (result?.status === "skipped" && /ghi đè|overwrite/i.test(result.message || "")) {
          needsOverwrite.push(id);
          setItemsState((prev) => ({ ...prev, [id]: { ...prev[id], status: "skipped", message: result.message } }));
        } else if (result?.status === "success") {
          successCount++;
          setItemsState((prev) => ({ ...prev, [id]: { ...prev[id], status: "saved", message: undefined } }));
        } else {
          failedCount++;
          setItemsState((prev) => ({ ...prev, [id]: { ...prev[id], status: "failed", message: result?.message || json?.error } }));
        }
      }

      setSaveProgress((p) => ({ done: p.done + 1, total: p.total, lastItemName: name }));
    }

    setIsSaving(false);

    if (successCount > 0) {
      toast.success(`Đã lưu ${successCount} bản dịch vào Wix Multilingual${mode === "publish" ? " và xuất bản" : " (bản nháp)"}.`);
      hasEditsRef.current = false;
    }
    if (failedCount > 0) toast.warning(`${failedCount} mục gặp lỗi khi lưu.`);

    if (needsOverwrite.length > 0 && !isRetry) {
      setPendingMode(mode);
      setPendingOverwriteIds(needsOverwrite);
    }
  };

  const handleConfirmOverwrite = () => {
    const ids = pendingOverwriteIds || [];
    setPendingOverwriteIds(null);
    void runSave(pendingMode, ids);
  };

  const itemsList = orderedItemIds.map((id) => itemsState[id]).filter((it): it is ReviewItemState => Boolean(it));
  const translatedReviewItems = useMemo(() => itemsList.filter((it) => it.status === "translated" || it.status === "saved"), [itemsList]);
  const problemReviewItems = useMemo(() => itemsList.filter((it) => it.status === "failed" || it.status === "skipped"), [itemsList]);
  const savedCount = itemsList.filter((it) => it.status === "saved").length;
  const currentReviewItem = translatedReviewItems[Math.min(currentReviewIndex, translatedReviewItems.length - 1)];
  const canSave = itemsList.some((it) => it.status === "translated" || it.status === "skipped") && !isSaving;

  if (configLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground gap-2 text-sm">
        <Loader2 className="w-4 h-4 animate-spin" />
        Đang tải cấu hình...
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-16">
      <PageHeader
        title="Dịch đa ngôn ngữ Wix CMS"
        description="Lấy nội dung từ Wix CMS, dịch và đồng bộ bản dịch vào Wix Multilingual."
        icon={<Languages className="w-5 h-5" />}
      />

      {configError && <Alert message={configError} onRetry={loadConfig} />}

      {config && config.warnings.length > 0 && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4 space-y-1.5">
            <p className="text-xs font-bold uppercase tracking-wider text-amber-600 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              Cấu hình chưa đầy đủ
            </p>
            <ul className="text-xs text-amber-700/90 space-y-1 list-disc list-inside">
              {config.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Thiết lập</CardTitle>
            <CardDescription>Chọn collection, ngôn ngữ, và các field cần dịch.</CardDescription>
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Collection">
              <Select value={collectionKey} onValueChange={setCollectionKey} disabled={!config || config.collections.length <= 1}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(config?.collections || []).map((c) => (
                    <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Ngôn ngữ nguồn">
              <Select value={sourceLocale} onValueChange={setSourceLocale}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Chọn ngôn ngữ" /></SelectTrigger>
                <SelectContent>
                  {(config?.locales || []).map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>
                  ))}
                  {!(config?.locales || []).some((l) => l.id === sourceLocale) && sourceLocale && (
                    <SelectItem value={sourceLocale}>{sourceLocale.toUpperCase()}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Ngôn ngữ đích">
              <Select value={targetLocale} onValueChange={(v) => { setTargetLocale(v); setPage(1); }}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Chọn ngôn ngữ" /></SelectTrigger>
                <SelectContent>
                  {(config?.locales || []).filter((l) => l.id !== sourceLocale).map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>
                  ))}
                  {!(config?.locales || []).some((l) => l.id === targetLocale) && targetLocale && (
                    <SelectItem value={targetLocale}>{targetLocale.toUpperCase()}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Field cần dịch</p>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {(config?.fields || []).length === 0 && (
                <p className="text-xs text-muted-foreground italic">Chưa xác định được field (xem cảnh báo cấu hình ở trên).</p>
              )}
              {(config?.fields || []).map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <Checkbox checked={selectedFieldKeys.has(f.key)} onCheckedChange={() => toggleField(f.key)} />
                  {f.displayName}
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Model AI dịch">
              <Select value={providerKind || "auto"} onValueChange={(v) => setProviderKind(v === "auto" ? "" : v)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">
                    Tự động ({config?.translationProvider.name || "chưa cấu hình"})
                  </SelectItem>
                  {(config?.availableProviders || []).map((p) => (
                    <SelectItem key={p.kind} value={p.kind} disabled={!p.configured}>
                      {p.label}{!p.configured ? " — chưa cấu hình" : ` — ${p.defaultModel}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {providerKind === "ollama" && (
              <Field label="Model Ollama">
                <Select value={effectiveOllamaModel} onValueChange={setOllamaModel} disabled={ollamaModelOptions.length === 0}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Không có model nào" /></SelectTrigger>
                  <SelectContent>
                    {ollamaModelOptions.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Chế độ xử lý bản dịch hiện có</p>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input type="radio" name="overwriteMode" checked={overwriteMode === "missing-only"} onChange={() => setOverwriteMode("missing-only")} className="accent-primary" />
                Chỉ dịch field chưa có bản dịch
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input type="radio" name="overwriteMode" checked={overwriteMode === "overwrite"} onChange={() => setOverwriteMode("overwrite")} className="accent-primary" />
                Dịch lại và ghi đè field đã chọn
              </label>
            </div>
          </div>
        </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Bước 1 · Chọn sản phẩm cần dịch</CardTitle>
            <CardDescription>
              {total > 0
                ? `Tổng ${total} sản phẩm — tick thủ công tối đa ${MAX_BATCH_SELECT} item, hoặc "Chọn toàn bộ" để dịch cả collection.`
                : `Chọn tối đa ${MAX_BATCH_SELECT} sản phẩm mỗi lần tick, hoặc "Chọn toàn bộ" để dịch cả collection.`}
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
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Tìm theo tên hoặc model..."
                value={searchInput}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm bg-background border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>
            {collectionKey === "products" && (
              <BrandMultiSelect
                value={brandIds}
                onChange={(ids) => {
                  setPage(1);
                  setBrandIds(ids);
                }}
              />
            )}
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                className="text-xs text-primary hover:underline font-semibold disabled:opacity-50 disabled:no-underline shrink-0"
                onClick={() => void selectAllMatching()}
                disabled={isSelectingAll || !collectionKey || !targetLocale || itemsLoading}
              >
                {isSelectingAll ? "Đang chọn toàn bộ..." : "Chọn toàn bộ sản phẩm"}
              </button>
              <div className="flex items-center gap-1.5 shrink-0" title="Chọn theo thứ tự sản phẩm trong danh sách hiện tại (vd. Từ 100 đến 200 = sản phẩm thứ 100 tới thứ 200)">
                <span className="text-xs text-muted-foreground">Chọn theo thứ tự:</span>
                <input
                  type="number"
                  min={1}
                  placeholder="Từ"
                  value={rangeFrom}
                  onChange={(e) => setRangeFrom(e.target.value)}
                  className="w-16 h-7 px-2 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
                <span className="text-xs text-muted-foreground">→</span>
                <input
                  type="number"
                  min={1}
                  placeholder="Đến"
                  value={rangeTo}
                  onChange={(e) => setRangeTo(e.target.value)}
                  className="w-16 h-7 px-2 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/30"
                />
                <button
                  type="button"
                  className="text-xs text-primary hover:underline font-semibold disabled:opacity-50 disabled:no-underline shrink-0"
                  onClick={() => void selectRange()}
                  disabled={isSelectingRange || !collectionKey || !targetLocale || itemsLoading || !rangeFrom || !rangeTo}
                >
                  {isSelectingRange ? "Đang chọn..." : "Chọn"}
                </button>
              </div>
              {selectedIds.size > 0 && (
                <>
                  <span className="text-xs font-semibold text-primary">Đã chọn {selectedIds.size} sản phẩm</span>
                  <Button size="sm" className="h-8 text-xs gap-1.5" disabled={!canTranslate} onClick={() => void startTranslate()}>
                    {isTranslating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Languages className="w-3.5 h-3.5" />}
                    Bước 2 · Bắt đầu dịch
                  </Button>
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground underline"
                    onClick={() => {
                      setSelectedIds(new Set());
                      setSelectedNamesById({});
                    }}
                  >
                    Bỏ chọn
                  </button>
                </>
              )}
            </div>
          </div>

          {itemsError && <Alert message={itemsError} onRetry={loadItems} />}

          <div className="border rounded-xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={items.length > 0 && items.every((i) => selectedIds.has(i.itemId))}
                      onCheckedChange={toggleAllOnPage}
                    />
                  </TableHead>
                  <TableHead>Tên</TableHead>
                  <TableHead>Field chưa dịch</TableHead>
                  <TableHead>Trạng thái dịch</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {itemsLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-10 text-muted-foreground text-sm">
                      <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                      Đang tải...
                    </TableCell>
                  </TableRow>
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-10 text-muted-foreground text-sm italic">
                      Không có sản phẩm nào phù hợp.
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => {
                    const status = STATUS_LABEL[item.translationStatus];
                    const MAX_SHOWN = 3;
                    const shownMissing = item.untranslatedFields.slice(0, MAX_SHOWN);
                    const extraMissing = item.untranslatedFields.length - shownMissing.length;
                    return (
                      <TableRow key={item.itemId} className={cn(selectedIds.has(item.itemId) && "bg-primary/5")}>
                        <TableCell>
                          <Checkbox checked={selectedIds.has(item.itemId)} onCheckedChange={() => toggleItem(item.itemId)} />
                        </TableCell>
                        <TableCell className="font-medium max-w-[260px] truncate" title={item.name}>{item.name}</TableCell>
                        <TableCell className="max-w-[320px]">
                          {item.untranslatedFields.length === 0 ? (
                            <span className="text-xs text-emerald-600 font-medium">Đầy đủ</span>
                          ) : (
                            <div className="flex flex-wrap gap-1" title={item.untranslatedFields.join(", ")}>
                              {shownMissing.map((f) => (
                                <Badge key={f} variant="outline" className="text-xs font-normal bg-red-500/5 text-red-600 border-red-500/20">
                                  {f}
                                </Badge>
                              ))}
                              {extraMissing > 0 && (
                                <Badge variant="outline" className="text-xs font-normal">
                                  +{extraMissing}
                                </Badge>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {item.translationStatus === "none" ? (
                            <Badge variant="outline" className={cn("text-xs font-bold", status.className)}>{status.label}</Badge>
                          ) : (
                            <button
                              type="button"
                              className="inline-flex"
                              title="Xem nội dung bản dịch đã lưu"
                              onClick={() => setViewingItemId(item.itemId)}
                            >
                              <Badge
                                variant="outline"
                                className={cn("text-xs font-bold cursor-pointer hover:opacity-80", status.className)}
                              >
                                {status.label}
                              </Badge>
                            </button>
                          )}
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
                <Button variant="outline" size="sm" className="h-8" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <Button variant="outline" size="sm" className="h-8" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
        )}
      </Card>

      {!canTranslate && selectedIds.size > 0 && !isTranslating && (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5" />
          Kiểm tra lại: đã chọn field, ngôn ngữ nguồn/đích khác nhau, và cấu hình Wix/translation provider ở trên.
        </div>
      )}

      {(flowStep === "translating" || flowStep === "review") && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="text-base">Bước 2 · Tiến độ dịch</CardTitle>
              <CardDescription>
                {isTranslating
                  ? "Đang dịch từng sản phẩm một bằng AI — xong sản phẩm nào hiện kết quả sản phẩm đó."
                  : `Đã dịch xong: ${translatedReviewItems.length + itemsList.filter((i) => i.status === "skipped").length} thành công, ${problemReviewItems.filter((i) => i.status === "failed").length} thất bại — kiểm tra ở Bước 3 bên dưới.`}
              </CardDescription>
            </div>
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => setTranslateCollapsed((v) => !v)}
              title={translateCollapsed ? "Mở rộng" : "Thu gọn"}
            >
              <ChevronDown className={cn("w-4 h-4 transition-transform", translateCollapsed && "-rotate-90")} />
            </Button>
          </CardHeader>
          {!translateCollapsed && (
            <CardContent className="space-y-1.5">
              <div className="flex justify-between text-xs font-medium text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  {isTranslating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {isTranslating ? "Đang dịch với AI..." : "Hoàn tất"}
                </span>
                <span>{translateProgress.done}/{translateProgress.total} sản phẩm</span>
              </div>
              <Progress value={(translateProgress.done / Math.max(1, translateProgress.total)) * 100} />
              {translateProgress.lastItemName && (
                <p className="text-xs text-muted-foreground truncate">
                  {isTranslating ? "Vừa dịch xong" : "Sản phẩm cuối"}: <span className="font-medium text-foreground">{translateProgress.lastItemName}</span>
                </p>
              )}
            </CardContent>
          )}
        </Card>
      )}

      {flowStep === "review" && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="text-base">Bước 3 · Duyệt và đẩy lên Wix</CardTitle>
              <CardDescription>
                {translatedReviewItems.length}/{itemsList.length} sản phẩm sẵn sàng ({savedCount} đã đẩy lên Wix) — có thể sửa trực tiếp bản dịch trước khi lưu.
              </CardDescription>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button type="button" className="text-xs text-muted-foreground hover:text-foreground underline shrink-0" onClick={handleResetClick}>
                Chọn sản phẩm khác
              </button>
              <Button variant="outline" className="h-8 text-xs gap-1.5" disabled={!canSave} onClick={() => void runSave("draft")}>
                {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                Lưu bản nháp
              </Button>
              <Button className="h-8 text-xs gap-1.5" disabled={!canSave} onClick={() => void runSave("publish")}>
                {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
                Xuất bản lên Wix
              </Button>
            </div>
          </CardHeader>

          {isSaving && saveProgress.total > 0 && (
            <div className="px-6 -mt-2 pb-2 space-y-1.5">
              <div className="flex justify-between text-xs font-medium text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Đang đẩy từng sản phẩm lên Wix...
                </span>
                <span>{saveProgress.done}/{saveProgress.total} sản phẩm</span>
              </div>
              <Progress value={(saveProgress.done / Math.max(1, saveProgress.total)) * 100} />
              {saveProgress.lastItemName && (
                <p className="text-xs text-muted-foreground truncate">
                  Vừa đẩy xong: <span className="font-medium text-foreground">{saveProgress.lastItemName}</span>
                </p>
              )}
            </div>
          )}

          <CardContent className="space-y-4">
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
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <StatusIcon status={currentReviewItem.status} />
                    <span className="font-semibold text-sm">{currentReviewItem.itemName}</span>
                    {currentReviewItem.status === "saved" && (
                      <Badge variant="outline" className="text-xs font-bold bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                        Đã đẩy lên Wix
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1.5"
                      disabled={isTranslating || isSaving}
                      onClick={() => handleRestore(currentReviewItem.itemId)}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Khôi phục
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1.5"
                      disabled={isTranslating || isSaving}
                      onClick={() => void retryTranslateOne(currentReviewItem.itemId)}
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      Dịch lại
                    </Button>
                  </div>
                </div>

                {currentReviewItem.message && (
                  <div className="text-xs rounded-lg px-3 py-2 border bg-amber-500/5 border-amber-500/20 text-amber-600">
                    {currentReviewItem.message}
                  </div>
                )}

                {selectedFieldDefs.map((field) => {
                  const original = currentReviewItem.sourceFields[field.key] || "";
                  const translated = currentReviewItem.translatedFields[field.key] ?? "";
                  const isHtml = field.type === "HTML";
                  const isStacked = isHtml;
                  return (
                    <div key={field.key} className="rounded-xl border bg-card/40 p-4">
                      <p className="text-xs font-bold text-foreground mb-3">{field.displayName}</p>
                      <div className={cn("grid gap-4", isStacked ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2")}>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
                          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                            <span>{targetLocale.toUpperCase()} · bản dịch (có thể sửa)</span>
                            <span className="normal-case font-medium text-muted-foreground">{translated.length} ký tự</span>
                          </label>
                          <textarea
                            value={translated}
                            onChange={(e) => handleFieldEdit(currentReviewItem.itemId, field.key, e.target.value)}
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
            ) : (
              <p className="text-xs text-muted-foreground italic text-center py-6">Không có sản phẩm nào dịch thành công để duyệt.</p>
            )}

            {problemReviewItems.length > 0 && (
              <div className="space-y-2 pt-2 border-t">
                <p className="text-xs font-bold uppercase tracking-wider text-amber-700 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {problemReviewItems.length} sản phẩm gặp lỗi hoặc bị bỏ qua
                </p>
                <div className="border rounded-xl overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Sản phẩm</TableHead>
                        <TableHead>Trạng thái</TableHead>
                        <TableHead>Lý do</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {problemReviewItems.map((item) => (
                        <TableRow key={item.itemId}>
                          <TableCell className="font-medium max-w-[220px] truncate" title={item.itemName}>{item.itemName}</TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-xs font-bold",
                                item.status === "failed"
                                  ? "bg-red-500/10 text-red-600 border-red-500/20"
                                  : "bg-amber-500/10 text-amber-600 border-amber-500/20"
                              )}
                            >
                              {item.status === "failed" ? "Thất bại" : "Bỏ qua"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground max-w-[420px]">{item.message || "—"}</TableCell>
                          <TableCell>
                            <button
                              type="button"
                              className="text-xs text-primary hover:underline font-semibold shrink-0 whitespace-nowrap"
                              onClick={() => void retryTranslateOne(item.itemId)}
                              disabled={isTranslating || isSaving}
                            >
                              Dịch lại
                            </button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Always-visible progress banner — pinned to the viewport so it stays in sight no matter
          where the admin has scrolled to. */}
      {(isTranslating || isSaving) && (
        <div className="fixed bottom-0 inset-x-0 z-50 border-t bg-background/95 backdrop-blur shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
          <div className="max-w-6xl mx-auto px-4 py-3 space-y-1.5">
            {(() => {
              const progress = isSaving ? saveProgress : translateProgress;
              const label = isSaving ? "Đang đẩy lên Wix" : "Đang dịch với AI";
              const lastLabel = isSaving ? "Vừa đẩy xong" : "Vừa dịch xong";
              return (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                    <span className="flex items-center gap-2 text-sm font-semibold">
                      <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      {label}
                    </span>
                    <span className="text-sm font-bold tabular-nums">
                      {progress.done}/{progress.total} sản phẩm
                    </span>
                  </div>
                  <Progress value={(progress.done / Math.max(1, progress.total)) * 100} />
                  {progress.lastItemName && (
                    <p className="text-xs text-muted-foreground truncate">
                      {lastLabel}: <span className="font-medium text-foreground">{progress.lastItemName}</span> — đang tự động dịch từng sản phẩm, không cần thao tác gì thêm.
                    </p>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      )}

      {viewingItemId && (
        <TranslatedContentViewer
          open={!!viewingItemId}
          itemId={viewingItemId}
          collectionKey={collectionKey}
          targetLocale={targetLocale}
          onClose={() => setViewingItemId(null)}
        />
      )}

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

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Chọn sản phẩm khác mà không lưu?</AlertDialogTitle>
            <AlertDialogDescription>Bạn có thay đổi chưa lưu trong bản dịch. Quay lại bước chọn sản phẩm sẽ mất các thay đổi này.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Tiếp tục chỉnh sửa</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmReset(false);
                resetToSelect();
              }}
            >
              Bỏ thay đổi, chọn lại
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function Alert({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-600">
      <span className="flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" />{message}</span>
      <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={onRetry}>Thử lại</Button>
    </div>
  );
}

function StatusIcon({ status }: { status: ReviewItemStatus }) {
  switch (status) {
    case "translating":
    case "saving":
      return <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />;
    case "translated":
      return <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />;
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
