import { useCallback } from "react";
import { exportToCsv, exportErrorReportCsv, exportProcessingReportJson } from "@/lib/services/wix-translation-sync/csvExporter";
import { WixExportRow, ValidationError, TranslationSummary, LocaleConfiguration, ProcessingReport } from "@/types/wix-translation-sync";
import { toast } from "sonner";

export interface UseCsvExportResult {
  downloadCompletedCsv: (
    completedWixRows: WixExportRow[],
    localeConfig: LocaleConfiguration
  ) => void;
  downloadErrorReportCsv: (validationErrors: ValidationError[]) => void;
  downloadProcessingReportJson: (
    summary: TranslationSummary,
    validationErrors: ValidationError[],
    localeCode: string
  ) => void;
}

export function useCsvExport(): UseCsvExportResult {
  const downloadCompletedCsv = useCallback(
    (completedWixRows: WixExportRow[], localeConfig: LocaleConfiguration) => {
      if (completedWixRows.length === 0) {
        toast.error("No completed Wix translation data available to export.");
        return;
      }
      const filename = `wix_export_${localeConfig.code.toLowerCase()}_completed.csv`;
      exportToCsv(completedWixRows, filename);
      toast.success(`Downloaded completed CSV: ${filename}`);
    },
    []
  );

  const downloadErrorReportCsv = useCallback((validationErrors: ValidationError[]) => {
    if (validationErrors.length === 0) {
      toast.info("No warnings or errors to export.");
      return;
    }
    const filename = "error-report.csv";
    exportErrorReportCsv(validationErrors, filename);
    toast.success(`Downloaded error report: ${filename}`);
  }, []);

  const downloadProcessingReportJson = useCallback(
    (
      summary: TranslationSummary,
      validationErrors: ValidationError[],
      localeCode: string
    ) => {
      const report: ProcessingReport = {
        timestamp: new Date().toISOString(),
        locale: localeCode,
        summary,
        validationErrors,
      };
      const filename = "processing-report.json";
      exportProcessingReportJson(report, filename);
      toast.success(`Downloaded processing report: ${filename}`);
    },
    []
  );

  return {
    downloadCompletedCsv,
    downloadErrorReportCsv,
    downloadProcessingReportJson,
  };
}
