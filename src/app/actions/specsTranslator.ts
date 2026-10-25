"use server";

import { requireUser } from "@/lib/auth/guard";
import { getActiveBrands, getAllProducts, updateCmsProductFields } from "@/lib/services/wixCms";

/**
 * How Technical Specifications is currently stored on a CMS item:
 * - "array": a real JSON array/object (already converted)
 * - "text":  a string (plain "Label: Value" lines, or legacy stringified JSON)
 * - "empty": missing / blank
 */
export type SpecsStorageFormat = "array" | "text" | "empty";

export interface CmsSpecsProduct {
  cmsItemId: string;
  Product: string;
  Title: string;
  Category: string;
  Brand: string;
  format: SpecsStorageFormat;
  /** Raw value as stored on CMS — string for "text", array/object for "array", null for "empty". */
  rawSpecs: unknown;
}

function pick(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim() !== "") return String(v);
  }
  return "";
}

function detectFormat(raw: unknown): SpecsStorageFormat {
  if (raw == null) return "empty";
  if (Array.isArray(raw)) return raw.length > 0 ? "array" : "empty";
  if (typeof raw === "object") return Object.keys(raw).length > 0 ? "array" : "empty";
  return String(raw).trim() ? "text" : "empty";
}

/**
 * Pulls every CMS product with its Technical Specifications left exactly as
 * stored (unlike pullCmsCatalogAsSheets(), which normalizes everything to an
 * array) so the Specs Translator can filter by storage format.
 */
export async function pullCmsSpecsAction(): Promise<
  { success: true; products: CmsSpecsProduct[] } | { success: false; error: string }
> {
  await requireUser("viewer");
  try {
    const [products, brands] = await Promise.all([getAllProducts(), getActiveBrands()]);
    if (products.length === 0) {
      return { success: false, error: "Không tìm thấy sản phẩm nào trên Wix CMS (kiểm tra lại cấu hình WIX_API_KEY / WIX_SITE_ID)." };
    }
    const brandNameById = new Map(brands.map((b) => [b._id, b.name]));

    const result: CmsSpecsProduct[] = products.map((product) => {
      const raw = product as unknown as Record<string, unknown>;
      const rawSpecs = raw.TechnicalSpecifications ?? raw.technicalSpecifications ?? null;
      const rawBrand = pick(raw, "Brand", "brand");
      return {
        cmsItemId: typeof raw._id === "string" ? raw._id : "",
        Product: pick(raw, "Product", "product"),
        Title: pick(raw, "Title", "title"),
        Category: pick(raw, "Category", "category"),
        Brand: brandNameById.get(rawBrand) || rawBrand,
        format: detectFormat(rawSpecs),
        rawSpecs,
      };
    });

    return { success: true, products: result };
  } catch (err) {
    console.error("[pullCmsSpecsAction] Failed:", err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Overwrites Technical Specifications on one CMS item (PATCH by real `_id`,
 * every other field untouched).
 * - target "array": `value` must be a JSON array string; stored as a real array.
 * - target "text":  `value` is stored as a plain string.
 */
export async function uploadCmsSpecsAction(
  itemId: string,
  target: "array" | "text",
  value: string
): Promise<{ success: boolean; error?: string }> {
  await requireUser("editor");
  if (!itemId.trim()) {
    return { success: false, error: "Thiếu cmsItemId của sản phẩm." };
  }

  let specsValue: string | unknown[] = value;
  if (target === "array") {
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) return { success: false, error: "Dữ liệu Array không hợp lệ (không phải mảng JSON)." };
      specsValue = parsed;
    } catch (err) {
      return { success: false, error: `JSON không hợp lệ: ${err instanceof Error ? err.message : String(err)}` };
    }
  } else if (/^\s*[[{]/.test(value)) {
    // updateCmsProductFields() auto-parses JSON-looking strings into arrays —
    // refuse instead of silently storing an array when text was requested.
    return { success: false, error: "Dữ liệu Text trông giống JSON — hãy chuyển sang dạng 'Label: Value' trước khi upload." };
  }

  try {
    const result = await updateCmsProductFields("", { TechnicalSpecifications: specsValue }, { itemId });
    return { success: result.success, error: result.error };
  } catch (err) {
    console.error("[uploadCmsSpecsAction] Failed:", err);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
