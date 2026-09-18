import { getActiveBrands, getAllProducts, WixBrand, WixProduct } from "./wixCms";
import { readSheet, appendRows, addLog, updateSystemConfig } from "./googleSheets";
import { scanBrandSitemap, scanBrandAPI, DiscoveredProduct } from "./sitemapParser";
import { sendNewProductsEmail } from "./emailService";
import { runNetworkScout } from "./networkScout";
import { enrichProductDataWithGeminiAgent, discoverProductsWithGeminiAgent } from "./geminiEnricher";
import {
  discoverProductsWithOllama,
  enrichProductDataWithOllama,
  isOllamaProductDiscoveryConfigured,
  type OllamaSearchSource,
} from "./ollamaProductDiscovery";

// Helper to construct deduplication keys
function getDedupKey(brandId: string, product: string, title: string): string {
  return `${brandId.trim()}|${(product || "").trim().toLowerCase()}|${(title || "").trim().toLowerCase()}`;
}

export let activeScanLogs: string[] = [];
export let isScanInProgress = false;

export function stopProductDiscovery() {
  if (isScanInProgress) {
    isScanInProgress = false;
    activeScanLogs.push("[SYSTEM] [STOP] Yêu cầu dừng quét từ Admin đã được ghi nhận. Đang dừng ở checkpoint tiếp theo...");
  }
}

interface ScanResult {
  totalScanned: number;
  totalNew: number;
  newProducts: Array<{ brandName: string; product: string; title: string; category: string }>;
  logs: string[];
}

/**
 * Runs the discovery engine for all active brands or a single brand.
 */
export async function runProductDiscovery(targetBrandId?: string): Promise<ScanResult> {
  activeScanLogs.length = 0;
  isScanInProgress = true;

  const result: ScanResult = {
    totalScanned: 0,
    totalNew: 0,
    newProducts: [],
    logs: activeScanLogs,
  };

  const timestamp = new Date().toISOString();
  result.logs.push(`[${timestamp}] Starting product discovery scan...`);
  await addLog("INFO", `Started discovery scan${targetBrandId ? ` for brand ID ${targetBrandId}` : " for all brands"}`);

  try {
    // 1. Fetch active brands from Wix CMS
    let brands = await getActiveBrands();
    if (targetBrandId) {
      brands = brands.filter((b) => b._id === targetBrandId);
      if (brands.length === 0) {
        throw new Error(`Brand with ID "${targetBrandId}" is not found or is inactive`);
      }
    }

    result.logs.push(`Found ${brands.length} active brand(s) to scan.`);

    if (brands.length === 0) {
      result.logs.push("No active brands to scan. Discovery finished.");
      await updateSystemConfig("LastScan", new Date().toISOString());
      isScanInProgress = false;
      return result;
    }

    // 2. Fetch existing data for deduplication checking
    result.logs.push("Loading existing data from Google Sheets and Wix CMS for deduplication...");
    
    const [sheetNewRows, sheetDeleteRows, wixProducts] = await Promise.all([
      readSheet("Product_New"),
      readSheet("Product_Delete"),
      getAllProducts(),
    ]);

    // Build deduplication sets
    const existingKeys = new Set<string>();

    // Wix Products (Index 0 is header, but since we retrieve from CMS, it's already an array of items)
    wixProducts.forEach((prod) => {
      // In Wix CMS, Brand is a reference field storing the Brand ID (which is a string)
      const brandVal = typeof prod.Brand === "object" ? (prod.Brand as any)._id : prod.Brand;
      if (brandVal && prod.Product && prod.Title) {
        existingKeys.add(getDedupKey(brandVal, prod.Product, prod.Title));
      }
    });

    // Product_New sheet (Row index 0 is header)
    // Columns: Category, Product, Title, productItem, Series, MainFeature, ProductOverview, TechnicalSpecifications, image, Brand, Datasheet
    // Brand is at column index 9 (0-based)
    // Product is at column index 1
    // Title is at column index 2
    if (sheetNewRows.length > 1) {
      for (let i = 1; i < sheetNewRows.length; i++) {
        const row = sheetNewRows[i];
        const category = row[0];
        const product = row[1];
        const title = row[2];
        const brandId = row[9];
        if (brandId && product && title) {
          existingKeys.add(getDedupKey(brandId, product, title));
        }
      }
    }

    // Product_Delete sheet (same structure)
    if (sheetDeleteRows.length > 1) {
      for (let i = 1; i < sheetDeleteRows.length; i++) {
        const row = sheetDeleteRows[i];
        const product = row[1];
        const title = row[2];
        const brandId = row[9];
        if (brandId && product && title) {
          existingKeys.add(getDedupKey(brandId, product, title));
        }
      }
    }

    result.logs.push(`Loaded ${existingKeys.size} total existing products for deduplication.`);

    // 3. Scan sitemaps and APIs for each brand
    const rowsToAppend: any[][] = [];

    for (const brand of brands) {
      if (!isScanInProgress) {
        result.logs.push("[SYSTEM] [STOP] Tiến trình quét đã bị dừng theo yêu cầu của Admin.");
        break;
      }
      result.logs.push(`Scanning brand: ${brand.name}...`);
      let candidates: DiscoveredProduct[] = [];

      try {
        if (brand.apiUrl) {
          result.logs.push(`Fetching products from API: ${brand.apiUrl}`);
          const apiCandidates = await scanBrandAPI(brand);
          candidates = candidates.concat(apiCandidates);
        }
      } catch (apiError) {
        const errMsg = (apiError as Error).message;
        result.logs.push(`[API Error] Failed to scan API for ${brand.name}: ${errMsg}`);
      }

      // Sitemap Scan (Temporarily Commented Out)
      /*
      try {
        if (brand.sitemapUrl) {
          result.logs.push(`Parsing sitemap: ${brand.sitemapUrl}`);
          const sitemapCandidates = await scanBrandSitemap(brand);
          candidates = candidates.concat(sitemapCandidates);
        }
      } catch (sitemapError) {
        const errMsg = (sitemapError as Error).message;
        result.logs.push(`[Sitemap Error] Failed to scan sitemap for ${brand.name}: ${errMsg}`);
      }
      */

      // Playwright Network Scout (Temporarily Commented Out)
      /*
      if (candidates.length === 0 && brand.websiteUrl) {
        result.logs.push(`[Fallback] Sitemap and API returned 0 products for ${brand.name}. Launching Network Scout Bot...`);
        try {
          const scoutCandidates = await runNetworkScout(brand.websiteUrl, brand.name);
          if (scoutCandidates.length > 0) {
            candidates = candidates.concat(scoutCandidates);
            result.logs.push(`[Fallback] Network Scout Bot successfully discovered ${scoutCandidates.length} product(s) for ${brand.name}.`);
          } else {
            result.logs.push(`[Fallback] Network Scout Bot finished but found no products for ${brand.name}.`);
          }
        } catch (scoutError) {
          const errMsg = (scoutError as Error).message;
          result.logs.push(`[Fallback ERROR] Network Scout Bot failed for ${brand.name}: ${errMsg}`);
        }
      }
      */

      // Gemini Discovery Agent (AI-driven brand discovery)
      if (process.env.GEMINI_API_KEY) {
        result.logs.push(`[Pipeline Status] Running Gemini Discovery Agent for brand: ${brand.name}...`);
        try {
          const aiCandidates = await discoverProductsWithGeminiAgent(brand.name);
          candidates = candidates.concat(aiCandidates);
          result.logs.push(`[Pipeline Status] Gemini Discovery Agent found ${aiCandidates.length} product(s) for ${brand.name}.`);
        } catch (aiDiscoveryError) {
          const errMsg = (aiDiscoveryError as Error).message;
          result.logs.push(`[Pipeline Status ERROR] Gemini Discovery Agent failed: ${errMsg}`);
        }
      }

      result.logs.push(`Found ${candidates.length} candidate products for ${brand.name}. Checking for duplicates...`);
      result.totalScanned += candidates.length;

      let brandNewCount = 0;
      for (const cand of candidates) {
        if (!isScanInProgress) {
          result.logs.push("[SYSTEM] [STOP] Tiến trình quét đã bị dừng theo yêu cầu của Admin.");
          break;
        }
        const key = getDedupKey(brand._id, cand.Product, cand.Title);

        if (!existingKeys.has(key)) {
          result.logs.push(`[Discovery Pipeline] New candidate found: ${cand.Product} - ${cand.Title}`);
          
          let finalCategory = cand.Category;
          let finalProduct = cand.Product;
          let finalTitle = cand.Title;
          let finalProductItem = cand.productItem;
          let finalSeries = cand.Series;
          let finalMainFeature = cand.MainFeature;
          let finalProductOverview = cand.ProductOverview;
          let finalTechnicalSpecifications = cand.TechnicalSpecifications;
          let finalImage = cand.image;
          let finalDatasheet = cand.Datasheet;

          // AI Enrichment step
          // Only enrich if the product features and overview are not already populated (which happens for Gemini Discovery Agent)
          const needsEnrichment = !cand.MainFeature && !cand.ProductOverview;

          if (process.env.GEMINI_API_KEY && needsEnrichment) {
            result.logs.push(`[Pipeline Status] Sitemap/Playwright -> AI: Running Gemini Search Grounding for ${cand.Product}...`);
            try {
              const enriched = await enrichProductDataWithGeminiAgent({
                Brand: brand.name,
                Product: cand.Product,
                Title: cand.Title,
                Category: cand.Category,
              });

              finalCategory = enriched.Category || finalCategory;
              finalProduct = enriched.Product || finalProduct;
              finalTitle = enriched.Title || finalTitle;
              finalProductItem = enriched["product (item)"] || finalProductItem;
              finalSeries = enriched.Series || finalSeries;
              finalMainFeature = enriched["Main Feature"] || finalMainFeature;
              finalProductOverview = enriched["Product Overview"] || finalProductOverview;
              finalTechnicalSpecifications = enriched["Technical Specifications"] || finalTechnicalSpecifications;
              finalImage = enriched.image || finalImage;
              finalDatasheet = enriched.Datasheet || finalDatasheet;

              result.logs.push(`[Pipeline Status] AI SUCCESS: Enriched data verified for ${finalProduct}`);
            } catch (aiError) {
              result.logs.push(`[Pipeline Status] AI FAILED: Skipping AI enrichment for ${cand.Product} (${(aiError as Error).message})`);
            }
          } else {
            result.logs.push(`[Pipeline Status] AI SKIPPED: GEMINI_API_KEY is not set. Using raw sitemap/playwright data.`);
          }

          // Sheet columns: Category, Product, Title, productItem, Series, MainFeature, ProductOverview, TechnicalSpecifications, image, Brand, Datasheet
          const sheetRow = [
            finalCategory,
            finalProduct,
            finalTitle,
            finalProductItem,
            finalSeries,
            finalMainFeature,
            finalProductOverview,
            finalTechnicalSpecifications,
            finalImage,
            brand._id, // Store Wix Brand ID
            finalDatasheet,
          ];

          rowsToAppend.push(sheetRow);
          // Track this new product for the email
          result.newProducts.push({
            brandName: brand.name,
            product: finalProduct,
            title: finalTitle,
            category: finalCategory,
          });

          // Prevent inserting duplicates within the same scan run
          existingKeys.add(key);
          brandNewCount++;
          result.totalNew++;
        }
      }

      if (brandNewCount > 0) {
        result.logs.push(`Found ${brandNewCount} new products for brand ${brand.name}.`);
        await addLog("INFO", `Discovered ${brandNewCount} new products for brand ${brand.name}`, brand.name);
      } else {
        result.logs.push(`No new products discovered for brand ${brand.name}.`);
      }
    }

    // 4. Batch append new products to Google Sheet
    if (rowsToAppend.length > 0) {
      result.logs.push(`Appending ${rowsToAppend.length} new product(s) to Product_New sheet...`);
      await appendRows("Product_New", rowsToAppend);
      result.logs.push("Google Sheets updated successfully.");

      // 5. Send email notifications
      result.logs.push("Sending email notification to trangioi479@gmail.com...");
      const emailSent = await sendNewProductsEmail(result.newProducts);
      if (emailSent) {
        result.logs.push("Email notification sent successfully.");
      } else {
        result.logs.push("Email notification skipped or failed (check SMTP settings).");
      }
    }

    // 6. Update system metadata
    await updateSystemConfig("LastScan", new Date().toISOString());
    result.logs.push(`Scan finished. Successfully scanned ${brands.length} brand(s) and found ${result.totalNew} new product(s).`);
    await addLog("INFO", `Scan finished. Scanned ${brands.length} brand(s). Found ${result.totalNew} new products.`);

  } catch (err) {
    const errorMsg = (err as Error).message;
    result.logs.push(`[ERROR] Scan failed: ${errorMsg}`);
    await addLog("ERROR", `Discovery scan failed: ${errorMsg}`);
  }

  isScanInProgress = false;
  return result;
}

export interface BrandScanResult extends ScanResult {
  /** True when `brandName` matched an existing Wix Brand by name — false means the products found are still queued, but with the raw brand NAME (not a valid Wix reference id) in the Brand column, so the caller should warn the admin to add this brand to the Brand collection before approving those rows. */
  brandMatched: boolean;
}

export type BrandDiscoveryProvider = "gemini" | "ollama";

/**
 * Ad-hoc AI product lookup for ONE brand name typed in by an admin — used by
 * the "Tra cứu sản phẩm bằng AI" tool (/admin/image-discovery). Unlike
 * runProductDiscovery() above, `brandName` does NOT need to already be an
 * active Wix Brand.
 *
 * `provider` picks which AI does the actual web lookup + enrichment:
 * - "gemini" (default): discoverProductsWithGeminiAgent / enrichProductDataWithGeminiAgent
 *   — real Google Search Grounding, most complete/reliable for open-ended discovery.
 * - "ollama": discoverProductsWithOllama / enrichProductDataWithOllama — free,
 *   self-hosted qwen3.5:9b reasoning over DuckDuckGo search snippets (see
 *   ollamaProductDiscovery.ts's doc comment for why this is offered as an
 *   alternative, not a replacement).
 * Either way, results append to the same Discovery Queue (Product_New
 * sheet), so they show up in the existing /admin/discovery review flow.
 *
 * `skipDedup`: when true, bypasses the "already exists in Wix/Sheets"
 * dedup check entirely — every candidate the AI finds gets queued. Meant
 * as a temporary debugging switch for when a search comes back with 0 new
 * products and it's unclear whether that's because the AI genuinely found
 * nothing, or because dedup is (perhaps wrongly) matching everything it
 * did find against existing data. Leave false for normal use — with it on,
 * products already in the catalog can be queued again as duplicates.
 */
export async function runProductDiscoveryForBrand(
  brandName: string,
  keyword?: string,
  provider: BrandDiscoveryProvider = "gemini",
  skipDedup = false
): Promise<BrandScanResult> {
  activeScanLogs.length = 0;
  isScanInProgress = true;

  const trimmedBrand = brandName.trim();
  const result: BrandScanResult = {
    totalScanned: 0,
    totalNew: 0,
    newProducts: [],
    logs: activeScanLogs,
    brandMatched: false,
  };

  result.logs.push(
    `Starting AI product lookup for brand "${trimmedBrand}"${keyword ? ` (keyword: ${keyword})` : ""} via ${provider}...`
  );
  await addLog("INFO", `Started ad-hoc brand discovery for "${trimmedBrand}" (provider: ${provider})`);

  if (!trimmedBrand) {
    result.logs.push("[ERROR] Brand name is empty.");
    isScanInProgress = false;
    return result;
  }
  if (provider === "gemini" && !process.env.GEMINI_API_KEY) {
    result.logs.push("[ERROR] GEMINI_API_KEY chưa được cấu hình — công cụ này cần Gemini Search Grounding để tra cứu trên mạng.");
    isScanInProgress = false;
    return result;
  }
  if (provider === "ollama" && !isOllamaProductDiscoveryConfigured()) {
    result.logs.push("[ERROR] OLLAMA_BASE_URL chưa được cấu hình.");
    isScanInProgress = false;
    return result;
  }

  try {
    const brands = await getActiveBrands();
    const matchedBrand = brands.find((b) => b.name.trim().toLowerCase() === trimmedBrand.toLowerCase());
    result.brandMatched = Boolean(matchedBrand);
    // Dedup key namespace: a real Brand ID when matched, otherwise the brand
    // name itself lower-cased — either way it's a stable per-brand key, just
    // not a valid Wix reference unless matchedBrand exists.
    const brandKeyForDedup = matchedBrand ? matchedBrand._id : `__unregistered__:${trimmedBrand.toLowerCase()}`;
    const brandColumnValue = matchedBrand ? matchedBrand._id : trimmedBrand;

    if (matchedBrand) {
      result.logs.push(`Đã khớp với hãng có sẵn trên Wix CMS: "${matchedBrand.name}" (ID: ${matchedBrand._id}).`);
    } else {
      result.logs.push(
        `[WARN] "${trimmedBrand}" chưa có trong danh sách hãng (Brand) trên Wix CMS. Sản phẩm tìm được vẫn sẽ được thêm vào Discovery Queue, nhưng cần thêm hãng "${trimmedBrand}" vào Brand collection trên CMS trước khi duyệt (approve) các sản phẩm này.`
      );
    }

    const existingKeys = new Set<string>();
    if (skipDedup) {
      result.logs.push("[WARN] Đã TẠM TẮT kiểm tra trùng lặp (dedup) — mọi sản phẩm AI tìm được sẽ được thêm vào Discovery Queue dù có thể đã tồn tại.");
    } else {
      result.logs.push("Loading existing data from Google Sheets and Wix CMS for deduplication...");
      const [sheetNewRows, sheetDeleteRows, wixProducts] = await Promise.all([
        readSheet("Product_New"),
        readSheet("Product_Delete"),
        getAllProducts(),
      ]);

      wixProducts.forEach((prod) => {
        const brandVal = typeof prod.Brand === "object" ? (prod.Brand as unknown as { _id?: string })._id : prod.Brand;
        if (brandVal && prod.Product && prod.Title) {
          existingKeys.add(getDedupKey(brandVal, prod.Product, prod.Title));
        }
      });
      if (sheetNewRows.length > 1) {
        for (let i = 1; i < sheetNewRows.length; i++) {
          const row = sheetNewRows[i];
          const product = row[1];
          const title = row[2];
          const brandId = row[9];
          if (brandId && product && title) existingKeys.add(getDedupKey(brandId, product, title));
        }
      }
      if (sheetDeleteRows.length > 1) {
        for (let i = 1; i < sheetDeleteRows.length; i++) {
          const row = sheetDeleteRows[i];
          const product = row[1];
          const title = row[2];
          const brandId = row[9];
          if (brandId && product && title) existingKeys.add(getDedupKey(brandId, product, title));
        }
      }
      result.logs.push(`Loaded ${existingKeys.size} total existing products for deduplication.`);
    }

    result.logs.push(`[Pipeline Status] Running ${provider === "gemini" ? "Gemini Discovery Agent" : "Ollama + DuckDuckGo Discovery"} for brand: ${trimmedBrand}...`);
    let candidates: DiscoveredProduct[] = [];
    let discoverySources: OllamaSearchSource[] = [];
    try {
      if (provider === "gemini") {
        candidates = await discoverProductsWithGeminiAgent(trimmedBrand, keyword);
      } else {
        const ollamaResult = await discoverProductsWithOllama(trimmedBrand, keyword);
        candidates = ollamaResult.products;
        discoverySources = ollamaResult.sources;
        if (discoverySources.length > 0) {
          result.logs.push(`[Pipeline Status] Tra cứu được ${discoverySources.length} nguồn: ${discoverySources.map((s) => s.url).join(", ")}`);
        }
      }
      result.logs.push(`[Pipeline Status] Found ${candidates.length} product(s) for ${trimmedBrand}.`);
    } catch (aiErr) {
      result.logs.push(`[Pipeline Status ERROR] Discovery failed: ${(aiErr as Error).message}`);
    }

    result.totalScanned = candidates.length;
    result.logs.push(`Found ${candidates.length} candidate product(s) for ${trimmedBrand}. Checking for duplicates...`);

    const rowsToAppend: unknown[][] = [];

    for (const cand of candidates) {
      if (!isScanInProgress) {
        result.logs.push("[SYSTEM] [STOP] Tiến trình đã bị dừng theo yêu cầu của Admin.");
        break;
      }
      const key = getDedupKey(brandKeyForDedup, cand.Product, cand.Title);
      if (existingKeys.has(key)) continue;

      result.logs.push(`[Discovery Pipeline] New candidate found: ${cand.Product} - ${cand.Title}`);

      let finalCategory = cand.Category;
      let finalProduct = cand.Product;
      let finalTitle = cand.Title;
      let finalProductItem = cand.productItem;
      let finalSeries = cand.Series;
      let finalMainFeature = cand.MainFeature;
      let finalProductOverview = cand.ProductOverview;
      let finalTechnicalSpecifications = cand.TechnicalSpecifications;
      let finalImage = cand.image;
      let finalDatasheet = cand.Datasheet;

      // Both discovery agents deliberately leave features/overview blank so
      // every candidate goes through the dedicated enrichment step below
      // for accuracy (see discoverProductsWithGeminiAgent's / this file's
      // doc comments).
      const needsEnrichment = !cand.MainFeature && !cand.ProductOverview;
      if (needsEnrichment) {
        result.logs.push(`[Pipeline Status] Running ${provider === "gemini" ? "Gemini Search Grounding" : "Ollama + DuckDuckGo"} enrichment for ${cand.Product}...`);
        try {
          if (provider === "gemini") {
            const enriched = await enrichProductDataWithGeminiAgent({
              Brand: trimmedBrand,
              Product: cand.Product,
              Title: cand.Title,
              Category: cand.Category,
            });
            finalCategory = enriched.Category || finalCategory;
            finalProduct = enriched.Product || finalProduct;
            finalTitle = enriched.Title || finalTitle;
            finalProductItem = enriched["product (item)"] || finalProductItem;
            finalSeries = enriched.Series || finalSeries;
            finalMainFeature = enriched["Main Feature"] || finalMainFeature;
            finalProductOverview = enriched["Product Overview"] || finalProductOverview;
            finalTechnicalSpecifications = enriched["Technical Specifications"] || finalTechnicalSpecifications;
            finalImage = enriched.image || finalImage;
            finalDatasheet = enriched.Datasheet || finalDatasheet;
          } else {
            const enriched = await enrichProductDataWithOllama({
              Brand: trimmedBrand,
              Product: cand.Product,
              Title: cand.Title,
              Category: cand.Category,
            });
            finalCategory = enriched.Category || finalCategory;
            finalSeries = enriched.Series || finalSeries;
            finalMainFeature = enriched["Main Feature"] || finalMainFeature;
            finalProductOverview = enriched["Product Overview"] || finalProductOverview;
            finalTechnicalSpecifications = enriched["Technical Specifications"] || finalTechnicalSpecifications;
            // No image/Datasheet from the Ollama path — see enrichProductDataWithOllama's doc comment.
          }
          result.logs.push(`[Pipeline Status] AI SUCCESS: Enriched data for ${finalProduct}`);
        } catch (enrichErr) {
          result.logs.push(`[Pipeline Status] AI FAILED: Skipping enrichment for ${cand.Product} (${(enrichErr as Error).message})`);
        }
      }

      const sheetRow = [
        finalCategory,
        finalProduct,
        finalTitle,
        finalProductItem,
        finalSeries,
        finalMainFeature,
        finalProductOverview,
        finalTechnicalSpecifications,
        finalImage,
        brandColumnValue, // Real Wix Brand ID if matched, otherwise the raw brand name (see brandMatched)
        finalDatasheet,
      ];
      rowsToAppend.push(sheetRow);
      result.newProducts.push({ brandName: trimmedBrand, product: finalProduct, title: finalTitle, category: finalCategory });
      existingKeys.add(key);
      result.totalNew++;
    }

    if (rowsToAppend.length > 0) {
      result.logs.push(`Appending ${rowsToAppend.length} new product(s) to Product_New sheet...`);
      await appendRows("Product_New", rowsToAppend);
      result.logs.push("Google Sheets updated successfully.");

      result.logs.push("Sending email notification...");
      const emailSent = await sendNewProductsEmail(result.newProducts);
      result.logs.push(emailSent ? "Email notification sent successfully." : "Email notification skipped or failed (check SMTP settings).");
    }

    await updateSystemConfig("LastScan", new Date().toISOString());
    result.logs.push(`Lookup finished. Found ${result.totalNew} new product(s) for "${trimmedBrand}".`);
    await addLog(
      "INFO",
      `Ad-hoc brand discovery finished for "${trimmedBrand}". Found ${result.totalNew} new products.`,
      trimmedBrand
    );
  } catch (err) {
    const errorMsg = (err as Error).message;
    result.logs.push(`[ERROR] Lookup failed: ${errorMsg}`);
    await addLog("ERROR", `Ad-hoc brand discovery failed for "${trimmedBrand}": ${errorMsg}`);
  }

  isScanInProgress = false;
  return result;
}
