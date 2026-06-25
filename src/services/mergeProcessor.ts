import { SeoRecord } from "@/types/SeoRecord";
import { ProductRecord } from "@/types/ProductRecord";
import { MergeResult, DuplicateWarning, MergeSummary } from "@/types/MergeResult";

interface MergeOptions {
  overwriteExisting: boolean;
  exportMissingIds: boolean;
}

export function processMerge(
  seoRecords: SeoRecord[],
  productRecords: ProductRecord[],
  options: MergeOptions
): MergeResult {
  const mergedRecords: ProductRecord[] = [];
  const missingInProducts: string[] = [];
  const duplicates: DuplicateWarning[] = [];
  const errors: string[] = [];

  // 1. Detect duplicates in SEO Records
  const seoIdCounts = new Map<string, number>();
  const seoMap = new Map<string, SeoRecord>(); // Store first occurrence of each ID

  seoRecords.forEach((record, index) => {
    const id = (record.ID || "").toString().trim();
    if (!id) {
      errors.push(`Row ${index + 1} in SEO file has an empty ID.`);
      return;
    }

    const count = seoIdCounts.get(id) || 0;
    seoIdCounts.set(id, count + 1);

    if (count === 0) {
      seoMap.set(id, record);
    }
  });

  // Add SEO duplicate warnings
  seoIdCounts.forEach((count, id) => {
    if (count > 1) {
      duplicates.push({
        id,
        source: "seo",
        count,
      });
    }
  });

  // 2. Detect duplicates in Product Records
  const productIdCounts = new Map<string, number>();
  productRecords.forEach((record, index) => {
    const id = (record.ID || "").toString().trim();
    if (!id) {
      // It's acceptable to have rows without IDs or header issues, but let's record it
      errors.push(`Row ${index + 1} in Products file has an empty ID.`);
      return;
    }
    const count = productIdCounts.get(id) || 0;
    productIdCounts.set(id, count + 1);
  });

  // Add Product duplicate warnings
  productIdCounts.forEach((count, id) => {
    if (count > 1) {
      duplicates.push({
        id,
        source: "products",
        count,
      });
    }
  });

  // Keep track of which SEO IDs were matched
  const matchedSeoIds = new Set<string>();

  let matchedCount = 0;
  let updatedCount = 0;

  // 3. Process products (preserve original order)
  productRecords.forEach((prodRecord) => {
    const id = (prodRecord.ID || "").toString().trim();
    const clonedRecord = { ...prodRecord };

    // Initialize display fields if not present
    if (!("metaTitle" in clonedRecord)) clonedRecord.metaTitle = "";
    if (!("metaDescription" in clonedRecord)) clonedRecord.metaDescription = "";
    if (!("shortDescription" in clonedRecord)) clonedRecord.shortDescription = "";
    if (!("altText" in clonedRecord)) clonedRecord.altText = "";
    if (!("faq" in clonedRecord)) clonedRecord.faq = "";

    clonedRecord._status = "Unchanged"; // Internal flag for rendering status in UI

    if (id && seoMap.has(id)) {
      const seoRecord = seoMap.get(id)!;
      matchedSeoIds.add(id);
      matchedCount++;

      let wasUpdated = false;
      const targetFields: (keyof SeoRecord & keyof ProductRecord)[] = [
        "metaTitle",
        "metaDescription",
        "shortDescription",
        "altText",
        "faq",
      ];

      targetFields.forEach((field) => {
        const seoVal = (seoRecord[field] !== undefined && seoRecord[field] !== null) 
          ? seoRecord[field].toString() 
          : "";
        const prodVal = (clonedRecord[field] !== undefined && clonedRecord[field] !== null) 
          ? clonedRecord[field].toString() 
          : "";

        const isProdEmpty = !prodVal.trim();

        if (options.overwriteExisting) {
          // Always overwrite unless source is empty and we want to keep whatever is there? 
          // Usually overwrite means replace.
          if (seoVal !== prodVal) {
            clonedRecord[field] = seoVal;
            wasUpdated = true;
          }
        } else {
          // Only fill if destination is empty
          if (isProdEmpty && seoVal && seoVal !== prodVal) {
            clonedRecord[field] = seoVal;
            wasUpdated = true;
          }
        }
      });

      if (wasUpdated) {
        clonedRecord._status = "Updated";
        updatedCount++;
      } else {
        clonedRecord._status = "Matched";
      }
    }

    mergedRecords.push(clonedRecord);
  });

  // 4. Identify missing IDs (exists in SEO map but not in products)
  const productIds = new Set(productRecords.map((r) => (r.ID || "").toString().trim()).filter(Boolean));
  seoMap.forEach((_, id) => {
    if (!productIds.has(id)) {
      missingInProducts.push(id);
    }
  });

  // Compile summary
  const summary: MergeSummary = {
    totalProducts: productRecords.length,
    matchedCount: matchedCount,
    updatedCount: updatedCount,
    missingCount: missingInProducts.length,
    duplicateCount: duplicates.length,
    errorCount: errors.length,
  };

  return {
    mergedRecords,
    missingInProducts,
    duplicates,
    summary,
    errors,
  };
}
