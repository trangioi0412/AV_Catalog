import { useState, useCallback } from "react";
import { SeoRecord } from "@/types/SeoRecord";
import { ProductRecord } from "@/types/ProductRecord";
import { MergeResult, DuplicateWarning, MergeSummary } from "@/types/MergeResult";
import { toast } from "sonner";

export interface UseMergeProcessorResult {
  progress: number;
  isProcessing: boolean;
  result: MergeResult | null;
  runMerge: (
    seoRows: SeoRecord[],
    productRows: ProductRecord[],
    options: { overwriteExisting: boolean; exportMissingIds: boolean }
  ) => Promise<void>;
  resetProcessor: () => void;
}

export function useMergeProcessor(): UseMergeProcessorResult {
  const [progress, setProgress] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [result, setResult] = useState<MergeResult | null>(null);

  const resetProcessor = useCallback(() => {
    setProgress(0);
    setIsProcessing(false);
    setResult(null);
  }, []);

  const runMerge = useCallback(
    async (
      seoRows: SeoRecord[],
      productRows: ProductRecord[],
      options: { overwriteExisting: boolean; exportMissingIds: boolean }
    ) => {
      if (seoRows.length === 0 || productRows.length === 0) {
        toast.error("Both SEO source and Products dataset files must contain records.");
        return;
      }

      setIsProcessing(true);
      setProgress(0);
      setResult(null);

      // Pre-processing
      const errors: string[] = [];
      const duplicates: DuplicateWarning[] = [];

      // 1. Map SEO Records & check duplicates
      const seoIdCounts = new Map<string, number>();
      const seoMap = new Map<string, SeoRecord>();

      seoRows.forEach((record, index) => {
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

      seoIdCounts.forEach((count, id) => {
        if (count > 1) {
          duplicates.push({ id, source: "seo", count });
        }
      });

      // 2. Map Product Records & check duplicates
      const productIdCounts = new Map<string, number>();
      productRows.forEach((record, index) => {
        const id = (record.ID || "").toString().trim();
        if (!id) {
          errors.push(`Row ${index + 1} in Products file has an empty ID.`);
          return;
        }
        const count = productIdCounts.get(id) || 0;
        productIdCounts.set(id, count + 1);
      });

      productIdCounts.forEach((count, id) => {
        if (count > 1) {
          duplicates.push({ id, source: "products", count });
        }
      });

      const totalProducts = productRows.length;
      const mergedRecords: ProductRecord[] = [];
      let matchedCount = 0;
      let updatedCount = 0;

      const batchSize = 100;
      let offset = 0;

      const executeBatch = () => {
        if (offset >= totalProducts) {
          // Completed merging products, now find missing IDs
          const productIds = new Set(
            productRows.map((r) => (r.ID || "").toString().trim()).filter(Boolean)
          );
          const missingInProducts: string[] = [];
          seoMap.forEach((_, id) => {
            if (!productIds.has(id)) {
              missingInProducts.push(id);
            }
          });

          const summary: MergeSummary = {
            totalProducts,
            matchedCount,
            updatedCount,
            missingCount: missingInProducts.length,
            duplicateCount: duplicates.length,
            errorCount: errors.length,
          };

          setResult({
            mergedRecords,
            missingInProducts,
            duplicates,
            summary,
            errors,
          });

          setProgress(100);
          setIsProcessing(false);

          if (errors.length > 0) {
            toast.warning(`Merged with ${errors.length} warnings/errors. Check summary cards.`);
          } else {
            toast.success("Dataset merge completed successfully!");
          }
          return;
        }

        const limit = Math.min(offset + batchSize, totalProducts);
        const batchSlice = productRows.slice(offset, limit);

        batchSlice.forEach((prodRecord) => {
          const id = (prodRecord.ID || "").toString().trim();
          const clonedRecord = { ...prodRecord };

          // Default missing fields
          if (!("metaTitle" in clonedRecord)) clonedRecord.metaTitle = "";
          if (!("metaDescription" in clonedRecord)) clonedRecord.metaDescription = "";
          if (!("shortDescription" in clonedRecord)) clonedRecord.shortDescription = "";
          if (!("altText" in clonedRecord)) clonedRecord.altText = "";
          if (!("faq" in clonedRecord)) clonedRecord.faq = "";

          clonedRecord._status = "Unchanged";

          if (id && seoMap.has(id)) {
            const seoRecord = seoMap.get(id)!;
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
              const seoVal =
                seoRecord[field] !== undefined && seoRecord[field] !== null
                  ? seoRecord[field].toString()
                  : "";
              const prodVal =
                clonedRecord[field] !== undefined && clonedRecord[field] !== null
                  ? clonedRecord[field].toString()
                  : "";

              const isProdEmpty = !prodVal.trim();

              if (options.overwriteExisting) {
                if (seoVal !== prodVal) {
                  clonedRecord[field] = seoVal;
                  wasUpdated = true;
                }
              } else {
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

        offset = limit;
        const currentProgress = Math.round((offset / totalProducts) * 100);
        setProgress(Math.min(currentProgress, 99));

        // Yield execution to browser for UI refresh
        setTimeout(executeBatch, 60);
      };

      // Start asynchronous iteration
      setTimeout(executeBatch, 0);
    },
    []
  );

  return {
    progress,
    isProcessing,
    result,
    runMerge,
    resetProcessor,
  };
}
