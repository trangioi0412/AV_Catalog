"use client";

/**
 * "Upload sản phẩm mới lên CMS" (DataCrawler). Lists only the brand tabs of
 * the shared Google Sheet that still have products missing on Wix CMS, and
 * only those products. Uploaded rows (product item in Import1 + images to
 * Wix Media) leave the list; a brand leaves the picker once it has none left.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
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
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  CloudUpload,
  Filter,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  Square,
  Trash2,
} from "lucide-react";

interface BrandWithNewProducts {
  tab: string;
  brandName: string;
  brandInCms: boolean;
  newCount: number;
  total: number;
}

interface NewProductRow {
  rowNumber: number;
  key: string;
  title: string;
  item: string;
  category: string;
  imageCount: number;
  hasSpecs: boolean;
  hasOverview: boolean;
}

interface NewProductsResult {
  tab: string;
  brandName: string;
  brandInCms: boolean;
  cmsBrandId: string | null;
  counts: { total: number; new: number; onCms: number };
  rows: NewProductRow[];
}

interface UploadRowResult {
  rowNumber: number;
  title: string;
  status: "created" | "exists" | "failed";
  cmsId: string | null;
  imagesUploaded: number;
  errors: string[];
}

const PAGE_SIZE = 100;
const API = "/api/datacrawler/new-products";
// Filter key for rows with an empty Category cell.
const NO_CATEGORY = "__none__";
const categoryOf = (r: NewProductRow) => r.category || NO_CATEGORY;
const categoryLabel = (c: string) =>
  c === NO_CATEGORY ? "(Chưa có category)" : c;

/** Rows per AI call (matches AV_CHECK_MAX_ROWS on the server). */
const AV_BATCH = 10;
/** Parallel AI requests (Ollama queues the rest). */
const AV_CONCURRENCY = 2;
type AvVerdict = "av" | "not_av" | "unsure";
interface AvResult {
  verdict: AvVerdict;
  reason: string;
}
type AvFilter = "all" | AvVerdict | "unchecked";
const AV_LABEL: Record<AvVerdict, string> = {
  av: "Đúng AV",
  not_av: "Không phải AV",
  unsure: "Chưa chắc",
};
const AV_BADGE: Record<AvVerdict, string> = {
  av: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  not_av: "bg-red-500/10 text-red-700 dark:text-red-400",
  unsure: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON from our own routes
async function readJson(res: Response): Promise<any> {
  const data = await res.json().catch(() => null);
  if (!res.ok)
    throw new Error(data?.detail || data?.error || `HTTP ${res.status}`);
  return data;
}

function post(body: Record<string, unknown>) {
  return fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(readJson);
}

export function NewProductUpload() {
  const [brands, setBrands] = useState<BrandWithNewProducts[]>([]);
  const [loadingBrands, setLoadingBrands] = useState(true);
  const [tab, setTab] = useState("");
  const [result, setResult] = useState<NewProductsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  // Categories to keep; empty = no filter (all shown).
  const [keepCategories, setKeepCategories] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(PAGE_SIZE);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [uploaded, setUploaded] = useState<UploadRowResult[]>([]);
  // Failed rows stay in the list with their error.
  const [failures, setFailures] = useState<Map<number, string[]>>(new Map());
  const stopRef = useRef(false);
  const [deleteTargets, setDeleteTargets] = useState<NewProductRow[] | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  // AI "is this an AV product?" results, by row key (survives row shifts after a delete).
  const [avResults, setAvResults] = useState<Map<string, AvResult>>(new Map());
  const [avFilter, setAvFilter] = useState<AvFilter>("all");
  const [checkingAv, setCheckingAv] = useState(false);
  const [avProgress, setAvProgress] = useState({ done: 0, total: 0 });

  const fetchBrands = useCallback(
    () =>
      fetch(API, { cache: "no-store" })
        .then(readJson)
        .then((data) => (data.brands || []) as BrandWithNewProducts[]),
    [],
  );

  useEffect(() => {
    let alive = true;
    fetchBrands()
      .then((list) => {
        if (alive) setBrands(list);
      })
      .catch((err: Error) =>
        toast.error(`Không tải được danh sách hãng: ${err.message}`),
      )
      .finally(() => {
        if (alive) setLoadingBrands(false);
      });
    return () => {
      alive = false;
    };
  }, [fetchBrands]);

  async function loadBrands() {
    setLoadingBrands(true);
    try {
      setBrands(await fetchBrands());
    } catch (err) {
      toast.error(`Không tải được danh sách hãng: ${(err as Error).message}`);
    } finally {
      setLoadingBrands(false);
    }
  }

  const load = useCallback(async (target: string) => {
    if (!target) return;
    setLoading(true);
    setShown(PAGE_SIZE);
    setChecked(new Set());
    setFailures(new Map());
    setUploaded([]);
    setDone(0);
    setTotal(0);
    try {
      const data: NewProductsResult = await readJson(
        await fetch(`${API}?tab=${encodeURIComponent(target)}`, {
          cache: "no-store",
        }),
      );
      setResult(data);
    } catch (err) {
      setResult(null);
      toast.error(`Không đọc được dữ liệu: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  /** Categories of the remaining new rows, with counts; rows without one grouped last. */
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of result?.rows ?? []) {
      const c = categoryOf(r);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()].sort(
      ([a], [b]) =>
        Number(a === NO_CATEGORY) - Number(b === NO_CATEGORY) ||
        a.localeCompare(b),
    );
  }, [result]);

  // Drop kept categories whose last row was uploaded or deleted.
  const kept = useMemo(
    () =>
      new Set(categories.map(([c]) => c).filter((c) => keepCategories.has(c))),
    [categories, keepCategories],
  );

  /** Rows outside the kept categories (search box ignored): the "delete the rest" targets. */
  const restRows = useMemo(
    () =>
      kept.size === 0 || !result
        ? []
        : result.rows.filter((r) => !kept.has(categoryOf(r))),
    [result, kept],
  );

  const toggleCategory = (c: string) => {
    setKeepCategories((prev) => {
      const next = new Set(
        [...prev].filter((x) => categories.some(([k]) => k === x)),
      );
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
    setShown(PAGE_SIZE);
  };

  const filtered = useMemo(() => {
    if (!result) return [];
    const q = query.trim().toLowerCase();
    return result.rows.filter(
      (r) =>
        (kept.size === 0 || kept.has(categoryOf(r))) &&
        (avFilter === "all" ||
          (avFilter === "unchecked"
            ? !avResults.has(r.key)
            : avResults.get(r.key)?.verdict === avFilter)) &&
        (!q ||
          [r.title, r.item, r.category].some((s) =>
            s.toLowerCase().includes(q),
          )),
    );
  }, [result, query, kept, avFilter, avResults]);

  const avCounts = useMemo(() => {
    const c = { av: 0, not_av: 0, unsure: 0, unchecked: 0 };
    for (const r of result?.rows ?? []) {
      const v = avResults.get(r.key)?.verdict;
      c[v ?? "unchecked"] += 1;
    }
    return c;
  }, [result, avResults]);

  const notAvRows = useMemo(
    () =>
      result
        ? result.rows.filter((r) => avResults.get(r.key)?.verdict === "not_av")
        : [],
    [result, avResults],
  );

  /**
   * AI check in one run: the ticked rows (re-check), or else EVERY new row of the
   * brand not checked yet -- category/search/AV filters do not limit it. A batch
   * that fails is counted and skipped, the run goes on; Stop ends after the
   * batches in flight.
   */
  async function runAvCheck() {
    if (!result) return;
    const targets =
      checked.size > 0
        ? result.rows.filter((r) => checked.has(r.rowNumber))
        : result.rows.filter((r) => !avResults.has(r.key));
    if (targets.length === 0) {
      toast.info("Tất cả sản phẩm của hãng đã được kiểm tra AV");
      return;
    }
    const batches: NewProductRow[][] = [];
    for (let i = 0; i < targets.length; i += AV_BATCH)
      batches.push(targets.slice(i, i + AV_BATCH));

    stopRef.current = false;
    setCheckingAv(true);
    setAvProgress({ done: 0, total: targets.length });
    let doneRows = 0;
    let notAv = 0;
    let unanswered = 0;
    const errors: string[] = [];
    let sheetChanged = false;
    let next = 0;

    const worker = async () => {
      while (next < batches.length && !stopRef.current && !sheetChanged) {
        const batch = batches[next++];
        try {
          const data = await post({
            tab: result.tab,
            action: "av-check",
            brandName: result.brandName,
            rows: batch.map((r) => ({ rowNumber: r.rowNumber, key: r.key })),
          });
          const results = (data.results || []) as {
            key: string;
            verdict: AvVerdict;
            reason: string;
            checked: boolean;
          }[];
          const answered = results.filter((x) => x.checked);
          unanswered += results.length - answered.length;
          notAv += answered.filter((x) => x.verdict === "not_av").length;
          setAvResults((prev) => {
            const m = new Map(prev);
            for (const x of answered)
              m.set(x.key, { verdict: x.verdict, reason: x.reason });
            return m;
          });
        } catch (err) {
          const msg = (err as Error).message;
          errors.push(msg);
          unanswered += batch.length;
          // Row numbers are stale: every later batch would fail too.
          if (/thay đổi trên Sheet/.test(msg)) sheetChanged = true;
        }
        doneRows += batch.length;
        setAvProgress({ done: doneRows, total: targets.length });
      }
    };

    try {
      await Promise.all(
        Array.from(
          { length: Math.min(AV_CONCURRENCY, batches.length) },
          worker,
        ),
      );
    } finally {
      setCheckingAv(false);
    }

    if (checked.size > 0) setChecked(new Set());
    const summary = `Đã kiểm tra AV ${targets.length - unanswered}/${targets.length} SP: ${notAv} không phải AV`;
    if (sheetChanged) {
      toast.error(
        "Google Sheet đã thay đổi trong lúc kiểm tra. Đang tải lại, bấm Kiểm tra AV để kiểm tiếp phần còn lại.",
      );
      await load(result.tab);
    } else if (unanswered > 0) {
      toast.warning(
        `${summary}. ${unanswered} SP chưa có kết quả${errors[0] ? ` (${errors[0]})` : ""}, bấm Kiểm tra AV lần nữa để kiểm riêng phần này.`,
      );
    } else toast.success(`${summary}${stopRef.current ? " (đã dừng)" : ""}`);
  }

  const allChecked =
    filtered.length > 0 && filtered.every((r) => checked.has(r.rowNumber));

  const toggleRow = (rowNumber: number) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(rowNumber)) next.delete(rowNumber);
      else next.add(rowNumber);
      return next;
    });

  const toggleAll = () =>
    setChecked((prev) => {
      const next = new Set(prev);
      for (const r of filtered) {
        if (allChecked) next.delete(r.rowNumber);
        else next.add(r.rowNumber);
      }
      return next;
    });

  /** Drops a row that is now on the CMS from the table and the brand's count. */
  function removeUploaded(tabName: string, rowNumber: number) {
    setResult((prev) =>
      prev
        ? { ...prev, rows: prev.rows.filter((r) => r.rowNumber !== rowNumber) }
        : prev,
    );
    setBrands((prev) =>
      prev
        .map((b) =>
          b.tab === tabName ? { ...b, newCount: b.newCount - 1 } : b,
        )
        .filter((b) => b.newCount > 0),
    );
  }

  /** Deletes rejected products from the brand tab on Google Sheet (not from the CMS). */
  async function confirmDelete() {
    if (!result || !deleteTargets || deleteTargets.length === 0) return;
    const tabName = result.tab;
    setDeleting(true);
    try {
      const data = await readJson(
        await fetch(
          `/api/catalog-upload/brand-sheets/${encodeURIComponent(tabName)}`,
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              rows: deleteTargets.map((r) => ({
                rowNumber: r.rowNumber,
                key: r.key,
              })),
            }),
          },
        ),
      );
      const deleted = Number(data.deleted) || 0;
      toast.success(`Đã xoá ${deleted} sản phẩm khỏi Excel (Google Sheet)`);
      setDeleteTargets(null);
      setBrands((prev) =>
        prev
          .map((b) =>
            b.tab === tabName ? { ...b, newCount: b.newCount - deleted } : b,
          )
          .filter((b) => b.newCount > 0),
      );
      // Rows below the deleted ones shift up: reload instead of patching locally.
      await load(tabName);
    } catch (err) {
      toast.error((err as Error).message);
      if (/thay đổi trên Sheet/.test((err as Error).message)) {
        setDeleteTargets(null);
        await load(tabName);
      }
    } finally {
      setDeleting(false);
    }
  }

  const checkedRows = result
    ? result.rows.filter((r) => checked.has(r.rowNumber))
    : [];

  async function runUpload() {
    if (!result) return;
    const targets = result.rows.filter((r) => checked.has(r.rowNumber));
    if (targets.length === 0) return;

    stopRef.current = false;
    setUploading(true);
    setDone(0);
    setTotal(targets.length);
    let created = 0;
    let failed = 0;
    try {
      let cmsBrandId = result.cmsBrandId;
      let mediaFolder = result.brandName;
      if (!cmsBrandId) {
        const b = await post({
          tab: result.tab,
          action: "brand",
          brandName: result.brandName,
        });
        cmsBrandId = b.brand._id as string;
        mediaFolder = b.brand.title || mediaFolder;
        setResult((prev) =>
          prev ? { ...prev, brandInCms: true, cmsBrandId } : prev,
        );
        setBrands((prev) =>
          prev.map((x) =>
            x.tab === result.tab ? { ...x, brandInCms: true } : x,
          ),
        );
        toast.success(
          b.created
            ? `Đã tạo hãng "${b.brand.title}" trên CMS`
            : `Hãng "${b.brand.title}" đã có trên CMS`,
        );
      }

      for (const [i, r] of targets.entries()) {
        if (stopRef.current) break;
        let res: UploadRowResult;
        try {
          const data = await post({
            tab: result.tab,
            action: "products",
            cmsBrandId,
            mediaFolder,
            rows: [{ rowNumber: r.rowNumber, key: r.key }],
          });
          res = data.results[0];
        } catch (err) {
          res = {
            rowNumber: r.rowNumber,
            title: r.title,
            status: "failed",
            cmsId: null,
            imagesUploaded: 0,
            errors: [(err as Error).message],
          };
        }
        setChecked((prev) => {
          const next = new Set(prev);
          next.delete(r.rowNumber);
          return next;
        });
        if (res.status === "failed") {
          failed += 1;
          setFailures((prev) => new Map(prev).set(r.rowNumber, res.errors));
        } else {
          // "exists": someone uploaded it meanwhile -- it is on the CMS either way.
          if (res.status === "created") created += 1;
          setUploaded((prev) => [...prev, res]);
          setFailures((prev) => {
            const next = new Map(prev);
            next.delete(r.rowNumber);
            return next;
          });
          removeUploaded(result.tab, r.rowNumber);
        }
        setDone(i + 1);
        // The sheet changed under us: row numbers are stale, stop and reload.
        if (
          res.status === "failed" &&
          res.errors.some((e) => /thay đổi trên Sheet/.test(e))
        )
          break;
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
    }
    const msg = `Đã tạo ${created} sản phẩm trên CMS${failed ? `, ${failed} lỗi` : ""}${stopRef.current ? " (đã dừng)" : ""}`;
    if (failed) toast.warning(msg);
    else toast.success(msg);
  }

  const busy = loading || uploading || checkingAv;
  const imageNotes = uploaded.filter((u) => u.errors.length > 0);

  return (
    <div className="space-y-4">
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CloudUpload className="w-4 h-4 text-primary" />
            Upload sản phẩm mới lên Wix CMS
          </CardTitle>
          <CardDescription>
            Chỉ liệt kê hãng có sản phẩm trên Google Sheet (DataCrawler) chưa có
            trên CMS. Upload tạo sản phẩm vào collection Import1 và đưa ảnh lên
            Wix Media. Sản phẩm đã có trên CMS không bị sửa.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <Select
            value={tab}
            onValueChange={(v) => {
              setTab(v);
              // Kept categories survive reloads (after delete) but not a brand change.
              setKeepCategories(new Set());
              setAvResults(new Map());
              setAvFilter("all");
              void load(v);
            }}
            disabled={loadingBrands || busy || brands.length === 0}
          >
            <SelectTrigger className="w-full sm:w-80">
              <SelectValue
                placeholder={
                  loadingBrands
                    ? "Đang kiểm tra các hãng…"
                    : brands.length === 0
                      ? "Không có hãng nào có sản phẩm mới"
                      : `Chọn hãng (${brands.length} hãng có SP mới)`
                }
              />
            </SelectTrigger>
            <SelectContent>
              {brands.map((b) => (
                <SelectItem key={b.tab} value={b.tab}>
                  {b.brandName} · {b.newCount} SP mới
                  {b.brandInCms ? "" : " · hãng mới"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            className="gap-2"
            disabled={busy || loadingBrands}
            onClick={() => {
              void loadBrands();
              if (tab) void load(tab);
            }}
          >
            {loading || loadingBrands ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Tải lại
          </Button>
        </CardContent>
      </Card>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground px-1">
          <Loader2 className="w-4 h-4 animate-spin" /> Đang đọc Google Sheet và
          Wix CMS…
        </div>
      )}

      {result && !loading && (
        <>
          {!result.brandInCms && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
              <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
              <span>
                Hãng <b>{result.brandName}</b> chưa có trên CMS. Khi upload,
                hãng sẽ được tạo trước (cần quyền admin); logo thêm ở mục Brand
                mới.
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm text-muted-foreground">
              <b className="text-foreground">{result.rows.length}</b> sản phẩm
              chưa có trên CMS
            </p>
            <div className="flex-1" />
            {uploading || checkingAv ? (
              <Button
                size="sm"
                variant="outline"
                className="gap-2"
                onClick={() => (stopRef.current = true)}
              >
                <Square className="w-3.5 h-3.5" /> Dừng
              </Button>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2"
                  disabled={deleting || result.rows.length === 0}
                  onClick={runAvCheck}
                  title="AI kiểm tra toàn bộ sản phẩm mới của hãng chưa kiểm tra (bỏ qua bộ lọc). Tích dòng để kiểm lại riêng các dòng đó."
                >
                  <ShieldCheck className="w-4 h-4" />
                  {checked.size > 0
                    ? `Kiểm tra lại AV ${checked.size} SP`
                    : avCounts.unchecked === 0
                      ? "Đã kiểm tra AV toàn bộ"
                      : avCounts.unchecked < result.rows.length
                      ? `Kiểm tra AV (${avCounts.unchecked} còn lại)`
                      : `Kiểm tra AV toàn bộ ${result.rows.length} SP`}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-2 text-red-600 dark:text-red-400"
                  disabled={checked.size === 0 || deleting}
                  onClick={() => setDeleteTargets(checkedRows)}
                >
                  <Trash2 className="w-4 h-4" /> Xoá {checked.size} khỏi Excel
                </Button>
                <Button
                  size="sm"
                  className="gap-2"
                  disabled={checked.size === 0 || deleting}
                  onClick={runUpload}
                >
                  <CloudUpload className="w-4 h-4" /> Upload {checked.size} sản
                  phẩm lên CMS
                </Button>
              </>
            )}
          </div>

          {(checkingAv || avProgress.total > 0) && (
            <div className="space-y-1">
              <Progress
                value={
                  avProgress.total
                    ? (avProgress.done / avProgress.total) * 100
                    : 0
                }
              />
              <p className="text-xs text-muted-foreground">
                {checkingAv ? "AI đang kiểm tra AV" : "Đã kiểm tra AV"}{" "}
                {avProgress.done}/{avProgress.total} sản phẩm
              </p>
            </div>
          )}

          {total > 0 && (
            <div className="space-y-1">
              <Progress value={(done / total) * 100} />
              <p className="text-xs text-muted-foreground">
                {uploading ? "Đang upload" : "Đã xong"} {done}/{total} sản phẩm
                {uploaded.length > 0 && ` · ${uploaded.length} đã lên CMS`}
              </p>
            </div>
          )}

          {imageNotes.length > 0 && (
            <div className="rounded-lg border border-border/60 p-3 text-xs space-y-1">
              <p className="font-medium flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Đã tạo
                trên CMS, có ghi chú về ảnh:
              </p>
              {imageNotes.map((u) => (
                <p
                  key={u.rowNumber}
                  className="text-muted-foreground break-words"
                >
                  Dòng {u.rowNumber} · {u.title}: {u.errors.join("; ")}
                </p>
              ))}
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="w-full sm:w-72 justify-between font-normal"
                  disabled={result.rows.length === 0}
                >
                  <span className="flex items-center gap-2 truncate">
                    <Filter className="w-4 h-4 shrink-0" />
                    {kept.size === 0
                      ? "Lọc / giữ theo category"
                      : `Giữ ${kept.size} category`}
                  </span>
                  <ChevronDown className="w-4 h-4 opacity-50 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-72 max-h-80 overflow-y-auto"
              >
                <DropdownMenuLabel>Chọn category cần giữ</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {categories.map(([c, n]) => (
                  <DropdownMenuCheckboxItem
                    key={c}
                    checked={kept.has(c)}
                    onCheckedChange={() => toggleCategory(c)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    <span className="truncate">{categoryLabel(c)}</span>
                    <span className="ml-auto pl-2 text-xs text-muted-foreground tabular-nums">
                      {n}
                    </span>
                  </DropdownMenuCheckboxItem>
                ))}
                {kept.size > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => setKeepCategories(new Set())}
                    >
                      Bỏ lọc (hiện tất cả)
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <Select
              value={avFilter}
              onValueChange={(v) => setAvFilter(v as AvFilter)}
            >
              <SelectTrigger className="w-full sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Kết quả AV: tất cả</SelectItem>
                <SelectItem value="not_av">
                  Không phải AV ({avCounts.not_av})
                </SelectItem>
                <SelectItem value="unsure">
                  Chưa chắc ({avCounts.unsure})
                </SelectItem>
                <SelectItem value="av">Đúng AV ({avCounts.av})</SelectItem>
                <SelectItem value="unchecked">
                  Chưa kiểm tra ({avCounts.unchecked})
                </SelectItem>
              </SelectContent>
            </Select>
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Tìm theo Title, model, category…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>

          {notAvRows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
              <span>
                AI đánh giá <b>{notAvRows.length}</b> sản phẩm không phải ngành
                AV. Xem lý do ở cột AV trước khi xoá.
              </span>
              <div className="flex-1" />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setAvFilter("not_av")}
                disabled={avFilter === "not_av"}
              >
                Xem
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-2 text-red-600 dark:text-red-400"
                disabled={busy || deleting}
                onClick={() => setDeleteTargets(notAvRows)}
              >
                <Trash2 className="w-4 h-4" /> Xoá {notAvRows.length} SP không
                phải AV khỏi Excel
              </Button>
            </div>
          )}

          {kept.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/30 p-3 text-sm">
              <span>
                Giữ <b>{result.rows.length - restRows.length}</b> SP thuộc{" "}
                {[...kept].map(categoryLabel).join(", ")}
                {" · "}
                <b>{restRows.length}</b> SP còn lại thuộc category khác
              </span>
              <div className="flex-1" />
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setKeepCategories(new Set())}
                disabled={uploading}
              >
                Bỏ lọc
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-2 text-red-600 dark:text-red-400"
                disabled={restRows.length === 0 || uploading || deleting}
                onClick={() => setDeleteTargets(restRows)}
              >
                <Trash2 className="w-4 h-4" /> Xoá {restRows.length} SP còn lại
                khỏi Excel
              </Button>
            </div>
          )}

          <Card className="border-border/60">
            <CardContent className="p-0 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="w-10 p-3">
                      <Checkbox
                        checked={allChecked}
                        onCheckedChange={toggleAll}
                        disabled={uploading || filtered.length === 0}
                        aria-label="Chọn tất cả"
                      />
                    </th>
                    <th className="text-left p-3">Dòng</th>
                    <th className="text-left p-3">Title</th>
                    <th className="text-left p-3">Model</th>
                    <th className="text-left p-3">Category</th>
                    <th className="text-left p-3">AV</th>
                    <th className="text-left p-3">Dữ liệu</th>
                    <th className="w-10 p-3" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, shown).map((r) => {
                    const errors = failures.get(r.rowNumber);
                    return (
                      <tr
                        key={r.rowNumber}
                        className="border-t border-border/40 align-top"
                      >
                        <td className="p-3">
                          <Checkbox
                            checked={checked.has(r.rowNumber)}
                            onCheckedChange={() => toggleRow(r.rowNumber)}
                            disabled={uploading}
                            aria-label={`Chọn dòng ${r.rowNumber}`}
                          />
                        </td>
                        <td className="p-3 text-muted-foreground tabular-nums">
                          {r.rowNumber}
                        </td>
                        <td className="p-3">
                          <p className="font-medium">
                            {r.title || "(không có Title)"}
                          </p>
                          {errors && (
                            <p className="text-xs text-red-600 dark:text-red-400 break-words max-w-md">
                              Lỗi upload: {errors.join("; ")}
                            </p>
                          )}
                        </td>
                        <td className="p-3 font-mono text-xs">{r.item}</td>
                        <td className="p-3 text-muted-foreground">
                          {r.category}
                        </td>
                        <td className="p-3 text-xs max-w-56">
                          {(() => {
                            const av = avResults.get(r.key);
                            if (!av)
                              return (
                                <span className="text-muted-foreground">—</span>
                              );
                            return (
                              <>
                                <span
                                  className={`inline-block rounded px-1.5 py-0.5 font-medium whitespace-nowrap ${AV_BADGE[av.verdict]}`}
                                >
                                  {AV_LABEL[av.verdict]}
                                </span>
                                {av.reason && (
                                  <p className="mt-1 text-muted-foreground break-words">
                                    {av.reason}
                                  </p>
                                )}
                              </>
                            );
                          })()}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground whitespace-nowrap">
                          {r.imageCount} ảnh · {r.hasSpecs ? "có" : "thiếu"}{" "}
                          thông số · {r.hasOverview ? "có" : "thiếu"} mô tả
                        </td>
                        <td className="p-2">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-muted-foreground hover:text-red-600"
                            disabled={uploading || deleting}
                            onClick={() => setDeleteTargets([r])}
                            aria-label={`Xoá dòng ${r.rowNumber} khỏi Excel`}
                            title="Xoá khỏi Excel"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        className="p-6 text-center text-muted-foreground"
                      >
                        {result.rows.length === 0
                          ? "Hãng này không còn sản phẩm nào chưa có trên CMS."
                          : "Không có sản phẩm phù hợp."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {filtered.length > shown && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShown((n) => n + PAGE_SIZE)}
              >
                Xem thêm ({filtered.length - shown} còn lại)
              </Button>
            </div>
          )}
        </>
      )}

      <AlertDialog
        open={!!deleteTargets}
        onOpenChange={(o) => !o && !deleting && setDeleteTargets(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Xoá {deleteTargets?.length} sản phẩm khỏi Excel?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Các dòng sẽ bị xoá vĩnh viễn khỏi tab &quot;{result?.tab}&quot;
              trên Google Sheet và không được upload lên CMS. Lần đồng bộ NSX
              sau, crawler có thể thêm lại sản phẩm nếu trang đó vẫn còn trên
              website hãng.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteTargets && deleteTargets.length > 10 && (
            <p className="text-xs text-muted-foreground">
              Category bị xoá:{" "}
              {[...new Set(deleteTargets.map(categoryOf))]
                .map(categoryLabel)
                .join(", ")}
            </p>
          )}
          {deleteTargets && deleteTargets.length <= 10 && (
            <ul className="text-xs text-muted-foreground list-disc pl-5">
              {deleteTargets.map((r) => (
                <li key={r.rowNumber}>
                  Dòng {r.rowNumber}: {r.title || r.item}
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
              {deleting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}{" "}
              Xoá
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
