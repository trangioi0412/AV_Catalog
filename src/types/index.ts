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

/**
 * Mirrors CatalogReviewCategory / CatalogReviewFinding in
 * src/lib/services/catalogAiReview.ts (server-only — duplicated here rather
 * than imported so this shared client/server types file doesn't pull in that
 * module's server-only dependencies). Keep the category list in sync.
 */
export type AiReviewCategory =
  | "category_mismatch"
  | "series_mismatch"
  | "missing_specs"
  | "invalid_name"
  | "placeholder_data"
  | "duplicate_content"
  | "mixed_language"
  | "other";

export interface AiReviewFinding {
  category: AiReviewCategory;
  message: string;
}

/**
 * Mirrors GroundingSource / EnrichedProductOutput in
 * src/lib/services/geminiEnricher.ts (server-only — duplicated here for the
 * same reason as AiReviewFinding above).
 */
export interface AiFixSource {
  title: string;
  url: string;
}

/** Which engine produced an AiFixSuggestion — see AiFixSuggestion.engine. */
export type AiFixEngine = "gemini" | "ollama";

export interface AiFixSuggestion {
  Category: string;
  Product: string;
  Title: string;
  "product (item)": string;
  Series: string;
  "Main Feature": string;
  "Product Overview": string;
  "Technical Specifications": string;
  image: string;
  Brand: string;
  Datasheet: string;
  /**
   * Real citation URLs — only ever populated for engine "gemini" (Google
   * Search grounding). "ollama" (qwen3.5:9b, local, no internet access) can
   * only reason from the fields/issues it was given, so this is always []
   * for that engine — see `note` instead for what it based the fix on.
   */
  sources: AiFixSource[];
  engine: AiFixEngine;
  /** Ollama engine only: what the model based its suggestion on / which fields it deliberately left unchanged and why. */
  note?: string;
}

export interface ProductRow {
  id: string;
  /**
   * The real Wix CMS Data item `_id` for this row — only present when the
   * row came from pullCmsCatalogAsSheets() (cmsCatalogPull.ts), never for an
   * uploaded Excel row. `id` above is just a fresh client-side uuidv4() for
   * React keying, NOT the CMS identity — a write-back MUST use this field
   * (via a by-id update path) instead of re-matching by Product/model name,
   * which is not guaranteed unique or even non-empty across the collection
   * and can silently patch the wrong CMS record.
   */
  cmsItemId?: string;
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
  /**
   * Findings from the AI catalog review (see catalogAiReview.ts). Present
   * (possibly an empty array) once this row has been scanned — undefined
   * means "not yet reviewed", which the AI Review dashboard relies on to
   * report how many products have been scanned vs. flagged.
   */
  aiReviewFindings?: AiReviewFinding[];
  /** Latest AI-proposed fix for this row (see AiFixSuggestion) — not applied until the user confirms in AiFixReviewModal. */
  aiFixSuggestion?: AiFixSuggestion;
  /**
   * Audit trail of AI-Fix changes actually applied to this row (as opposed to
   * generic manual-edit tracking via isEdited/originalValues) — one entry per
   * field per apply action. Lets the user see/export exactly what AI changed,
   * distinct from any manual edits made afterward.
   */
  aiAppliedFixes?: AiAppliedFix[];
}

/** AiFixEngine plus "translation" — a field can also be changed by the mixed-language translate action (see TranslateMixedLanguageModal), which isn't a review/fix suggestion. */
export type AiAppliedFixEngine = AiFixEngine | "translation";

export interface AiAppliedFix {
  field: string;
  oldValue: string;
  newValue: string;
  engine: AiAppliedFixEngine;
  appliedAt: number;
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
