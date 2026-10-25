/**
 * Content-completeness check for products — both queued rows (Product_New
 * sheet, every value a string) and live Wix CMS items (Import1, where
 * TechnicalSpecifications / galleryImages can be real arrays/objects).
 *
 * A value only counts as present when it carries real text somewhere inside
 * it, so "[]", "{}", '[{"label":"Weight","value":""}]', ["", " "] or a
 * placeholder like "—" are all "missing".
 */

/** Placeholder strings the scrapers/AI write instead of leaving a cell empty. */
const PLACEHOLDERS = new Set(["", "-", "—", "n/a", "na", "null", "undefined", "none", "[]", "{}"]);

function stringHasText(text: string): boolean {
  const t = text.trim();
  if (PLACEHOLDERS.has(t.toLowerCase())) return false;
  if (t.startsWith("[") || t.startsWith("{")) {
    try {
      return hasContent(JSON.parse(t));
    } catch {
      // Not JSON after all — plain text that happens to start with a bracket.
      return true;
    }
  }
  return true;
}

/** True when `value` contains real content (string, array or object; nested JSON is unpacked). */
export function hasContent(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return stringHasText(value);
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some(hasContent);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    // A { label, value } spec row is only useful when its value is filled in.
    if ("value" in obj) return hasContent(obj.value);
    return Object.values(obj).some(hasContent);
  }
  return false;
}

/** Number of spec rows that actually have a value (plain non-JSON text counts as 1 row). */
export function countFilledSpecs(raw: unknown): { filled: number; total: number } {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return { filled: 0, total: 0 };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return hasContent(raw) ? { filled: 1, total: 1 } : { filled: 0, total: 0 };
    }
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? Object.entries(parsed as Record<string, unknown>).map(([label, value]) => ({ label, value }))
      : [];
  return { filled: rows.filter(hasContent).length, total: rows.length };
}

// ─── Field catalog ──────────────────────────────────────────────────────────

type AnyProduct = object;

function get(p: AnyProduct, key: string): unknown {
  return (p as Record<string, unknown>)[key];
}

export interface ContentField {
  key: string;
  label: string;
  /** Checked when the user has not chosen fields yet. */
  defaultOn: boolean;
  /** Whether queued Product_New rows carry this field at all. */
  inQueue: boolean;
  /** The value(s) to test; an array means any of them counts. */
  read: (p: AnyProduct) => unknown;
}

const field = (key: string, label: string, defaultOn: boolean, inQueue = true): ContentField => ({
  key,
  label,
  defaultOn,
  inQueue,
  read: (p) => get(p, key),
});

export const CONTENT_FIELDS: ContentField[] = [
  field("Category", "Category", true),
  field("Title", "Title", true),
  field("Series", "Series", false),
  field("MainFeature", "Main Feature", true),
  field("ProductOverview", "Product Overview", true),
  field("TechnicalSpecifications", "Thông số kỹ thuật", true),
  field("image", "Hình ảnh", true),
  field("galleryImages", "Gallery ảnh", false, false),
  // CMS stores the datasheet in `document` / `Document`; queued rows use `Datasheet`.
  {
    key: "Datasheet",
    label: "Datasheet",
    defaultOn: true,
    inQueue: true,
    read: (p) => [get(p, "Datasheet"), get(p, "document"), get(p, "Document")],
  },
  field("Manual", "Manual", false, false),
  field("Brochure", "Brochure", false, false),
  field("Firmware", "Firmware", false, false),
  field("Videos", "Videos", false, false),
];

export const DEFAULT_CONTENT_FIELD_KEYS = CONTENT_FIELDS.filter((f) => f.defaultOn).map((f) => f.key);

/** Keys of every catalog field that has content in `product`. */
export function getFilledFieldKeys(product: AnyProduct): string[] {
  return CONTENT_FIELDS.filter((f) => hasContent(f.read(product))).map((f) => f.key);
}

/** Labels of the selected fields that are missing content, in catalog order. */
export function getMissingContent(
  product: AnyProduct,
  selectedKeys: readonly string[] = DEFAULT_CONTENT_FIELD_KEYS
): string[] {
  const selected = new Set(selectedKeys);
  return CONTENT_FIELDS.filter((f) => selected.has(f.key) && !hasContent(f.read(product))).map((f) => f.label);
}

/** Same as getMissingContent but from a precomputed list of filled keys. */
export function missingFromFilled(filledKeys: readonly string[], selectedKeys: readonly string[]): string[] {
  const filled = new Set(filledKeys);
  const selected = new Set(selectedKeys);
  return CONTENT_FIELDS.filter((f) => selected.has(f.key) && !filled.has(f.key)).map((f) => f.label);
}
