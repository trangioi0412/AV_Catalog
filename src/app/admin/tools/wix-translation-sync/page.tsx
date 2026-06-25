"use client";

import React, { useState, useEffect } from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { FileUploader } from "@/components/tools/wix-translation-sync/FileUploader";
import { ValidationPanel } from "@/components/tools/wix-translation-sync/ValidationPanel";
import { ProgressBar } from "@/components/tools/wix-translation-sync/ProgressBar";
import { ProcessingSummary } from "@/components/tools/wix-translation-sync/ProcessingSummary";
import { PreviewTable } from "@/components/tools/wix-translation-sync/PreviewTable";
import { ErrorTable } from "@/components/tools/wix-translation-sync/ErrorTable";
import { DownloadSection } from "@/components/tools/wix-translation-sync/DownloadSection";
import { useCsvUpload } from "@/hooks/wix-translation-sync/useCsvUpload";
import { useTranslationProcessor } from "@/hooks/wix-translation-sync/useTranslationProcessor";
import { useCsvExport } from "@/hooks/wix-translation-sync/useCsvExport";
import { LOCALE_CONFIGS } from "@/config/wix-translation-sync/localeMappings";
import { TOOL_DESCRIPTION } from "@/constants/wix-translation-sync/translationTool";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { RefreshCw, Play, Languages } from "lucide-react";

export default function WixTranslationSyncPage() {
  const [selectedLocale, setSelectedLocale] = useState<string>("EN");

  // Custom Hooks
  const wixUpload = useCsvUpload("Wix Export CSV");
  const cmsUpload = useCsvUpload("CMS Export CSV");
  const processor = useTranslationProcessor();
  const exporter = useCsvExport();

  // Reset processor state on file or locale changes
  useEffect(() => {
    processor.resetProcessor();
  }, [wixUpload.file, cmsUpload.file, selectedLocale]);

  const canProcess =
    wixUpload.file !== null &&
    cmsUpload.file !== null &&
    !wixUpload.isLoading &&
    !cmsUpload.isLoading &&
    !processor.isProcessing;

  const handleProcess = async () => {
    if (!canProcess) return;

    const localeConfig = LOCALE_CONFIGS[selectedLocale];
    await processor.processTranslation(
      wixUpload.rows,
      cmsUpload.rows,
      localeConfig
    );
  };

  const handleResetAll = () => {
    wixUpload.removeFile();
    cmsUpload.removeFile();
    processor.resetProcessor();
    setSelectedLocale("EN");
  };

  const localeConfig = LOCALE_CONFIGS[selectedLocale];
  const hasResults = processor.summary !== null;

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-6xl mx-auto pb-16">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
              <Languages className="w-6 h-6 text-primary" />
              Wix Translation Sync Tool
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Synchronize Wix Multilingual export files with AV_Catalog CMS data.
            </p>
          </div>
          {hasResults && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetAll}
              className="text-xs h-9 font-bold gap-1.5 border-destructive/20 text-destructive hover:bg-destructive/5"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Đặt lại tất cả
            </Button>
          )}
        </div>

        {/* Description Panel */}
        <Card className="border border-border/60 bg-card/60 backdrop-blur-md shadow-sm rounded-xl">
          <CardContent className="p-4 text-xs text-muted-foreground leading-relaxed">
            {TOOL_DESCRIPTION}
          </CardContent>
        </Card>

        {/* File Upload Section */}
        <FileUploader
          wixFileState={wixUpload}
          cmsFileState={cmsUpload}
          selectedLocale={selectedLocale}
          onLocaleChange={setSelectedLocale}
          disabled={processor.isProcessing}
        />

        {/* Process Button */}
        <div className="flex justify-center pt-2">
          <Button
            size="lg"
            onClick={handleProcess}
            disabled={!canProcess}
            className="w-full sm:w-[280px] text-xs font-bold gap-2 shadow-lg shadow-primary/20 rounded-lg h-11"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            Process Translation Mapping
          </Button>
        </div>

        {/* Progress Bar */}
        <ProgressBar
          progress={processor.progress}
          isProcessing={processor.isProcessing}
        />

        {/* Metrics Summary */}
        <ProcessingSummary summary={processor.summary} />

        {/* Validation Report Alerts */}
        <ValidationPanel
          errors={processor.validationErrors}
          totalWixRows={wixUpload.rows.length}
          hasProcessed={hasResults}
        />

        {/* Download Buttons Section */}
        <DownloadSection
          completedWixRows={processor.completedWixRows}
          validationErrors={processor.validationErrors}
          hasResults={hasResults}
          onDownloadCompleted={() =>
            exporter.downloadCompletedCsv(processor.completedWixRows, localeConfig)
          }
          onDownloadErrors={() =>
            exporter.downloadErrorReportCsv(processor.validationErrors)
          }
          onDownloadReport={() =>
            exporter.downloadProcessingReportJson(
              processor.summary!,
              processor.validationErrors,
              localeConfig.code
            )
          }
        />

        {/* Preview Grid */}
        <PreviewTable mappingResults={processor.mappingResults} />

        {/* Errors Log */}
        <ErrorTable errors={processor.validationErrors} />
      </div>
    </DashboardLayout>
  );
}
