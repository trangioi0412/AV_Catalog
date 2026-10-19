"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { RefreshCw, PlayCircle, Loader2, AlertTriangle, Layers } from "lucide-react";
import { ProgressBar } from "./ProgressBar";

interface Manufacturer {
  key: string;
  display_name: string;
  base_url: string;
}

interface SyncStatus {
  job_id: string;
  manufacturer: string;
  status: "queued" | "running" | "completed" | "completed_with_warnings" | "failed";
  total: number;
  processed: number;
  success: number;
  failed: number;
  skipped: number;
  progress: number;
  error: string | null;
  warnings: string[];
}

const TERMINAL_STATUSES = new Set(["completed", "completed_with_warnings", "failed"]);
const POLL_INTERVAL_MS = 2000;

const STATUS_BADGE_CLASSES: Record<string, string> = {
  queued: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  running: "bg-primary/10 text-primary border-primary/20",
  completed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  completed_with_warnings: "bg-yellow-500/10 text-yellow-700 border-yellow-500/20",
  failed: "bg-destructive/10 text-destructive border-destructive/20",
};

interface BatchJob {
  manufacturer: string;
  jobId: string;
  status: SyncStatus | null;
}

export function ManufacturerSyncPanel() {
  const [manufacturers, setManufacturers] = useState<Manufacturer[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [batchJobs, setBatchJobs] = useState<BatchJob[]>([]);
  const [batchSkipped, setBatchSkipped] = useState<string[]>([]);
  const [isStartingAll, setIsStartingAll] = useState(false);
  const batchPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/manufacturer-sync/manufacturers")
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok || !Array.isArray(data)) {
          throw new Error((data as { detail?: string } | null)?.detail ?? "Không thể tải danh sách nhà sản xuất từ dịch vụ sync.");
        }
        return data as Manufacturer[];
      })
      .then((data) => {
        setManufacturers(data);
        if (data.length > 0) setSelected(data[0].key);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Không thể tải danh sách nhà sản xuất từ dịch vụ sync."));

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (batchPollRef.current) clearInterval(batchPollRef.current);
    };
  }, []);

  function pollStatus(jobId: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/manufacturer-sync/sync/status/${jobId}`);
        if (!res.ok) throw new Error("status request failed");
        const data: SyncStatus = await res.json();
        setStatus(data);
        if (TERMINAL_STATUSES.has(data.status) && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch {
        setError("Mất kết nối khi đang theo dõi trạng thái sync.");
        if (pollRef.current) clearInterval(pollRef.current);
      }
    }, POLL_INTERVAL_MS);
  }

  async function handleStart() {
    if (!selected) return;
    setError(null);
    setIsStarting(true);
    setStatus(null);
    try {
      const res = await fetch("/api/manufacturer-sync/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manufacturer: selected, mode: "full" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.detail ?? "Không thể bắt đầu sync");
      }
      const data = await res.json();
      setStatus({
        job_id: data.job_id,
        manufacturer: data.manufacturer,
        status: "queued",
        total: 0,
        processed: 0,
        success: 0,
        failed: 0,
        skipped: 0,
        progress: 0,
        error: null,
        warnings: [],
      });
      pollStatus(data.job_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể bắt đầu sync");
    } finally {
      setIsStarting(false);
    }
  }

  function pollBatch(jobs: { manufacturer: string; jobId: string }[]) {
    if (batchPollRef.current) clearInterval(batchPollRef.current);
    batchPollRef.current = setInterval(async () => {
      const results = await Promise.all(
        jobs.map(async (j) => {
          try {
            const res = await fetch(`/api/manufacturer-sync/sync/status/${j.jobId}`);
            if (!res.ok) return { ...j, status: null as SyncStatus | null };
            return { ...j, status: (await res.json()) as SyncStatus };
          } catch {
            return { ...j, status: null as SyncStatus | null };
          }
        })
      );
      setBatchJobs(results);
      const allDone = results.every((r) => r.status && TERMINAL_STATUSES.has(r.status.status));
      if (allDone && batchPollRef.current) {
        clearInterval(batchPollRef.current);
        batchPollRef.current = null;
      }
    }, POLL_INTERVAL_MS);
  }

  async function handleStartAll() {
    setError(null);
    setIsStartingAll(true);
    setBatchJobs([]);
    setBatchSkipped([]);
    try {
      const res = await fetch("/api/manufacturer-sync/sync/all", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.detail ?? "Không thể bắt đầu đồng bộ tất cả");
      }
      const data = await res.json();
      const jobs = (data.jobs as { manufacturer: string; job_id: string }[]).map((j) => ({
        manufacturer: j.manufacturer,
        jobId: j.job_id,
        status: null as SyncStatus | null,
      }));
      setBatchJobs(jobs);
      setBatchSkipped(data.skipped ?? []);
      if (jobs.length > 0) pollBatch(jobs.map((j) => ({ manufacturer: j.manufacturer, jobId: j.jobId })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể bắt đầu đồng bộ tất cả");
    } finally {
      setIsStartingAll(false);
    }
  }

  const isRunning = status !== null && !TERMINAL_STATUSES.has(status.status);
  const isBatchRunning = batchJobs.length > 0 && batchJobs.some((j) => !j.status || !TERMINAL_STATUSES.has(j.status.status));

  return (
    <Card className="max-w-2xl w-full border-primary/10 bg-card/40 backdrop-blur-md shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <RefreshCw className="w-4 h-4 text-primary" />
          Đồng Bộ Dữ Liệu Nhà Sản Xuất
        </CardTitle>
        <CardDescription>
          Crawl catalog của một nhà sản xuất và đồng bộ vào Google Sheet (DataCrawler backend độc lập).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <label className="text-xs text-muted-foreground">Nhà sản xuất</label>
            <Select value={selected} onValueChange={setSelected} disabled={isRunning}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Chọn nhà sản xuất..." />
              </SelectTrigger>
              <SelectContent>
                {manufacturers.map((m) => (
                  <SelectItem key={m.key} value={m.key}>
                    {m.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleStart} disabled={!selected || isRunning || isStarting} className="gap-1.5">
            {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
            {isRunning ? "Đang sync..." : "Bắt đầu đồng bộ"}
          </Button>
        </div>

        {error && (
          <p className="flex items-center gap-1.5 text-sm text-destructive">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            {error}
          </p>
        )}

        {status && (
          <div className="space-y-3 rounded-lg border border-primary/5 bg-muted/30 p-3">
            <div className="flex items-center justify-between text-sm">
              <Badge variant="outline" className={STATUS_BADGE_CLASSES[status.status] ?? ""}>
                {status.status}
              </Badge>
              <span className="text-muted-foreground text-xs">
                {status.processed}/{status.total} đã xử lý
              </span>
            </div>

            <ProgressBar progress={status.progress} />

            <div className="grid grid-cols-4 gap-2 text-center text-sm">
              <Stat label="Tìm thấy" value={status.total} />
              <Stat label="Thành công" value={status.success} />
              <Stat label="Lỗi" value={status.failed} />
              <Stat label="Bỏ qua" value={status.skipped} />
            </div>

            {status.error && <p className="text-xs text-destructive">{status.error}</p>}

            {status.warnings.length > 0 && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">{status.warnings.length} cảnh báo</summary>
                <ul className="mt-1 space-y-1 max-h-40 overflow-auto">
                  {status.warnings.slice(0, 20).map((w, i) => (
                    <li key={i} className="truncate">
                      {w}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        <Separator className="opacity-50" />

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-primary/70" />
                Đồng bộ tất cả hãng
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Quét mọi sheet hãng trong Google Sheet (trừ New_brand, System_Config, Sync_logs...) để kiểm tra sản phẩm mới.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={handleStartAll}
              disabled={isBatchRunning || isStartingAll}
              className="shrink-0 gap-1.5"
            >
              {isBatchRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {isBatchRunning ? "Đang đồng bộ..." : "Đồng bộ tất cả"}
            </Button>
          </div>

          {batchSkipped.length > 0 && (
            <p className="text-xs text-amber-600 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              Bỏ qua (chưa biết website): {batchSkipped.join(", ")}
            </p>
          )}

          {batchJobs.length > 0 && (
            <ul className="space-y-1.5 max-h-64 overflow-auto rounded-lg border border-primary/5 bg-muted/30 p-2">
              {batchJobs.map((j) => (
                <li key={j.jobId} className="flex items-center justify-between text-xs gap-2 px-1">
                  <span className="truncate">{j.manufacturer}</span>
                  <Badge variant="outline" className={`shrink-0 ${j.status ? STATUS_BADGE_CLASSES[j.status.status] ?? "" : ""}`}>
                    {j.status ? j.status.status : "..."}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-background/60 py-2">
      <div className="text-base font-semibold">{value}</div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
