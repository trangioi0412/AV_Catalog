"use client";

/**
 * /admin/tools/cms-ai-review
 * ─────────────────────────────────────────────────────────────────────────────
 * Standalone tool: pull products straight from Wix CMS, let the admin choose
 * which column(s) to have AI check (mainly Category/Series), then run the
 * AI review and show a findings dashboard. Deliberately its own page/local
 * state — NOT wired into the "/" Catalog Upload dashboard or its
 * useDataStore — so pulling CMS data here never touches whatever catalog
 * (Excel-uploaded or otherwise) is currently loaded there.
 *
 * Reuses the existing server-side pieces (pullCmsCatalogAction,
 * /api/catalog-upload/ai-review with its targetFields option) since those
 * are generic services, not part of the Catalog Upload page itself.
 */

import React from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { pullCmsCatalogAction, updateCmsProductFieldsByIdAction } from "@/app/actions/discovery";
import { toast } from "sonner";
import { BrandMultiSelect } from "@/components/data/BrandMultiSelect";
import { RULE_CHECKS, runRuleChecks, type QualityCheckProduct, type RuleCheckKey } from "@/lib/services/cmsDataQualityChecks";
import { Bot, Database, Loader2, ArrowDownToLine, ChevronDown, ChevronRight, ShieldCheck, ScanSearch, AlertTriangle, Wrench, UploadCloud, Info, Layers, ListChecks } from "lucide-react";

interface LocalProduct {
  id: string;
  /** Real Wix CMS item `_id` (ProductRow.cmsItemId) — the ONLY safe key to write this product back to CMS with; never re-match by `product`/model name, which isn't guaranteed unique or even non-empty. */
  cmsItemId: string;
  brand: string;
  product: string;
  fields: Record<string, string>;
  /** Structured specs + raw link/model fields — only used by the rule-based checks. */
  specs: { label: string; value: string }[];
  productItem: string;
  image: string;
  datasheet: string;
}

interface CategoryCluster {
  canonical: string;
  members: string[];
}

interface GroundingSource {
  title: string;
  url: string;
}

interface Finding {
  category: string;
  message: string;
  /** "ai" = catalogAiReview (Ollama); "rule" = cmsDataQualityChecks. */
  source?: "ai" | "rule";
}

interface FixSuggestion {
  fields: Record<string, string>;
  note: string;
}

interface FixChange {
  key: string;
  productId: string;
  brand: string;
  product: string;
  field: string;
  fieldKey: string;
  oldValue: string;
  newValue: string;
}

/** Fields catalogAiFixOllama.ts can propose AND updateCmsProductFieldsByIdAction can actually push back to CMS — Brand/Product from FIXABLE_FIELDS are deliberately excluded (Brand is a CMS reference ID; Product is display-only here now that writes go by cmsItemId, not by name — neither is safe to auto-push). */
const FIX_FIELD_LABELS: Record<string, string> = {
  Category: "Category",
  Title: "Title",
  Series: "Series",
  MainFeature: "Main Feature",
  ProductOverview: "Product Overview",
  TechnicalSpecifications: "Technical Specifications",
};
const PUSHABLE_FIX_FIELDS = Object.keys(FIX_FIELD_LABELS);

/** Mirrors AI_REVIEW_TARGET_FIELDS in catalogAiReview.ts (server-only, so duplicated here). */
const FIELD_OPTIONS: { key: string; label: string; hint: string }[] = [
  { key: "Category", label: "Category", hint: "Category có khớp với loại sản phẩm thực tế (đối chiếu với Main Feature/Product Overview) không." },
  { key: "Series", label: "Series", hint: "Series có khớp với Model/Title/Brand không, có bị dán nhầm từ sản phẩm khác không." },
  { key: "Title", label: "Title / Tên sản phẩm", hint: "Tên sản phẩm/Model có bị thiếu, lỗi ký tự, hay cắt cụt không." },
  { key: "MainFeature", label: "Main Feature", hint: "Placeholder còn sót, nội dung dán nhầm, hoặc lẫn Anh/Việt." },
  { key: "ProductOverview", label: "Product Overview", hint: "Placeholder còn sót, nội dung dán nhầm, hoặc lẫn Anh/Việt." },
  { key: "TechnicalSpecifications", label: "Technical Specifications", hint: "Thông số trống/quá sơ sài, hoặc dán nhầm từ sản phẩm khác." },
];
const DEFAULT_FIELDS = ["Category", "Series"];

const CATEGORY_LABELS: Record<string, string> = {
  category_mismatch: "Category không khớp",
  series_mismatch: "Series không khớp",
  missing_specs: "Thông số thiếu/sơ sài",
  invalid_name: "Tên sản phẩm lỗi",
  placeholder_data: "Còn sót placeholder",
  duplicate_content: "Nội dung trùng lặp",
  mixed_language: "Lẫn Anh/Việt",
  other: "Khác",
  ...Object.fromEntries(RULE_CHECKS.map((r) => [r.key, r.label])),
};

export default function CmsAiReviewPage() {
  const [products, setProducts] = React.useState<LocalProduct[]>([]);
  const [isPulling, setIsPulling] = React.useState(false);
  const [selectedFields, setSelectedFields] = React.useState<string[]>(DEFAULT_FIELDS);
  const [isReviewing, setIsReviewing] = React.useState(false);
  const [progress, setProgress] = React.useState({ done: 0, total: 0 });
  const [findingsById, setFindingsById] = React.useState<Map<string, Finding[]>>(new Map());
  const [hasReviewed, setHasReviewed] = React.useState(false);
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  // Brand names (as shown on each product) to limit checking to; empty = every brand.
  const [brandFilter, setBrandFilter] = React.useState<string[]>([]);
  const [selectedRules, setSelectedRules] = React.useState<RuleCheckKey[]>(RULE_CHECKS.map((r) => r.key));
  const [ruleFindingsById, setRuleFindingsById] = React.useState<Map<string, Finding[]>>(new Map());
  const [hasRuleChecked, setHasRuleChecked] = React.useState(false);

  const [isFixing, setIsFixing] = React.useState(false);
  const [fixProgress, setFixProgress] = React.useState({ done: 0, total: 0 });
  const [fixSuggestionsById, setFixSuggestionsById] = React.useState<Map<string, FixSuggestion>>(new Map());
  const [hasFixed, setHasFixed] = React.useState(false);
  const [selectedFixKeys, setSelectedFixKeys] = React.useState<Record<string, boolean>>({});
  const [isApplyingFixes, setIsApplyingFixes] = React.useState(false);
  const [appliedProductIds, setAppliedProductIds] = React.useState<Set<string>>(new Set());

  const [isClustering, setIsClustering] = React.useState(false);
  const [categoryClusters, setCategoryClusters] = React.useState<CategoryCluster[] | null>(null);
  const [hasClustered, setHasClustered] = React.useState(false);
  const [selectedClusters, setSelectedClusters] = React.useState<Record<number, boolean>>({});
  const [clusterOverrides, setClusterOverrides] = React.useState<Record<number, string>>({});
  const [isApplyingClusters, setIsApplyingClusters] = React.useState(false);
  const [appliedClusterIndices, setAppliedClusterIndices] = React.useState<Set<number>>(new Set());
  const [useWebVerification, setUseWebVerification] = React.useState(true);
  const [clusterSources, setClusterSources] = React.useState<GroundingSource[]>([]);

  const handlePull = async () => {
    setIsPulling(true);
    const toastId = toast.loading("Đang tải dữ liệu từ Wix CMS...");
    try {
      const result = await pullCmsCatalogAction();
      toast.dismiss(toastId);
      if (!result.success) {
        toast.error(`Tải dữ liệu từ CMS thất bại: ${result.error}`);
        return;
      }

      const flat: LocalProduct[] = result.sheets.flatMap((sheet) =>
        sheet.rows.map((row) => {
          const specs = Array.isArray(row.transformedSpecifications)
            ? row.transformedSpecifications.map((s: { label: string; value: string }) => `${s.label}: ${s.value}`).join("; ")
            : "";
          return {
            id: row.id,
            cmsItemId: String(row.cmsItemId ?? ""),
            brand: String(row.Brand ?? ""),
            product: String(row.Product ?? row.Title ?? ""),
            fields: {
              Category: String(row.Category ?? ""),
              Series: String(row.Series ?? ""),
              Title: String(row.Title ?? ""),
              MainFeature: String(row["Main Feature"] ?? ""),
              ProductOverview: String(row["Product Overview"] ?? ""),
              TechnicalSpecifications: specs,
              Brand: String(row.Brand ?? ""),
              Product: String(row.Product ?? ""),
            },
            specs: Array.isArray(row.transformedSpecifications) ? row.transformedSpecifications : [],
            productItem: String(row.originalRawRow?.productItem ?? row.originalRawRow?.ProductItem ?? ""),
            image: String(row.image ?? ""),
            datasheet: String(row.Datasheet ?? ""),
          };
        })
      );

      setProducts(flat);
      setFindingsById(new Map());
      setHasReviewed(false);
      setRuleFindingsById(new Map());
      setHasRuleChecked(false);
      // Keep only brands that still exist in the freshly loaded data
      setBrandFilter((prev) => prev.filter((b) => flat.some((p) => p.brand === b)));
      setFixSuggestionsById(new Map());
      setHasFixed(false);
      setAppliedProductIds(new Set());
      setCategoryClusters(null);
      setHasClustered(false);
      setSelectedClusters({});
      setClusterOverrides({});
      setAppliedClusterIndices(new Set());
      setClusterSources([]);
      toast.success(`Đã tải ${result.totalProducts} sản phẩm từ Wix CMS.`);
    } catch (err) {
      toast.dismiss(toastId);
      toast.error(`Tải dữ liệu từ CMS thất bại: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsPulling(false);
    }
  };

  const brandOptions = React.useMemo(() => {
    const counts = new Map<string, number>();
    products.forEach((p) => counts.set(p.brand, (counts.get(p.brand) ?? 0) + 1));
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => ({ value: name, label: `${name} (${count})` }));
  }, [products]);

  /** Products the brand filter keeps — what both the AI review and the rule checks run on. */
  const scopedProducts = React.useMemo(
    () => (brandFilter.length === 0 ? products : products.filter((p) => brandFilter.includes(p.brand))),
    [products, brandFilter]
  );

  const toQualityCheckProduct = (p: LocalProduct): QualityCheckProduct => ({
    id: p.id,
    brand: p.brand,
    title: p.fields.Title,
    product: p.fields.Product,
    category: p.fields.Category,
    series: p.fields.Series,
    mainFeature: p.fields.MainFeature,
    productOverview: p.fields.ProductOverview,
    specs: p.specs,
    productItem: p.productItem,
    image: p.image,
    datasheet: p.datasheet,
  });

  const handleRunRuleChecks = () => {
    if (scopedProducts.length === 0) return;
    if (selectedRules.length === 0) {
      toast.error("Chưa chọn quy tắc nào để kiểm tra.");
      return;
    }
    // Duplicates/copied content are compared against the whole catalog, so a
    // product copied from another brand is still caught when filtering by brand.
    const result = runRuleChecks(scopedProducts.map(toQualityCheckProduct), selectedRules, products.map(toQualityCheckProduct));
    const next = new Map<string, Finding[]>();
    result.forEach((findings, id) => next.set(id, findings.map((f) => ({ ...f, source: "rule" as const }))));
    setRuleFindingsById(next);
    setHasRuleChecked(true);
    toast.success(
      next.size > 0
        ? `Kiểm tra quy tắc: phát hiện vấn đề ở ${next.size}/${scopedProducts.length} sản phẩm.`
        : `Kiểm tra quy tắc: không phát hiện vấn đề nào trong ${scopedProducts.length} sản phẩm.`
    );
  };

  const productsByCategory = React.useMemo(() => {
    const map = new Map<string, LocalProduct[]>();
    products.forEach((p) => {
      const cat = p.fields.Category?.trim();
      if (!cat) return;
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(p);
    });
    return map;
  }, [products]);

  const handleClusterCategories = async () => {
    const distinctCategories = Array.from(productsByCategory.keys());
    if (distinctCategories.length < 2) {
      toast.error("Cần ít nhất 2 giá trị Category khác nhau trong dữ liệu để phân nhóm.");
      return;
    }

    setIsClustering(true);
    try {
      const entries = distinctCategories.map((cat) => ({
        category: cat,
        samples: (productsByCategory.get(cat) || []).slice(0, 3).map((p) => ({
          brand: p.brand,
          product: p.product,
          title: p.fields.Title,
          mainFeature: p.fields.MainFeature,
          productOverview: p.fields.ProductOverview,
        })),
      }));

      const requestMode: "web" | "local" = useWebVerification ? "web" : "local";
      const res = await fetch("/api/catalog-upload/category-cluster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: requestMode, entries }),
      });
      const json = await res.json();

      if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);

      const clusters: CategoryCluster[] = json.clusters || [];
      setCategoryClusters(clusters);
      setClusterSources(json.sources || []);
      setHasClustered(true);
      setSelectedClusters({});
      setClusterOverrides({});
      setAppliedClusterIndices(new Set());

      const mergeableCount = clusters.filter((c) => c.members.length > 1).length;
      if (mergeableCount === 0) {
        toast.success("AI không tìm thấy nhóm Category nào có thể gộp — các Category hiện tại đều đã riêng biệt.");
      } else {
        toast.success(`AI đề xuất gộp ${mergeableCount} nhóm Category trùng ý nghĩa.`);
      }
    } catch (err) {
      toast.error(`Phân nhóm Category thất bại: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsClustering(false);
    }
  };

  const isClusterSelected = (index: number) => selectedClusters[index] ?? true;

  const handleApplyClusterMerges = async () => {
    if (!categoryClusters) return;
    const targets = categoryClusters
      .map((c, i) => ({ c, i }))
      .filter(({ c, i }) => c.members.length > 1 && !appliedClusterIndices.has(i) && isClusterSelected(i));

    if (targets.length === 0) {
      toast.error("Chưa chọn nhóm Category nào để gộp.");
      return;
    }

    setIsApplyingClusters(true);
    let successCount = 0;
    let failCount = 0;
    const newlyApplied = new Set<number>();
    const categoryUpdates = new Map<string, string>();

    for (const { c, i } of targets) {
      const canonical = (clusterOverrides[i] ?? c.canonical).trim();
      if (!canonical) continue;
      const affected = c.members.flatMap((m) => productsByCategory.get(m) || []).filter((p) => p.fields.Category !== canonical);

      let clusterFailed = false;
      for (const p of affected) {
        if (!p.cmsItemId) {
          failCount++;
          clusterFailed = true;
          console.error(`[Category Cluster] Missing cmsItemId for ${p.product} — skipped to avoid writing to the wrong CMS record.`);
          continue;
        }
        try {
          const result = await updateCmsProductFieldsByIdAction(p.cmsItemId, { Category: canonical });
          if (result.success) {
            successCount++;
            categoryUpdates.set(p.id, canonical);
          } else {
            failCount++;
            clusterFailed = true;
            console.error(`[Category Cluster] Push failed for ${p.product}:`, result.error);
          }
        } catch (err) {
          failCount++;
          clusterFailed = true;
          console.error(`[Category Cluster] Push failed for ${p.product}:`, err);
        }
      }
      if (!clusterFailed) newlyApplied.add(i);
    }

    if (categoryUpdates.size > 0) {
      setProducts((prev) =>
        prev.map((p) => (categoryUpdates.has(p.id) ? { ...p, fields: { ...p.fields, Category: categoryUpdates.get(p.id)! } } : p))
      );
    }
    setAppliedClusterIndices((prev) => new Set([...prev, ...newlyApplied]));
    setIsApplyingClusters(false);

    if (failCount > 0) {
      toast.warning(`Đã gộp Category cho ${successCount} sản phẩm, ${failCount} sản phẩm thất bại.`);
    } else {
      toast.success(`Đã gộp Category thành công cho ${successCount} sản phẩm trên CMS.`);
    }
  };

  const toggleField = (key: string, checked: boolean) => {
    setSelectedFields((prev) => (checked ? [...prev, key] : prev.filter((k) => k !== key)));
  };

  const handleRunReview = async () => {
    if (scopedProducts.length === 0) return;
    if (selectedFields.length === 0) {
      toast.error("Chưa chọn cột nào để kiểm tra.");
      return;
    }

    const items = scopedProducts.map((p) => ({
      id: p.id,
      fields: {
        Category: p.fields.Category.slice(0, 200),
        Series: p.fields.Series.slice(0, 200),
        Brand: p.fields.Brand.slice(0, 100),
        Product: p.fields.Product.slice(0, 200),
        Title: p.fields.Title.slice(0, 300),
        "Main Feature": p.fields.MainFeature.slice(0, 500),
        "Product Overview": p.fields.ProductOverview.slice(0, 1000),
        "Technical Specifications": p.fields.TechnicalSpecifications.slice(0, 1500),
      },
    }));

    const batchSize = 10;
    const batches: (typeof items)[] = [];
    for (let i = 0; i < items.length; i += batchSize) batches.push(items.slice(i, i + batchSize));

    setIsReviewing(true);
    setProgress({ done: 0, total: items.length });
    const nextFindings = new Map<string, Finding[]>();
    let flaggedCount = 0;
    let failedBatches = 0;

    for (const batch of batches) {
      try {
        const res = await fetch("/api/catalog-upload/ai-review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: batch, targetFields: selectedFields }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);

        const results: { id: string; findings: Finding[] }[] = json.results || [];
        results.forEach((r) => {
          nextFindings.set(r.id, r.findings.map((f) => ({ ...f, source: "ai" as const })));
          if (r.findings.length > 0) flaggedCount++;
        });
      } catch (err) {
        failedBatches++;
        console.error("[CMS AI Review] Batch failed:", err);
      }
      setProgress((prev) => ({ done: Math.min(prev.done + batch.length, items.length), total: items.length }));
    }

    setFindingsById(nextFindings);
    setHasReviewed(true);
    setIsReviewing(false);
    setFixSuggestionsById(new Map());
    setHasFixed(false);
    setAppliedProductIds(new Set());

    if (failedBatches > 0) {
      toast.warning(`Kiểm tra hoàn tất với ${failedBatches} lô lỗi. Phát hiện vấn đề ở ${flaggedCount} sản phẩm.`);
    } else if (flaggedCount > 0) {
      toast.success(`Đã phát hiện vấn đề ở ${flaggedCount}/${items.length} sản phẩm.`);
    } else {
      toast.success(`Kiểm tra hoàn tất — không phát hiện vấn đề nào trong ${items.length} sản phẩm.`);
    }
  };

  const allFindingsFor = (id: string): Finding[] => [...(findingsById.get(id) || []), ...(ruleFindingsById.get(id) || [])];
  const flaggedProducts = scopedProducts.filter((p) => allFindingsFor(p.id).length > 0);
  // AI Fix only gets AI findings — rule findings like "trùng tên" or "thiếu ảnh" aren't something it can fix from the text.
  const aiFlaggedProducts = scopedProducts.filter((p) => (findingsById.get(p.id)?.length ?? 0) > 0);
  const findingCountsByCategory = React.useMemo(() => {
    const counts = new Map<string, number>();
    scopedProducts.forEach((p) =>
      [...(findingsById.get(p.id) || []), ...(ruleFindingsById.get(p.id) || [])].forEach((f) => counts.set(f.category, (counts.get(f.category) ?? 0) + 1))
    );
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [scopedProducts, findingsById, ruleFindingsById]);

  const handleRunFix = async () => {
    const targets = aiFlaggedProducts.filter((p) => !appliedProductIds.has(p.id));
    if (targets.length === 0) return;

    setIsFixing(true);
    setFixProgress({ done: 0, total: targets.length });

    const batchSize = 8;
    const batches: LocalProduct[][] = [];
    for (let i = 0; i < targets.length; i += batchSize) batches.push(targets.slice(i, i + batchSize));

    const nextSuggestions = new Map<string, FixSuggestion>();
    let fixedCount = 0;
    let failedBatches = 0;

    for (const batch of batches) {
      const items = batch.map((p) => ({
        id: p.id,
        fields: {
          Category: p.fields.Category,
          Product: p.fields.Product,
          Title: p.fields.Title,
          Series: p.fields.Series,
          MainFeature: p.fields.MainFeature,
          ProductOverview: p.fields.ProductOverview,
          TechnicalSpecifications: p.fields.TechnicalSpecifications,
          Brand: p.fields.Brand,
        },
        issues: (findingsById.get(p.id) || []).map((f) => f.message),
      }));

      try {
        const res = await fetch("/api/catalog-upload/ai-fix-ollama", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || `Request failed (${res.status})`);

        const results: { id: string; fields: Record<string, string>; note: string }[] = json.results || [];
        results.forEach((r) => {
          nextSuggestions.set(r.id, { fields: r.fields, note: r.note });
          if (Object.keys(r.fields).length > 0) fixedCount++;
        });
      } catch (err) {
        failedBatches++;
        console.error("[CMS AI Fix] Batch failed:", err);
      }
      setFixProgress((prev) => ({ done: Math.min(prev.done + batch.length, targets.length), total: targets.length }));
    }

    setFixSuggestionsById(nextSuggestions);
    setHasFixed(true);
    setIsFixing(false);
    setSelectedFixKeys({});

    if (failedBatches > 0) {
      toast.warning(`Đề xuất sửa hoàn tất với ${failedBatches} lô lỗi. AI đề xuất sửa cho ${fixedCount} sản phẩm.`);
    } else if (fixedCount > 0) {
      toast.success(`AI (qwen3.5:9b) đã đề xuất sửa cho ${fixedCount}/${targets.length} sản phẩm.`);
    } else {
      toast.warning(`AI không đề xuất sửa được trường nào — dữ liệu có thể quá thiếu để AI tự sửa mà không bịa thêm thông tin.`);
    }
  };

  // A change with no explicit entry yet defaults to approved, same pattern
  // AiFixDashboard uses — avoids a setState-in-effect just to pre-check new
  // suggestions as they arrive.
  const isFixSelected = (key: string) => selectedFixKeys[key] ?? true;

  const fixChanges: FixChange[] = React.useMemo(() => {
    const changes: FixChange[] = [];
    fixSuggestionsById.forEach((suggestion, id) => {
      if (appliedProductIds.has(id)) return;
      const p = products.find((pr) => pr.id === id);
      if (!p) return;
      PUSHABLE_FIX_FIELDS.forEach((fieldKey) => {
        const newVal = suggestion.fields[fieldKey];
        if (newVal === undefined) return;
        const oldVal = p.fields[fieldKey] || "";
        if (newVal === oldVal) return;
        changes.push({
          key: `${id}::${fieldKey}`,
          productId: id,
          brand: p.brand,
          product: p.product,
          field: FIX_FIELD_LABELS[fieldKey],
          fieldKey,
          oldValue: oldVal,
          newValue: newVal,
        });
      });
    });
    return changes;
  }, [fixSuggestionsById, products, appliedProductIds]);

  const fixChangesByProduct = React.useMemo(() => {
    const map = new Map<string, FixChange[]>();
    const order: string[] = [];
    fixChanges.forEach((c) => {
      if (!map.has(c.productId)) {
        map.set(c.productId, []);
        order.push(c.productId);
      }
      map.get(c.productId)!.push(c);
    });
    return { map, order };
  }, [fixChanges]);

  const handleApplyFixes = async () => {
    const toApply = fixChanges.filter((c) => isFixSelected(c.key));
    if (toApply.length === 0) {
      toast.error("Chưa chọn thay đổi nào để áp dụng.");
      return;
    }

    const byProduct = new Map<string, FixChange[]>();
    toApply.forEach((c) => {
      if (!byProduct.has(c.productId)) byProduct.set(c.productId, []);
      byProduct.get(c.productId)!.push(c);
    });

    const productById = new Map(products.map((p) => [p.id, p]));

    setIsApplyingFixes(true);
    let successCount = 0;
    let failCount = 0;
    const newlyApplied = new Set<string>();

    for (const [productId, changes] of byProduct) {
      const modelName = changes[0].product;
      const cmsItemId = productById.get(productId)?.cmsItemId;
      const fieldsToPush: Partial<Record<"Category" | "Title" | "Series" | "MainFeature" | "ProductOverview" | "TechnicalSpecifications", string>> = {};
      changes.forEach((c) => {
        fieldsToPush[c.fieldKey as keyof typeof fieldsToPush] = c.newValue;
      });
      if (!cmsItemId) {
        failCount += changes.length;
        console.error(`[CMS AI Fix] Missing cmsItemId for ${modelName} — skipped to avoid writing to the wrong CMS record.`);
        continue;
      }
      try {
        const result = await updateCmsProductFieldsByIdAction(cmsItemId, fieldsToPush);
        if (result.success) {
          successCount += changes.length;
          newlyApplied.add(productId);
        } else {
          failCount += changes.length;
          console.error(`[CMS AI Fix] Push failed for ${modelName}:`, result.error);
        }
      } catch (err) {
        failCount += changes.length;
        console.error(`[CMS AI Fix] Push failed for ${modelName}:`, err);
      }
    }

    setAppliedProductIds((prev) => new Set([...prev, ...newlyApplied]));
    setIsApplyingFixes(false);

    if (failCount > 0) {
      toast.warning(`Đã ghi ${successCount} trường lên CMS, ${failCount} trường thất bại.`);
    } else {
      toast.success(`Đã ghi đè ${successCount} trường lên ${newlyApplied.size} sản phẩm trên CMS.`);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-5xl mx-auto pb-16">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
            <Bot className="w-6 h-6 text-primary" />
            AI Kiểm Tra Dữ Liệu CMS
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Tải sản phẩm trực tiếp từ Wix CMS, chọn cột cần kiểm tra, rồi để AI rà soát và báo lỗi. Công cụ độc lập — không ảnh hưởng tới dữ liệu đang mở ở Catalog Upload.
          </p>
        </div>

        {/* Bước 1 — Tải dữ liệu */}
        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Database className="w-4 h-4 text-indigo-500" />
              Bước 1 — Tải dữ liệu từ Wix CMS
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">
              {products.length > 0 ? `Đã tải ${products.length} sản phẩm từ CMS.` : "Chưa tải dữ liệu — bấm nút bên phải để bắt đầu."}
            </p>
            <Button onClick={handlePull} disabled={isPulling} className="gap-2 shrink-0 w-full sm:w-auto">
              {isPulling ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowDownToLine className="w-4 h-4" />}
              {isPulling ? "Đang tải..." : products.length > 0 ? "Tải lại từ CMS" : "Tải dữ liệu từ Wix CMS"}
            </Button>
          </CardContent>
        </Card>

        {/* Bước 2 — Đồng bộ hoá tên Category */}
        {products.length > 0 && (
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Layers className="w-4 h-4 text-blue-500" />
                  Bước 2 — Đồng bộ hoá tên Category (tuỳ chọn)
                </CardTitle>
                <Button onClick={handleClusterCategories} disabled={isClustering} size="sm" variant="outline" className="gap-2">
                  {isClustering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Layers className="w-3.5 h-3.5" />}
                  {isClustering ? "Đang phân nhóm..." : hasClustered ? "Phân nhóm lại" : "Phân nhóm Category bằng AI"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Gộp các Category cùng loại thiết bị nhưng đang viết khác nhau (ví dụ &quot;Camera A&quot;, &quot;Camera B&quot;, &quot;Camera hội nghị&quot; đều là &quot;Camera&quot;) thành một tên chung, thống nhất trên toàn catalog.
              </p>
              <label className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/40 rounded-md p-2">
                <Checkbox
                  checked={useWebVerification}
                  onCheckedChange={(v) => setUseWebVerification(Boolean(v))}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium text-foreground">Tra cứu Internet để xác thực</span> — AI (Ollama qwen3.5:9b) luôn đọc Main Feature/Product Overview thực tế của sản phẩm mẫu mỗi Category để xác định đúng loại thiết bị trước khi gộp nhóm. Bật thêm mục này để AI tra cứu trên mạng một sản phẩm mẫu mỗi Category, xác thực chắc chắn hơn (chậm hơn); bỏ chọn để phân nhóm nhanh hơn, chỉ dựa vào nội dung sản phẩm đã có trong CMS.
                </span>
              </label>
              {!hasClustered ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                  <Info className="w-4 h-4 shrink-0" />
                  {productsByCategory.size} giá trị Category khác nhau trong dữ liệu đã tải — bấm nút bên trên để AI đề xuất gộp nhóm.
                </div>
              ) : (
                (() => {
                  const mergeable = categoryClusters!
                    .map((c, i) => ({ c, i }))
                    .filter(({ c, i }) => c.members.length > 1 && !appliedClusterIndices.has(i));
                  if (mergeable.length === 0) {
                    return (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                        <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-500" />
                        Không có nhóm Category nào cần gộp.
                      </div>
                    );
                  }
                  return (
                    <>
                      <div className="space-y-2">
                        {mergeable.map(({ c, i }) => {
                          const canonical = clusterOverrides[i] ?? c.canonical;
                          const affectedCount = c.members.reduce((acc, m) => acc + (productsByCategory.get(m)?.length ?? 0), 0);
                          return (
                            <div key={i} className="border rounded-lg p-3 space-y-2">
                              <div className="flex items-start gap-3">
                                <Checkbox
                                  checked={isClusterSelected(i)}
                                  onCheckedChange={(v) => setSelectedClusters((prev) => ({ ...prev, [i]: Boolean(v) }))}
                                  className="mt-1"
                                />
                                <div className="flex-1 min-w-0 space-y-2">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {c.members.map((m, mi) => (
                                      <Badge key={`${i}-${mi}-${m}`} variant="outline" className="text-[10px] px-1.5 py-0 h-5">
                                        {m} ({productsByCategory.get(m)?.length ?? 0})
                                      </Badge>
                                    ))}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-[11px] text-muted-foreground shrink-0">Tên chuẩn:</span>
                                    <input
                                      value={canonical}
                                      onChange={(e) => setClusterOverrides((prev) => ({ ...prev, [i]: e.target.value }))}
                                      className="flex-1 min-w-0 text-sm font-semibold bg-transparent border-b border-dashed border-border/60 focus:outline-none focus:border-primary px-1"
                                    />
                                  </div>
                                  <p className="text-[11px] text-muted-foreground">
                                    Sẽ đổi Category cho {affectedCount} sản phẩm.
                                  </p>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex items-center justify-end pt-1">
                        <Button onClick={handleApplyClusterMerges} disabled={isApplyingClusters} size="sm" className="gap-2">
                          {isApplyingClusters ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
                          Áp dụng gộp nhóm đã chọn lên CMS
                        </Button>
                      </div>
                    </>
                  );
                })()
              )}
              {clusterSources.length > 0 && (
                <div className="border-t pt-2 mt-2 space-y-1">
                  <p className="text-[11px] font-medium text-muted-foreground">Nguồn AI đã tra cứu để xác thực:</p>
                  <ul className="space-y-0.5">
                    {clusterSources.map((s, i) => (
                      <li key={i} className="text-[11px] truncate">
                        <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                          {s.title || s.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Bước 3 — Chọn cột + chạy kiểm tra */}
        {products.length > 0 && (
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <ScanSearch className="w-4 h-4 text-violet-500" />
                Bước 3 — Chọn phạm vi và nội dung kiểm tra
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-semibold">Phạm vi kiểm tra</p>
                <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                  <BrandMultiSelect value={brandFilter} onChange={setBrandFilter} options={brandOptions} />
                  <p className="text-xs text-muted-foreground sm:pt-2.5">
                    Sẽ kiểm tra <span className="font-semibold text-foreground">{scopedProducts.length}</span> / {products.length} sản phẩm
                    {brandFilter.length > 0 ? ` của ${brandFilter.length} hãng đã chọn` : " (tất cả hãng)"}.
                  </p>
                </div>
              </div>

              <div className="space-y-2 border-t pt-4">
                <p className="text-xs font-semibold flex items-center gap-1.5">
                  <ListChecks className="w-3.5 h-3.5 text-emerald-500" />
                  Kiểm tra nhanh theo quy tắc (không dùng AI, chạy tức thì)
                </p>
                <p className="text-xs text-muted-foreground">
                  Kết quả chính xác tuyệt đối theo dữ liệu — không phụ thuộc AI. Phát hiện được lỗi AI bỏ sót vì so sánh toàn bộ catalog cùng lúc (sản phẩm trùng, mô tả sao chép giữa các sản phẩm).
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {RULE_CHECKS.map((rule) => (
                    <label
                      key={rule.key}
                      className="flex items-start gap-3 p-2.5 rounded-lg border border-border/50 hover:bg-accent/40 transition-colors cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedRules.includes(rule.key)}
                        onCheckedChange={(v) =>
                          setSelectedRules((prev) => (v ? [...prev, rule.key] : prev.filter((k) => k !== rule.key)))
                        }
                        className="mt-0.5"
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{rule.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{rule.hint}</p>
                      </div>
                    </label>
                  ))}
                </div>
                <div className="flex items-center justify-end pt-1">
                  <Button
                    onClick={handleRunRuleChecks}
                    disabled={selectedRules.length === 0 || scopedProducts.length === 0}
                    variant="outline"
                    className="gap-2"
                  >
                    <ListChecks className="w-4 h-4" />
                    Kiểm tra theo quy tắc ({selectedRules.length} quy tắc)
                  </Button>
                </div>
              </div>

              <p className="text-xs font-semibold border-t pt-4 flex items-center gap-1.5">
                <Bot className="w-3.5 h-3.5 text-violet-500" />
                Kiểm tra bằng AI
              </p>
              <p className="text-xs text-muted-foreground">
                AI vẫn đọc đầy đủ mọi thông tin sản phẩm để đối chiếu (ví dụ đọc Main Feature/Product Overview để đánh giá Category), nhưng chỉ báo lỗi cho những cột được chọn dưới đây.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {FIELD_OPTIONS.map((opt) => (
                  <label
                    key={opt.key}
                    className="flex items-start gap-3 p-2.5 rounded-lg border border-border/50 hover:bg-accent/40 transition-colors cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedFields.includes(opt.key)}
                      onCheckedChange={(v) => toggleField(opt.key, Boolean(v))}
                      className="mt-0.5"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">{opt.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{opt.hint}</p>
                    </div>
                  </label>
                ))}
              </div>
              {isReviewing && <Progress value={(progress.done / Math.max(1, progress.total)) * 100} className="h-2" />}
              <div className="flex items-center justify-end pt-1">
                <Button onClick={handleRunReview} disabled={isReviewing || selectedFields.length === 0 || scopedProducts.length === 0} className="gap-2">
                  {isReviewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bot className="w-4 h-4" />}
                  {isReviewing ? `Đang kiểm tra (${progress.done}/${progress.total})` : `Bắt đầu kiểm tra AI (${selectedFields.length} cột)`}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Bước 4 — Kết quả */}
        {(hasReviewed || hasRuleChecked) && (
          <Card className="border-border/60 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                {flaggedProducts.length > 0 ? (
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                ) : (
                  <ShieldCheck className="w-4 h-4 text-emerald-500" />
                )}
                Bước 4 — Kết quả kiểm tra ({flaggedProducts.length} / {scopedProducts.length} sản phẩm bị gắn cờ)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {findingCountsByCategory.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pb-1">
                  {findingCountsByCategory.map(([cat, count]) => (
                    <Badge key={cat} variant="secondary" className="text-[10px]">
                      {CATEGORY_LABELS[cat] || cat}: {count}
                    </Badge>
                  ))}
                </div>
              )}
              {flaggedProducts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">Không phát hiện vấn đề nào ở các cột đã chọn.</p>
              ) : (
                <div className="max-h-[560px] overflow-y-auto space-y-2 pr-1">
                  {flaggedProducts.map((p) => {
                    const findings = allFindingsFor(p.id);
                    const isOpen = expanded[p.id];
                    return (
                      <div key={p.id} className="border rounded-lg overflow-hidden">
                        <button
                          className="w-full flex items-center gap-2 bg-muted/40 px-3 py-2 text-left"
                          onClick={() => setExpanded((prev) => ({ ...prev, [p.id]: !prev[p.id] }))}
                        >
                          {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          <span className="text-xs font-semibold">{p.brand} {p.product}</span>
                          <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 ml-auto">{findings.length} vấn đề</Badge>
                        </button>
                        {isOpen && (
                          <div className="divide-y">
                            {findings.map((f, i) => (
                              <div key={i} className="px-3 py-2.5 text-xs space-y-1">
                                <div className="flex items-center gap-1.5">
                                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">{CATEGORY_LABELS[f.category] || f.category}</Badge>
                                  <span className="text-[9px] text-muted-foreground">{f.source === "rule" ? "Quy tắc" : "AI"}</span>
                                </div>
                                <p className="text-muted-foreground">{f.message}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Bước 5 — Sửa bằng AI */}
        {hasReviewed && aiFlaggedProducts.length > 0 && (
          <Card className="border-violet-500/20 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Wrench className="w-4 h-4 text-violet-500" />
                  Bước 5 — Sửa bằng AI (qwen3.5:9b)
                </CardTitle>
                <Button onClick={handleRunFix} disabled={isFixing} size="sm" className="gap-2 bg-violet-600 hover:bg-violet-700">
                  {isFixing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wrench className="w-3.5 h-3.5" />}
                  {isFixing
                    ? `Đang đề xuất (${fixProgress.done}/${fixProgress.total})`
                    : hasFixed
                    ? "Đề xuất lại"
                    : `Đề xuất sửa (${aiFlaggedProducts.filter((p) => !appliedProductIds.has(p.id)).length} sản phẩm)`}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {!hasFixed ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                  <Info className="w-4 h-4 shrink-0" />
                  AI sẽ chỉ dựa vào dữ liệu sẵn có của từng sản phẩm để sửa (không tra cứu internet) — bấm nút bên trên để bắt đầu.
                </div>
              ) : fixChangesByProduct.order.length === 0 ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
                  <Info className="w-4 h-4 shrink-0" />
                  AI không đề xuất sửa trường nào đủ chắc chắn cho các sản phẩm bị gắn cờ — dữ liệu có thể quá thiếu để AI tự sửa mà không bịa thêm thông tin.
                </div>
              ) : (
                <>
                  <div className="max-h-[520px] overflow-y-auto pr-1 space-y-3">
                    {fixChangesByProduct.order.map((productId) => {
                      const changes = fixChangesByProduct.map.get(productId)!;
                      const note = fixSuggestionsById.get(productId)?.note;
                      const { brand, product } = changes[0];
                      const selectedCount = changes.filter((c) => isFixSelected(c.key)).length;
                      return (
                        <div key={productId} className="border rounded-lg overflow-hidden">
                          <div className="flex items-center gap-2 bg-muted/40 px-3 py-2">
                            <span className="text-xs font-semibold">{brand} {product}</span>
                            <span className="text-[10px] text-muted-foreground ml-auto">{selectedCount}/{changes.length}</span>
                          </div>
                          {note && (
                            <p className="px-3 pt-2 text-[11px] text-muted-foreground italic">Ghi chú AI: {note}</p>
                          )}
                          <div className="divide-y">
                            {changes.map((c) => (
                              <div key={c.key} className="flex items-start gap-3 px-3 py-2.5">
                                <Checkbox
                                  checked={isFixSelected(c.key)}
                                  onCheckedChange={(v) => setSelectedFixKeys((prev) => ({ ...prev, [c.key]: Boolean(v) }))}
                                  className="mt-1"
                                />
                                <div className="flex-1 min-w-0 space-y-1">
                                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{c.field}</span>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                                    <div className="p-2 rounded bg-muted/40 break-words max-h-28 overflow-auto">
                                      <span className="text-[9px] text-muted-foreground block mb-0.5">Hiện tại (CMS)</span>
                                      {c.oldValue || <span className="italic text-muted-foreground">(trống)</span>}
                                    </div>
                                    <div className="p-2 rounded bg-violet-500/5 border border-violet-500/20 break-words max-h-28 overflow-auto">
                                      <span className="text-[9px] text-violet-600 dark:text-violet-400 block mb-0.5">AI đề xuất</span>
                                      {c.newValue || <span className="italic text-muted-foreground">(xoá)</span>}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-end pt-2">
                    <Button onClick={handleApplyFixes} disabled={isApplyingFixes} className="gap-2 bg-violet-600 hover:bg-violet-700">
                      {isApplyingFixes ? <Loader2 className="w-4 h-4 animate-spin" /> : <UploadCloud className="w-4 h-4" />}
                      Áp dụng đã chọn lên CMS
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
