export interface Specification {
  label: string;
  value: string;
}

export type ValidationStatus = "valid" | "warning" | "error";

export interface ParsingError {
  field: string;
  message: string;
  severity: "warning" | "error";
}

export interface ProductRow {
  id: string;
  // Dynamic fields from the original file
  [key: string]: any;
  
  // Enrichment fields
  parsedSpecifications: Specification[];
  transformedSpecifications: Specification[];
  validationState: ValidationStatus;
  parsingErrors: ParsingError[];
  
  // Metadata
  isEdited: boolean;
  originalValues?: {
    [key: string]: any;
    transformedSpecifications: Specification[];
  };
  lastModified?: number;
  originalRawRow?: any;
}

export interface SheetData {
  sheetName: string;
  brandName: string;
  columns: string[];
  rows: ProductRow[];
}

export interface AppState {
  fileName: string | null;
  fileType: "xlsx" | "csv" | null;
  sheets: SheetData[];
  originalSheets: SheetData[];
  activeSheetIndex: number;
  brandMapping: Record<string, string> | null;
  isLoading: boolean;
  history: any[]; // For undo/redo implementation
  stats: {
    totalBrands: number;
    totalProducts: number;
    totalSpecs: number;
    failedRows: number;
    validationErrors: number;
    validProducts: number;
  };
}
