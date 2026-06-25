import Papa from "papaparse";
import { ProductRecord } from "@/types/ProductRecord";

/**
 * Downloads raw string content in the browser.
 */
function downloadBlob(content: string, filename: string, contentType: string): void {
  if (typeof window === "undefined") return;

  // Prefix with UTF-8 Byte Order Mark (BOM) to ensure correct character representation (Vietnamese text, HTML, etc.) in Excel
  const blob = new Blob(["\uFEFF" + content], { type: `${contentType};charset=utf-8;` });
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
 * Exports product records array to a CSV file.
 */
export function exportToCsv(records: ProductRecord[], filename = "products_completed.csv"): void {
  // Strip internal UI properties before export
  const cleanedData = records.map((record) => {
    const { _status, ...rest } = record;
    return rest;
  });

  const csv = Papa.unparse(cleanedData, {
    quotes: true, // Forces quotes around cells to safely preserve multiline strings and HTML
    newline: "\r\n",
  });

  downloadBlob(csv, filename, "text/csv");
}

/**
 * Exports a list of missing IDs to a CSV file.
 */
export function exportMissingIdsCsv(missingIds: string[], filename = "missing_ids.csv"): void {
  const data = missingIds.map((id) => ({ ID: id }));
  const csv = Papa.unparse(data, {
    quotes: true,
    newline: "\r\n",
  });
  downloadBlob(csv, filename, "text/csv");
}
