import type { ProductRow, AiFixSuggestion, Specification, SheetData, AiFixEngine } from "@/types";

/** Finds the row's actual column name for a field, matching case/spacing-insensitively; falls back to the first candidate if the sheet has no such column (so applying still creates it). */
export function resolveColumnKey(columns: string[], candidates: string[]): string {
  const normalize = (s: string) => s.toLowerCase().replace(/[\s_]/g, "");
  for (const candidate of candidates) {
    const match = columns.find((c) => normalize(c) === normalize(candidate));
    if (match) return match;
  }
  return candidates[0];
}

export function getFieldValue(row: ProductRow, candidates: string[]): string {
  for (const c of candidates) {
    const key = Object.keys(row).find((k) => k.toLowerCase() === c.toLowerCase());
    if (key && row[key] != null && String(row[key]).trim() !== "") return String(row[key]);
  }
  return "";
}

type TextFieldKey = "Category" | "Product" | "Title" | "Series" | "Main Feature" | "Product Overview" | "Brand";

interface FieldDef {
  key: TextFieldKey;
  label: string;
  columnCandidates: string[];
}

export const AI_FIX_TEXT_FIELDS: FieldDef[] = [
  { key: "Category", label: "Category", columnCandidates: ["Category"] },
  { key: "Product", label: "Product / Model", columnCandidates: ["Product"] },
  { key: "Title", label: "Title", columnCandidates: ["Title"] },
  { key: "Series", label: "Series", columnCandidates: ["Series"] },
  { key: "Main Feature", label: "Main Feature", columnCandidates: ["Main Feature", "MainFeature"] },
  { key: "Product Overview", label: "Product Overview", columnCandidates: ["Product Overview", "ProductOverview"] },
  { key: "Brand", label: "Brand", columnCandidates: ["Brand"] },
];

export const TECH_SPECS_CANDIDATES = ["Technical Specifications", "Thông số kỹ thuật"];

export function parseSpecsJson(text: string): Specification[] {
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed) && parsed.every((s) => s && typeof s.label === "string" && typeof s.value === "string")) {
      return parsed;
    }
  } catch {
    // fall through
  }
  return [];
}

export interface AiFixFieldChange {
  field: string;
  columnKey: string;
  oldValue: string;
  newValue: string;
  isSpecs?: boolean;
  specsArray?: Specification[];
}

/**
 * Every field where an AiFixSuggestion genuinely differs from a row's current
 * values — the full set a "select all" apply would use. Shared by
 * AiFixReviewModal (per-row, user picks a subset), the bulk "Áp dụng tất cả"
 * action (applies every entry), and the AI-fix-suggestions export (reports
 * every entry without applying anything).
 */
export function computeAiFixChanges(row: ProductRow, suggestion: AiFixSuggestion, columns: string[]): AiFixFieldChange[] {
  const changes: AiFixFieldChange[] = [];

  AI_FIX_TEXT_FIELDS.forEach((f) => {
    const currentVal = getFieldValue(row, f.columnCandidates);
    const suggestedVal = suggestion[f.key] as string;
    if (suggestedVal === currentVal) return;
    changes.push({
      field: f.label,
      columnKey: resolveColumnKey(columns, f.columnCandidates),
      oldValue: currentVal,
      newValue: suggestedVal,
    });
  });

  // A suggestion of [] is legitimate (the AI Fix engine can deliberately clear
  // specs it determined were copy-pasted from an unrelated product) — the
  // only question is whether it differs from what's there now.
  const currentSpecs = Array.isArray(row.transformedSpecifications) ? row.transformedSpecifications : [];
  const suggestedSpecs = parseSpecsJson(suggestion["Technical Specifications"]);
  if (JSON.stringify(suggestedSpecs) !== JSON.stringify(currentSpecs)) {
    changes.push({
      field: "Technical Specifications",
      columnKey: resolveColumnKey(columns, TECH_SPECS_CANDIDATES),
      oldValue: currentSpecs.map((s) => `${s.label}: ${s.value}`).join("; "),
      newValue: suggestedSpecs.map((s) => `${s.label}: ${s.value}`).join("; "),
      isSpecs: true,
      specsArray: suggestedSpecs,
    });
  }

  return changes;
}

/** Builds the ProductRow updates object from a (possibly filtered) subset of changes. */
export function buildUpdatesFromChanges(changes: AiFixFieldChange[]): Partial<ProductRow> {
  const updates: Partial<ProductRow> = {};
  changes.forEach((c) => {
    updates[c.columnKey] = c.newValue;
    if (c.isSpecs && c.specsArray) {
      updates.transformedSpecifications = c.specsArray;
      updates.parsedSpecifications = JSON.parse(JSON.stringify(c.specsArray));
    }
  });
  return updates;
}

export interface PendingAiFixChange extends AiFixFieldChange {
  /** Composite key for use as a React key / selection map key. */
  key: string;
  rowId: string;
  sheetIndex: number;
  rowIndex: number;
  brand: string;
  product: string;
  engine: AiFixEngine;
}

/**
 * Flattens every real, pending AI Fix change across the whole catalog into one
 * list — the single source of truth for "what does AI actually propose to
 * change" used by the toolbar counts, the bulk apply action, and the AI Fix
 * Dashboard. `declinedCount` is how many rows have a suggestion where AI found
 * nothing it could confidently fix (fields: {}, or every field already
 * matched) — a legitimate outcome, not a bug, but worth surfacing so "why did
 * apply do nothing for this one" has an answer.
 */
export function collectPendingAiFixChanges(sheets: SheetData[]): {
  changes: PendingAiFixChange[];
  declinedCount: number;
  productCount: number;
} {
  const changes: PendingAiFixChange[] = [];
  let declinedCount = 0;
  const productIds = new Set<string>();

  sheets.forEach((sheet, sheetIndex) => {
    sheet.rows.forEach((row, rowIndex) => {
      if (!row.aiFixSuggestion) return;
      const rowChanges = computeAiFixChanges(row, row.aiFixSuggestion, sheet.columns);
      if (rowChanges.length === 0) {
        declinedCount++;
        return;
      }
      productIds.add(row.id);
      rowChanges.forEach((c) => {
        changes.push({
          ...c,
          key: `${row.id}::${c.field}`,
          rowId: row.id,
          sheetIndex,
          rowIndex,
          brand: String(row.Brand ?? row.brand ?? ""),
          product: String(row.Product ?? row.product ?? ""),
          engine: row.aiFixSuggestion!.engine,
        });
      });
    });
  });

  return { changes, declinedCount, productCount: productIds.size };
}
