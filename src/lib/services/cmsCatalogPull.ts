/**
 * cmsCatalogPull.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Pulls the full product catalog directly from Wix CMS (Import1) and converts
 * it into the exact same SheetData[]/ProductRow shape an uploaded Excel file
 * produces (see fileUtils.ts's transformRow). Once loaded via
 * useDataStore.setFileData, every existing catalog tool — "Kiểm tra AI" (AI
 * Review), "Sửa bằng AI" (AI Fix), DataTable, Export — works completely
 * unchanged on live CMS data, so this is a second DATA SOURCE for the same
 * pipeline rather than a separate "review CMS data" feature to build and keep
 * in sync with the Excel path.
 *
 * Server-only: never import this from a Client Component.
 */

import { v4 as uuidv4 } from "uuid";
import { getAllProducts, getActiveBrands } from "./wixCms";
import { textToTechnicalSpecs } from "../utils/specsTranslator";
import type { SheetData, ProductRow, Specification } from "@/types";

/**
 * Column set for the generated sheets — matches the fields AI Review
 * (catalogAiReview.ts) and AI Fix (catalogAiFixOllama.ts) already look for on
 * an uploaded-Excel row, plus the reference fields CMS Sync/export rely on.
 */
const CATALOG_COLUMNS = [
  "Category",
  "Product",
  "Title",
  "Series",
  "Main Feature",
  "Product Overview",
  "Technical Specifications",
  "Brand",
  "image",
  "Datasheet",
];

/** Case-insensitive-ish field pick — Wix collections aren't guaranteed to store a given field under the exact casing the WixProduct type declares (see getCms() in wixCms.ts for the same defensive pattern). */
function pick(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim() !== "") return String(v);
  }
  return "";
}

function isSpecArray(val: unknown): val is Specification[] {
  return Array.isArray(val) && val.every((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).label === "string" && typeof (item as Record<string, unknown>).value === "string");
}

/**
 * Technical Specifications on Wix can be a real array/object (Wix Data
 * stores whatever JSON shape was written to it) or a plain string — mirrors
 * the JSON-then-plain-text fallback fileUtils.ts's transformRow() already
 * uses for an uploaded Excel's Technical Specifications column.
 */
function extractSpecifications(raw: unknown): Specification[] {
  if (isSpecArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const maybe = raw as Record<string, unknown>;
    if (typeof maybe.label === "string" && typeof maybe.value === "string") {
      return [{ label: maybe.label, value: maybe.value }];
    }
    return [];
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        return extractSpecifications(JSON.parse(trimmed));
      } catch {
        // Not actually JSON despite the leading bracket — fall through.
      }
    }
    return textToTechnicalSpecs(trimmed);
  }
  return [];
}

export interface CmsCatalogPullResult {
  sheets: SheetData[];
  totalProducts: number;
}

/**
 * Fetches every product currently on Wix CMS and groups them into one
 * SheetData per brand (mirroring the "one sheet per brand" convention an
 * uploaded catalog Excel file already uses) — ready to hand to
 * useDataStore.setFileData().
 */
export async function pullCmsCatalogAsSheets(): Promise<CmsCatalogPullResult> {
  const [products, brands] = await Promise.all([getAllProducts(), getActiveBrands()]);
  const brandNameById = new Map(brands.map((b) => [b._id, b.name]));

  const rowsByBrand = new Map<string, ProductRow[]>();

  for (const product of products) {
    const raw = product as unknown as Record<string, unknown>;

    const rawBrand = pick(raw, "Brand", "brand");
    const brandName = brandNameById.get(rawBrand) || rawBrand || "Chưa gắn nhãn hãng";

    const specifications = extractSpecifications(raw.TechnicalSpecifications ?? raw.technicalSpecifications);

    const row: ProductRow = {
      id: uuidv4(),
      // The real Wix Data item id (see normalizeCmsItem in wixCms.ts) — kept
      // separately from `id` above so a write-back can PATCH this exact
      // record by id instead of re-matching by Product/model name (see the
      // ProductRow.cmsItemId doc comment for why that match is unsafe).
      cmsItemId: typeof raw._id === "string" ? raw._id : "",
      Category: pick(raw, "Category", "category"),
      Product: pick(raw, "Product", "product"),
      Title: pick(raw, "Title", "title"),
      Series: pick(raw, "Series", "series"),
      "Main Feature": pick(raw, "MainFeature", "mainFeature", "Main Feature"),
      "Product Overview": pick(raw, "ProductOverview", "productOverview", "Product Overview"),
      "Technical Specifications": JSON.stringify(specifications, null, 2),
      Brand: brandName,
      image: pick(raw, "image", "Image"),
      Datasheet: pick(raw, "Datasheet", "datasheet"),
      parsedSpecifications: specifications,
      transformedSpecifications: JSON.parse(JSON.stringify(specifications)),
      validationState: "valid",
      parsingErrors: [],
      isEdited: false,
      originalRawRow: JSON.parse(JSON.stringify(raw)),
    };

    if (!rowsByBrand.has(brandName)) rowsByBrand.set(brandName, []);
    rowsByBrand.get(brandName)!.push(row);
  }

  const sheets: SheetData[] = Array.from(rowsByBrand.entries()).map(([brandName, rows]) => ({
    sheetName: brandName,
    brandName,
    columns: CATALOG_COLUMNS,
    rows,
  }));

  return { sheets, totalProducts: products.length };
}
