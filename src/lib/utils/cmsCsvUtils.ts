"use client";

/**
 * cmsCsvUtils.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Parses a CSV export of the Wix "Import1" products collection (downloaded
 * from the Wix CMS Content Manager) into a lookup by product/model name, for
 * CmsSyncDashboard's CSV-based comparison. Client-side only — runs in the
 * browser right after the admin picks the file, so the compare request can
 * skip Wix entirely and just diff in-memory values.
 *
 * Column names are matched case/spacing-insensitively against every name Wix
 * is known to export this field under (its raw field key, e.g. "mainFeature",
 * as well as the display label a human might have renamed the export column
 * to) — the same tolerant-matching approach getField()/getCms() use
 * elsewhere in this codebase for the same reason: nobody can guarantee which
 * casing Wix's export (or a spreadsheet app re-saving it) actually used.
 */

import Papa from "papaparse";

export interface CmsCsvRow {
  Title: string;
  MainFeature: string;
  ProductOverview: string;
}

export interface ParsedCmsCsv {
  /** Keyed by normalizeProductKey(product/model name). */
  byProduct: Map<string, CmsCsvRow>;
  rowCount: number;
  matchedColumnCount: number;
  columns: string[];
}

const COLUMN_CANDIDATES = {
  product: ["Product", "product", "Model", "model", "product (item)"],
  title: ["Title", "title"],
  mainFeature: ["MainFeature", "mainFeature", "Main Feature", "main feature"],
  productOverview: ["ProductOverview", "productOverview", "Product Overview", "product overview"],
};

function normalizeHeader(s: string): string {
  return s.toLowerCase().replace(/[\s_-]/g, "");
}

/** Resolves each logical field to whichever actual column name this CSV uses, once per parse (not per row). */
function resolveColumns(headers: string[]): Record<keyof typeof COLUMN_CANDIDATES, string | null> {
  const normalizedToActual = new Map<string, string>();
  headers.forEach((h) => normalizedToActual.set(normalizeHeader(h), h));

  const resolve = (candidates: string[]): string | null => {
    for (const c of candidates) {
      const match = normalizedToActual.get(normalizeHeader(c));
      if (match) return match;
    }
    return null;
  };

  return {
    product: resolve(COLUMN_CANDIDATES.product),
    title: resolve(COLUMN_CANDIDATES.title),
    mainFeature: resolve(COLUMN_CANDIDATES.mainFeature),
    productOverview: resolve(COLUMN_CANDIDATES.productOverview),
  };
}

/** Case/whitespace-insensitive key so "DMPS3-4K-350-C" and " dmps3-4k-350-c " match the same product. */
export function normalizeProductKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Parses a CSV file into a product-name-keyed lookup. Throws if the file
 * has no column that looks like a product/model name — every other column
 * is optional (a CSV missing e.g. Product Overview just means every row
 * compares as "missing on CMS" for that one field, not a hard failure).
 */
export async function parseCmsCsvFile(file: File): Promise<ParsedCmsCsv> {
  const text = await file.text();

  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (results) => {
        try {
          const columns = results.meta.fields || [];
          const resolved = resolveColumns(columns);
          if (!resolved.product) {
            reject(
              new Error(
                `Không tìm thấy cột "Product"/"Model" trong file CSV. Các cột hiện có: ${columns.join(", ") || "(không có)"}`
              )
            );
            return;
          }

          const byProduct = new Map<string, CmsCsvRow>();
          for (const row of results.data) {
            const productRaw = resolved.product ? row[resolved.product] : "";
            const product = (productRaw || "").trim();
            if (!product) continue;
            byProduct.set(normalizeProductKey(product), {
              Title: (resolved.title ? row[resolved.title] : "") || "",
              MainFeature: (resolved.mainFeature ? row[resolved.mainFeature] : "") || "",
              ProductOverview: (resolved.productOverview ? row[resolved.productOverview] : "") || "",
            });
          }

          const matchedColumnCount = [resolved.title, resolved.mainFeature, resolved.productOverview].filter(Boolean).length;

          resolve({ byProduct, rowCount: results.data.length, matchedColumnCount, columns });
        } catch (err) {
          reject(err);
        }
      },
      error: (err: unknown) => reject(err),
    });
  });
}
