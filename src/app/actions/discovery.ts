"use server";

import { revalidatePath } from "next/cache";
import { runProductDiscovery } from "@/lib/services/discoveryEngine";
import { readSheet, getSystemConfig, updateSystemConfig } from "@/lib/services/googleSheets";
import { getActiveBrands, getAllProducts, insertProduct, WixProduct } from "@/lib/services/wixCms";

export interface DashboardStats {
  totalBrands: number;
  totalProducts: number;
  newProductCount: number;
  deletedProductCount: number;
  pendingCount: number;
  approvedCount: number;
  rejectedCount: number;
  lastScan: string;
  lastSync: string;
  isImageSearchEnabled?: boolean;
}

export interface PendingProduct {
  rowIndex: number; // The 0-based data index (row 2 = 0)
  Category: string;
  Product: string;
  Title: string;
  productItem: string;
  Series: string;
  MainFeature: string;
  ProductOverview: string;
  TechnicalSpecifications: string;
  image: string;
  Brand: string; // Brand ID
  Datasheet: string;
  brandName?: string;
}

export interface SyncLogEntry {
  timestamp: string;
  level: string;
  message: string;
  brand: string;
}

/**
 * Runs the product discovery scan manually.
 */
export async function runDiscoveryAction(brandId?: string) {
  try {
    const result = await runProductDiscovery(brandId);
    
    // Clear route cache so dashboard and queues update
    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/discovery");
    revalidatePath("/admin/scanner");

    return {
      success: true,
      totalScanned: result.totalScanned,
      totalNew: result.totalNew,
      logs: result.logs,
    };
  } catch (err) {
    console.error("Discovery action failed:", err);
    return {
      success: false,
      error: (err as Error).message,
      logs: [`[ERROR] Scan failed: ${(err as Error).message}`],
    };
  }
}

/**
 * Gathers stats for the /admin/dashboard page.
 */
export async function getDashboardStatsAction(): Promise<DashboardStats> {
  try {
    const [brands, products, sheetNew, sheetDelete, config] = await Promise.all([
      getActiveBrands().catch((err) => {
        console.error("Wix Brands fetch error:", err);
        return [];
      }),
      getAllProducts().catch((err) => {
        console.error("Wix Products fetch error:", err);
        return [];
      }),
      readSheet("Product_New").catch((err) => {
        console.error("Google Sheets Product_New read error:", err);
        return [];
      }),
      readSheet("Product_Delete").catch((err) => {
        console.error("Google Sheets Product_Delete read error:", err);
        return [];
      }),
      getSystemConfig().catch((err) => {
        console.error("Google Sheets System_Config read error:", err);
        return {} as Record<string, string>;
      }),
    ]);

    const newProductCount = Math.max(0, sheetNew.length - 1);
    const deletedProductCount = Math.max(0, sheetDelete.length - 1);

    const approvedCount = parseInt(config.ApprovedCount || "0", 10);
    const rejectedCount = parseInt(config.RejectedCount || "0", 10);

    const isImageSearchEnabled = config.ImageSearchEnabled !== "false";

    return {
      totalBrands: brands.length,
      totalProducts: products.length,
      newProductCount,
      deletedProductCount,
      pendingCount: newProductCount,
      approvedCount,
      rejectedCount,
      lastScan: config.LastScan || "",
      lastSync: config.LastSync || "",
      isImageSearchEnabled,
    };
  } catch (err) {
    console.error("Failed to fetch dashboard stats:", err);
    return {
      totalBrands: 0,
      totalProducts: 0,
      newProductCount: 0,
      deletedProductCount: 0,
      pendingCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      lastScan: "",
      lastSync: "",
      isImageSearchEnabled: true,
    };
  }
}

/**
 * Fetches recent logs from the Sync_Logs sheet.
 */
export async function getDiscoveryLogsAction(limit = 50): Promise<SyncLogEntry[]> {
  try {
    const rows = await readSheet("Sync_Logs");
    if (rows.length <= 1) return [];

    // Columns: Timestamp, Level, Message, Brand
    const logs = rows.slice(1).map((row) => ({
      timestamp: row[0] || "",
      level: row[1] || "INFO",
      message: row[2] || "",
      brand: row[3] || "",
    }));

    // Sort descending by timestamp
    return logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, limit);
  } catch (err) {
    console.error("Failed to fetch logs:", err);
    return [];
  }
}

/**
 * Fetches all pending products in the Product_New sheet.
 */
export async function getPendingProductsAction(): Promise<PendingProduct[]> {
  try {
    const [rows, brands] = await Promise.all([
      readSheet("Product_New"),
      getActiveBrands().catch(() => []),
    ]);
    if (rows.length <= 1) return [];

    const brandMap = new Map(brands.map((b) => [b._id, b.name]));

    // Columns: Category, Product, Title, productItem, Series, MainFeature, ProductOverview, TechnicalSpecifications, image, Brand (ID), Datasheet
    // row 0 is header, so row i maps to data index i-1
    return rows.slice(1).map((row, idx) => {
      const brandId = row[9] || "";
      return {
        rowIndex: idx, // 0-based data index (corresponds to row index i - 1)
        Category: row[0] || "",
        Product: row[1] || "",
        Title: row[2] || "",
        productItem: row[3] || "",
        Series: row[4] || "",
        MainFeature: row[5] || "",
        ProductOverview: row[6] || "",
        TechnicalSpecifications: row[7] || "[]",
        image: row[8] || "",
        Brand: brandId,
        Datasheet: row[10] || "",
        brandName: brandMap.get(brandId) || brandId,
      };
    });
  } catch (err) {
    console.error("Failed to fetch pending products:", err);
    return [];
  }
}

/**
 * Fetches all active brands.
 */
export async function getActiveBrandsAction() {
  try {
    return await getActiveBrands();
  } catch (err) {
    console.error("Failed to fetch active brands:", err);
    return [];
  }
}

/**
 * Updates the ImageSearchEnabled config key in System_Config.
 */
export async function updateImageSearchConfigAction(enabled: boolean) {
  try {
    await updateSystemConfig("ImageSearchEnabled", String(enabled));
    revalidatePath("/admin/dashboard");
    return { success: true };
  } catch (err) {
    console.error("Failed to update ImageSearchEnabled config:", err);
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Uploads catalog product rows directly to Wix CMS collection Import2.
 */
export async function uploadCatalogToWixAction(products: any[]) {
  try {
    const brands = await getActiveBrands();
    const brandMap = new Map(brands.map((b) => [b.name.toLowerCase().trim(), b._id]));
    const brandIdMap = new Set(brands.map((b) => b._id));

    let successCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    for (const prod of products) {
      try {
        // Resolve Brand ID
        let brandId = "";
        const rawBrand = prod.Brand || prod.brand || prod.BrandName || prod.brandName || "";
        if (typeof rawBrand === "object" && rawBrand !== null) {
          brandId = rawBrand._id || rawBrand.id || "";
        } else if (typeof rawBrand === "string" && rawBrand.trim() !== "") {
          const trimmed = rawBrand.trim();
          if (brandIdMap.has(trimmed)) {
            brandId = trimmed;
          } else {
            const lowerBrand = trimmed.toLowerCase();
            brandId = brandMap.get(lowerBrand) || "";
            if (!brandId) {
              // Try finding case-insensitive match among names
              for (const b of brands) {
                if (b.name.toLowerCase().trim() === lowerBrand) {
                  brandId = b._id;
                  break;
                }
              }
            }
          }
        }

        // Map row fields to WixProduct schema case-insensitively
        const getFieldVal = (keys: string[]) => {
          for (const key of keys) {
            const exactKey = Object.keys(prod).find(k => k.toLowerCase() === key.toLowerCase());
            if (exactKey && prod[exactKey] !== undefined) {
              return prod[exactKey];
            }
          }
          return undefined;
        };

        const payload: Record<string, any> = {};

        const addField = (targetKey: string, searchKeys: string[]) => {
          const val = getFieldVal(searchKeys);
          if (val !== undefined && val !== null && val !== "") {
            payload[targetKey] = val;
          }
        };

        addField("Category", ["Category", "thể loại", "nhóm"]);
        addField("Product", ["Product", "sản phẩm", "Model", "Model Number"]);
        addField("Title", ["Title", "tiêu đề", "tên sản phẩm", "Name"]);
        addField("productItem", ["productItem", "product (item)", "item"]);
        addField("Series", ["Series", "dòng sản phẩm"]);
        addField("MainFeature", ["MainFeature", "Main Feature", "tính năng chính"]);
        addField("ProductOverview", ["ProductOverview", "Product Overview", "tổng quan"]);
        addField("Datasheet", ["Datasheet", "Data Sheet"]);
        addField("slug", ["slug", "đường dẫn"]);
        addField("image", ["image", "hình ảnh", "ảnh"]);
        addField("galleryImages", ["galleryImages", "gallery"]);
        addField("Manual", ["Manual", "hướng dẫn"]);
        addField("Brochure", ["Brochure"]);
        addField("Firmware", ["Firmware"]);
        addField("Videos", ["Videos"]);
        addField("CompatibleProducts", ["CompatibleProducts", "Compatible Products"]);
        addField("CompatibleRooms", ["CompatibleRooms", "Compatible Rooms"]);
        addField("CompatibleSolutions", ["CompatibleSolutions", "Compatible Solutions"]);

        if (brandId) {
          payload.Brand = brandId;
        }

        // Build TechnicalSpecifications string from transformedSpecifications if available
        let technicalSpecifications = "";
        const specs = prod.transformedSpecifications || prod.parsedSpecifications || [];
        if (Array.isArray(specs) && specs.length > 0) {
          technicalSpecifications = JSON.stringify(specs);
        } else {
          const rawSpecs = getFieldVal(["TechnicalSpecifications", "Technical Specifications", "thông số kỹ thuật"]);
          if (rawSpecs) {
            technicalSpecifications = typeof rawSpecs === "string" ? rawSpecs : JSON.stringify(rawSpecs);
          }
        }

        if (technicalSpecifications) {
          payload.TechnicalSpecifications = technicalSpecifications;
        }

        await insertProduct(payload as WixProduct);

        successCount++;
      } catch (err: any) {
        failedCount++;
        errors.push(`Product: ${prod.Product || prod.Title || "Unknown"} - ${err.message}`);
      }
    }

    revalidatePath("/admin/dashboard");
    revalidatePath("/admin/discovery");

    return {
      success: true,
      successCount,
      failedCount,
      errors
    };
  } catch (error: any) {
    console.error("[Wix Catalog Upload] Failed:", error);
    return {
      success: false,
      error: error.message
    };
  }
}

