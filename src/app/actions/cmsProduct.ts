"use server";

import { revalidatePath } from "next/cache";
import {
  clearProductDocumentFields,
  deleteMediaFile,
  WixProduct,
} from "@/lib/services/wixCms";
import { addLog } from "@/lib/services/googleSheets";
import { getProductDocumentEntries, extractValidDocumentUrl } from "@/lib/utils/documentFields";

// Re-export DocumentEntry type for consumers (components, other actions)
export type { DocumentEntry } from "@/lib/utils/documentFields";
// Re-export the pure helper so it can be called in server context too
export { getProductDocumentEntries };

export interface ClearDocumentResult {
  success: boolean;
  /** Number of media files successfully deleted from Wix Media Manager */
  deletedMediaCount: number;
  /** Number of media files that failed to delete */
  failedMediaCount: number;
  mediaErrors: string[];
  /** Error message if CMS patch failed */
  error?: string;
}

/**
 * Clear selected document fields from a CMS product item AND delete the
 * corresponding files from Wix Media Manager.
 *
 * This does NOT delete the entire product — only the chosen document fields
 * are cleared (set to null) in the CMS collection, and the associated media
 * files are removed from Site Media.
 *
 * @param productId     Wix CMS item ID
 * @param product       Full WixProduct object (for extracting field URLs and logging)
 * @param fieldsToClear Array of CMS field names to clear (e.g. ["Datasheet", "Manual"])
 * @param collectionId  CMS collection ID (default: "Import1")
 */
export async function clearCmsDocumentFieldsAction(
  productId: string,
  product: WixProduct,
  fieldsToClear: string[],
  collectionId = "Import1"
): Promise<ClearDocumentResult> {
  if (!fieldsToClear || fieldsToClear.length === 0) {
    return { success: true, deletedMediaCount: 0, failedMediaCount: 0, mediaErrors: [] };
  }

  // Step 1: Collect the media URLs for the fields being cleared
  const urlsToClear: string[] = [];
  for (const field of fieldsToClear) {
    const validUrl = extractValidDocumentUrl((product as any)[field]);
    if (validUrl) {
      urlsToClear.push(validUrl);
    }
  }
  // Deduplicate URLs (same file might be referenced by multiple field variants)
  const uniqueUrls = Array.from(new Set(urlsToClear));


  // Step 2: Patch CMS item to clear the document fields
  const cmsResult = await clearProductDocumentFields(productId, collectionId, fieldsToClear);
  if (!cmsResult.success) {
    return {
      success: false,
      deletedMediaCount: 0,
      failedMediaCount: 0,
      mediaErrors: [],
      error: `Khong the cap nhat CMS: ${cmsResult.error}`,
    };
  }

  // Step 3: Delete the actual files from Wix Media Manager
  let deletedMediaCount = 0;
  let failedMediaCount = 0;
  const mediaErrors: string[] = [];

  if (uniqueUrls.length > 0) {
    const deleteResults = await Promise.allSettled(
      uniqueUrls.map((url) => deleteMediaFile(url))
    );

    for (const r of deleteResults) {
      if (r.status === "fulfilled") {
        if (r.value.success) {
          deletedMediaCount++;
        } else {
          failedMediaCount++;
          if (r.value.error) mediaErrors.push(r.value.error);
        }
      } else {
        failedMediaCount++;
        mediaErrors.push(String(r.reason));
      }
    }
  }

  // Step 4: Log the action
  try {
    const brandName = typeof product.Brand === "string" ? product.Brand : "";
    const logMsg = [
      `Xoa document: ${product.Product || productId} - "${product.Title || ""}"`,
      `Fields cleared: [${fieldsToClear.join(", ")}]`,
      `Media files deleted: ${deletedMediaCount}`,
      failedMediaCount > 0 ? `Media errors: ${failedMediaCount}` : "",
    ]
      .filter(Boolean)
      .join(" | ");

    await addLog("WARNING", logMsg, brandName).catch((err) => {
      console.warn("[clearCmsDocumentFieldsAction] addLog error:", err);
    });
  } catch {
    // Non-fatal
  }

  // Step 5: Revalidate
  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/discovery");

  return {
    success: true,
    deletedMediaCount,
    failedMediaCount,
    mediaErrors,
  };
}

/**
 * Bulk-clear document fields across multiple CMS products in sequence.
 * Each item specifies its own list of field names to clear.
 */
export async function bulkClearCmsDocumentFieldsAction(
  items: Array<{
    id: string;
    product: WixProduct;
    fieldsToClear: string[];
  }>
): Promise<{
  totalSuccess: number;
  totalFailed: number;
  results: Array<{ id: string; result: ClearDocumentResult }>;
}> {
  const results: Array<{ id: string; result: ClearDocumentResult }> = [];
  let totalSuccess = 0;
  let totalFailed = 0;

  for (const item of items) {
    const result = await clearCmsDocumentFieldsAction(
      item.id,
      item.product,
      item.fieldsToClear
    );
    results.push({ id: item.id, result });
    if (result.success) {
      totalSuccess++;
    } else {
      totalFailed++;
    }
  }

  return { totalSuccess, totalFailed, results };
}
