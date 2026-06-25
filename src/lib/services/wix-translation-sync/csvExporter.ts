import Papa from "papaparse";
import { ValidationError, ProcessingReport } from "../../../types/wix-translation-sync";

/**
 * Downloads raw text content as a file in the browser.
 */
export function downloadBlob(
  content: string,
  filename: string,
  contentType: string
): void {
  if (typeof window === "undefined") return;

  const blob = new Blob([content], { type: `${contentType};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Exports data array into a CSV file downloaded in the browser.
 */
export function exportToCsv(data: any[], filename: string): void {
  const csv = Papa.unparse(data, {
    quotes: true, // Forces quotes around fields to preserve multiline cells safely
    newline: "\r\n", // Standard newline format
  });
  downloadBlob(csv, filename, "text/csv");
}

/**
 * Exports validation errors into an error report CSV.
 */
export function exportErrorReportCsv(
  errors: ValidationError[],
  filename = "error-report.csv"
): void {
  const formattedErrors = errors.map((err) => ({
    "Row Number": err.rowNumber,
    "Content ID": err.contentId,
    "Field ID": err.fieldId,
    Severity: err.severity.toUpperCase(),
    Type: err.type,
    "Error Details": err.details,
  }));
  exportToCsv(formattedErrors, filename);
}

/**
 * Exports processing report metadata as a JSON file.
 */
export function exportProcessingReportJson(
  report: ProcessingReport,
  filename = "processing-report.json"
): void {
  const jsonContent = JSON.stringify(report, null, 2);
  downloadBlob(jsonContent, filename, "application/json");
}
