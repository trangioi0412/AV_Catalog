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
import type { CmsTranslationStatus, WixTranslationConfigResponse, WixTranslationListItem } from "@/types/wix-translation";

const PAGE_SIZE = 20;
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

  const [items, setItems] = useState<WixTranslationListItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [reviewOpen, setReviewOpen] = useState(false);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    setCollectionKey((prev) => prev || cfg.collections[0]?.key || "");
    setSourceLocale((prev) => prev || cfg.defaultSourceLocale || "vi");
    setTargetLocale((prev) => prev || cfg.defaultTargetLocale || "en");
    setSelectedFieldKeys((prev) => (prev.size > 0 ? prev : new Set(cfg.fields.map((f) => f.key))));
    setConfigLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadConfig();
  }, [loadConfig]);

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

  const toggleField = (key: string) => {
    setSelectedFieldKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const itemNamesById = useMemo(() => Object.fromEntries(items.map((i) => [i.itemId, i.name])), [items]);
  const selectedFieldDefs = useMemo(
    () => (config?.fields || []).filter((f) => selectedFieldKeys.has(f.key)).map((f) => ({ key: f.key, displayName: f.displayName })),
    [config, selectedFieldKeys]
  );

  const canTranslate =
    selectedIds.size > 0 &&
    selectedFieldDefs.length > 0 &&
    Boolean(sourceLocale) &&
    Boolean(targetLocale) &&
    sourceLocale !== targetLocale &&
    Boolean(config?.wixConfigured) &&
    Boolean(config?.multilingualReady) &&
    Boolean(config?.translationProvider.configured);

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
        <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Sản phẩm trong CMS</CardTitle>
            <CardDescription>Chọn tối đa {MAX_BATCH_SELECT} sản phẩm mỗi lần dịch.</CardDescription>
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
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-primary">Đã chọn {selectedIds.size} sản phẩm</span>
                <Button size="sm" className="h-8 text-xs gap-1.5" disabled={!canTranslate} onClick={() => setReviewOpen(true)}>
                  <Languages className="w-3.5 h-3.5" />
                  Dịch các mục đã chọn
                </Button>
                <button className="text-xs text-muted-foreground hover:text-foreground underline" onClick={() => setSelectedIds(new Set())}>
                  Bỏ chọn
                </button>
              </div>
            )}
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
                  <TableHead>Model</TableHead>
                  <TableHead>Thương hiệu</TableHead>
                  <TableHead>Ngày cập nhật</TableHead>
                  <TableHead>Trạng thái dịch</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {itemsLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10 text-muted-foreground text-sm">
                      <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                      Đang tải...
                    </TableCell>
                  </TableRow>
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10 text-muted-foreground text-sm italic">
                      Không có sản phẩm nào phù hợp.
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => {
                    const status = STATUS_LABEL[item.translationStatus];
                    return (
                      <TableRow key={item.itemId} className={cn(selectedIds.has(item.itemId) && "bg-primary/5")}>
                        <TableCell>
                          <Checkbox checked={selectedIds.has(item.itemId)} onCheckedChange={() => toggleItem(item.itemId)} />
                        </TableCell>
                        <TableCell className="font-medium max-w-[260px] truncate" title={item.name}>{item.name}</TableCell>
                        <TableCell className="font-mono text-xs">{item.model || "—"}</TableCell>
                        <TableCell className="text-xs">{item.brand || "—"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {item.updatedDate ? new Date(item.updatedDate).toLocaleDateString("vi-VN") : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn("text-[10px] font-bold", status.className)}>{status.label}</Badge>
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

      {reviewOpen && config && (
        <TranslationReviewPanel
          open={reviewOpen}
          itemIds={Array.from(selectedIds)}
          itemNamesById={itemNamesById}
          fields={selectedFieldDefs}
          collectionKey={collectionKey}
          sourceLocale={sourceLocale}
          targetLocale={targetLocale}
          overwriteExisting={overwriteMode === "overwrite"}
          onClose={() => setReviewOpen(false)}
          onSaved={() => {
            setReviewOpen(false);
            setSelectedIds(new Set());
            void loadItems();
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
