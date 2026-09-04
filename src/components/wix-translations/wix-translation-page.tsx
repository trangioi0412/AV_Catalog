"use client";

import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { Languages, Search, ChevronLeft, ChevronRight, AlertTriangle, Loader2, RefreshCw, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { TranslationReviewPanel } from "@/components/wix-translations/translation-review-panel";
import { TranslatedContentViewer } from "@/components/wix-translations/translated-content-viewer";
import type { CmsTranslationStatus, WixTranslationConfigResponse, WixTranslationListItem } from "@/types/wix-translation";

const PAGE_SIZE = 20;
// Must match MAX_TRANSLATION_BATCH_SIZE in @/config/wix-translation.config — the server hard-caps
// both /preview's itemIds and /save's items at this many per request (not importable here: that
// config module also reads server-only env vars that shouldn't end up in the client bundle).
const MAX_BATCH_SELECT = 20;

const STATUS_LABEL: Record<CmsTranslationStatus, { label: string; className: string }> = {
  none: { label: "Chưa dịch", className: "bg-muted text-muted-foreground border-border" },
  draft: { label: "Nháp", className: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  published: { label: "Đã xuất bản", className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
};

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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // "Chọn toàn bộ" can select items well beyond the current page, so their display name isn't
  // in `items` (only the current page's 20 rows) — collected alongside itemId there so the
  // review panel can still show a real product name for every item in the batch queue below.
  const [selectedNamesById, setSelectedNamesById] = useState<Record<string, string>>({});
  const [isSelectingAll, setIsSelectingAll] = useState(false);

  const [reviewOpen, setReviewOpen] = useState(false);
  const [viewingItemId, setViewingItemId] = useState<string | null>(null);
  // Selecting more than MAX_BATCH_SELECT items chunks them into successive batches of
  // MAX_BATCH_SELECT (the server's hard per-request cap) run one after another through the
  // SAME review panel — each batch still gets a full human preview/edit/save step, just
  // auto-advancing to the next batch instead of making the admin reselect items each time.
  const [batchQueue, setBatchQueue] = useState<string[][]>([]);
  const [batchIndex, setBatchIndex] = useState(0);

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
  }, [collectionKey, targetLocale, page, search]);

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
      else toast.warning(`Chỉ được chọn tối đa ${MAX_BATCH_SELECT} sản phẩm mỗi lần dịch.`);
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
            toast.warning(`Chỉ được chọn tối đa ${MAX_BATCH_SELECT} sản phẩm mỗi lần dịch.`);
            break;
          }
          next.add(id);
        }
      }
      return next;
    });
  };

  // Selects every item matching the current search across the WHOLE collection, not just the
  // current page — bypasses MAX_BATCH_SELECT (that cap is for manual checkbox clicks only).
  // "Dịch các mục đã chọn" below then runs this selection through the review panel in
  // successive MAX_BATCH_SELECT-sized batches instead of one oversized request.
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
    selectedProviderConfigured;

  // Splits the current selection into MAX_BATCH_SELECT-sized batches and opens the review
  // panel on the first one; onSaved (below) advances through the rest automatically.
  const startTranslateSelected = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += MAX_BATCH_SELECT) chunks.push(ids.slice(i, i + MAX_BATCH_SELECT));
    setBatchQueue(chunks);
    setBatchIndex(0);
    setReviewOpen(true);
  };

  const currentBatchIds = batchQueue[batchIndex] || [];
  const isBatchedRun = batchQueue.length > 1;

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
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
          <Languages className="w-6 h-6 text-primary" />
          Dịch đa ngôn ngữ Wix CMS
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Lấy nội dung từ Wix CMS, dịch và đồng bộ bản dịch vào Wix Multilingual.
        </p>
      </div>

      {configError && (
        <Alert message={configError} onRetry={loadConfig} />
      )}

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
        <CardHeader>
          <CardTitle className="text-base">Thiết lập</CardTitle>
          <CardDescription>Chọn collection, ngôn ngữ, và các field cần dịch.</CardDescription>
        </CardHeader>
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
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Sản phẩm trong CMS</CardTitle>
            <CardDescription>
              {total > 0
                ? `Tổng ${total} sản phẩm — tick thủ công tối đa ${MAX_BATCH_SELECT} item, hoặc "Chọn toàn bộ" để dịch cả collection (chạy tuần tự theo từng đợt ${MAX_BATCH_SELECT} item).`
                : `Chọn tối đa ${MAX_BATCH_SELECT} sản phẩm mỗi lần tick, hoặc "Chọn toàn bộ" để dịch cả collection theo từng đợt.`}
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={() => loadItems()} disabled={itemsLoading}>
            <RefreshCw className={cn("w-3.5 h-3.5", itemsLoading && "animate-spin")} />
            Tải lại
          </Button>
        </CardHeader>
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
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                className="text-xs text-primary hover:underline font-semibold disabled:opacity-50 disabled:no-underline shrink-0"
                onClick={() => void selectAllMatching()}
                disabled={isSelectingAll || !collectionKey || !targetLocale || itemsLoading}
              >
                {isSelectingAll ? "Đang chọn toàn bộ..." : "Chọn toàn bộ sản phẩm"}
              </button>
              {selectedIds.size > 0 && (
                <>
                  <span className="text-xs font-semibold text-primary">Đã chọn {selectedIds.size} sản phẩm</span>
                  <Button size="sm" className="h-8 text-xs gap-1.5" disabled={!canTranslate} onClick={startTranslateSelected}>
                    <Languages className="w-3.5 h-3.5" />
                    Dịch các mục đã chọn
                    {selectedIds.size > MAX_BATCH_SELECT ? ` (${Math.ceil(selectedIds.size / MAX_BATCH_SELECT)} đợt)` : ""}
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

          {isBatchedRun && reviewOpen && (
            <div className="flex items-center gap-2 rounded-lg border bg-primary/5 border-primary/20 px-3 py-2 text-xs font-semibold text-primary">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              Đang dịch theo đợt — Đợt {batchIndex + 1}/{batchQueue.length} ({currentBatchIds.length} sản phẩm/đợt). Lưu xong một đợt sẽ tự động mở đợt tiếp theo.
            </div>
          )}

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
                                <Badge key={f} variant="outline" className="text-[10px] font-normal bg-red-500/5 text-red-600 border-red-500/20">
                                  {f}
                                </Badge>
                              ))}
                              {extraMissing > 0 && (
                                <Badge variant="outline" className="text-[10px] font-normal">
                                  +{extraMissing}
                                </Badge>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {item.translationStatus === "none" ? (
                            <Badge variant="outline" className={cn("text-[10px] font-bold", status.className)}>{status.label}</Badge>
                          ) : (
                            <button
                              type="button"
                              className="inline-flex"
                              title="Xem nội dung bản dịch đã lưu"
                              onClick={() => setViewingItemId(item.itemId)}
                            >
                              <Badge
                                variant="outline"
                                className={cn("text-[10px] font-bold cursor-pointer hover:opacity-80", status.className)}
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
      </Card>

      {!canTranslate && selectedIds.size > 0 && (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5" />
          Kiểm tra lại: đã chọn field, ngôn ngữ nguồn/đích khác nhau, và cấu hình Wix/translation provider ở trên.
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

      {reviewOpen && config && currentBatchIds.length > 0 && (
        <TranslationReviewPanel
          // Remounts the panel fresh for each batch — it only ever runs its AI preview once per
          // mount (see startedRef in TranslationReviewPanel), so a new itemIds array for the next
          // batch needs a new instance, not a prop update on the same one.
          key={batchIndex}
          open={reviewOpen}
          itemIds={currentBatchIds}
          itemNamesById={itemNamesById}
          fields={selectedFieldDefs}
          collectionKey={collectionKey}
          sourceLocale={sourceLocale}
          targetLocale={targetLocale}
          overwriteExisting={overwriteMode === "overwrite"}
          providerKind={providerKind || undefined}
          providerModel={providerKind === "ollama" ? effectiveOllamaModel || undefined : undefined}
          onClose={() => {
            setReviewOpen(false);
            setBatchQueue([]);
            setBatchIndex(0);
          }}
          onSaved={() => {
            const nextIndex = batchIndex + 1;
            if (nextIndex < batchQueue.length) {
              setBatchIndex(nextIndex);
              void loadItems();
            } else {
              setReviewOpen(false);
              setBatchQueue([]);
              setBatchIndex(0);
              setSelectedIds(new Set());
              setSelectedNamesById({});
              void loadItems();
            }
          }}
        />
      )}
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
