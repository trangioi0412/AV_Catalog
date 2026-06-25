import * as XLSX from "xlsx";
import { ProductRecord } from "@/types/ProductRecord";

/**
 * Downloads a Blob file in the browser.
 */
function downloadBlob(blob: Blob, filename: string): void {
  if (typeof window === "undefined") return;

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
 * Exports records array to an Excel (.xlsx) file.
 */
export function exportToExcel(records: ProductRecord[], filename = "products_completed.xlsx"): void {
  // Clean internal properties before exporting
  const cleanedData = records.map((record) => {
    const { _status, ...rest } = record;
    return rest;
  });

  const worksheet = XLSX.utils.json_to_sheet(cleanedData);
  const workbook = XLSX.utils.book_new();
  
  XLSX.utils.book_append_sheet(workbook, worksheet, "Products");

  // Generate buffer
  const excelBuffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const blob = new Blob([excelBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=utf-8;",
  });

  downloadBlob(blob, filename);
}
