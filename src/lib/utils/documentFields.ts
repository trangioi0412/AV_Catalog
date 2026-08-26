import { WixProduct } from "@/lib/services/wixCms";

/**
 * Represents a single document field on a WixProduct that currently has a valid value.
 */
export interface DocumentEntry {
  /** The key name as it appears in the product object */
  fieldKey: string;
  /** Human-readable label shown in the UI */
  label: string;
  /** The actual wix:// or https URL stored in this field */
  url: string;
}

/**
 * Strictly validate and extract a document URL from a field value.
 * Filters out empty strings, "undefined", "null", "N/A", "none", "{}" and invalid non-URL values.
 */
export function extractValidDocumentUrl(val: any): string | null {
  if (!val) return null;

  let str = "";
  if (typeof val === "string") {
    str = val.trim();
  } else if (typeof val === "object" && val !== null) {
    if (typeof val.src === "string") str = val.src.trim();
    else if (typeof val.url === "string") str = val.url.trim();
    else if (typeof val.fileUrl === "string") str = val.fileUrl.trim();
  }

  if (!str) return null;

  const lower = str.toLowerCase();
  if (
    lower === "" ||
    lower === "undefined" ||
    lower === "null" ||
    lower === "n/a" ||
    lower === "none" ||
    lower === "{}" ||
    lower === "[]" ||
    lower === "[object object]"
  ) {
    return null;
  }

  // Must match a valid document / media URL format
  if (
    str.startsWith("wix:document://") ||
    str.startsWith("wix:image://") ||
    str.startsWith("wix:video://") ||
    str.startsWith("http://") ||
    str.startsWith("https://") ||
    str.startsWith("/")
  ) {
    return str;
  }

  return null;
}

/**
 * Returns true if a product has a valid document stored in the primary 'document' (or 'Document') column.
 */
export function hasProductDocument(product: WixProduct): boolean {
  if (!product) return false;
  const docUrl = extractValidDocumentUrl((product as any).document || (product as any).Document);
  return Boolean(docUrl);
}

/**
 * Inspect a WixProduct and return all populated document fields as DocumentEntry[].
 *
 * Checks both capitalised and lowercase variants of each field because Wix CMS
 * may return either casing depending on the collection schema.
 * Deduplicates by URL so the same file is not listed twice.
 */
export function getProductDocumentEntries(product: WixProduct): DocumentEntry[] {
  if (!product) return [];
  const entries: DocumentEntry[] = [];


  const push = (fieldKey: string, label: string) => {
    const validUrl = extractValidDocumentUrl((product as any)[fieldKey]);
    if (validUrl) {
      entries.push({ fieldKey, label, url: validUrl });
    }
  };

  // Inspect ONLY the document column (checking exact key present on product object)
  if ((product as any).document !== undefined && (product as any).document !== null) {
    push("document", "Document");
  } else if ((product as any).Document !== undefined && (product as any).Document !== null) {
    push("Document", "Document");
  } else {
    push("document", "Document");
  }

  // Deduplicate by URL so the same file isn't listed twice for both casing variants
  const seen = new Set<string>();
  return entries.filter((e) => {
    if (seen.has(e.url)) return false;
    seen.add(e.url);
    return true;
  });
}

