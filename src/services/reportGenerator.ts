import { MergeResult } from "@/types/MergeResult";

/**
 * Generates a formatted JSON string representing the merge report.
 */
export function generateReport(result: MergeResult): string {
  const timestamp = new Date().toISOString();
  const reportData = {
    generatedAt: timestamp,
    summary: result.summary,
    duplicateWarnings: result.duplicates,
    missingIDsInProducts: result.missingInProducts,
    errors: result.errors,
  };
  return JSON.stringify(reportData, null, 2);
}

/**
 * Downloads the merge report as a JSON file.
 */
export function downloadReport(result: MergeResult, filename = "merge_report.json"): void {
  if (typeof window === "undefined") return;

  const content = generateReport(result);
  const blob = new Blob([content], { type: "application/json;charset=utf-8;" });
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
