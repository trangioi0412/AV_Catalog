import { create } from "zustand";
import { AppState, SheetData, ProductRow, Specification, ParsingError } from "@/types";
import { v4 as uuidv4 } from "uuid";
import { parseSpecifications } from "@/lib/parser/parser";

interface DataActions {
  setFileData: (fileName: string, fileType: "xlsx" | "csv", sheets: SheetData[]) => void;
  setActiveSheet: (index: number) => void;
  updateProductRow: (sheetIndex: number, rowIndex: number, updates: Partial<ProductRow>) => void;
  deleteProductRows: (sheetIndex: number, rowIds: string[]) => void;
  deleteRowsWithIssues: (sheetIndex: number) => void;
  updateSpecification: (sheetIndex: number, rowIndex: number, specIndex: number, updates: Partial<Specification>) => void;
  addSpecification: (sheetIndex: number, rowIndex: number) => void;
  deleteSpecification: (sheetIndex: number, rowIndex: number, specIndex: number) => void;
  reorderSpecifications: (sheetIndex: number, rowIndex: number, specs: Specification[]) => void;
  setLoading: (loading: boolean) => void;
  resetChanges: () => void;
  calculateStats: () => void;
  setBrandMapping: (mapping: Record<string, string>) => void;
  applyBrandMapping: () => void;
  convertSpecs: () => void;
}

function validateSpecifications(specs: Specification[]): ParsingError[] {
  const errors: ParsingError[] = [];
  const seenLabels = new Set<string>();

  if (specs.length === 0) {
    errors.push({
      field: "Technical Specifications",
      message: "No specifications found. Row is empty.",
      severity: "warning",
    });
    return errors;
  }

  specs.forEach((spec, index) => {
    const label = spec.label.trim();
    const value = spec.value.trim();

    if (!label) {
      errors.push({
        field: `Specification ${index + 1}`,
        message: `Specification at position ${index + 1} has an empty label.`,
        severity: "error",
      });
    } else {
      const lowerLabel = label.toLowerCase();
      if (seenLabels.has(lowerLabel)) {
        errors.push({
          field: label,
          message: `Duplicate specification label: "${label}".`,
          severity: "warning",
        });
      } else {
        seenLabels.add(lowerLabel);
      }
    }

    if (label && !value) {
      errors.push({
        field: label,
        message: `Specification "${label}" has an empty value.`,
        severity: "warning",
      });
    }
  });

  return errors;
}

function validateProductRow(row: ProductRow): ParsingError[] {
  const errors = validateSpecifications(row.transformedSpecifications);

  Object.entries(row).forEach(([key, val]) => {
    if (["id", "parsedSpecifications", "transformedSpecifications", "validationState", "parsingErrors", "isEdited", "originalValues", "lastModified"].includes(key)) return;
    if (String(val || "").toUpperCase().includes("CẦN VERIFY")) {
      errors.push({
        field: key,
        message: `Cột "${key}" chứa thông tin cần xác minh: "${val}"`,
        severity: "warning"
      });
    }
  });

  return errors;
}

export const useDataStore = create<AppState & DataActions>((set, get) => ({
  fileName: null,
  fileType: null,
  sheets: [],
  originalSheets: [],
  activeSheetIndex: 0,
  brandMapping: null,
  isLoading: false,
  history: [],
  stats: {
    totalBrands: 0,
    totalProducts: 0,
    totalSpecs: 0,
    failedRows: 0,
    validationErrors: 0,
    validProducts: 0,
  },

  setFileData: (fileName, fileType, sheets) => {
    const originalSheets = sheets.length > 0 ? JSON.parse(JSON.stringify(sheets)) : [];
    set({ fileName, fileType, sheets, originalSheets, activeSheetIndex: 0 });
    get().calculateStats();
  },

  setActiveSheet: (index) => set({ activeSheetIndex: index }),

  updateProductRow: (sheetIndex, rowIndex, updates) => {
    set((state) => {
      const newSheets = [...state.sheets];
      const sheet = { ...newSheets[sheetIndex] };
      const rows = [...sheet.rows];
      const row = { ...rows[rowIndex], ...updates };
      
      if (!row.originalValues) {
        row.originalValues = JSON.parse(JSON.stringify(rows[rowIndex]));
      }

      const errors = validateProductRow(row);
      row.parsingErrors = errors;
      row.validationState = errors.some(e => e.severity === "error") ? "error" : (errors.length > 0 ? "warning" : "valid");
      row.isEdited = true;
      row.lastModified = Date.now();
      
      rows[rowIndex] = row;
      sheet.rows = rows;
      newSheets[sheetIndex] = sheet;
      return { sheets: newSheets };
    });
    get().calculateStats();
  },

  deleteProductRows: (sheetIndex, rowIds) => {
    set((state) => {
      const newSheets = [...state.sheets];
      if (sheetIndex < 0 || sheetIndex >= newSheets.length) return state;
      const sheet = { ...newSheets[sheetIndex] };
      sheet.rows = sheet.rows.filter((row) => !rowIds.includes(row.id));
      newSheets[sheetIndex] = sheet;
      return { sheets: newSheets };
    });
    get().calculateStats();
  },

  deleteRowsWithIssues: (sheetIndex) => {
    set((state) => {
      const newSheets = [...state.sheets];
      if (sheetIndex < 0 || sheetIndex >= newSheets.length) return state;
      const sheet = { ...newSheets[sheetIndex] };
      sheet.rows = sheet.rows.filter((row) => {
        const hasErrors = Array.isArray(row.parsingErrors) && row.parsingErrors.length > 0;
        const isInvalid = row.validationState === "error" || row.validationState === "warning";
        return !hasErrors && !isInvalid;
      });
      newSheets[sheetIndex] = sheet;
      return { sheets: newSheets };
    });
    get().calculateStats();
  },

  updateSpecification: (sheetIndex, rowIndex, specIndex, updates) => {
    set((state) => {
      const newSheets = [...state.sheets];
      const sheet = { ...newSheets[sheetIndex] };
      const rows = [...sheet.rows];
      const row = { ...rows[rowIndex] };
      const specs = [...row.transformedSpecifications];
      
      specs[specIndex] = { ...specs[specIndex], ...updates };
      row.transformedSpecifications = specs;
      
      const errors = validateProductRow(row);
      row.parsingErrors = errors;
      row.validationState = errors.some(e => e.severity === "error") ? "error" : (errors.length > 0 ? "warning" : "valid");
      row.isEdited = true;
      row.lastModified = Date.now();
      
      if (!row.originalValues) {
        row.originalValues = JSON.parse(JSON.stringify(rows[rowIndex]));
      }
      
      rows[rowIndex] = row;
      sheet.rows = rows;
      newSheets[sheetIndex] = sheet;
      return { sheets: newSheets };
    });
    get().calculateStats();
  },

  addSpecification: (sheetIndex, rowIndex) => {
    set((state) => {
      const newSheets = [...state.sheets];
      const sheet = { ...newSheets[sheetIndex] };
      const rows = [...sheet.rows];
      const row = { ...rows[rowIndex] };
      const specs = [
        ...row.transformedSpecifications,
        { label: "New Field", value: "New Value" }
      ];
      row.transformedSpecifications = specs;

      const errors = validateProductRow(row);
      row.parsingErrors = errors;
      row.validationState = errors.some(e => e.severity === "error") ? "error" : (errors.length > 0 ? "warning" : "valid");
      row.isEdited = true;
      
      if (!row.originalValues) {
        row.originalValues = JSON.parse(JSON.stringify(rows[rowIndex]));
      }
      
      rows[rowIndex] = row;
      sheet.rows = rows;
      newSheets[sheetIndex] = sheet;
      return { sheets: newSheets };
    });
    get().calculateStats();
  },

  deleteSpecification: (sheetIndex, rowIndex, specIndex) => {
    set((state) => {
      const newSheets = [...state.sheets];
      const sheet = { ...newSheets[sheetIndex] };
      const rows = [...sheet.rows];
      const row = { ...rows[rowIndex] };
      const specs = row.transformedSpecifications.filter((_, i) => i !== specIndex);
      row.transformedSpecifications = specs;

      const errors = validateProductRow(row);
      row.parsingErrors = errors;
      row.validationState = errors.some(e => e.severity === "error") ? "error" : (errors.length > 0 ? "warning" : "valid");
      row.isEdited = true;
      
      if (!row.originalValues) {
        row.originalValues = JSON.parse(JSON.stringify(rows[rowIndex]));
      }
      
      rows[rowIndex] = row;
      sheet.rows = rows;
      newSheets[sheetIndex] = sheet;
      return { sheets: newSheets };
    });
    get().calculateStats();
  },

  reorderSpecifications: (sheetIndex, rowIndex, specs) => {
    set((state) => {
      const newSheets = [...state.sheets];
      const sheet = { ...newSheets[sheetIndex] };
      const rows = [...sheet.rows];
      const row = { ...rows[rowIndex] };
      
      row.transformedSpecifications = specs;

      const errors = validateProductRow(row);
      row.parsingErrors = errors;
      row.validationState = errors.some(e => e.severity === "error") ? "error" : (errors.length > 0 ? "warning" : "valid");
      row.isEdited = true;
      
      if (!row.originalValues) {
        row.originalValues = JSON.parse(JSON.stringify(rows[rowIndex]));
      }
      
      rows[rowIndex] = row;
      sheet.rows = rows;
      newSheets[sheetIndex] = sheet;
      return { sheets: newSheets };
    });
    get().calculateStats();
  },

  setLoading: (loading) => set({ isLoading: loading }),

  resetChanges: () => {
    set((state) => {
      if (state.originalSheets.length === 0) return {};
      const sheets = JSON.parse(JSON.stringify(state.originalSheets));
      return { sheets };
    });
    get().calculateStats();
  },

  calculateStats: () => {
    const state = get();
    let totalProducts = 0;
    let totalSpecs = 0;
    let failedRows = 0;
    let validationErrors = 0;
    let validProducts = 0;

    state.sheets.forEach(sheet => {
      totalProducts += sheet.rows.length;
      sheet.rows.forEach(row => {
        totalSpecs += row.transformedSpecifications.length;
        if (row.validationState === "valid") validProducts++;
        if (row.validationState === "error") failedRows++;
        validationErrors += row.parsingErrors.length;
      });
    });

    set({
      stats: {
        totalBrands: state.sheets.length,
        totalProducts,
        totalSpecs,
        failedRows,
        validationErrors,
        validProducts,
      }
    });
  },

  setBrandMapping: (mapping) => set({ brandMapping: mapping }),

  applyBrandMapping: () => {
    set((state) => {
      if (!state.brandMapping) return state;
      
      const newSheets = state.sheets.map(sheet => {
        // Find which column represents the Brand
        const brandColumn = sheet.columns.find(col => 
          ["brand", "thương hiệu", "hang", "manufacturer", "vendor"].includes(col.toLowerCase())
        );

        if (!brandColumn) return sheet;

        return {
          ...sheet,
          rows: sheet.rows.map(row => {
            const currentBrandName = String(row[brandColumn] || "").trim().toLowerCase();
            const mappedId = state.brandMapping![currentBrandName] || row[brandColumn];
 
            if (mappedId !== row[brandColumn]) {
              return {
                ...row,
                [brandColumn]: mappedId,
                isEdited: true,
                lastModified: Date.now()
              };
            }
            return row;
          })
        };
      });

      return { sheets: newSheets };
    });
  },

  convertSpecs: () => {
    set((state) => {
      const newSheets = state.sheets.map((sheet) => {
        const techSpecsKey = sheet.columns.find(col => 
          col.toLowerCase() === "technical specifications" || col.toLowerCase() === "thông số kỹ thuật"
        ) || "Technical Specifications";

        return {
          ...sheet,
          rows: sheet.rows.map((row) => {
            const rawRow = row.originalRawRow || row;
            const techSpecs = rawRow[techSpecsKey] || "";
            const { specifications, errors } = parseSpecifications(techSpecs);

            // Re-run warning verification for CẦN VERIFY
            Object.entries(rawRow).forEach(([key, val]) => {
              if (["id", "parsedSpecifications", "transformedSpecifications", "validationState", "parsingErrors", "isEdited", "originalValues", "lastModified", "originalRawRow"].includes(key)) return;
              if (String(val || "").toUpperCase().includes("CẦN VERIFY")) {
                errors.push({
                  field: key,
                  message: `Cột "${key}" chứa thông tin cần kiểm chứng: "${val}"`,
                  severity: "warning"
                });
              }
            });

            const updatedRow = { ...row };
            updatedRow[techSpecsKey] = JSON.stringify(specifications, null, 2);

            return {
              ...row,
              ...updatedRow,
              parsedSpecifications: specifications,
              transformedSpecifications: JSON.parse(JSON.stringify(specifications)),
              validationState: (errors.some(e => e.severity === "error") ? "error" : (errors.length > 0 ? "warning" : "valid")) as "valid" | "warning" | "error",
              parsingErrors: errors,
              isEdited: true,
              lastModified: Date.now()
            };
          })
        };
      });

      return { sheets: newSheets };
    });
    get().calculateStats();
  }
}));
