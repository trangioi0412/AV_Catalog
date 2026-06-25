import { ProductRecord } from "./ProductRecord";

export interface DuplicateWarning {
  id: string;
  source: "seo" | "products";
  count: number;
}

export interface MergeSummary {
  totalProducts: number;
  matchedCount: number;
  updatedCount: number;
  missingCount: number;
  duplicateCount: number;
  errorCount: number;
}

export interface MergeResult {
  mergedRecords: ProductRecord[];
  missingInProducts: string[];
  duplicates: DuplicateWarning[];
  summary: MergeSummary;
  errors: string[];
}
