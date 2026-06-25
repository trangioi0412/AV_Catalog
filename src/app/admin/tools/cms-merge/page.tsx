"use client";

import React, { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { UploadCard } from "@/components/tools/cms-merge/UploadCard";
import { MergeSettings } from "@/components/tools/cms-merge/MergeSettings";
import { SummaryCards } from "@/components/tools/cms-merge/SummaryCards";
import { PreviewTable } from "@/components/tools/cms-merge/PreviewTable";
import { DownloadSection } from "@/components/tools/cms-merge/DownloadSection";
import { useCsvUpload } from "@/hooks/useCsvUpload";
import { useMergeProcessor } from "@/hooks/useMergeProcessor";
import { exportToCsv, exportMissingIdsCsv } from "@/services/csvExporter";
import { exportToExcel } from "@/services/excelExporter";
import { downloadReport } from "@/services/reportGenerator";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { RefreshCw, Play, GitMerge, Loader2, Info } from "lucide-react";

export default function CmsMergePage() {
  const [overwriteExisting, setOverwriteExisting] = useState<boolean>(true);
  const [exportMissingIds, setExportMissingIds] = useState<boolean>(true);
  const [outputFormat, setOutputFormat] = useState<"csv" | "xlsx">("csv");

  // Hooks for file uploads
  const seoUpload = useCsvUpload<any>("SEO Source CSV");
  const productUpload = useCsvUpload<any>("Products CSV");

  // Hook for merge processor
  const mergeProcessor = useMergeProcessor();

  // Reset processor if files change
  useEffect(() => {
    mergeProcessor.resetProcessor();
  }, [seoUpload.file, productUpload.file]);

  const canMerge =
    seoUpload.file !== null &&
    productUpload.file !== null &&
    !seoUpload.isLoading &&
    !productUpload.isLoading &&
    !mergeProcessor.isProcessing;

  const handleMerge = async () => {
    if (!canMerge) return;

    await mergeProcessor.runMerge(seoUpload.rows, productUpload.rows, {
      overwriteExisting,
      exportMissingIds,
    });
  };

  const handleResetAll = () => {
    seoUpload.removeFile();
    productUpload.removeFile();
    mergeProcessor.resetProcessor();
    setOverwriteExisting(true);
    setExportMissingIds(true);
    setOutputFormat("csv");
  };

  const hasResults = mergeProcessor.result !== null;
  const missingCount = mergeProcessor.result?.summary.missingCount || 0;

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-6xl mx-auto pb-16">
        {/* Page Title & Reset Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
              <GitMerge className="w-6 h-6 text-primary animate-pulse" />
              CMS Merge Tool
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Merge SEO and FAQ information into AV_Catalog Product Dataset.
            </p>
          </div>
          {hasResults && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetAll}
              className="text-xs h-9 font-bold gap-1.5 border-destructive/20 text-destructive hover:bg-destructive/5 rounded-lg transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reset All
            </Button>
          )}
        </div>

        {/* Informative Tool Guide Card */}
        <Card className="border border-border/60 bg-card/60 backdrop-blur-md shadow-sm rounded-xl">
          <CardContent className="p-4 flex items-start gap-3 text-xs text-muted-foreground leading-relaxed">
            <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-bold text-foreground">Usage Guide:</span>
              <p>
                1. Upload your source file containing SEO & FAQ fields (CSV A, e.g. <i>AVSTEK_Import1_VN_B_SEO_AIO_858.csv</i>).
              </p>
              <p>
                2. Upload your target destination product catalog file (CSV B, e.g. <i>products (2).csv</i>).
              </p>
              <p>
                3. Choose whether to overwrite current values, then hit <b>Merge Files</b>. The layout preserves sorting indexes, columns, formatting, line breaks, HTML tags, and array items.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Upload Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <UploadCard
            title="SEO Source CSV (File A)"
            description="Source file with SEO columns: ID, metaTitle, metaDescription, shortDescription, altText, faq"
            helpText="Expects 858 records. Matches destination file rows via ID value."
            file={seoUpload.file}
            isLoading={seoUpload.isLoading}
            error={seoUpload.error}
            rowsCount={seoUpload.rows.length}
            onUpload={seoUpload.handleUpload}
            onRemove={seoUpload.removeFile}
          />
          <UploadCard
            title="Products CSV (File B)"
            description="Destination products catalog: Title, Brand, Category, ID, specifications, media gallery, etc."
            helpText="Expects 881 records. Updated cells will store modified SEO attributes."
            file={productUpload.file}
            isLoading={productUpload.isLoading}
            error={productUpload.error}
            rowsCount={productUpload.rows.length}
            onUpload={productUpload.handleUpload}
            onRemove={productUpload.removeFile}
          />
        </div>

        {/* Merge Settings component */}
        <MergeSettings
          overwriteExisting={overwriteExisting}
          onOverwriteChange={setOverwriteExisting}
          exportMissingIds={exportMissingIds}
          onExportMissingChange={setExportMissingIds}
          outputFormat={outputFormat}
          onFormatChange={setOutputFormat}
          disabled={mergeProcessor.isProcessing}
        />

        {/* Merge Files Trigger Button */}
        <div className="flex justify-center pt-2">
          <Button
            size="lg"
            onClick={handleMerge}
            disabled={!canMerge}
            className="w-full sm:w-[280px] text-xs font-bold gap-2 shadow-lg shadow-primary/20 rounded-xl h-11 transition-all"
          >
            {mergeProcessor.isProcessing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Merging Datasets...
              </>
            ) : (
              <>
                <GitMerge className="w-3.5 h-3.5" />
                Merge Files
              </>
            )}
          </Button>
        </div>

        {/* Progress bar widget */}
        {mergeProcessor.isProcessing && (
          <div className="space-y-2.5 p-4 rounded-xl border border-primary/10 bg-primary/5 flex flex-col justify-center animate-pulse">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
                <span className="text-xs font-bold text-foreground">
                  Processing CMS Merge and syncing ID records...
                </span>
              </div>
              <span className="text-xs font-bold text-primary">{mergeProcessor.progress}%</span>
            </div>
            <Progress value={mergeProcessor.progress} className="h-2" />
            <span className="text-[10px] text-muted-foreground/85 leading-none">
              Please keep this page open until the merge is completed.
            </span>
          </div>
        )}

        {/* Metrics Summary cards */}
        <SummaryCards summary={mergeProcessor.result?.summary || null} />

        {/* Download Button panel */}
        <DownloadSection
          hasResults={hasResults}
          hasMissing={hasResults && missingCount > 0 && exportMissingIds}
          onDownloadResult={() => {
            if (!mergeProcessor.result) return;
            if (outputFormat === "csv") {
              exportToCsv(mergeProcessor.result.mergedRecords, "products_completed.csv");
            } else {
              exportToExcel(mergeProcessor.result.mergedRecords, "products_completed.xlsx");
            }
          }}
          onDownloadMissing={() => {
            if (!mergeProcessor.result) return;
            exportMissingIdsCsv(mergeProcessor.result.missingInProducts, "products_missing_ids.csv");
          }}
          onDownloadReport={() => {
            if (!mergeProcessor.result) return;
            downloadReport(mergeProcessor.result, "products_merge_report.json");
          }}
          outputFormat={outputFormat}
        />

        {/* Data Preview Table */}
        {mergeProcessor.result && (
          <PreviewTable mergedRecords={mergeProcessor.result.mergedRecords} />
        )}
      </div>
    </DashboardLayout>
  );
}
