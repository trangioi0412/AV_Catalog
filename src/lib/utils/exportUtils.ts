import Papa from "papaparse";
import { SheetData, ProductRow } from "@/types";
import { technicalSpecsToText } from "./specsTranslator";

/**
 * Helper to clean row data before export, excluding metadata fields case-insensitively.
 * Kept columns: Category, Product, Title, productItem, Series, MainFeature, ProductOverview, TechnicalSpecifications, image, Brand.
 * Excluded columns: datasheet, Confidence, Datasheet_Type, Wix_Slug, originalRawRow, and internal tracking fields.
 */
function cleanRowForExport(row: ProductRow, isWarnings?: boolean): Record<string, any> {
  const { 
    id, 
    parsedSpecifications, 
    transformedSpecifications, 
    validationState, 
    parsingErrors, 
    isEdited, 
    originalValues,
    lastModified,
    originalRawRow,
    ...originalData 
  } = row;

  const finalData: Record<string, any> = {};
  
  // Define keys to exclude (case-insensitive)
  const excludedKeys = new Set([
    "datasheet",
    "confidence",
    "datasheet_type",
    "wix_slug",
    "originalrawrow"
  ]);

  // Copy over keys, skipping the excluded ones
  Object.keys(originalData).forEach((key) => {
    const lowerKey = key.toLowerCase();
    if (!excludedKeys.has(lowerKey)) {
      finalData[key] = originalData[key];
    }
  });

  const techSpecsKey = Object.keys(finalData).find(key => key.toLowerCase() === "technical specifications") || "Technical Specifications";
  
  if (isWarnings && originalRawRow && techSpecsKey in originalRawRow) {
    const originalSpecs = originalRawRow[techSpecsKey];
    finalData[techSpecsKey] = originalSpecs !== undefined ? originalSpecs : technicalSpecsToText(transformedSpecifications);
  } else {
    finalData[techSpecsKey] = technicalSpecsToText(transformedSpecifications);
  }

  return finalData;
}

export async function exportToExcel(sheets: SheetData[], fileName: string) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();

  sheets.forEach((sheet) => {
    const exportData = sheet.rows.map((row) => cleanRowForExport(row));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    
    // Auto-size columns
    const maxWidths = exportData.reduce((acc: any, row: any) => {
      Object.keys(row).forEach((key, i) => {
        const val = row[key] ? row[key].toString() : "";
        acc[i] = Math.max(acc[i] || 0, val.length, key.length);
      });
      return acc;
    }, []);

    worksheet["!cols"] = maxWidths.map((w: number) => ({ w: Math.min(w, 50) })); // Cap width at 50

    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.sheetName);
  });

  const safeFileName = (fileName || "catalog").split(".")[0];
  XLSX.writeFile(workbook, `${safeFileName}_updated.xlsx`);
}

export function exportToCSV(sheet: SheetData, fileName: string) {
  const exportData = sheet.rows.map((row) => cleanRowForExport(row));

  const csv = Papa.unparse(exportData);
  const safeFileName = (fileName || "catalog").split(".")[0];
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", `${safeFileName}_updated.csv`);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function exportToJSON(sheets: SheetData[], fileName: string) {
  const safeFileName = (fileName || "catalog").split(".")[0];
  const blob = new Blob([JSON.stringify(sheets, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", `${safeFileName}_updated.json`);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export async function exportSelectedToExcel(rows: ProductRow[], brandName: string, fileName: string, isWarnings?: boolean) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  
  const exportData = rows.map((row) => cleanRowForExport(row, isWarnings));

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  XLSX.utils.book_append_sheet(workbook, worksheet, brandName);
  
  const safeFileName = (fileName || "catalog").split(".")[0];
  XLSX.writeFile(workbook, `${safeFileName}_selected_rows.xlsx`);
}

export async function exportWarningsToExcel(sheets: SheetData[], fileName: string): Promise<boolean> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  let hasWarnings = false;

  sheets.forEach((sheet) => {
    const warningRows = sheet.rows.filter(row => row.validationState === "warning");
    if (warningRows.length === 0) return;

    hasWarnings = true;
    
    const exportData = warningRows.map((row) => cleanRowForExport(row, true));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    
    // Auto-size columns
    const maxWidths = exportData.reduce((acc: any, row: any) => {
      Object.keys(row).forEach((key, i) => {
        const val = row[key] ? row[key].toString() : "";
        acc[i] = Math.max(acc[i] || 0, val.length, key.length);
      });
      return acc;
    }, []);

    worksheet["!cols"] = maxWidths.map((w: number) => ({ w: Math.min(w, 50) }));

    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.sheetName);
  });

  if (!hasWarnings) {
    return false;
  }

  const safeFileName = (fileName || "catalog").split(".")[0];
  XLSX.writeFile(workbook, `${safeFileName}_warnings.xlsx`);
  return true;
}

export async function exportValidToExcel(sheets: SheetData[], fileName: string): Promise<boolean> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  let hasValid = false;

  sheets.forEach((sheet) => {
    const validRows = sheet.rows.filter(row => row.validationState === "valid");
    if (validRows.length === 0) return;

    hasValid = true;
    
    const exportData = validRows.map((row) => cleanRowForExport(row, false));

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    
    // Auto-size columns
    const maxWidths = exportData.reduce((acc: any, row: any) => {
      Object.keys(row).forEach((key, i) => {
        const val = row[key] ? row[key].toString() : "";
        acc[i] = Math.max(acc[i] || 0, val.length, key.length);
      });
      return acc;
    }, []);

    worksheet["!cols"] = maxWidths.map((w: number) => ({ w: Math.min(w, 50) }));

    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.sheetName);
  });

  if (!hasValid) {
    return false;
  }

  const safeFileName = (fileName || "catalog").split(".")[0];
  XLSX.writeFile(workbook, `${safeFileName}_valid.xlsx`);
  return true;
}

