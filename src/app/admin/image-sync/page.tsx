"use client";

import React, { useCallback, useRef, useState } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  ImageIcon,
  Upload,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileImage,
  Loader2,
  Trash2,
  Play,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Eye,
  RefreshCw,
  FolderOpen,
  Zap,
  BarChart3,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type Phase = "select" | "preview" | "uploading" | "done";

interface FileItem {
  file: File;
  previewUrl: string;
}

interface MatchedPreviewItem {
  normalizedKey: string;
  displayName: string;
  mainFileName: string;
  galleryFileNames: string[];
  cmsId: string;
  productName: string;
  existingImageUrl?: string;
  /** Whether user has checked this item for upload */
  selected: boolean;
}

interface UnmatchedReason {
  displayName: string;
  normalizedKey: string;
  reason: string;
  suggestion?: {
    label: string;
    normalizedKey: string;
    score: number;
  };
}

interface MissingReason {
  productName: string;
  normalizedKey: string;
  reason: string;
  suggestion?: {
    label: string;
    normalizedKey: string;
    score: number;
  };
}

interface ScanPreview {
  matched: Omit<MatchedPreviewItem, "selected">[];
  unmatched: UnmatchedReason[];
  missing: MissingReason[];
}

interface SyncReportItem {
  productName: string;
  cmsId: string;
  imageFile: string;
  galleryFiles: string[];
  status: "success" | "error";
  wixUrl?: string;
  galleryWixUrls?: string[];
  error?: string;
}

interface SyncReport {
  matched: SyncReportItem[];
  unmatched: string[];
  missing: string[];
  summary: {
    total: number;
    success: number;
    failed: number;
    unmatched: number;
    missing: number;
    durationMs: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const SUPPORTED_EXTS = [".jpg", ".jpeg", ".png", ".webp"];

function isSupportedImage(name: string) {
  const lower = name.toLowerCase();
  return SUPPORTED_EXTS.some((ext) => lower.endsWith(ext));
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ─────────────────────────────────────────────────────────────────────────────
// STAT CARD
// ─────────────────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  color,
  icon: Icon,
}: {
  label: string;
  value: number;
  color: string;
  icon: React.ElementType;
}) {
  const borderClass =
    color === "green"
      ? "border-green-500/20 bg-green-500/5 hover:border-green-500/40"
      : color === "amber"
      ? "border-amber-500/20 bg-amber-500/5 hover:border-amber-500/40"
      : "border-red-500/20 bg-red-500/5 hover:border-red-500/40";

  const iconClass =
    color === "green"
      ? "bg-green-500/10 text-green-500"
      : color === "amber"
      ? "bg-amber-500/10 text-amber-500"
      : "bg-red-500/10 text-red-500";

  return (
    <Card className={cn("border transition-all duration-300", borderClass)}>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={cn("p-2 rounded-lg", iconClass)}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-2xl font-bold">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// THUMBNAIL
// ─────────────────────────────────────────────────────────────────────────────

function Thumbnail({ src, name }: { src?: string; name: string }) {
  if (!src) {
    return (
      <div className="w-10 h-10 rounded-md bg-muted flex items-center justify-center shrink-0">
        <FileImage className="w-4 h-4 text-muted-foreground" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={name}
      className="w-10 h-10 rounded-md object-cover shrink-0 border border-border"
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function ImageSyncPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("select");
  const [isDragging, setIsDragging] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [collectionId, setCollectionId] = useState("Import2");

  // Collections picker state
  const [collections, setCollections] = useState<Array<{ id: string; displayName: string }>>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [collectionsError, setCollectionsError] = useState<string | null>(null);
  const [collectionsLoaded, setCollectionsLoaded] = useState(false);

  const loadCollections = async () => {
    setCollectionsLoading(true);
    setCollectionsError(null);
    try {
      const res = await fetch("/api/image-sync/collections");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load collections");
      setCollections(data.collections ?? []);
      setCollectionsLoaded(true);
      // Auto-select if exactly one exists named Products
      const found = (data.collections ?? []).find(
        (c: { id: string }) =>
          c.id.toLowerCase() === "products" || c.id === collectionId
      );
      if (found) setCollectionId(found.id);
      toast.success(`Found ${data.collections.length} collection(s).`);
    } catch (err: any) {
      setCollectionsError(err.message);
      toast.error(`Cannot load collections: ${err.message}`);
    } finally {
      setCollectionsLoading(false);
    }
  };

  // Scan/preview state
  const [isScanning, setIsScanning] = useState(false);
  const [scanPreview, setScanPreview] = useState<ScanPreview | null>(null);
  const [matchedItems, setMatchedItems] = useState<MatchedPreviewItem[]>([]);
  // Scan meta info (collection stats returned from API)
  
  // Log scanned matched items to browser console
  React.useEffect(() => {
    if (matchedItems && matchedItems.length > 0) {
      console.log("[Image Sync] Scanned matched items (devices):", matchedItems);
    }
  }, [matchedItems]);

  const [scanInfo, setScanInfo] = useState<{
    collectionId: string;
    totalFiles: number;
    totalProducts: number;
  } | null>(null);

  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadLogs, setUploadLogs] = useState<string[]>([]);
  const [syncReport, setSyncReport] = useState<SyncReport | null>(null);

  // ── File selection ────────────────────────────────────────────────────────

  const addFiles = useCallback((newFiles: File[]) => {
    const supported = newFiles.filter((f) => isSupportedImage(f.name));
    if (supported.length < newFiles.length) {
      toast.warning(`${newFiles.length - supported.length} unsupported file(s) skipped.`);
    }
    const items: FileItem[] = supported.map((f) => ({
      file: f,
      previewUrl: URL.createObjectURL(f),
    }));
    setFiles((prev) => {
      // Deduplicate by name
      const existingNames = new Set(prev.map((p) => p.file.name));
      const unique = items.filter((i) => !existingNames.has(i.file.name));
      return [...prev, ...unique];
    });
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const dropped = Array.from(e.dataTransfer.files);
      addFiles(dropped);
    },
    [addFiles]
  );

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files));
    e.target.value = "";
  };

  const removeFile = (name: string) => {
    setFiles((prev) => {
      const item = prev.find((f) => f.file.name === name);
      if (item) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((f) => f.file.name !== name);
    });
  };

  const clearAll = () => {
    files.forEach((f) => URL.revokeObjectURL(f.previewUrl));
    setFiles([]);
    setScanPreview(null);
    setMatchedItems([]);
    setPhase("select");
  };

  // ── Step 1 → Step 2: Scan / analyze ──────────────────────────────────────

  const handleAnalyze = async () => {
    if (files.length === 0) {
      toast.error("Please add at least one image file.");
      return;
    }
    setIsScanning(true);
    try {
      const res = await fetch("/api/image-sync/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileNames: files.map((f) => f.file.name),
          collectionId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Scan failed");

      const preview: ScanPreview = data.preview;
      setScanPreview(preview);
      setScanInfo({
        collectionId: data.collectionId ?? collectionId,
        totalFiles: data.totalFiles ?? files.length,
        totalProducts: data.totalProducts ?? 0,
      });

      // Build matched items with selection state
      const fileMap = new Map(files.map((f) => [f.file.name, f]));
      const items: MatchedPreviewItem[] = preview.matched.map((m) => ({
        ...m,
        selected: true,
        previewUrl: fileMap.get(m.mainFileName)?.previewUrl,
      }));
      setMatchedItems(items);
      setPhase("preview");

      toast.success(
        `Analysis complete: ${preview.matched.length} matched, ${preview.unmatched.length} unmatched, ${preview.missing.length} missing.`
      );
    } catch (err: any) {
      toast.error(`Scan failed: ${err.message}`);
    } finally {
      setIsScanning(false);
    }
  };

  // ── Step 2 → Step 3: Upload ───────────────────────────────────────────────

  const handleStartUpload = async () => {
    const selected = matchedItems.filter((m) => m.selected);
    if (selected.length === 0) {
      toast.error("Select at least one product to upload.");
      return;
    }

    setIsUploading(true);
    setPhase("uploading");
    setUploadProgress(0);
    setUploadLogs([]);

    // Generate job ID client-side
    const newJobId = crypto.randomUUID();
    setJobId(newJobId);

    try {
      const formData = new FormData();
      formData.append("collectionId", collectionId);
      formData.append("jobId", newJobId);
      formData.append("matchedJson", JSON.stringify(
        selected.map(({ normalizedKey, displayName, mainFileName, galleryFileNames, cmsId, productName }) => ({
          normalizedKey,
          displayName,
          mainFileName,
          galleryFileNames,
          cmsId,
          productName,
        }))
      ));

      // Attach all needed files
      const fileMap = new Map(files.map((f) => [f.file.name, f.file]));
      for (const item of selected) {
        const mainFile = fileMap.get(item.mainFileName);
        if (mainFile) formData.append("files", mainFile, mainFile.name);
        for (const gName of item.galleryFileNames) {
          const gFile = fileMap.get(gName);
          if (gFile) formData.append("files", gFile, gFile.name);
        }
      }

      // Start polling for progress while the upload runs
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/image-sync/status?jobId=${newJobId}`);
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            setUploadProgress(statusData.percent ?? 0);
            if (statusData.recentLogs?.length > 0) {
              const newLogs: string[] = statusData.recentLogs.map(
                (l: any) =>
                  `${l.status === "success" ? "✓" : "✗"} ${l.productName} — ${l.fileName}`
              );
              setUploadLogs(newLogs);
            }
            if (statusData.status === "done" || statusData.status === "error") {
              clearInterval(pollInterval);
            }
          }
        } catch {
          // Polling errors are non-fatal
        }
      }, 1500);

      // Upload request (long-running)
      const res = await fetch("/api/image-sync/upload", {
        method: "POST",
        body: formData,
      });

      clearInterval(pollInterval);
      setUploadProgress(100);

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");

      const report: SyncReport = {
        ...data.report,
        unmatched: scanPreview?.unmatched.map((u) => u.displayName) ?? [],
        missing: scanPreview?.missing.map((m) => m.productName) ?? [],
        summary: {
          ...data.report.summary,
          unmatched: scanPreview?.unmatched.length ?? 0,
          missing: scanPreview?.missing.length ?? 0,
        },
      };
      setSyncReport(report);
      setPhase("done");
      toast.success(`Upload complete! ${report.summary.success} succeeded, ${report.summary.failed} failed.`);
    } catch (err: any) {
      toast.error(`Upload failed: ${err.message}`);
      setPhase("preview");
    } finally {
      setIsUploading(false);
    }
  };

  // ── Toggle selection ──────────────────────────────────────────────────────

  const toggleItem = (cmsId: string) => {
    setMatchedItems((prev) =>
      prev.map((m) => (m.cmsId === cmsId ? { ...m, selected: !m.selected } : m))
    );
  };

  const toggleAll = () => {
    const allSelected = matchedItems.every((m) => m.selected);
    setMatchedItems((prev) => prev.map((m) => ({ ...m, selected: !allSelected })));
  };

  const selectedCount = matchedItems.filter((m) => m.selected).length;

  // ── Reset ─────────────────────────────────────────────────────────────────

  const handleReset = () => {
    clearAll();
    setSyncReport(null);
    setUploadProgress(0);
    setUploadLogs([]);
    setJobId(null);
    setPhase("select");
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-6xl">

        {/* ── Page Header ── */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
              Image Sync
            </h1>
            <p className="text-muted-foreground mt-1">
              Upload product images from your local folder to Wix Media Manager and sync with CMS.
            </p>
          </div>
          {phase !== "select" && (
            <Button variant="outline" size="sm" className="gap-2" onClick={handleReset}>
              <RotateCcw className="w-4 h-4" />
              Start Over
            </Button>
          )}
        </div>

        {/* ── Phase Stepper ── */}
        <div className="flex items-center gap-2 text-sm">
          {(["select", "preview", "uploading", "done"] as Phase[]).map((p, i) => {
            const labels: Record<Phase, string> = {
              select: "1. Select Files",
              preview: "2. Review Matches",
              uploading: "3. Uploading",
              done: "4. Done",
            };
            const active = phase === p;
            const passed =
              ["select", "preview", "uploading", "done"].indexOf(phase) > i;
            return (
              <React.Fragment key={p}>
                <div
                  className={cn(
                    "px-3 py-1 rounded-full text-xs font-semibold transition-all",
                    active
                      ? "bg-primary text-primary-foreground shadow-md shadow-primary/30"
                      : passed
                        ? "bg-green-500/20 text-green-600 dark:text-green-400"
                        : "bg-muted text-muted-foreground"
                  )}
                >
                  {labels[p]}
                </div>
                {i < 3 && <ChevronRight key={`sep-${i}`} className="w-3 h-3 text-muted-foreground" />}
              </React.Fragment>
            );
          })}
        </div>

        {/* ─────────────────────────── PHASE 1: SELECT ─────────────────────────── */}
        {phase === "select" && (
          <div className="space-y-4">
            {/* Collection picker */}
            <Card className="border-primary/10 bg-card/60">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <Info className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium">Wix CMS Collection</span>
                </div>

                {/* Input row + Load button */}
                <div className="flex gap-2">
                  {collectionsLoaded && collections.length > 0 ? (
                    // Show select dropdown once loaded
                    <select
                      id="collection-id-select"
                      value={collectionId}
                      onChange={(e) => setCollectionId(e.target.value)}
                      className="flex-1 px-3 py-2 text-sm rounded-md border bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      {collections.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.displayName} ({c.id})
                        </option>
                      ))}
                    </select>
                  ) : (
                    // Manual input fallback
                    <input
                      id="collection-id-input"
                      value={collectionId}
                      onChange={(e) => setCollectionId(e.target.value)}
                      className="flex-1 px-3 py-2 text-sm rounded-md border bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
                      placeholder="e.g. Products"
                    />
                  )}
                  <Button
                    id="load-collections-btn"
                    variant="outline"
                    size="sm"
                    onClick={loadCollections}
                    disabled={collectionsLoading}
                    className="gap-2 shrink-0"
                  >
                    {collectionsLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    {collectionsLoaded ? "Reload" : "Load Collections"}
                  </Button>
                </div>

                {/* Status messages */}
                {collectionsError && (
                  <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-500/5 border border-red-500/20 text-xs text-red-600 dark:text-red-400">
                    <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>{collectionsError}</span>
                  </div>
                )}
                {collectionsLoaded && !collectionsError && (
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-green-500/5 border border-green-500/20 text-xs text-green-600 dark:text-green-400">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span>Connected — using collection: <strong>{collectionId}</strong></span>
                  </div>
                )}
                {!collectionsLoaded && !collectionsError && (
                  <p className="text-xs text-muted-foreground">
                    Click "Load Collections" to browse your Wix CMS collections, or type the collection ID directly (e.g. <code className="font-mono bg-muted px-1 rounded">Products</code>).
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={cn(
                "relative rounded-2xl border-2 border-dashed transition-all duration-300 cursor-pointer",
                "flex flex-col items-center justify-center gap-4 p-12 text-center",
                isDragging
                  ? "border-primary bg-primary/5 scale-[1.01]"
                  : "border-border hover:border-primary/50 hover:bg-muted/30"
              )}
            >
              {/* Animated glow when dragging */}
              {isDragging && (
                <div className="absolute inset-0 rounded-2xl bg-primary/5 animate-pulse pointer-events-none" />
              )}

              <div className={cn(
                "p-5 rounded-full transition-all",
                isDragging ? "bg-primary/20 scale-110" : "bg-muted"
              )}>
                <FolderOpen className={cn("w-10 h-10", isDragging ? "text-primary" : "text-muted-foreground")} />
              </div>

              <div>
                <p className="text-lg font-semibold">
                  {isDragging ? "Drop files here" : "Drag & drop product images"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  or click to browse — supports <span className="font-mono text-xs">.jpg .jpeg .png .webp</span>
                </p>
              </div>

              <Button variant="outline" size="sm" className="gap-2 pointer-events-none">
                <Upload className="w-4 h-4" />
                Browse Files
              </Button>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".jpg,.jpeg,.png,.webp"
                className="sr-only"
                onChange={handleFileInput}
                id="image-file-input"
              />
            </div>

            {/* File list */}
            {files.length > 0 && (
              <Card className="border-border/50">
                <CardHeader className="pb-2 flex-row items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <FileImage className="w-4 h-4" />
                    {files.length} file{files.length !== 1 ? "s" : ""} selected
                    <span className="text-xs font-normal text-muted-foreground">
                      ({formatBytes(files.reduce((a, f) => a + f.file.size, 0))} total)
                    </span>
                  </CardTitle>
                  <Button variant="ghost" size="sm" className="text-destructive gap-1 h-7" onClick={clearAll}>
                    <Trash2 className="w-3 h-3" />
                    Clear all
                  </Button>
                </CardHeader>
                <CardContent className="p-0">
                  <ScrollArea className="h-64">
                    <div className="divide-y">
                      {files.map(({ file, previewUrl }) => (
                        <div key={file.name} className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors group">
                          <Thumbnail src={previewUrl} name={file.name} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{file.name}</p>
                            <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="w-7 h-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                            onClick={(e) => { e.stopPropagation(); removeFile(file.name); }}
                          >
                            <XCircle className="w-4 h-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            )}

            {/* Analyze button */}
            <Button
              id="analyze-matches-btn"
              className="w-full gap-2 h-11 text-base font-semibold shadow-lg shadow-primary/20 transition-all"
              onClick={handleAnalyze}
              disabled={files.length === 0 || isScanning}
            >
              {isScanning ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Analyzing — fetching CMS products...
                </>
              ) : (
                <>
                  <Zap className="w-5 h-5" />
                  Analyze Matches ({files.length} files)
                </>
              )}
            </Button>
          </div>
        )}

        {/* ─────────────────────────── PHASE 2: PREVIEW ────────────────────────── */}
        {phase === "preview" && scanPreview && (
          <div className="space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Matched" value={scanPreview.matched.length} color="green" icon={CheckCircle2} />
              <StatCard label="Unmatched Files" value={scanPreview.unmatched.length} color="amber" icon={AlertTriangle} />
              <StatCard label="Missing Images" value={scanPreview.missing.length} color="red" icon={XCircle} />
            </div>

            {/* Collection info banner */}
            {scanInfo && (
              <Card className="border-primary/10 bg-card/50">
                <CardContent className="p-3">
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-green-500 inline-block shrink-0" />
                      <span>Collection:</span>
                      <code className="font-mono font-semibold text-foreground bg-muted px-1.5 py-0.5 rounded">
                        {scanInfo.collectionId}
                      </code>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-blue-500 inline-block shrink-0" />
                      <span>Sản phẩm trong CMS:</span>
                      <span className="font-bold text-foreground">{scanInfo.totalProducts.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-purple-500 inline-block shrink-0" />
                      <span>File ảnh đã quét:</span>
                      <span className="font-bold text-foreground">{scanInfo.totalFiles.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center gap-1.5 ml-auto">
                      <span>Tỷ lệ match:</span>
                      <span className={cn(
                        "font-bold",
                        scanInfo.totalFiles > 0 && (scanPreview.matched.length / scanInfo.totalFiles) >= 0.7
                          ? "text-green-500"
                          : "text-amber-500"
                      )}>
                        {scanInfo.totalFiles > 0
                          ? Math.round((scanPreview.matched.length / scanInfo.totalFiles) * 100)
                          : 0}%
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Selection controls */}
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{selectedCount}</span> of {matchedItems.length} matched products selected for upload
              </p>
              <Button variant="outline" size="sm" onClick={toggleAll} className="h-8">
                {matchedItems.every((m) => m.selected) ? "Deselect All" : "Select All"}
              </Button>
            </div>

            {/* Tabs */}
            <Tabs defaultValue="matched" className="w-full">
              <TabsList className="grid grid-cols-3 w-full max-w-md">
                <TabsTrigger value="matched" className="gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                  Matched <Badge variant="secondary" className="ml-1 text-xs">{scanPreview.matched.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="unmatched" className="gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                  Unmatched <Badge variant="secondary" className="ml-1 text-xs">{scanPreview.unmatched.length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="missing" className="gap-1.5">
                  <XCircle className="w-3.5 h-3.5 text-red-500" />
                  Missing <Badge variant="secondary" className="ml-1 text-xs">{scanPreview.missing.length}</Badge>
                </TabsTrigger>
              </TabsList>

              {/* Matched tab */}
              <TabsContent value="matched" className="mt-3">
                <Card className="border-green-500/10">
                  <ScrollArea className="h-80">
                    <div className="divide-y">
                      {matchedItems.length === 0 && (
                        <p className="p-6 text-center text-muted-foreground text-sm">No matched images found.</p>
                      )}
                      {matchedItems.map((item) => {
                        const fileItem = files.find((f) => f.file.name === item.mainFileName);
                        return (
                          <div
                            key={item.cmsId}
                            className={cn(
                              "flex items-center gap-3 px-4 py-3 transition-colors cursor-pointer",
                              item.selected ? "bg-green-500/5 hover:bg-green-500/10" : "opacity-50 hover:opacity-70"
                            )}
                            onClick={() => toggleItem(item.cmsId)}
                          >
                            {/* Checkbox */}
                            <input
                              type="checkbox"
                              checked={item.selected}
                              onChange={() => toggleItem(item.cmsId)}
                              onClick={(e) => e.stopPropagation()}
                              className="w-4 h-4 accent-green-500 shrink-0"
                              id={`checkbox-${item.cmsId}`}
                            />
                            <Thumbnail src={fileItem?.previewUrl} name={item.mainFileName} />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{item.productName}</p>
                              <p className="text-xs text-muted-foreground truncate">
                                {item.mainFileName}
                                {item.galleryFileNames.length > 0 && (
                                  <span className="ml-1 text-blue-500">+{item.galleryFileNames.length} gallery</span>
                                )}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <Badge variant="outline" className="text-[10px] font-mono">{item.cmsId.slice(0, 8)}…</Badge>
                              {item.existingImageUrl && (
                                <p className="text-[10px] text-amber-500 mt-0.5">⚠ Has existing image</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </Card>
              </TabsContent>

              {/* Unmatched tab */}
              <TabsContent value="unmatched" className="mt-3">
                <Card className="border-amber-500/10">
                  <ScrollArea className="h-80">
                    <div className="p-3 space-y-2">
                      {scanPreview.unmatched.length === 0 && (
                        <p className="p-6 text-center text-muted-foreground text-sm">
                          🎉 All files matched a CMS product.
                        </p>
                      )}
                      {scanPreview.unmatched.map((item) => (
                        <div key={item.normalizedKey} className="rounded-lg bg-amber-500/5 border border-amber-500/15 p-3 space-y-2">
                          {/* Header row */}
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium">{item.displayName}</p>
                              <p className="text-xs font-mono text-muted-foreground mt-0.5">
                                Key tìm kiếm: <span className="text-amber-600 dark:text-amber-400">&quot;{item.normalizedKey}&quot;</span>
                              </p>
                            </div>
                            <Badge variant="outline" className="text-[10px] border-amber-500/30 text-amber-600 dark:text-amber-400 shrink-0">
                              Unmatched
                            </Badge>
                          </div>
                          {/* Suggestion */}
                          {item.suggestion && (
                            <div className="ml-5 flex items-center gap-2 p-2 rounded-md bg-blue-500/5 border border-blue-500/15">
                              <span className="text-[10px] text-blue-500 font-semibold uppercase tracking-wide shrink-0">Gần nhất:</span>
                              <span className="text-xs truncate">{item.suggestion.label}</span>
                              <span
                                className={cn(
                                  "ml-auto text-[10px] font-bold shrink-0",
                                  item.suggestion.score >= 0.6 ? "text-green-500" :
                                    item.suggestion.score >= 0.4 ? "text-amber-500" : "text-muted-foreground"
                                )}
                              >
                                {Math.round(item.suggestion.score * 100)}%
                              </span>
                            </div>
                          )}
                          {/* Reason */}
                          <p className="ml-5 text-[11px] text-muted-foreground leading-relaxed">{item.reason}</p>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </Card>
              </TabsContent>

              {/* Missing tab */}
              <TabsContent value="missing" className="mt-3">
                <Card className="border-red-500/10">
                  <ScrollArea className="h-80">
                    <div className="p-3 space-y-2">
                      {scanPreview.missing.length === 0 && (
                        <p className="p-6 text-center text-muted-foreground text-sm">
                          🎉 All CMS products have a corresponding image.
                        </p>
                      )}
                      {scanPreview.missing.map((item) => (
                        <div key={item.normalizedKey} className="rounded-lg bg-red-500/5 border border-red-500/15 p-3 space-y-2">
                          {/* Header row */}
                          <div className="flex items-start gap-2">
                            <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium">{item.productName}</p>
                              <p className="text-xs font-mono text-muted-foreground mt-0.5">
                                Cần file có key: <span className="text-red-500 dark:text-red-400">&quot;{item.normalizedKey}&quot;</span>
                              </p>
                            </div>
                            <Badge variant="outline" className="text-[10px] border-red-500/30 text-red-500 shrink-0">
                              No image
                            </Badge>
                          </div>
                          {/* Suggestion */}
                          {item.suggestion && (
                            <div className="ml-5 flex items-center gap-2 p-2 rounded-md bg-blue-500/5 border border-blue-500/15">
                              <span className="text-[10px] text-blue-500 font-semibold uppercase tracking-wide shrink-0">File gần nhất:</span>
                              <span className="text-xs truncate">{item.suggestion.label}</span>
                              <span
                                className={cn(
                                  "ml-auto text-[10px] font-bold shrink-0",
                                  item.suggestion.score >= 0.6 ? "text-green-500" :
                                    item.suggestion.score >= 0.4 ? "text-amber-500" : "text-muted-foreground"
                                )}
                              >
                                {Math.round(item.suggestion.score * 100)}%
                              </span>
                            </div>
                          )}
                          {/* Reason */}
                          <p className="ml-5 text-[11px] text-muted-foreground leading-relaxed">{item.reason}</p>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </Card>
              </TabsContent>
            </Tabs>

            {/* Action buttons */}
            <div className="flex gap-3">
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => setPhase("select")}
              >
                <ChevronDown className="w-4 h-4 rotate-90" />
                Back
              </Button>
              <Button
                id="start-upload-btn"
                className="flex-1 gap-2 h-11 font-semibold shadow-lg shadow-primary/20"
                onClick={handleStartUpload}
                disabled={selectedCount === 0}
              >
                <Play className="w-5 h-5" />
                Start Upload — {selectedCount} product{selectedCount !== 1 ? "s" : ""}
              </Button>
            </div>
          </div>
        )}

        {/* ─────────────────────────── PHASE 3: UPLOADING ──────────────────────── */}
        {phase === "uploading" && (
          <div className="space-y-6">
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="p-8 space-y-6">
                {/* Animated icon */}
                <div className="flex justify-center">
                  <div className="relative">
                    <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center animate-pulse">
                      <Upload className="w-10 h-10 text-primary" />
                    </div>
                    <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                      <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                    </div>
                  </div>
                </div>

                <div className="text-center space-y-1">
                  <p className="text-xl font-bold">Uploading to Wix Media Manager…</p>
                  <p className="text-muted-foreground text-sm">
                    Please do not close this tab. Processing {selectedCount} products.
                  </p>
                </div>

                {/* Progress bar */}
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Progress</span>
                    <span className="font-bold">{uploadProgress}%</span>
                  </div>
                  <Progress value={uploadProgress} className="h-3 rounded-full" />
                </div>

                {/* Live log */}
                {uploadLogs.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Live Log</p>
                    <ScrollArea className="h-40 rounded-lg border bg-muted/30 p-3">
                      {uploadLogs.map((log, i) => (
                        <p key={i} className="text-xs font-mono leading-5">{log}</p>
                      ))}
                    </ScrollArea>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* ─────────────────────────── PHASE 4: DONE ───────────────────────────── */}
        {phase === "done" && syncReport && (
          <div className="space-y-6">
            {/* Hero summary */}
            <Card className="border-green-500/20 bg-gradient-to-br from-green-500/5 to-card">
              <CardContent className="p-6">
                <div className="flex items-center gap-4 mb-4">
                  <div className="p-3 rounded-full bg-green-500/10">
                    <CheckCircle2 className="w-8 h-8 text-green-500" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">Sync Complete</h2>
                    <p className="text-muted-foreground text-sm">
                      Finished in {formatMs(syncReport.summary.durationMs)}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="text-center p-3 rounded-lg bg-muted/50">
                    <p className="text-2xl font-bold text-green-500">{syncReport.summary.success}</p>
                    <p className="text-xs text-muted-foreground">Success</p>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-muted/50">
                    <p className="text-2xl font-bold text-red-500">{syncReport.summary.failed}</p>
                    <p className="text-xs text-muted-foreground">Failed</p>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-muted/50">
                    <p className="text-2xl font-bold text-amber-500">{syncReport.summary.unmatched}</p>
                    <p className="text-xs text-muted-foreground">Unmatched</p>
                  </div>
                  <div className="text-center p-3 rounded-lg bg-muted/50">
                    <p className="text-2xl font-bold text-slate-500">{syncReport.summary.missing}</p>
                    <p className="text-xs text-muted-foreground">Missing</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Detailed report tabs */}
            <Tabs defaultValue="matched" className="w-full">
              <TabsList className="grid grid-cols-3 w-full max-w-md">
                <TabsTrigger value="matched">
                  Synced <Badge variant="secondary" className="ml-1">{syncReport.matched.filter(m => m.status === "success").length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="errors">
                  Errors <Badge variant="secondary" className="ml-1">{syncReport.matched.filter(m => m.status === "error").length}</Badge>
                </TabsTrigger>
                <TabsTrigger value="unmatched">
                  Unmatched <Badge variant="secondary" className="ml-1">{syncReport.unmatched.length}</Badge>
                </TabsTrigger>
              </TabsList>

              <TabsContent value="matched" className="mt-3">
                <Card>
                  <ScrollArea className="h-80">
                    <div className="divide-y">
                      {syncReport.matched.filter(m => m.status === "success").map((item) => (
                        <div key={item.cmsId} className="px-4 py-3 flex items-start gap-3">
                          <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{item.productName}</p>
                            <p className="text-xs text-muted-foreground font-mono truncate">{item.wixUrl}</p>
                            {item.galleryWixUrls && item.galleryWixUrls.length > 0 && (
                              <p className="text-xs text-blue-500 mt-0.5">+{item.galleryWixUrls.length} gallery image{item.galleryWixUrls.length !== 1 ? "s" : ""}</p>
                            )}
                          </div>
                          <Badge variant="outline" className="text-[10px] font-mono shrink-0">{item.cmsId.slice(0, 8)}…</Badge>
                        </div>
                      ))}
                      {syncReport.matched.filter(m => m.status === "success").length === 0 && (
                        <p className="p-6 text-center text-muted-foreground text-sm">No successful uploads.</p>
                      )}
                    </div>
                  </ScrollArea>
                </Card>
              </TabsContent>

              <TabsContent value="errors" className="mt-3">
                <Card className="border-red-500/10">
                  <ScrollArea className="h-80">
                    <div className="divide-y">
                      {syncReport.matched.filter(m => m.status === "error").map((item) => (
                        <div key={item.cmsId} className="px-4 py-3 flex items-start gap-3">
                          <XCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{item.productName}</p>
                            <p className="text-xs text-red-500 mt-0.5">{item.error}</p>
                          </div>
                        </div>
                      ))}
                      {syncReport.matched.filter(m => m.status === "error").length === 0 && (
                        <p className="p-6 text-center text-muted-foreground text-sm">🎉 No errors!</p>
                      )}
                    </div>
                  </ScrollArea>
                </Card>
              </TabsContent>

              <TabsContent value="unmatched" className="mt-3">
                <Card className="border-amber-500/10">
                  <ScrollArea className="h-80">
                    <div className="p-3 space-y-1.5">
                      {syncReport.unmatched.length === 0 && (
                        <p className="p-6 text-center text-muted-foreground text-sm">No unmatched files.</p>
                      )}
                      {syncReport.unmatched.map((name) => (
                        <div key={name} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/10">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                          <span className="text-sm">{name}</span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </Card>
              </TabsContent>
            </Tabs>

            {/* Actions */}
            <div className="flex gap-3">
              <Button
                id="sync-again-btn"
                variant="outline"
                className="gap-2"
                onClick={handleReset}
              >
                <RefreshCw className="w-4 h-4" />
                Sync More Images
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => {
                  const blob = new Blob([JSON.stringify(syncReport, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `image-sync-report-${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                <BarChart3 className="w-4 h-4" />
                Export Report
              </Button>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
