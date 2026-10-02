/**
 * cmsDataQualityChecks.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Deterministic (rule-based, no AI) data-quality checks for the "AI Kiểm Tra
 * CMS" tool. They complement catalogAiReview.ts rather than replace it:
 *   - They're exact: the same data always gives the same findings, with no
 *     model hallucinating a problem or missing an obvious one.
 *   - They see the WHOLE catalog at once. The AI review only ever sees a
 *     batch of ~10 products, so it cannot notice two products sharing the
 *     same name or the same copy-pasted description across batches.
 *
 * Pure functions, no I/O — safe to import from a Client Component.
 */

import { normalizeName, matchKey } from "../utils/productName";

export interface QualityCheckProduct {
  id: string;
  /** Brand display name (not the CMS reference id). */
  brand: string;
  title: string;
  product: string;
  category: string;
  series: string;
  mainFeature: string;
  productOverview: string;
  specs: { label: string; value: string }[];
  /** Model code ("product (item)" column), when the brand's import has one. */
  productItem?: string;
  image?: string;
  /** Raw Datasheet field — may hold several URLs separated by newlines. */
  datasheet?: string;
}

export const RULE_CHECKS = [
  {
    key: "missing_fields",
    label: "Thiếu thông tin bắt buộc",
    hint: "Trống Title, Category, Main Feature, Product Overview, Technical Specifications, ảnh, hoặc chưa gắn hãng.",
  },
  {
    key: "duplicate_product",
    label: "Sản phẩm bị trùng",
    hint: "Hai sản phẩm trở lên có cùng tên (Title) hoặc cùng mã model — thường là import 2 lần.",
  },
  {
    key: "copied_content",
    label: "Mô tả bị sao chép giữa các sản phẩm",
    hint: "Main Feature / Product Overview giống hệt một sản phẩm khác (dấu hiệu dán nhầm). AI không phát hiện được lỗi này vì chỉ xem từng lô 10 sản phẩm.",
  },
  {
    key: "placeholder_text",
    label: "Còn sót nội dung tạm",
    hint: 'Còn "N/A", "TBD", "TODO", "CẦN VERIFY", "???", "lorem ipsum"... trong các trường nội dung.',
  },
  {
    key: "broken_encoding",
    label: "Lỗi font / ký tự rác",
    hint: 'Ký tự lỗi mã hoá như "Ã©", "â€™", "�" do copy từ PDF/Excel.',
  },
  {
    key: "spec_conflict",
    label: "Thông số kỹ thuật mâu thuẫn",
    hint: "Cùng một thông số xuất hiện nhiều lần với giá trị khác nhau, hoặc thông số có tên mà không có giá trị.",
  },
  {
    key: "invalid_link",
    label: "Link Datasheet / ảnh sai định dạng",
    hint: "Datasheet hoặc ảnh không phải đường dẫn http(s):// hay wix:… hợp lệ.",
  },
] as const;

export type RuleCheckKey = (typeof RULE_CHECKS)[number]["key"];

export interface RuleFinding {
  category: RuleCheckKey;
  message: string;
}

const UNBRANDED = "Chưa gắn nhãn hãng"; // brand label cmsCatalogPull.ts gives an item with no brand

const PLACEHOLDER_RE = /\b(N\/A|TBD|TODO|lorem ipsum)\b|CẦN VERIFY|\?{3,}/i;
// UTF-8 text decoded as Windows-1252: "Ã©" / "â€™" / "Â" + NBSP for Latin text, and for
// Vietnamese "áº" / "á»" (ạ, ố…), "Æ°" / "Æ¡" (ư, ơ), "Ä‘" (đ) — plus the Unicode
// replacement character. None of these pairs occur in correctly-encoded text;
// "Â"/"Ã" followed by an ordinary letter (e.g. "ÂM THANH") is not matched.
const MOJIBAKE_RE = /\u00C3[\u0080-\u00BF]|\u00E2\u20AC|\u00C2[\u00A0-\u00BF]|\u00E1[\u00BA\u00BB]|\u00C6[\u00B0\u00A1]|\u00C4\u2018|\uFFFD/;
const VALID_LINK_RE = /^(https?:\/\/\S+|wix:(image|document|video):\/\/\S+)$/i;

// A description shorter than this is too generic to call "copied" (e.g. "HDMI 2.0").
const MIN_COPIED_LENGTH = 60;

const TEXT_FIELDS: { key: "title" | "mainFeature" | "productOverview" | "series" | "category"; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "category", label: "Category" },
  { key: "series", label: "Series" },
  { key: "mainFeature", label: "Main Feature" },
  { key: "productOverview", label: "Product Overview" },
];

function displayName(p: QualityCheckProduct): string {
  return [p.brand, p.title || p.product].filter(Boolean).join(" ") || p.id;
}

function checkMissingFields(p: QualityCheckProduct): RuleFinding[] {
  const missing: string[] = [];
  if (!p.title.trim() && !p.product.trim()) missing.push("Title/Product");
  if (!p.category.trim()) missing.push("Category");
  if (!p.mainFeature.trim()) missing.push("Main Feature");
  if (!p.productOverview.trim()) missing.push("Product Overview");
  if (p.specs.length === 0) missing.push("Technical Specifications");
  if (!p.image?.trim()) missing.push("ảnh (image)");
  if (!p.brand.trim() || p.brand === UNBRANDED) missing.push("hãng (Brand)");
  return missing.length ? [{ category: "missing_fields", message: `Đang trống: ${missing.join(", ")}.` }] : [];
}

function checkPlaceholder(p: QualityCheckProduct): RuleFinding[] {
  const hits: string[] = [];
  for (const { key, label } of TEXT_FIELDS) {
    const m = p[key].match(PLACEHOLDER_RE);
    if (m) hits.push(`${label} ("${m[0]}")`);
  }
  const specHit = p.specs.find((s) => PLACEHOLDER_RE.test(s.value));
  if (specHit) hits.push(`Technical Specifications ("${specHit.label}: ${specHit.value.slice(0, 40)}")`);
  return hits.length ? [{ category: "placeholder_text", message: `Còn nội dung tạm ở: ${hits.join("; ")}.` }] : [];
}

function checkEncoding(p: QualityCheckProduct): RuleFinding[] {
  const fields = TEXT_FIELDS.filter(({ key }) => MOJIBAKE_RE.test(p[key])).map(({ label }) => label);
  if (p.specs.some((s) => MOJIBAKE_RE.test(s.label) || MOJIBAKE_RE.test(s.value))) fields.push("Technical Specifications");
  return fields.length ? [{ category: "broken_encoding", message: `Có ký tự lỗi mã hoá ở: ${fields.join(", ")}.` }] : [];
}

function checkSpecs(p: QualityCheckProduct): RuleFinding[] {
  const findings: RuleFinding[] = [];
  const valuesByLabel = new Map<string, { label: string; values: Set<string> }>();
  const emptyLabels: string[] = [];
  for (const s of p.specs) {
    const label = s.label.trim();
    const value = s.value.trim();
    if (!label) continue;
    if (!value) {
      emptyLabels.push(label);
      continue;
    }
    const k = label.toLowerCase();
    if (!valuesByLabel.has(k)) valuesByLabel.set(k, { label, values: new Set() });
    valuesByLabel.get(k)!.values.add(value.toLowerCase().replace(/\s+/g, " "));
  }
  const conflicts = [...valuesByLabel.values()].filter((v) => v.values.size > 1).map((v) => `"${v.label}" (${v.values.size} giá trị)`);
  if (conflicts.length) {
    findings.push({ category: "spec_conflict", message: `Thông số lặp lại với giá trị khác nhau: ${conflicts.join(", ")}.` });
  }
  if (emptyLabels.length) {
    findings.push({ category: "spec_conflict", message: `Thông số có tên nhưng không có giá trị: ${emptyLabels.slice(0, 5).join(", ")}${emptyLabels.length > 5 ? "…" : ""}.` });
  }
  return findings;
}

function checkLinks(p: QualityCheckProduct): RuleFinding[] {
  const bad: string[] = [];
  const describe = (what: string, url: string) =>
    `${what} "${url.length > 80 ? `…${url.slice(-80)}` : url}"${/\s/.test(url) ? " (chứa khoảng trắng)" : ""}`;
  const image = p.image?.trim();
  if (image && !VALID_LINK_RE.test(image)) bad.push(describe("ảnh", image));
  for (const line of (p.datasheet || "").split(/\r?\n/)) {
    const url = line.trim();
    if (url && !VALID_LINK_RE.test(url)) bad.push(describe("Datasheet", url));
  }
  return bad.length ? [{ category: "invalid_link", message: `Đường dẫn không hợp lệ: ${bad.join("; ")}.` }] : [];
}

/** Groups products by a key; returns only groups with 2+ members. */
function groupsOf(products: QualityCheckProduct[], keyOf: (p: QualityCheckProduct) => string): QualityCheckProduct[][] {
  const map = new Map<string, QualityCheckProduct[]>();
  for (const p of products) {
    const k = keyOf(p);
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(p);
  }
  return [...map.values()].filter((g) => g.length > 1);
}

function others(group: QualityCheckProduct[], self: QualityCheckProduct): string {
  const names = group.filter((o) => o !== self).map(displayName);
  return names.slice(0, 3).join(", ") + (names.length > 3 ? ` và ${names.length - 3} sản phẩm khác` : "");
}

/**
 * Runs the selected rule checks. Cross-product checks (duplicates, copied
 * content) compare against `catalog` — pass the whole loaded catalog even
 * when `products` is only a brand-filtered subset, so a duplicate of a
 * product from another brand is still caught.
 */
export function runRuleChecks(
  products: QualityCheckProduct[],
  selected: readonly RuleCheckKey[],
  catalog: QualityCheckProduct[] = products
): Map<string, RuleFinding[]> {
  const on = new Set(selected);
  const result = new Map<string, RuleFinding[]>();
  const add = (id: string, f: RuleFinding[]) => {
    if (f.length === 0) return;
    result.set(id, [...(result.get(id) || []), ...f]);
  };

  const inScope = new Set(products.map((p) => p.id));

  for (const p of products) {
    if (on.has("missing_fields")) add(p.id, checkMissingFields(p));
    if (on.has("placeholder_text")) add(p.id, checkPlaceholder(p));
    if (on.has("broken_encoding")) add(p.id, checkEncoding(p));
    if (on.has("spec_conflict")) add(p.id, checkSpecs(p));
    if (on.has("invalid_link")) add(p.id, checkLinks(p));
  }

  if (on.has("duplicate_product")) {
    const flagged = new Set<string>();
    const byName = groupsOf(catalog, (p) => matchKey(normalizeName(p.title || p.product)));
    const byModel = groupsOf(catalog, (p) => (p.productItem ? matchKey(normalizeName(p.productItem)) : ""));
    for (const [group, what] of [
      [byName, "cùng tên"],
      [byModel, "cùng mã model"],
    ] as const) {
      for (const g of group) {
        // Same name but distinct model codes = different products whose Title
        // doesn't tell them apart, not a double import.
        const models = new Set(g.map((p) => p.productItem?.trim()).filter(Boolean));
        const distinctModels = what === "cùng tên" && models.size === g.length;
        for (const p of g) {
          if (!inScope.has(p.id) || flagged.has(`${p.id}:${what}`)) continue;
          flagged.add(`${p.id}:${what}`);
          const message = distinctModels
            ? `Trùng tên với ${others(g, p)} nhưng khác mã model (${[...models].join(", ")}) — nên thêm mã model vào Title để phân biệt.`
            : `Trùng ${what} với: ${others(g, p)} — có thể bị import 2 lần.`;
          add(p.id, [{ category: "duplicate_product", message }]);
        }
      }
    }
  }

  if (on.has("copied_content")) {
    for (const [field, label] of [
      ["mainFeature", "Main Feature"],
      ["productOverview", "Product Overview"],
    ] as const) {
      const groups = groupsOf(catalog, (p) => {
        const text = p[field].trim().toLowerCase().replace(/\s+/g, " ");
        return text.length >= MIN_COPIED_LENGTH ? text : "";
      });
      for (const g of groups) {
        // Same product imported twice is a duplicate, not copied content — only
        // flag when the copies belong to differently-named products.
        if (new Set(g.map((p) => matchKey(normalizeName(p.title || p.product)))).size < 2) continue;
        for (const p of g) {
          if (!inScope.has(p.id)) continue;
          add(p.id, [{ category: "copied_content", message: `${label} giống hệt: ${others(g, p)}.` }]);
        }
      }
    }
  }

  return result;
}
