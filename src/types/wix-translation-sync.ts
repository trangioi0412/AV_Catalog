export interface WixExportRow {
  "ID (do not edit)": string;
  "Content type": string;
  "Element type": string;
  [key: string]: string; // Wix target/source lang fields (e.g. "Target language (EN)", "Source language (VI)")
}

export interface CMSRow {
  ID: string;
  [key: string]: string; // e.g. Title_EN, metaTitle_EN, productOverview_EN
}

export interface WixRowIdJson {
  contentId: string;
  fieldId: string;
  sequencePath: any[];
}

export type ValidationErrorType =
  | "INVALID_JSON"
  | "MISSING_CONTENT_ID"
  | "MISSING_FIELD_ID"
  | "MISSING_CMS_RECORD"
  | "UNSUPPORTED_FIELD"
  | "EMPTY_CMS_VALUE"
  | "MISSING_MAPPING"
  | "DUPLICATE_CMS_ID"
  | "DUPLICATE_WIX_RECORD"
  | "DUPLICATE_MAPPING"
  | "PARSE_ERROR";

export interface ValidationError {
  rowNumber: number; // 1-based index in file
  contentId: string;
  fieldId: string;
  severity: "warning" | "error";
  type: ValidationErrorType;
  details: string;
}

export interface MappingResult {
  rowNumber: number;
  contentId: string;
  fieldId: string;
  cmsMatch: boolean;
  originalValue: string;
  newValue: string;
  status: "success" | "warning" | "error";
  errorDetails?: string;
}

export interface TranslationSummary {
  totalRows: number;
  matchedRows: number;
  updatedRows: number;
  missingCmsRecords: number;
  unsupportedFields: number;
  errorsCount: number;
  successRate: number;
}

export interface ProcessingReport {
  timestamp: string;
  locale: string;
  summary: TranslationSummary;
  validationErrors: ValidationError[];
}

export interface LocaleConfiguration {
  code: string;
  label: string;
  wixTargetColumn: string;
  cmsFieldSuffix: string;
}
