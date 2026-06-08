import * as XLSX from "xlsx";
import Papa from "papaparse";
import { SheetData, ProductRow } from "@/types";

export function exportToExcel(sheets: SheetData[], fileName: string) {
  const workbook = XLSX.utils.book_new();

  sheets.forEach((sheet) => {
    // Prepare data for export
    const exportData = sheet.rows.map((row) => {
      // Create a copy of the row excluding our internal tracking fields
      const { 
        id, 
        parsedSpecifications, 
        transformedSpecifications, 
        validationState, 
        parsingErrors, 
        isEdited, 
        originalValues,
        lastModified,
        ...originalData 
      } = row;

      // Replace the original Technical Specifications column with the transformed JSON
      const updatedSpecs = JSON.stringify(transformedSpecifications, null, 2);

      // Handle both casing possibilities
      const finalData = { ...originalData };
      if ("Technical Specifications" in finalData || !("technical specifications" in finalData)) {
        finalData["Technical Specifications"] = updatedSpecs;
      } else {
        finalData["technical specifications"] = updatedSpecs;
      }

      return finalData;
    });

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
  const exportData = sheet.rows.map((row) => {
    const { 
      id, 
      parsedSpecifications, 
      transformedSpecifications, 
      validationState, 
      parsingErrors, 
      isEdited, 
      originalValues,
      lastModified,
      ...originalData 
    } = row;

    const updatedSpecs = JSON.stringify(transformedSpecifications, null, 2);

    const finalData = { ...originalData };
    if ("Technical Specifications" in finalData || !("technical specifications" in finalData)) {
      finalData["Technical Specifications"] = updatedSpecs;
    } else {
      finalData["technical specifications"] = updatedSpecs;
    }

    return finalData;
  });

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

export function exportSelectedToExcel(rows: ProductRow[], brandName: string, fileName: string, isWarnings?: boolean) {
  const workbook = XLSX.utils.book_new();
  
  const exportData = rows.map((row) => {
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

    const finalData = { ...originalData };
    const techSpecsKey = Object.keys(finalData).find(key => key.toLowerCase() === "technical specifications") || "Technical Specifications";
    
    if (isWarnings && originalRawRow && techSpecsKey in originalRawRow) {
      finalData[techSpecsKey] = originalRawRow[techSpecsKey];
    } else {
      const updatedSpecs = JSON.stringify(transformedSpecifications, null, 2);
      finalData[techSpecsKey] = updatedSpecs;
    }

    return finalData;
  });

  const worksheet = XLSX.utils.json_to_sheet(exportData);
  XLSX.utils.book_append_sheet(workbook, worksheet, brandName);
  
  const safeFileName = (fileName || "catalog").split(".")[0];
  XLSX.writeFile(workbook, `${safeFileName}_selected_rows.xlsx`);
}

export function exportWarningsToExcel(sheets: SheetData[], fileName: string): boolean {
  const workbook = XLSX.utils.book_new();
  let hasWarnings = false;

  sheets.forEach((sheet) => {
    const warningRows = sheet.rows.filter(row => row.validationState === "warning");
    if (warningRows.length === 0) return;

    hasWarnings = true;
    
    const exportData = warningRows.map((row) => {
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

      const finalData = { ...originalData };
      const techSpecsKey = Object.keys(finalData).find(key => key.toLowerCase() === "technical specifications") || "Technical Specifications";
      
      if (originalRawRow && techSpecsKey in originalRawRow) {
        finalData[techSpecsKey] = originalRawRow[techSpecsKey];
      } else {
        const updatedSpecs = JSON.stringify(transformedSpecifications, null, 2);
        finalData[techSpecsKey] = updatedSpecs;
      }

      return finalData;
    });

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

export function exportValidToExcel(sheets: SheetData[], fileName: string): boolean {
  const workbook = XLSX.utils.book_new();
  let hasValid = false;

  sheets.forEach((sheet) => {
    const validRows = sheet.rows.filter(row => row.validationState === "valid");
    if (validRows.length === 0) return;

    hasValid = true;
    
    const exportData = validRows.map((row) => {
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

      const updatedSpecs = JSON.stringify(transformedSpecifications, null, 2);
      const finalData = { ...originalData };
      
      const techSpecsKey = Object.keys(finalData).find(key => key.toLowerCase() === "technical specifications") || "Technical Specifications";
      finalData[techSpecsKey] = updatedSpecs;

      return finalData;
    });

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
