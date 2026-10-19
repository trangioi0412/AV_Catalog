"use client";

import React from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { FileUpload } from "@/components/data/FileUpload";
import { DataTable } from "@/components/data/DataTable";
import { StatisticsDashboard } from "@/components/data/StatisticsDashboard";
import { AiReviewDashboard } from "@/components/data/AiReviewDashboard";
import { AiFixDashboard } from "@/components/data/AiFixDashboard";
import { CmsSyncDashboard } from "@/components/data/CmsSyncDashboard";
import { useDataStore, ALL_SHEETS_INDEX } from "@/store/useDataStore";
import type { AiReviewFinding } from "@/types";
import { collectPendingAiFixChanges } from "@/lib/utils/aiFixUtils";
import { Button } from "@/components/ui/button";
import { 
  Download, 
  Trash2, 
  RefreshCcw, 
  FileCheck,
  PlusCircle,
  FileSpreadsheet,
  FileJson,
  FileCode,
  AlertTriangle,
  CloudUpload,
  Loader2,
  Search,
  Sparkles,
  Bot,
  Wrench,
  Upload,
} from "lucide-react";
import { uploadCatalogToWixAction } from "@/app/actions/discovery";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel
} from "@/components/ui/dropdown-menu";
import { exportToExcel, exportToCSV, exportToJSON, exportWarningsToExcel, exportValidToExcel, exportAiFixesToExcel, exportAiFixSuggestionsToExcel } from "@/lib/utils/exportUtils";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { motion, AnimatePresence } from "framer-motion";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export default function DashboardPage() {
  const {
    fileName,
    sheets,
    activeSheetIndex,
    resetChanges,
    setFileData,
    convertSpecs,
    setAiReviewFindings,
    setAiFixSuggestion
  } = useDataStore();

  const handleConvertSpecs = () => {
    convertSpecs();
    toast.success("Đã chuyển đổi thành công tất cả thông số kỹ thuật thô sang dạng cấu trúc mảng!");
  };

  const [isAiReviewing, setIsAiReviewing] = React.useState(false);
  const [aiReviewProgress, setAiReviewProgress] = React.useState({ done: 0, total: 0 });
  const handleAiReview = async () => {
    if (!sheets || sheets.length === 0) {
      toast.error("No product data loaded to review.");
      return;
    }

    // Resolve each product's owning (sheetIndex, rowIndex) up front so AI findings
    // can be written back to the right row regardless of which sheet it lives in.
    const locationById = new Map<string, { sheetIndex: number; rowIndex: number }>();
    const items: { id: string; fields: Record<string, string> }[] = [];
    sheets.forEach((sheet, sheetIndex) => {
      sheet.rows.forEach((row, rowIndex) => {
        locationById.set(row.id, { sheetIndex, rowIndex });
        const specsText = Array.isArray(row.transformedSpecifications)
          ? row.transformedSpecifications.map((s) => `${s.label}: ${s.value}`).join("; ")
          : "";
        items.push({
          id: row.id,
          fields: {
            Category: String(row.Category ?? row.category ?? "").slice(0, 200),
            Brand: String(row.Brand ?? row.brand ?? sheet.brandName ?? "").slice(0, 100),
            Product: String(row.Product ?? row.product ?? row.Title ?? row.title ?? "").slice(0, 200),
            Title: String(row.Title ?? row.title ?? "").slice(0, 300),
            // Category has to be judged against what the product actually does, not
            // just its name — without these, the AI can only catch a mismatch when
            // the product name itself gives it away.
            "Main Feature": String(row["Main Feature"] ?? row.MainFeature ?? "").slice(0, 500),
            "Product Overview": String(row["Product Overview"] ?? row.ProductOverview ?? "").slice(0, 1000),
            "Technical Specifications": specsText.slice(0, 1500),
          },
        });
      });
    });

    if (items.length === 0) {
      toast.error("No products found across any sheet.");
      return;
    }

    const batchSize = 10;
    const batches: (typeof items)[] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }

    setIsAiReviewing(true);
    setAiReviewProgress({ done: 0, total: items.length });

    let flaggedCount = 0;
    let failedBatches = 0;

    for (const batch of batches) {
      try {
        const res = await fetch("/api/catalog-upload/ai-review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: batch }),
        });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json?.error || `Request failed (${res.status})`);
        }
        const results: { id: string; findings: AiReviewFinding[] }[] = json.results || [];
        const resultById = new Map(results.map((r) => [r.id, r.findings]));

        // Mark every item in the batch as scanned — flagged ones get their AI
        // findings, clean ones get [] — so the AI Review dashboard can tell
        // "not yet scanned" (undefined) apart from "scanned, nothing found" ([]).
        for (const item of batch) {
          const location = locationById.get(item.id);
          if (!location) continue;
          const findings = resultById.get(item.id) || [];
          setAiReviewFindings(location.sheetIndex, location.rowIndex, findings);
          if (findings.length > 0) flaggedCount++;
        }
      } catch (err) {
        failedBatches++;
        console.error("[AI Review] Batch failed:", err);
      }
      setAiReviewProgress((prev) => ({ done: Math.min(prev.done + batch.length, items.length), total: items.length }));
    }

    setIsAiReviewing(false);

    if (failedBatches > 0) {
      toast.warning(`AI review hoàn tất với ${failedBatches} lô bị lỗi. Đã phát hiện vấn đề ở ${flaggedCount} sản phẩm.`);
    } else if (flaggedCount > 0) {
      toast.success(`AI review đã phát hiện vấn đề ở ${flaggedCount}/${items.length} sản phẩm.`);
    } else {
      toast.success(`AI review hoàn tất — không phát hiện vấn đề nào trong ${items.length} sản phẩm.`);
    }
  };

  const [isAiFixing, setIsAiFixing] = React.useState(false);
  const [aiFixProgress, setAiFixProgress] = React.useState({ done: 0, total: 0 });

  const flaggedCount = React.useMemo(
    () => sheets.reduce((acc, sheet) => acc + sheet.rows.filter((r) => (r.aiReviewFindings?.length ?? 0) > 0).length, 0),
    [sheets]
  );

  // Runs after "Kiểm tra AI" — proposes fixes for every AI-flagged product using a
  // local Ollama model (qwen3.5:9b) instead of Gemini's grounded search, since it
  // has no internet access it can only clean up existing data (see
  // catalogAiFixOllama.ts), never invent specs it wasn't given. Suggestions are
  // stored per-row and only applied once reviewed in AiFixReviewModal.
  const handleAiFixAll = async () => {
    const locationById = new Map<string, { sheetIndex: number; rowIndex: number }>();
    // The "no change suggested" fallback for Technical Specifications must be the
    // same JSON-array-string shape AiFixReviewModal's parseSpecsJson expects
    // (matching what the Gemini path always returns) — NOT the compact "label:
    // value; ..." summary sent to the model, which isn't valid JSON and would
    // make an untouched field look like the AI deliberately cleared the specs.
    const currentSpecsJsonById = new Map<string, string>();
    const items: { id: string; fields: Record<string, string>; issues: string[] }[] = [];

    sheets.forEach((sheet, sheetIndex) => {
      sheet.rows.forEach((row, rowIndex) => {
        if (!row.aiReviewFindings || row.aiReviewFindings.length === 0) return;
        locationById.set(row.id, { sheetIndex, rowIndex });
        const specsArray = Array.isArray(row.transformedSpecifications) ? row.transformedSpecifications : [];
        currentSpecsJsonById.set(row.id, JSON.stringify(specsArray));
        const specsText = specsArray.map((s) => `${s.label}: ${s.value}`).join("; ");
        items.push({
          id: row.id,
          fields: {
            Category: String(row.Category ?? row.category ?? "").slice(0, 200),
            Brand: String(row.Brand ?? row.brand ?? sheet.brandName ?? "").slice(0, 100),
            Product: String(row.Product ?? row.product ?? "").slice(0, 200),
            Title: String(row.Title ?? row.title ?? "").slice(0, 300),
            Series: String(row.Series ?? "").slice(0, 200),
            MainFeature: String(row["Main Feature"] ?? row.MainFeature ?? "").slice(0, 500),
            ProductOverview: String(row["Product Overview"] ?? row.ProductOverview ?? "").slice(0, 1000),
            TechnicalSpecifications: specsText.slice(0, 1500),
          },
          issues: row.aiReviewFindings.map((f) => f.message),
        });
      });
    });

    if (items.length === 0) {
      toast.error("Chưa có sản phẩm nào bị AI gắn cờ — chạy \"Kiểm tra AI\" trước.");
      return;
    }

    const batchSize = 8;
    const batches: (typeof items)[] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }

    setIsAiFixing(true);
    setAiFixProgress({ done: 0, total: items.length });

    let fixedCount = 0;
    let failedBatches = 0;

    for (const batch of batches) {
      try {
        const res = await fetch("/api/catalog-upload/ai-fix-ollama", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: batch }),
        });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json?.error || `Request failed (${res.status})`);
        }
        const results: { id: string; fields: Record<string, string>; note: string }[] = json.results || [];
        const resultById = new Map(results.map((r) => [r.id, r]));

        for (const item of batch) {
          const result = resultById.get(item.id);
          if (!result) continue;
          const f = result.fields;
          setAiFixSuggestion(locationById.get(item.id)!.sheetIndex, locationById.get(item.id)!.rowIndex, {
            Category: f.Category ?? item.fields.Category,
            Product: f.Product ?? item.fields.Product,
            Title: f.Title ?? item.fields.Title,
            "product (item)": "",
            Series: f.Series ?? item.fields.Series,
            "Main Feature": f.MainFeature ?? item.fields.MainFeature,
            "Product Overview": f.ProductOverview ?? item.fields.ProductOverview,
            "Technical Specifications": f.TechnicalSpecifications ?? currentSpecsJsonById.get(item.id) ?? "[]",
            image: "",
            Brand: f.Brand ?? item.fields.Brand,
            Datasheet: "",
            sources: [],
            engine: "ollama",
            note: result.note,
          });
          if (Object.keys(f).length > 0) fixedCount++;
        }
      } catch (err) {
        failedBatches++;
        console.error("[AI Fix] Batch failed:", err);
      }
      setAiFixProgress((prev) => ({ done: Math.min(prev.done + batch.length, items.length), total: items.length }));
    }

    setIsAiFixing(false);

    const nextStepHint = ` Xem và duyệt trong "Duyệt đề xuất AI Fix" bên dưới, hoặc Export → "Đề xuất AI (chưa áp dụng)" để tải file xem trước.`;
    if (failedBatches > 0) {
      toast.warning(`AI fix hoàn tất với ${failedBatches} lô bị lỗi. Đã đề xuất sửa cho ${fixedCount} sản phẩm.${nextStepHint}`);
    } else {
      toast.success(`AI (qwen3.5:9b) đã đề xuất sửa cho ${fixedCount}/${items.length} sản phẩm.${nextStepHint}`);
    }
  };

  // Real, appliable pending changes only — a row can have an aiFixSuggestion
  // object where AI declined every field (a legitimate outcome for messy/
  // ambiguous data, not a bug), which must NOT count here or the export/
  // count below would look actionable while doing nothing.
  const pendingAiFixSuggestionsCount = React.useMemo(() => {
    return collectPendingAiFixChanges(sheets).productCount;
  }, [sheets]);

  const [isUploadingToWix, setIsUploadingToWix] = React.useState(false);
  const [uploadReport, setUploadReport] = React.useState<{
    successCount: number;
    failedCount: number;
    errors: string[];
    totalCount: number;
  } | null>(null);
  const [isReportOpen, setIsReportOpen] = React.useState(false);
  const [errorSearchQuery, setErrorSearchQuery] = React.useState("");

  // `uploadCatalogToWixAction` already upserts (looks up each product by
  // model name and updates the existing CMS record instead of duplicating —
  // see insertProduct in wixCms.ts), so pushing a filtered subset here is
  // just as safe as the full-catalog upload below, only scoped to fewer rows.
  const handleUploadToWix = async (productsOverride?: any[], loadingLabel?: string) => {
    if (!sheets || sheets.length === 0) {
      toast.error("No product data loaded to upload.");
      return;
    }

    const allProducts = productsOverride ?? sheets.flatMap((sheet) => sheet.rows);
    if (allProducts.length === 0) {
      toast.error("No products found across any sheet.");
      return;
    }

    setIsUploadingToWix(true);
    const uploadToastId = toast.loading(loadingLabel || `Uploading all ${allProducts.length} products to Wix Studio Import1...`);

    try {
      const result = await uploadCatalogToWixAction(allProducts);
      toast.dismiss(uploadToastId);
      if (result.success) {
        setUploadReport({
          successCount: result.successCount || 0,
          failedCount: result.failedCount || 0,
          errors: result.errors || [],
          totalCount: allProducts.length,
        });
        setIsReportOpen(true);

        if (result.failedCount === 0) {
          toast.success(`Successfully uploaded all ${result.successCount} products to Wix Studio!`);
        } else {
          toast.warning(`Uploaded ${result.successCount} products successfully, but ${result.failedCount} failed.`);
          // Capped, not the full array — the report dialog already shows every
          // error with search; Next.js dev forwards browser console.warn to the
          // terminal over a WebSocket with a fixed max payload, and a large
          // catalog's full failure list has crashed that channel before.
          const errors = result.errors || [];
          console.warn(`Wix upload errors (${errors.length} total, showing first 20):`, errors.slice(0, 20));
        }
      } else {
        toast.error(`Wix upload failed: ${result.error}`);
      }
    } catch (err: any) {
      toast.dismiss(uploadToastId);
      toast.error(`Error uploading to Wix: ${err.message || err}`);
    } finally {
      setIsUploadingToWix(false);
    }
  };

  const handleUploadAiFixedToWix = () => {
    const aiFixedProducts = sheets.flatMap((sheet) => sheet.rows.filter((r) => (r.aiAppliedFixes?.length ?? 0) > 0));
    if (aiFixedProducts.length === 0) {
      toast.error("Chưa có sản phẩm nào được AI sửa để đẩy lên CMS.");
      return;
    }
    handleUploadToWix(aiFixedProducts, `Đang đẩy ${aiFixedProducts.length} sản phẩm đã AI sửa lên Wix Studio...`);
  };

  // Log loaded product catalog and device data for admin inspection
  React.useEffect(() => {
    if (sheets && sheets.length > 0) {
      console.log("[Dashboard] Loaded sheets data:", sheets);
      const activeRows = activeSheetIndex === ALL_SHEETS_INDEX
        ? sheets.flatMap((s) => s.rows)
        : sheets[activeSheetIndex]?.rows || [];
      console.log("[Dashboard] Active sheet rows (devices):", activeRows);
    }
  }, [sheets, activeSheetIndex]);

  const [showResetDialog, setShowResetDialog] = React.useState(false);
  const [showClearDialog, setShowClearDialog] = React.useState(false);
  // While a CMS comparison is active, the comparison table takes over in
  // place of the regular "Catalog Data" table — see CmsSyncDashboard.
  const [isCmsSyncActive, setIsCmsSyncActive] = React.useState(false);

  const totalWarningsCount = React.useMemo(() => {
    return sheets.reduce((acc, sheet) => {
      return acc + sheet.rows.filter(r => r.validationState === "warning").length;
    }, 0);
  }, [sheets]);

  const totalValidCount = React.useMemo(() => {
    return sheets.reduce((acc, sheet) => {
      return acc + sheet.rows.filter(r => r.validationState === "valid").length;
    }, 0);
  }, [sheets]);

  const totalAiFixesCount = React.useMemo(() => {
    return sheets.reduce((acc, sheet) => {
      return acc + sheet.rows.reduce((rowAcc, r) => rowAcc + (r.aiAppliedFixes?.length ?? 0), 0);
    }, 0);
  }, [sheets]);

  const aiFixedProductsCount = React.useMemo(() => {
    return sheets.reduce((acc, sheet) => acc + sheet.rows.filter((r) => (r.aiAppliedFixes?.length ?? 0) > 0).length, 0);
  }, [sheets]);

  const handleExport = async (type: "xlsx" | "csv" | "json" | "warnings" | "valid" | "ai-fixes" | "ai-suggestions") => {
    if (sheets.length === 0) return;
    const exportFileName = fileName || "catalog";

    if (type === "xlsx") {
      await exportToExcel(sheets, exportFileName);
    } else if (type === "csv") {
      const csvSheet = activeSheetIndex === ALL_SHEETS_INDEX
        ? {
            sheetName: "All Products",
            brandName: "All Products",
            columns: Array.from(new Set(sheets.flatMap((s) => s.columns))),
            rows: sheets.flatMap((s) => s.rows),
          }
        : sheets[activeSheetIndex];
      exportToCSV(csvSheet, exportFileName);
    } else if (type === "json") {
      exportToJSON(sheets, exportFileName);
    } else if (type === "warnings") {
      const success = await exportWarningsToExcel(sheets, exportFileName);
      if (success) {
        toast.success("Exported all warning rows across all sheets!");
      } else {
        toast.error("No warning rows found to export.");
      }
    } else if (type === "valid") {
      const success = await exportValidToExcel(sheets, exportFileName);
      if (success) {
        toast.success("Exported all valid rows across all sheets!");
      } else {
        toast.error("No valid rows found to export.");
      }
    } else if (type === "ai-fixes") {
      const success = await exportAiFixesToExcel(sheets, exportFileName);
      if (success) {
        toast.success("Đã xuất báo cáo các thay đổi AI đã sửa!");
      } else {
        toast.error("Chưa có thay đổi nào từ AI để xuất.");
      }
    } else if (type === "ai-suggestions") {
      const success = await exportAiFixSuggestionsToExcel(sheets, exportFileName);
      if (success) {
        toast.success("Đã xuất file đề xuất AI (chưa áp dụng)!");
      } else {
        toast.error("Chưa có đề xuất AI nào — chạy \"Sửa bằng AI (qwen3.5:9b)\" trước.");
      }
    }
  };

  const handleReset = () => {
    setShowResetDialog(true);
  };

  const handleClear = () => {
    setShowClearDialog(true);
  };

  return (
    <DashboardLayout>
      <div className="space-y-8 pb-20">

        {/* ── Top Section ─────────────────────────────────────────── */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <PageHeader
              title={fileName ? "Quản lý Catalog sản phẩm" : "Chào mừng quay lại"}
              description={
                fileName
                  ? `Đang làm việc với · ${fileName}`
                  : "Tải lên file catalog để bắt đầu chuyển đổi và đồng bộ dữ liệu sản phẩm."
              }
              icon={<Upload className="w-5 h-5" />}
            />

            {fileName && (
              <div className="flex flex-wrap items-center gap-2">
                {/* ── Secondary / utility actions ── */}
                <div className="flex items-center gap-1 p-1 bg-muted/60 rounded-lg border border-border/60">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-primary hover:bg-primary/10 hover:text-primary h-7 px-2.5"
                    onClick={handleConvertSpecs}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Convert Specs
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-highlight hover:bg-highlight/10 hover:text-highlight h-7 px-2.5"
                    onClick={handleAiReview}
                    disabled={isAiReviewing}
                  >
                    {isAiReviewing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Bot className="w-3.5 h-3.5" />
                    )}
                    {isAiReviewing ? `Đang kiểm tra AI (${aiReviewProgress.done}/${aiReviewProgress.total})` : "Kiểm tra AI"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-highlight hover:bg-highlight/10 hover:text-highlight h-7 px-2.5"
                    onClick={handleAiFixAll}
                    disabled={isAiFixing || flaggedCount === 0}
                    title={flaggedCount === 0 ? "Chạy \"Kiểm tra AI\" trước để có sản phẩm cần sửa" : `Sửa ${flaggedCount} sản phẩm bị gắn cờ bằng qwen3.5:9b (local, không tra cứu internet)`}
                  >
                    {isAiFixing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Wrench className="w-3.5 h-3.5" />
                    )}
                    {isAiFixing ? `Đang sửa (${aiFixProgress.done}/${aiFixProgress.total})` : `Sửa bằng AI (qwen3.5:9b)${flaggedCount > 0 ? ` (${flaggedCount})` : ""}`}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 h-7 px-2.5"
                    onClick={handleReset}
                  >
                    <RefreshCcw className="w-3.5 h-3.5" />
                    Reset
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive h-7 px-2.5"
                    onClick={handleClear}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Clear
                  </Button>
                </div>

                {/* ── Primary actions ── */}
                <Button
                  variant="default"
                  size="sm"
                  className="gap-2 shadow-md shadow-primary/25"
                  onClick={() => handleUploadToWix()}
                  disabled={isUploadingToWix}
                >
                  {isUploadingToWix ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CloudUpload className="w-4 h-4" />
                  )}
                  Upload to Wix
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 border-highlight/30 text-highlight hover:bg-highlight/10"
                  onClick={handleUploadAiFixedToWix}
                  disabled={isUploadingToWix || aiFixedProductsCount === 0}
                  title={aiFixedProductsCount === 0 ? "Chưa có sản phẩm nào được AI sửa" : "Chỉ đẩy các sản phẩm đã AI sửa lên CMS (không đẩy toàn bộ catalog)"}
                >
                  {isUploadingToWix ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
                  Đẩy sản phẩm AI đã sửa lên CMS{aiFixedProductsCount > 0 ? ` (${aiFixedProductsCount})` : ""}
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2">
                      <Download className="w-4 h-4" />
                      Export
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>Export Formats</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => handleExport("xlsx")} className="gap-2">
                      <FileSpreadsheet className="w-4 h-4 text-green-600" />
                      Excel Workbook (.xlsx)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleExport("csv")} className="gap-2">
                      <FileCode className="w-4 h-4 text-primary" />
                      Comma Separated (.csv)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleExport("json")} className="gap-2">
                      <FileJson className="w-4 h-4 text-amber-600" />
                      JSON Data Structure (.json)
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => handleExport("warnings")}
                      className="gap-2"
                      disabled={totalWarningsCount === 0}
                    >
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                      All Warnings ({totalWarningsCount})
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleExport("valid")}
                      className="gap-2"
                      disabled={totalValidCount === 0}
                    >
                      <FileCheck className="w-4 h-4 text-green-600" />
                      All Valid Rows ({totalValidCount})
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleExport("ai-suggestions")}
                      className="gap-2"
                      disabled={pendingAiFixSuggestionsCount === 0}
                    >
                      <Bot className="w-4 h-4 text-cyan-500" />
                      Đề xuất AI, chưa áp dụng ({pendingAiFixSuggestionsCount})
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleExport("ai-fixes")}
                      className="gap-2"
                      disabled={totalAiFixesCount === 0}
                    >
                      <Bot className="w-4 h-4 text-highlight" />
                      Báo cáo AI đã sửa ({totalAiFixesCount})
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
        </div>

        {/* ── Main Content ─────────────────────────────────────────── */}
        <AnimatePresence mode="wait">
          {!fileName ? (
            <motion.div
              key="upload"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.35, ease: "circOut" }}
              className="py-8"
            >
              <FileUpload />
            </motion.div>
          ) : (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.4, ease: "circOut" }}
              className="space-y-8"
            >
              <StatisticsDashboard />

              <AiReviewDashboard />

              <AiFixDashboard />

              <CmsSyncDashboard onActiveChange={setIsCmsSyncActive} />

              {!isCmsSyncActive && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                        <FileCheck className="w-3.5 h-3.5 text-primary" />
                      </div>
                      <h2 className="text-lg font-bold">Catalog Data</h2>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => toast.info("Add Product feature coming soon")}
                    >
                      <PlusCircle className="w-4 h-4" />
                      Add Product
                    </Button>
                  </div>

                  <DataTable />
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Reset Confirmation Dialog ─────────────────────────────── */}
      <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset all changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to reset all changes? This will restore the catalog to its original uploaded state. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                resetChanges();
                setShowResetDialog(false);
                toast.success("All changes have been successfully reset!");
              }}
            >
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Clear Confirmation Dialog ─────────────────────────────── */}
      <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear catalog data?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to clear the current file and start over? All uploaded data and modifications will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setFileData("", "xlsx", []);
                setShowClearDialog(false);
                toast.success("Catalog data cleared successfully");
              }}
            >
              Clear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Upload Report Dialog ──────────────────────────────────── */}
      <Dialog open={isReportOpen} onOpenChange={setIsReportOpen}>
        <DialogContent className="max-w-2xl bg-card/95 border-primary/10 backdrop-blur-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <CloudUpload className="w-5 h-5 text-primary" />
              Kết quả tải lên Wix Studio
            </DialogTitle>
            <DialogDescription>
              Báo cáo chi tiết quá trình đồng bộ sản phẩm vào hệ thống Wix Studio CMS.
            </DialogDescription>
          </DialogHeader>

          {uploadReport && (
            <div className="space-y-6 mt-4">
              {/* Stats Grid */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 text-center">
                  <span className="text-xs text-primary/80 font-medium block mb-1">Tổng sản phẩm</span>
                  <strong className="text-2xl font-extrabold text-primary">
                    {uploadReport.totalCount}
                  </strong>
                </div>
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 text-center">
                  <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium block mb-1">Thành công</span>
                  <strong className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">
                    {uploadReport.successCount}
                  </strong>
                </div>
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-center">
                  <span className="text-xs text-red-500 font-medium block mb-1">Thất bại</span>
                  <strong className="text-2xl font-extrabold text-red-600 dark:text-red-400">
                    {uploadReport.failedCount}
                  </strong>
                </div>
              </div>

              {/* Success Alert */}
              {uploadReport.failedCount === 0 && (
                <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 rounded-xl p-4 flex items-center gap-3">
                  <FileCheck className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                  <span className="text-sm font-medium">
                    Tất cả sản phẩm đã được tải lên Wix Studio CMS thành công và không gặp lỗi nào!
                  </span>
                </div>
              )}

              {/* Errors List Section */}
              {uploadReport.failedCount > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                      Chi tiết sản phẩm bị lỗi ({uploadReport.failedCount})
                    </h3>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(uploadReport.errors.join("\n"));
                        toast.success("Đã sao chép tất cả lỗi vào bộ nhớ tạm!");
                      }}
                      className="text-xs py-1 h-7"
                    >
                      Sao chép tất cả lỗi
                    </Button>
                  </div>

                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Tìm kiếm theo tên sản phẩm hoặc nội dung lỗi..."
                      value={errorSearchQuery}
                      onChange={(e) => setErrorSearchQuery(e.target.value)}
                      className="pl-10 bg-background/50 focus-visible:ring-primary/20 text-sm"
                    />
                  </div>

                  <div className="max-h-[280px] overflow-y-auto border border-red-500/10 rounded-xl bg-card text-xs divide-y divide-border">
                    {uploadReport.errors
                      .filter((err) =>
                        err.toLowerCase().includes(errorSearchQuery.toLowerCase())
                      )
                      .map((err, i) => {
                        const parts = err.split(" - ");
                        const productInfo = parts[0] || "Sản phẩm không xác định";
                        const errorMsg = parts.slice(1).join(" - ") || err;

                        return (
                          <div key={i} className="p-3 hover:bg-muted/10 transition-colors flex gap-3 items-start">
                            <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                            <div className="space-y-1">
                              <span className="font-bold text-foreground block">
                                {productInfo}
                              </span>
                              <span className="text-muted-foreground leading-relaxed">
                                {errorMsg}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    {uploadReport.errors.filter((err) =>
                      err.toLowerCase().includes(errorSearchQuery.toLowerCase())
                    ).length === 0 && (
                      <div className="p-4 text-center text-muted-foreground italic">
                        Không tìm thấy lỗi nào khớp với tìm kiếm.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="mt-6 border-t pt-4">
            <Button
              variant="default"
              onClick={() => setIsReportOpen(false)}
              className="w-full sm:w-auto"
            >
              Đóng báo cáo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
