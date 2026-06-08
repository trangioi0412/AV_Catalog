"use server";

import { revalidatePath } from "next/cache";
import { insertProduct, WixProduct } from "@/lib/services/wixCms";
import { readSheet, deleteRowByIndex, appendRows, addLog, updateSystemConfig, getSystemConfig, clearSheet } from "@/lib/services/googleSheets";
import { PendingProduct } from "./discovery";

/**
 * Finds the correct index of a product row, accounting for concurrent modifications.
 */
async function findCorrectRowIndex(product: PendingProduct, originalIndex: number): Promise<number> {
  const rows = await readSheet("Product_New");
  if (rows.length <= 1) {
    throw new Error("The queue is empty");
  }

  // Check if original index still matches
  const targetRow = rows[originalIndex + 1]; // +1 to skip header
  if (
    targetRow &&
    targetRow[9] === product.Brand &&
    targetRow[1] === product.Product &&
    targetRow[2] === product.Title
  ) {
    return originalIndex;
  }

  // Find by scanning
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (
      row[9] === product.Brand &&
      row[1] === product.Product &&
      row[2] === product.Title
    ) {
      return i - 1; // 0-based data index
    }
  }

  throw new Error("Product was not found in the queue. It may have already been processed.");
}

/**
 * Approves a product: Syncs to Wix CMS, removes from Google Sheet queue, logs action.
 */
export async function approveProductAction(product: PendingProduct, originalIndex: number) {
  try {
    // 1. Verify and find index of the row in the sheet
    const correctIndex = await findCorrectRowIndex(product, originalIndex);

    // 2. Insert into Wix CMS
    const wixProduct: WixProduct = {
      Category: product.Category,
      Product: product.Product,
      Title: product.Title,
      productItem: product.productItem,
      Series: product.Series,
      MainFeature: product.MainFeature,
      ProductOverview: product.ProductOverview,
      TechnicalSpecifications: product.TechnicalSpecifications,
      image: product.image,
      Brand: product.Brand,
      Datasheet: product.Datasheet,
    };
    
    await insertProduct(wixProduct);

    // 3. Remove from Product_New sheet
    await deleteRowByIndex("Product_New", correctIndex);

    // 4. Update stats and config in System_Config
    const config = await getSystemConfig();
    const approvedCount = parseInt(config.ApprovedCount || "0", 10) + 1;
    await Promise.all([
      updateSystemConfig("ApprovedCount", approvedCount.toString()),
      updateSystemConfig("LastSync", new Date().toISOString()),
    ]);

    // 5. Create log
    await addLog("INFO", `Approved and synced product: ${product.Product} - ${product.Title}`, product.brandName);

    // Revalidate paths
    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/discovery");

    return { success: true };
  } catch (err) {
    console.error("Approve product failed:", err);
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Rejects a product: Moves to Product_Delete sheet, removes from queue, logs action.
 */
export async function rejectProductAction(product: PendingProduct, originalIndex: number) {
  try {
    // 1. Verify and find index
    const correctIndex = await findCorrectRowIndex(product, originalIndex);

    // 2. Append to Product_Delete sheet
    // Columns: Category, Product, Title, productItem, Series, MainFeature, ProductOverview, TechnicalSpecifications, image, Brand, Datasheet
    const deleteRow = [
      product.Category,
      product.Product,
      product.Title,
      product.productItem,
      product.Series,
      product.MainFeature,
      product.ProductOverview,
      product.TechnicalSpecifications,
      product.image,
      product.Brand,
      product.Datasheet,
    ];
    await appendRows("Product_Delete", [deleteRow]);

    // 3. Remove from Product_New sheet
    await deleteRowByIndex("Product_New", correctIndex);

    // 4. Update stats and config
    const config = await getSystemConfig();
    const rejectedCount = parseInt(config.RejectedCount || "0", 10) + 1;
    await updateSystemConfig("RejectedCount", rejectedCount.toString());

    // 5. Create log
    await addLog("INFO", `Rejected and blacklisted product: ${product.Product} - ${product.Title}`, product.brandName);

    // Revalidate paths
    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/discovery");

    return { success: true };
  } catch (err) {
    console.error("Reject product failed:", err);
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Deletes a product: Removes from queue and logs action (doesn't blacklist).
 */
export async function deleteProductAction(product: PendingProduct, originalIndex: number) {
  try {
    // 1. Verify and find index
    const correctIndex = await findCorrectRowIndex(product, originalIndex);

    // 2. Remove from Product_New sheet
    await deleteRowByIndex("Product_New", correctIndex);

    // 3. Create log
    await addLog("INFO", `Deleted product from queue: ${product.Product} - ${product.Title}`, product.brandName);

    // Revalidate paths
    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/discovery");

    return { success: true };
  } catch (err) {
    console.error("Delete product failed:", err);
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Clears the entire blacklist (Product_Delete sheet)
 */
export async function clearBlacklistAction() {
  try {
    await clearSheet("Product_Delete");
    await addLog("WARNING", "Cleared the entire product blacklist");
    
    // Reset RejectedCount config
    await updateSystemConfig("RejectedCount", "0");

    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/discovery");
    return { success: true };
  } catch (err) {
    console.error("Clear blacklist failed:", err);
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Clears the entire pending queue (Product_New sheet)
 */
export async function clearQueueAction() {
  try {
    await clearSheet("Product_New");
    await addLog("WARNING", "Cleared the entire pending products queue");

    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/discovery");
    return { success: true };
  } catch (err) {
    console.error("Clear queue failed:", err);
    return { success: false, error: (err as Error).message };
  }
}
