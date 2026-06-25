import * as XLSX from "xlsx";
import Papa from "papaparse";
import { SheetData, ProductRow } from "@/types";
import { parseSpecifications } from "@/lib/parser/parser";
import { textToTechnicalSpecs } from "./specsTranslator";
import { v4 as uuidv4 } from "uuid";

/**
 * Parses an Excel or CSV file and transforms it into the application structure.
 */
export async function parseFile(file: File, shouldParseSpecs: boolean = true): Promise<SheetData[]> {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "csv") {
    return parseCSV(file, shouldParseSpecs);
  } else if (extension === "xlsx" || extension === "xls") {
    return parseExcel(file, shouldParseSpecs);
  } else {
    throw new Error("Unsupported file type. Please upload .xlsx, .xls, or .csv");
  }
}

async function parseExcel(file: File, shouldParseSpecs: boolean = true): Promise<SheetData[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheets: SheetData[] = [];

        workbook.SheetNames.forEach((sheetName) => {
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
          
          if (jsonData.length > 0) {
            const columns = Object.keys(jsonData[0] as object);
            const rows = (jsonData as any[]).map((row) => transformRow(row, shouldParseSpecs));
            
            sheets.push({
              sheetName,
              brandName: sheetName, // Use sheet name as brand name by default
              columns,
              rows,
            });
          }
        });

        resolve(sheets);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

async function parseCSV(file: File, shouldParseSpecs: boolean = true): Promise<SheetData[]> {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const columns = results.meta.fields || [];
        const rows = results.data.map((row: any) => transformRow(row, shouldParseSpecs));
        
        resolve([{
          sheetName: file.name.replace(".csv", ""),
          brandName: file.name.replace(".csv", ""),
          columns,
          rows,
        }]);
      },
      error: reject,
    });
  });
}

function transformRow(row: any, shouldParseSpecs: boolean = true): ProductRow {
  const techSpecsKey = Object.keys(row).find(key => key.toLowerCase() === "technical specifications" || key.toLowerCase() === "thông số kỹ thuật") || "Technical Specifications";
  const techSpecs = row[techSpecsKey] || "";
  
  let specifications: any[] = [];
  let errors: any[] = [];

  if (shouldParseSpecs) {
    let parsedAsJson = false;
    const trimmedTechSpecs = typeof techSpecs === "string" ? techSpecs.trim() : "";
    
    if (trimmedTechSpecs.startsWith("[") || trimmedTechSpecs.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmedTechSpecs);
        const specsArray = Array.isArray(parsed) ? parsed : [parsed];
        const isValid = specsArray.every(item => 
          item && typeof item === "object" && typeof item.label === "string" && typeof item.value === "string"
        );
        if (isValid) {
          specifications = specsArray;
          parsedAsJson = true;
        }
      } catch (e) {
        // Fall back to plain text parsing
      }
    }

    if (!parsedAsJson) {
      specifications = textToTechnicalSpecs(techSpecs);
      if (specifications.length === 0 && trimmedTechSpecs.length > 0) {
        errors.push({
          field: "Technical Specifications",
          message: "No structured specifications found. Please check format (Label: Value).",
          severity: "warning",
        });
      }
    }
  }

  // Check for "CẦN VERIFY" (case-insensitive) in all columns of the parsed row
  Object.entries(row).forEach(([key, val]) => {
    if (String(val || "").toUpperCase().includes("CẦN VERIFY")) {
      errors.push({
        field: key,
        message: `Cột "${key}" chứa thông tin cần kiểm chứng: "${val}"`,
        severity: "warning"
      });
    }
  });
  
  // Create an updated row where the original field is replaced by JSON
  const updatedRow = { ...row };
  if (shouldParseSpecs) {
    updatedRow[techSpecsKey] = JSON.stringify(specifications, null, 2);
  }
  
  return {
    id: uuidv4(),
    ...updatedRow,
    parsedSpecifications: specifications,
    transformedSpecifications: JSON.parse(JSON.stringify(specifications)), // Deep copy for editing
    validationState: errors.some(e => e.severity === "error") ? "error" : (errors.length > 0 ? "warning" : "valid"),
    parsingErrors: errors,
    isEdited: false,
    originalRawRow: JSON.parse(JSON.stringify(row)),
  };
}
