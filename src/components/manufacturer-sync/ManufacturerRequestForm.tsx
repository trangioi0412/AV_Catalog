"use client";

import { useEffect, useRef, useState } from "react";
import type { AiPreviewResponse, SyncStatus } from "@/lib/manufacturerSync/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { UserPlus, Loader2, Sparkles, CheckCircle2, AlertTriangle, Link as LinkIcon } from "lucide-react";
import { ProgressBar } from "./ProgressBar";

// Mirrors one row of the backend's New_brand Google Sheet -- `id` is a
// slug (Sheets rows have no database auto-increment id), and `status` is
// already the human-readable Vietnamese text stored in the sheet (see
// av-crawler-api/services/admin_sheets.py::NewBrandStatus), not a code
// needing translation here.
interface ManufacturerRequest {
  id: string;
  name: string;
  website_url: string | null;
  status: string;
  notes: string | null;
  created_at: string;
}

const REQUEST_STATUS_PENDING = "Chờ duyệt";

const STATUS_BADGE_CLASSES: Record<string, string> = {
  "Chờ duyệt": "bg-amber-500/10 text-amber-600 border-amber-500/20",
  "Duyệt": "bg-blue-500/10 text-blue-600 border-blue-500/20",
  "Đang cào dữ liệu": "bg-blue-500/10 text-blue-600 border-blue-500/20",
  "Đã cào xong": "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  "Lỗi cào dữ liệu": "bg-destructive/10 text-destructive border-destructive/20",
  "Từ chối": "bg-destructive/10 text-destructive border-destructive/20",
};

const SYNC_TERMINAL_STATUSES = new Set(["completed", "completed_with_warnings", "failed"]);
const SYNC_POLL_INTERVAL_MS = 2000;

const SYNC_STATUS_BADGE_CLASSES: Record<string, string> = {
  queued: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  running: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  completed: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  completed_with_warnings: "bg-yellow-500/10 text-yellow-700 border-yellow-500/20",
  failed: "bg-destructive/10 text-destructive border-destructive/20",
};

interface PreviewState {
  loading: boolean;
  error: string | null;
  data: AiPreviewResponse | null;
}

interface ApproveState {
  loading: boolean;
  error: string | null;
  jobId: string | null;
}

async function previewManufacturerRequest(requestId: string): Promise<AiPreviewResponse> {
  const res = await fetch(`/api/manufacturer-sync/requests/${requestId}/preview`, { method: "POST" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.detail ?? "Xem trước thất bại");
  return body as AiPreviewResponse;
}

interface ApproveResponseBody {
  job_id: string;
}

async function approveManufacturerRequest(requestId: string): Promise<ApproveResponseBody> {
  const res = await fetch(`/api/manufacturer-sync/requests/${requestId}/approve`, { method: "POST" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.detail ?? "Duyệt thất bại");
  return body as ApproveResponseBody;
}

export function ManufacturerRequestForm() {
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [requests, setRequests] = useState<ManufacturerRequest[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [previewByRequest, setPreviewByRequest] = useState<Record<string, PreviewState>>({});
  const [approveByRequest, setApproveByRequest] = useState<Record<string, ApproveState>>({});
  const [jobStatusByRequest, setJobStatusByRequest] = useState<Record<string, SyncStatus>>({});
  const pollIntervals = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  async function loadRequests() {
    try {
      const res = await fetch("/api/manufacturer-sync/requests");
      if (!res.ok) return;
      setRequests(await res.json());
    } catch {
      // Best-effort list refresh; the form itself still works without it.
    }
  }

  useEffect(() => {
    loadRequests();
    const intervals = pollIntervals.current;
    return () => {
      Object.values(intervals).forEach(clearInterval);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Vui lòng nhập tên hãng.");
      return;
    }
    if (!website.trim()) {
      setError("Vui lòng nhập website chính thức của hãng.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await fetch("/api/manufacturer-sync/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), website_url: website.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.detail ?? "Gửi yêu cầu thất bại");
      }
      setSuccessMessage(`Đã ghi nhận yêu cầu cho "${name.trim()}".`);
      setName("");
      setWebsite("");
      await loadRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gửi yêu cầu thất bại");
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePreview(requestId: string) {
    setPreviewByRequest((s) => ({ ...s, [requestId]: { loading: true, error: null, data: s[requestId]?.data ?? null } }));
    try {
      const data = await previewManufacturerRequest(requestId);
      setPreviewByRequest((s) => ({ ...s, [requestId]: { loading: false, error: null, data } }));
    } catch (err) {
      setPreviewByRequest((s) => ({
        ...s,
        [requestId]: { loading: false, error: err instanceof Error ? err.message : "Xem trước thất bại", data: null },
      }));
    }
  }

  function pollJobStatus(requestId: string, jobId: string) {
    if (pollIntervals.current[requestId]) clearInterval(pollIntervals.current[requestId]);
    pollIntervals.current[requestId] = setInterval(async () => {
      try {
        const res = await fetch(`/api/manufacturer-sync/sync/status/${jobId}`);
        if (!res.ok) throw new Error("status request failed");
        const data: SyncStatus = await res.json();
        setJobStatusByRequest((s) => ({ ...s, [requestId]: data }));
        if (SYNC_TERMINAL_STATUSES.has(data.status)) {
          clearInterval(pollIntervals.current[requestId]);
          delete pollIntervals.current[requestId];
          loadRequests();
        }
      } catch {
        clearInterval(pollIntervals.current[requestId]);
        delete pollIntervals.current[requestId];
      }
    }, SYNC_POLL_INTERVAL_MS);
  }

  async function handleApprove(requestId: string) {
    setApproveByRequest((s) => ({ ...s, [requestId]: { loading: true, error: null, jobId: null } }));
    try {
      const result = await approveManufacturerRequest(requestId);
      setApproveByRequest((s) => ({ ...s, [requestId]: { loading: false, error: null, jobId: result.job_id } }));
      pollJobStatus(requestId, result.job_id);
      await loadRequests();
    } catch (err) {
      setApproveByRequest((s) => ({
        ...s,
        [requestId]: { loading: false, error: err instanceof Error ? err.message : "Duyệt thất bại", jobId: null },
      }));
    }
  }

  return (
    <Card className="max-w-2xl w-full border-primary/10 bg-card/40 backdrop-blur-md shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-primary" />
          Yêu Cầu Thêm Hãng Mới
        </CardTitle>
        <CardDescription>
          Nhập tên và website chính thức của hãng. Hệ thống sẽ tự động kiểm tra sơ bộ website (sitemap, robots.txt,
          có cần JavaScript không) và ghi thành checklist ngay khi gửi. Sau đó có thể để AI cục bộ (Ollama) đọc thử
          rồi tự động đồng bộ, không cần dev viết adapter riêng.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="brand-name" className="text-xs text-muted-foreground">
              Tên hãng
            </Label>
            <Input
              id="brand-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="VD: Yealink"
              disabled={submitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="brand-website" className="text-xs text-muted-foreground">
              Website chính thức (bắt buộc)
            </Label>
            <Input
              id="brand-website"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="VD: yealink.com"
              required
              disabled={submitting}
            />
          </div>
          <Button type="submit" disabled={submitting} className="gap-1.5">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
            {submitting ? "Đang gửi..." : "Gửi yêu cầu"}
          </Button>
        </form>

        {error && (
          <p className="flex items-center gap-1.5 text-sm text-destructive">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            {error}
          </p>
        )}
        {successMessage && (
          <p className="flex items-center gap-1.5 text-sm text-emerald-600">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            {successMessage}
          </p>
        )}

        {requests.length > 0 && (
          <div className="space-y-2 pt-2">
            <Separator className="opacity-50 mb-2" />
            <h3 className="text-sm font-medium text-muted-foreground">Danh sách yêu cầu</h3>
            <ul className="space-y-3 max-h-[32rem] overflow-auto">
              {requests.map((r) => {
                const preview = previewByRequest[r.id];
                const approve = approveByRequest[r.id];
                const jobStatus = jobStatusByRequest[r.id];
                const busy = Boolean(preview?.loading || approve?.loading);

                return (
                  <li key={r.id} className="text-sm rounded-lg border border-primary/5 bg-muted/30 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{r.name}</div>
                        {r.website_url && (
                          <a
                            href={r.website_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-primary hover:underline truncate block"
                          >
                            {r.website_url}
                          </a>
                        )}
                      </div>
                      <Badge variant="outline" className={`shrink-0 ${STATUS_BADGE_CLASSES[r.status] ?? ""}`}>
                        {r.status}
                      </Badge>
                    </div>

                    {r.notes && (
                      <details className="mt-1.5">
                        <summary className="cursor-pointer text-xs text-muted-foreground">
                          Kết quả kiểm tra sơ bộ
                        </summary>
                        <pre className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground font-sans">
                          {r.notes}
                        </pre>
                      </details>
                    )}

                    {r.status === REQUEST_STATUS_PENDING && r.website_url && (
                      <div className="mt-2.5 space-y-2">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handlePreview(r.id)}
                            disabled={busy}
                            className="gap-1.5"
                          >
                            {preview?.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                            {preview?.loading ? "Đang đọc thử..." : "Xem trước (AI)"}
                          </Button>
                          <Button size="sm" onClick={() => handleApprove(r.id)} disabled={busy} className="gap-1.5">
                            {approve?.loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                            {approve?.loading ? "Đang duyệt..." : "Duyệt & đồng bộ (AI)"}
                          </Button>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          AI đọc thử vài trang sản phẩm bằng model cục bộ (chậm, có thể mất vài phút) -- xem trước
                          trước khi duyệt để tránh dữ liệu sai bị đồng bộ vào hệ thống chính.
                        </p>
                      </div>
                    )}

                    {preview?.error && <p className="mt-2 text-xs text-destructive">{preview.error}</p>}

                    {preview?.data && (
                      <div className="mt-2 space-y-2 rounded-md bg-background/60 p-2">
                        <p className="text-xs text-muted-foreground">
                          Đã thử {preview.data.checked_urls} trang -- mã hãng dự kiến:{" "}
                          <code>{preview.data.manufacturer_key}</code>
                        </p>
                        <ul className="space-y-2">
                          {preview.data.products.map((p, i) => (
                            <li key={i} className="text-xs border border-primary/10 rounded-md p-2">
                              <a
                                href={p.source_url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1 truncate text-primary hover:underline"
                              >
                                <LinkIcon className="w-3 h-3 shrink-0" />
                                {p.source_url}
                              </a>
                              {p.ok ? (
                                <div className="mt-1 space-y-0.5">
                                  <div>
                                    <span className="font-medium">{p.name ?? "(không xác định)"}</span>
                                    {p.model && <span className="text-muted-foreground"> · {p.model}</span>}
                                  </div>
                                  {p.category && <div className="text-muted-foreground">{p.category}</div>}
                                  {p.description && (
                                    <div className="text-muted-foreground line-clamp-2">{p.description}</div>
                                  )}
                                </div>
                              ) : (
                                <div className="mt-1 text-destructive">{p.error ?? "Lỗi không xác định"}</div>
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {approve?.error && <p className="mt-2 text-xs text-destructive">{approve.error}</p>}

                    {jobStatus && (
                      <div className="mt-2 space-y-1.5 rounded-md bg-background/60 p-2">
                        <div className="flex items-center justify-between text-xs">
                          <Badge variant="outline" className={SYNC_STATUS_BADGE_CLASSES[jobStatus.status] ?? ""}>
                            {jobStatus.status}
                          </Badge>
                          <span className="text-muted-foreground">
                            {jobStatus.processed}/{jobStatus.total} sản phẩm
                          </span>
                        </div>
                        <ProgressBar progress={jobStatus.progress} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
