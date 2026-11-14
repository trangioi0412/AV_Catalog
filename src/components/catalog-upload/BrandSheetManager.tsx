"use client";

/**
 * "Dữ liệu hãng (Excel)" tab of /admin/catalog-upload.
 *
 * Reads the per-brand Google Sheet tabs written by DataCrawler, lets an editor
 * filter by category / data quality, fix or delete bad rows (written back to
 * the Sheet), and run "Tải ảnh & upload brand mới":
 *   1. create the brand in the Wix `brand` collection if missing,
 *   2. download images to the crawler's local Data/<brand>/ folder,
 *   3. upload images to Wix Media in small batches (attached to CMS
 *      products that exist and have no image yet).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  RefreshCw,
  Loader2,
  Pencil,
  Trash2,
  Search,
  ImageUp,
  AlertTriangle,
  CheckCircle2,
  Square,
  Database,
} from "lucide-react";

interface BrandTabSummary {
  tab: string;
  productCount: number;
  brandName: string;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
}

interface BrandSheetRow {
  rowNumber: number;
  key: string;
  values: Record<string, string>;
}

interface RowImageResult {
  rowNumber: number;
  title: string;
  status: "uploaded" | "skipped_existing" | "no_images" | "failed";
  uploaded: number;
  attachedToCms: boolean;
  errors: string[];
}

const ALL = "__all__";
const NO_CATEGORY = "__none__";
const PAGE_SIZE = 200;
const PUBLISH_BATCH = 5;
const RECENT_DAYS = 7;

const SHORT_FIELDS = ["Title", "product (item)", "Category", "Product", "Series", "Brand"];
const LONG_FIELDS = ["Product Overview", "Main Feature", "Technical Specifications", "image", "Datasheet"];

type QualityFilter = "all" | "no_image" | "no_specs" | "no_model" | "no_category";

const QUALITY_LABELS: Record<QualityFilter, string> = {
  all: "Tất cả",
  no_image: "Thiếu ảnh",
  no_specs: "Thiếu thông số",
  no_model: "Thiếu model",
  no_category: "Thiếu category",
};

function lines(value: string | undefined): string[] {
  return (value || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function matchesQuality(row: BrandSheetRow, q: QualityFilter): boolean {
  const v = row.values;
  switch (q) {
    case "no_image":
      return lines(v["image"]).length === 0;
    case "no_specs":
      return lines(v["Technical Specifications"]).length === 0;
    case "no_model":
      return !(v["product (item)"] || "").trim();
    case "no_category":
      return !(v["Category"] || "").trim();
    default:
      return true;
  }
}

function isRecent(iso: string | null): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return !Number.isNaN(t) && Date.now() - t < RECENT_DAYS * 24 * 3600 * 1000;
}

function formatDate(iso: string | null): string {
  if (!iso) return "chưa có log đồng bộ";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("vi-VN");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON from our own routes, shape known per call site
async function readJson(res: Response): Promise<any> {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.detail || data?.error || `HTTP ${res.status}`);
  return data;
}

async function fetchBrands(): Promise<BrandTabSummary[]> {
  const data = await readJson(await fetch("/api/catalog-upload/brand-sheets", { cache: "no-store" }));
  return data.brands || [];
}

export function BrandSheetManager() {
  const [brands, setBrands] = useState<BrandTabSummary[]>([]);
  const [brandsLoading, setBrandsLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState("");

  const [rows, setRows] = useState<BrandSheetRow[]>([]);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [category, setCategory] = useState(ALL);
  const [quality, setQuality] = useState<QualityFilter>("all");
  const [search, setSearch] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [checked, setChecked] = useState<Set<number>>(new Set());

  const [editing, setEditing] = useState<BrandSheetRow | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const [deleteTargets, setDeleteTargets] = useState<BrandSheetRow[] | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [publishing, setPublishing] = useState(false);
  const [publishStep, setPublishStep] = useState("");
  const [publishDone, setPublishDone] = useState(0);
  const [publishTotal, setPublishTotal] = useState(0);
  const [publishResults, setPublishResults] = useState<RowImageResult[]>([]);
  const [publishLog, setPublishLog] = useState<string[]>([]);
  const stopRef = useRef(false);

  const brand = brands.find((b) => b.tab === selectedTab) || null;

  const loadBrands = useCallback(async () => {
    setBrandsLoading(true);
    try {
      setBrands(await fetchBrands());
    } catch (err) {
      toast.error(`Không tải được danh sách hãng: ${(err as Error).message}`);
    } finally {
      setBrandsLoading(false);
    }
  }, []);

  const loadRows = useCallback(async (tab: string) => {
    if (!tab) return;
    setRowsLoading(true);
    setChecked(new Set());
    try {
      const data = await readJson(
        await fetch(`/api/catalog-upload/brand-sheets/${encodeURIComponent(tab)}`, { cache: "no-store" })
      );
      setRows(data.rows || []);
      setVisible(PAGE_SIZE);
    } catch (err) {
      setRows([]);
      toast.error(`Không tải được dữ liệu hãng: ${(err as Error).message}`);
    } finally {
      setRowsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchBrands()
      .then((b) => {
        if (!cancelled) setBrands(b);
      })
      .catch((err) => toast.error(`Không tải được danh sách hãng: ${(err as Error).message}`))
      .finally(() => {
        if (!cancelled) setBrandsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function selectBrand(tab: string) {
    setSelectedTab(tab);
    setCategory(ALL);
    setQuality("all");
    setSearch("");
    setPublishResults([]);
    setPublishLog([]);
    void loadRows(tab);
  }

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const c = (r.values["Category"] || "").trim() || NO_CATEGORY;
      counts.set(c, (counts.get(c) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const c = (r.values["Category"] || "").trim() || NO_CATEGORY;
      if (category !== ALL && c !== category) return false;
      if (!matchesQuality(r, quality)) return false;
      if (!q) return true;
      return [r.values["Title"], r.values["product (item)"], r.values["Product"]].some((v) =>
        (v || "").toLowerCase().includes(q)
      );
    });
  }, [rows, category, quality, search]);

  const allFilteredChecked = filtered.length > 0 && filtered.every((r) => checked.has(r.rowNumber));
  const checkedRows = rows.filter((r) => checked.has(r.rowNumber));

  function toggleRow(n: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }

  function toggleAllFiltered() {
    setChecked((prev) => {
      const next = new Set(prev);
      if (allFilteredChecked) filtered.forEach((r) => next.delete(r.rowNumber));
      else filtered.forEach((r) => next.add(r.rowNumber));
      return next;
    });
  }

  function openEdit(row: BrandSheetRow) {
    setEditing(row);
    setDraft({ ...row.values });
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    try {
      const data = await readJson(
        await fetch(`/api/catalog-upload/brand-sheets/${encodeURIComponent(selectedTab)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rowNumber: editing.rowNumber, key: editing.key, values: draft }),
        })
      );
      const updated: BrandSheetRow = data.row;
      setRows((prev) => prev.map((r) => (r.rowNumber === updated.rowNumber ? updated : r)));
      setEditing(null);
      toast.success(`Đã lưu dòng ${updated.rowNumber} lên Google Sheet`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTargets || deleteTargets.length === 0) return;
    setDeleting(true);
    try {
      const data = await readJson(
        await fetch(`/api/catalog-upload/brand-sheets/${encodeURIComponent(selectedTab)}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: deleteTargets.map((r) => ({ rowNumber: r.rowNumber, key: r.key })) }),
        })
      );
      toast.success(`Đã xoá ${data.deleted} sản phẩm khỏi Google Sheet`);
      setDeleteTargets(null);
      // Row numbers below the deleted rows shift: reload instead of patching locally.
      await loadRows(selectedTab);
      void loadBrands();
    } catch (err) {
      toast.error((err as Error).message);
      if (/thay đổi trên Sheet/.test((err as Error).message)) await loadRows(selectedTab);
    } finally {
      setDeleting(false);
    }
  }

  async function runPublish() {
    if (!brand) return;
    const targets = checkedRows.length > 0 ? checkedRows : filtered;
    const withImages = targets.filter((r) => lines(r.values["image"]).length > 0);

    stopRef.current = false;
    setPublishing(true);
    setPublishResults([]);
    setPublishLog([]);
    setPublishDone(0);
    setPublishTotal(withImages.length);
    const log = (msg: string) => setPublishLog((prev) => [...prev, msg]);
    const publishUrl = `/api/catalog-upload/brand-sheets/${encodeURIComponent(brand.tab)}/publish`;

    try {
      setPublishStep("Tạo brand trên Wix");
      const b = await readJson(
        await fetch(publishUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "brand" }),
        })
      );
      log(b.created ? `✓ Đã tạo brand "${b.brand.title}" trên Wix` : `• Brand "${b.brand.title}" đã có trên Wix`);
      // Wix's own brand title names the Media folder ("Vissonic", not the tab key).
      const mediaBrandName: string = b.brand.title || brand.brandName;

      setPublishStep(`Tải ảnh về máy (Data/${brand.tab})`);
      try {
        const d = await readJson(
          await fetch("/api/manufacturer-sync/images/download", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ manufacturer: brand.tab }),
          })
        );
        log(`✓ Tải ảnh về máy: ${d.downloaded} mới, ${d.skipped_existing} đã có, ${d.failed?.length ?? 0} lỗi`);
      } catch (err) {
        // The local copy is a convenience; the Wix upload below does not depend on it.
        log(`⚠ Không tải được ảnh về máy: ${(err as Error).message}`);
      }

      setPublishStep("Upload ảnh lên Wix Media");
      for (let i = 0; i < withImages.length; i += PUBLISH_BATCH) {
        if (stopRef.current) {
          log("■ Đã dừng theo yêu cầu");
          break;
        }
        const batch = withImages.slice(i, i + PUBLISH_BATCH);
        try {
          const data = await readJson(
            await fetch(publishUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "images",
                brandName: mediaBrandName,
                rows: batch.map((r) => ({ rowNumber: r.rowNumber, key: r.key })),
              }),
            })
          );
          setPublishResults((prev) => [...prev, ...(data.results as RowImageResult[])]);
        } catch (err) {
          const msg = (err as Error).message;
          log(`✕ Lỗi lô dòng ${batch[0].rowNumber}-${batch[batch.length - 1].rowNumber}: ${msg}`);
          setPublishResults((prev) => [
            ...prev,
            ...batch.map((r) => ({
              rowNumber: r.rowNumber,
              title: r.values["Title"] || "",
              status: "failed" as const,
              uploaded: 0,
              attachedToCms: false,
              errors: [msg],
            })),
          ]);
          if (/thay đổi trên Sheet/.test(msg)) break;
        }
        setPublishDone(Math.min(i + PUBLISH_BATCH, withImages.length));
      }
      setPublishStep("Hoàn tất");
      toast.success(`Hoàn tất upload brand ${brand.brandName}`);
    } catch (err) {
      setPublishStep("Lỗi");
      log(`✕ ${(err as Error).message}`);
      toast.error((err as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  const summary = useMemo(() => {
    const s = { uploaded: 0, files: 0, attached: 0, skipped: 0, failed: 0 };
    for (const r of publishResults) {
      if (r.status === "uploaded") s.uploaded += 1;
      if (r.status === "skipped_existing") s.skipped += 1;
      if (r.status === "failed") s.failed += 1;
      if (r.attachedToCms) s.attached += 1;
      s.files += r.uploaded;
    }
    return s;
  }, [publishResults]);

  const publishTargetCount = (checkedRows.length > 0 ? checkedRows : filtered).length;

  return (
    <div className="space-y-6">
      <Card className="border-border/60 bg-card shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="w-4 h-4 text-primary" /> Dữ liệu hãng từ Excel (Google Sheet)
          </CardTitle>
          <CardDescription>
            Mỗi hãng là một tab do DataCrawler ghi ra. Sửa và xoá được ghi thẳng vào Google Sheet.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-3">
          <Select value={selectedTab} onValueChange={selectBrand} disabled={publishing}>
            <SelectTrigger className="w-full sm:w-96">
              <SelectValue placeholder={brandsLoading ? "Đang tải..." : "Chọn hãng..."} />
            </SelectTrigger>
            <SelectContent>
              {brands.map((b) => (
                <SelectItem key={b.tab} value={b.tab}>
                  {b.brandName} · {b.productCount} SP{isRecent(b.lastSyncedAt) ? " · mới cập nhật" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={() => {
              void loadBrands();
              if (selectedTab) void loadRows(selectedTab);
            }}
            disabled={brandsLoading || rowsLoading || publishing}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${brandsLoading || rowsLoading ? "animate-spin" : ""}`} />
            Tải lại
          </Button>
          {brand && (
            <div className="text-xs text-muted-foreground self-center">
              Đồng bộ gần nhất: {formatDate(brand.lastSyncedAt)}
              {brand.lastSyncStatus ? ` (${brand.lastSyncStatus})` : ""}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedTab && (
        <Card className="border-border/60 bg-card shadow-sm">
          <CardHeader className="space-y-3">
            <div className="flex flex-col lg:flex-row gap-3">
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-full lg:w-72">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Tất cả category ({rows.length})</SelectItem>
                  {categories.map(([c, n]) => (
                    <SelectItem key={c} value={c}>
                      {c === NO_CATEGORY ? "(Không có category)" : c} ({n})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={quality} onValueChange={(v) => setQuality(v as QualityFilter)}>
                <SelectTrigger className="w-full lg:w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(QUALITY_LABELS) as QualityFilter[]).map((q) => (
                    <SelectItem key={q} value={q}>
                      {QUALITY_LABELS[q]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Tìm theo tên / model..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {filtered.length} / {rows.length} sản phẩm · đã chọn {checkedRows.length}
              </span>
              <div className="flex-1" />
              <Button
                variant="destructive"
                size="sm"
                disabled={checkedRows.length === 0 || publishing}
                onClick={() => setDeleteTargets(checkedRows)}
              >
                <Trash2 className="w-4 h-4 mr-1" /> Xoá {checkedRows.length || ""} đã chọn
              </Button>
              <Button size="sm" disabled={publishing || rowsLoading || publishTargetCount === 0} onClick={runPublish}>
                {publishing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ImageUp className="w-4 h-4 mr-1" />}
                Tải ảnh & upload brand mới ({checkedRows.length > 0 ? "đã chọn" : "đang lọc"}: {publishTargetCount})
              </Button>
              {publishing && (
                <Button size="sm" variant="outline" onClick={() => (stopRef.current = true)}>
                  <Square className="w-4 h-4 mr-1" /> Dừng
                </Button>
              )}
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {(publishing || publishLog.length > 0) && (
              <div className="rounded-xl border border-border/60 p-4 space-y-2 bg-muted/20">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold">{publishStep}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {publishDone}/{publishTotal} sản phẩm có ảnh
                  </span>
                </div>
                <Progress value={publishTotal ? (publishDone / publishTotal) * 100 : 0} />
                {publishResults.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    {summary.uploaded} SP đã upload ({summary.files} ảnh) · {summary.attached} gắn vào CMS ·{" "}
                    {summary.skipped} đã có trên Wix · {summary.failed} lỗi
                  </div>
                )}
                <ul className="text-xs space-y-0.5 font-mono">
                  {publishLog.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
                {publishResults.some((r) => r.errors.length > 0) && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-amber-600">Chi tiết lỗi</summary>
                    <ul className="mt-1 space-y-0.5 max-h-48 overflow-y-auto">
                      {publishResults
                        .filter((r) => r.errors.length > 0)
                        .map((r) => (
                          <li key={r.rowNumber}>
                            Dòng {r.rowNumber} ({r.title}): {r.errors.join("; ")}
                          </li>
                        ))}
                    </ul>
                  </details>
                )}
              </div>
            )}

            {rowsLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Đang đọc Google Sheet...
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">Không có sản phẩm phù hợp</div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border/60">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th className="p-2 w-8">
                        <Checkbox checked={allFilteredChecked} onCheckedChange={toggleAllFiltered} aria-label="Chọn tất cả" />
                      </th>
                      <th className="p-2 text-left">Dòng</th>
                      <th className="p-2 text-left">Tên sản phẩm</th>
                      <th className="p-2 text-left">Model</th>
                      <th className="p-2 text-left">Category</th>
                      <th className="p-2 text-center">Ảnh</th>
                      <th className="p-2 text-center">Thông số</th>
                      <th className="p-2 text-right">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, visible).map((r) => {
                      const images = lines(r.values["image"]);
                      const specs = lines(r.values["Technical Specifications"]).length;
                      const result = publishResults.find((p) => p.rowNumber === r.rowNumber);
                      return (
                        <tr key={r.rowNumber} className="border-t border-border/40 hover:bg-accent/30">
                          <td className="p-2">
                            <Checkbox
                              checked={checked.has(r.rowNumber)}
                              onCheckedChange={() => toggleRow(r.rowNumber)}
                              aria-label={`Chọn dòng ${r.rowNumber}`}
                            />
                          </td>
                          <td className="p-2 tabular-nums text-muted-foreground">{r.rowNumber}</td>
                          <td className="p-2 max-w-xs">
                            <div className="flex items-center gap-2">
                              {images[0] && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={images[0]}
                                  alt=""
                                  className="w-8 h-8 object-contain rounded bg-white shrink-0"
                                  loading="lazy"
                                />
                              )}
                              <span className="truncate" title={r.values["Title"]}>
                                {r.values["Title"] || <em className="text-rose-500">(trống)</em>}
                              </span>
                              {result?.status === "uploaded" && (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                              )}
                              {result?.status === "failed" && (
                                <AlertTriangle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                              )}
                            </div>
                          </td>
                          <td className="p-2 font-mono text-xs">
                            {r.values["product (item)"] || <span className="text-amber-600">—</span>}
                          </td>
                          <td className="p-2 text-xs">
                            {r.values["Category"] || <span className="text-amber-600">—</span>}
                          </td>
                          <td className="p-2 text-center">
                            {images.length > 0 ? (
                              images.length
                            ) : (
                              <Badge variant="outline" className="text-amber-600 border-amber-500/30">
                                0
                              </Badge>
                            )}
                          </td>
                          <td className="p-2 text-center">
                            {specs > 0 ? (
                              specs
                            ) : (
                              <Badge variant="outline" className="text-amber-600 border-amber-500/30">
                                0
                              </Badge>
                            )}
                          </td>
                          <td className="p-2 text-right whitespace-nowrap">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => openEdit(r)}
                              aria-label="Sửa"
                              disabled={publishing}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setDeleteTargets([r])}
                              aria-label="Xoá"
                              disabled={publishing}
                            >
                              <Trash2 className="w-4 h-4 text-rose-500" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filtered.length > visible && (
                  <div className="p-3 text-center border-t border-border/40">
                    <Button variant="outline" size="sm" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
                      Hiện thêm ({filtered.length - visible} còn lại)
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && !saving && setEditing(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Sửa sản phẩm · dòng {editing?.rowNumber}</DialogTitle>
            <DialogDescription>Thay đổi được ghi vào tab &quot;{selectedTab}&quot; trên Google Sheet.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {SHORT_FIELDS.map((f) => (
              <label key={f} className="text-xs font-medium space-y-1">
                <span>{f}</span>
                <Input value={draft[f] ?? ""} onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))} />
              </label>
            ))}
          </div>
          <div className="space-y-3">
            {LONG_FIELDS.map((f) => (
              <label key={f} className="text-xs font-medium space-y-1 block">
                <span>
                  {f}
                  {f === "image" || f === "Datasheet" ? " (mỗi URL một dòng)" : ""}
                </span>
                <textarea
                  className="w-full min-h-24 rounded-md border border-input bg-transparent px-3 py-2 text-sm font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={draft[f] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))}
                />
              </label>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              Huỷ
            </Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Lưu lên Sheet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTargets} onOpenChange={(o) => !o && !deleting && setDeleteTargets(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xoá {deleteTargets?.length} sản phẩm?</AlertDialogTitle>
            <AlertDialogDescription>
              Các dòng sẽ bị xoá vĩnh viễn khỏi tab &quot;{selectedTab}&quot; trên Google Sheet. Lần đồng bộ NSX sau,
              crawler có thể thêm lại sản phẩm nếu trang đó vẫn còn trên website hãng.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteTargets && deleteTargets.length <= 10 && (
            <ul className="text-xs text-muted-foreground list-disc pl-5">
              {deleteTargets.map((r) => (
                <li key={r.rowNumber}>
                  Dòng {r.rowNumber}: {r.values["Title"] || r.values["product (item)"]}
                </li>
              ))}
            </ul>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Huỷ</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={deleting}
            >
              {deleting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />} Xoá
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
