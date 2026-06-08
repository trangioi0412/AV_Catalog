import { chromium, Page } from "playwright";
import { DiscoveredProduct } from "./sitemapParser";

export interface TargetProductSchema {
  brand: string;
  model_number: string;
  product_name: string;
  image_url: string;
  source_url: string;
}

/**
 * Normalizes any object to a list of arrays (recursive search).
 */
function findArrays(obj: any): any[][] {
  const arrays: any[][] = [];
  function recurse(current: any) {
    if (!current || typeof current !== "object") return;
    if (Array.isArray(current)) {
      arrays.push(current);
      for (const item of current) {
        recurse(item);
      }
      return;
    }
    for (const key of Object.keys(current)) {
      try {
        recurse(current[key]);
      } catch {
        // Prevent accessor properties from crashing
      }
    }
  }
  recurse(obj);
  return arrays;
}

/**
 * Scores an array based on how closely its elements resemble product items.
 */
function scoreProductArray(arr: any[]): number {
  if (!arr || arr.length === 0) return 0;
  
  let score = 0;
  const sample = arr.slice(0, 5);
  const productKeywords = [
    "name", "title", "sku", "model", "partnumber", "id", 
    "url", "uri", "path", "image", "imageUrl", "description", 
    "price", "slug", "brand"
  ];
  
  for (const item of sample) {
    if (!item || typeof item !== "object") continue;
    const keys = Object.keys(item).map((k) => k.toLowerCase());
    
    let matchCount = 0;
    for (const kw of productKeywords) {
      if (keys.some((k) => k.includes(kw))) {
        matchCount++;
      }
    }
    
    const hasIdentifier = keys.some(
      (k) => k.includes("name") || k.includes("title") || k.includes("model") || k.includes("sku")
    );
    
    if (hasIdentifier && matchCount >= 2) {
      score += matchCount;
    }
  }
  
  return score / sample.length;
}

/**
 * Heuristically parses a raw object from API response into a DiscoveredProduct structure.
 */
function parseRawItemToDiscoveredProduct(
  item: any,
  brandName: string,
  pageOrigin: string
): DiscoveredProduct | null {
  if (!item || typeof item !== "object") return null;
  
  const findValue = (keys: string[]): any => {
    const itemKeys = Object.keys(item);
    for (const key of keys) {
      const foundKey = itemKeys.find((k) => k.toLowerCase() === key.toLowerCase());
      if (foundKey) return item[foundKey];
    }
    return undefined;
  };
  
  const rawProduct = findValue(["productName", "name", "product", "modelName", "product_name", "displayName", "label"]);
  const rawTitle = findValue(["title", "name", "description", "label", "heading"]);
  const rawModel = findValue(["sku", "model", "modelNumber", "model_number", "partNumber", "part_number", "itemNumber", "id"]);
  const rawImage = findValue(["image", "imageUrl", "image_url", "img", "thumbnail", "photo", "picture", "media"]);
  const rawUrl = findValue(["url", "sourceUrl", "source_url", "link", "href", "path", "uri"]);
  const rawCategory = findValue(["category", "type", "group", "class", "department", "productType"]);
  const rawSeries = findValue(["series", "family", "line", "productLine"]);
  const rawOverview = findValue(["description", "overview", "summary", "text", "shortDescription", "body"]);
  const rawDatasheet = findValue(["datasheet", "pdf", "datasheetUrl", "manual", "specSheet"]);
  const rawSpecs = findValue(["specifications", "specs", "techSpecs", "features"]);

  const title = String(rawTitle || rawProduct || rawModel || "").trim();
  const product = String(rawProduct || rawModel || rawTitle || "").trim();
  
  if (!product && !title) return null;

  let image = "";
  if (rawImage) {
    const imgStr = String(rawImage).trim();
    if (imgStr.startsWith("http")) {
      image = imgStr;
    } else if (imgStr.startsWith("/")) {
      image = `${pageOrigin}${imgStr}`;
    } else if (imgStr) {
      image = `${pageOrigin}/${imgStr}`;
    }
  }

  let productItem = "";
  if (rawUrl) {
    const urlStr = String(rawUrl).trim();
    if (urlStr.startsWith("http")) {
      productItem = urlStr;
    } else if (urlStr.startsWith("/")) {
      productItem = `${pageOrigin}${urlStr}`;
    } else if (urlStr) {
      productItem = `${pageOrigin}/${urlStr}`;
    }
  } else {
    const slug = encodeURIComponent(product.toLowerCase().replace(/\s+/g, "-"));
    productItem = `${pageOrigin}/products/${slug}`;
  }

  let technicalSpecifications = "[]";
  if (rawSpecs) {
    if (Array.isArray(rawSpecs)) {
      technicalSpecifications = JSON.stringify(
        rawSpecs.map((s: any) => {
          if (typeof s === "object" && s !== null) {
            return {
              label: s.label || s.name || s.key || "",
              value: s.value || s.content || "",
            };
          }
          return { label: "Spec", value: String(s) };
        })
      );
    } else if (typeof rawSpecs === "object" && rawSpecs !== null) {
      technicalSpecifications = JSON.stringify(
        Object.entries(rawSpecs).map(([label, value]) => ({
          label,
          value: typeof value === "object" ? JSON.stringify(value) : String(value),
        }))
      );
    } else {
      technicalSpecifications = JSON.stringify([{ label: "Specifications", value: String(rawSpecs) }]);
    }
  }

  let datasheet = "";
  if (rawDatasheet) {
    const dsStr = String(rawDatasheet).trim();
    if (dsStr.startsWith("http")) {
      datasheet = dsStr;
    } else if (dsStr.startsWith("/")) {
      datasheet = `${pageOrigin}${dsStr}`;
    } else if (dsStr) {
      datasheet = `${pageOrigin}/${dsStr}`;
    }
  }

  return {
    Category: String(rawCategory || "General").trim(),
    Product: product,
    Title: title,
    productItem,
    Series: String(rawSeries || "").trim(),
    MainFeature: "",
    ProductOverview: String(rawOverview || "").trim(),
    TechnicalSpecifications: technicalSpecifications,
    image,
    Datasheet: datasheet,
  };
}

/**
 * Traverses JSON structure, finds product arrays, parses and returns candidates.
 */
function extractProductsFromJSON(json: any, apiUrl: string, brandName: string): DiscoveredProduct[] {
  const arrays = findArrays(json);
  if (arrays.length === 0) return [];
  
  let bestArray: any[] | null = null;
  let bestScore = 0;
  
  for (const arr of arrays) {
    const score = scoreProductArray(arr);
    if (score > bestScore) {
      bestScore = score;
      bestArray = arr;
    }
  }
  
  if (bestArray && bestScore >= 1.5) {
    try {
      const origin = new URL(apiUrl).origin;
      const parsedProducts: DiscoveredProduct[] = [];
      
      for (const item of bestArray) {
        const prod = parseRawItemToDiscoveredProduct(item, brandName, origin);
        if (prod) {
          parsedProducts.push(prod);
        }
      }
      
      return parsedProducts;
    } catch (e) {
      console.error("[Scout] Error mapping array item to product:", e);
    }
  }
  
  return [];
}

/**
 * Traverses JSON-LD schemas looking for Product or ItemList elements containing products.
 */
function findProductsInJsonLd(data: any, brandName: string, pageOrigin: string): DiscoveredProduct[] {
  const products: DiscoveredProduct[] = [];
  
  function search(item: any) {
    if (!item || typeof item !== "object") return;
    
    if (item["@type"] === "Product" || item["@type"] === "http://schema.org/Product") {
      const name = item.name || item.title || "";
      if (name) {
        const image = Array.isArray(item.image) ? item.image[0] : (item.image || "");
        const sku = item.sku || item.model || item.mpn || "";
        const url = item.url || "";
        
        let resolvedUrl = url;
        if (resolvedUrl && !resolvedUrl.startsWith("http")) {
          resolvedUrl = new URL(resolvedUrl, pageOrigin).toString();
        }
        
        let resolvedImage = image;
        if (resolvedImage && !resolvedImage.startsWith("http")) {
          resolvedImage = new URL(resolvedImage, pageOrigin).toString();
        }

        products.push({
          Category: "General",
          Product: sku || name,
          Title: name,
          productItem: resolvedUrl || pageOrigin,
          Series: "",
          MainFeature: "",
          ProductOverview: item.description || "",
          TechnicalSpecifications: "[]",
          image: resolvedImage,
          Datasheet: "",
        });
      }
      return;
    }
    
    if ((item["@type"] === "ItemList" || item["@type"] === "http://schema.org/ItemList") && item.itemListElement) {
      const elements = item.itemListElement;
      if (Array.isArray(elements)) {
        for (const element of elements) {
          if (element.item) {
            search(element.item);
          } else {
            search(element);
          }
        }
      }
    }
    
    for (const key of Object.keys(item)) {
      try {
        search(item[key]);
      } catch {
        // Prevent accessor crash
      }
    }
  }
  
  search(data);
  return products;
}

/**
 * Scrapes DOM for fallback sources (JSON-LD, Shopify window vars, and card heuristics).
 */
async function extractProductsFromDOM(page: Page, brandName: string): Promise<DiscoveredProduct[]> {
  const pageUrl = page.url();
  const pageOrigin = new URL(pageUrl).origin;
  
  // Fallback 1: Parse application/ld+json script tags (SEO structured data)
  try {
    const jsonLdData = await page.evaluate(() => {
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      return scripts.map((s) => s.textContent || "");
    });
    
    const products: DiscoveredProduct[] = [];
    for (const jsonStr of jsonLdData) {
      if (!jsonStr) continue;
      try {
        const data = JSON.parse(jsonStr);
        const found = findProductsInJsonLd(data, brandName, pageOrigin);
        if (found.length > 0) {
          products.push(...found);
        }
      } catch {
        // Skip malformed JSON
      }
    }
    
    if (products.length > 0) {
      console.log(`[Scout] Extracted ${products.length} products from JSON-LD schema metadata.`);
      return products;
    }
  } catch (err) {
    console.error("[Scout] Error parsing JSON-LD scripts:", err);
  }
  
  // Fallback 2: Check window.Shopify.products or similar e-commerce global arrays
  try {
    const shopifyProducts = await page.evaluate(() => {
      if (typeof window !== "undefined" && (window as any).Shopify && (window as any).Shopify.products) {
        return (window as any).Shopify.products;
      }
      return null;
    });
    
    if (shopifyProducts && Array.isArray(shopifyProducts)) {
      const products: DiscoveredProduct[] = [];
      for (const item of shopifyProducts) {
        const prod = parseRawItemToDiscoveredProduct(item, brandName, pageOrigin);
        if (prod) products.push(prod);
      }
      if (products.length > 0) {
        console.log(`[Scout] Extracted ${products.length} products from window.Shopify.products global array.`);
        return products;
      }
    }
  } catch (err) {
    // Skip window vars check errors
  }

  // Fallback 3: Heuristic DOM scraping (product cards links & images)
  try {
    const cardData = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a"));
      const candidates: Array<{ title: string; href: string; image?: string }> = [];
      
      for (const a of anchors) {
        const href = a.getAttribute("href");
        if (!href) continue;
        
        const lowerHref = href.toLowerCase();
        // Check if the link contains a product path pattern
        const isProductLink = /\/(product|products|item|items|p|shop|catalog)\//i.test(lowerHref);
        if (!isProductLink) continue;
        
        const text = (a.textContent || "").trim();
        // Filter out excessively short or long strings (unlikely to be product names)
        if (text.length < 3 || text.length > 80) continue;
        
        // Exclude common navigation links
        if (/^(cart|checkout|login|register|view|buy|shop|search|about|contact)/i.test(text)) continue;
        
        const img = a.querySelector("img");
        const imgUrl = img ? (img.getAttribute("src") || img.getAttribute("data-src") || img.getAttribute("srcset")) : undefined;
        
        candidates.push({
          title: text,
          href: href,
          image: imgUrl || undefined,
        });
      }
      return candidates;
    });
    
    const products: DiscoveredProduct[] = [];
    for (const card of cardData) {
      let productUrl = card.href;
      if (!productUrl.startsWith("http")) {
        productUrl = new URL(productUrl, pageOrigin).toString();
      }
      
      let imageUrl = card.image || "";
      if (imageUrl && !imageUrl.startsWith("http")) {
        imageUrl = new URL(imageUrl, pageOrigin).toString();
      }
      
      products.push({
        Category: "General",
        Product: card.title,
        Title: card.title,
        productItem: productUrl,
        Series: "",
        MainFeature: "",
        ProductOverview: "",
        TechnicalSpecifications: "[]",
        image: imageUrl,
        Datasheet: "",
      });
    }
    
    if (products.length > 0) {
      console.log(`[Scout] Extracted ${products.length} products via DOM layout card heuristics.`);
      return products;
    }
  } catch (err) {
    console.error("[Scout] Error scraping product cards:", err);
  }

  return [];
}

/**
 * Automates window scrolling to trigger lazy loading of AJAX product lists.
 */
async function autoScroll(page: Page) {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => {
      let totalHeight = 0;
      const distance = 150;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        
        if (totalHeight >= scrollHeight || totalHeight > 6000) {
          clearInterval(timer);
          resolve();
        }
      }, 150);
    });
  });
}

/**
 * Run Playwright Network Scout on a target website to intercept API queries and extract product catalog.
 * 
 * @param url The page URL to visit (usually brand catalog/products page or website homepage)
 * @param brandName The brand name
 * @param timeoutMs Maximum scout run time (default: 15000ms)
 */
export async function runNetworkScout(
  url: string,
  brandName: string,
  timeoutMs = 15000
): Promise<DiscoveredProduct[]> {
  console.log(`[Scout] Starting Network Scout for ${brandName} at ${url}...`);
  
  const capturedProducts: DiscoveredProduct[] = [];
  
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-web-security",
    ],
  });
  
  try {
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      extraHTTPHeaders: {
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
      },
    });
    
    const page = await context.newPage();
    
    // Intercept network responses
    page.on("response", async (response) => {
      try {
        const contentType = response.headers()["content-type"] || "";
        const resUrl = response.url();
        
        if (contentType.includes("application/json")) {
          console.log(`[Scout Debug] Intercepted JSON: ${resUrl}`);
          const lowerUrl = resUrl.toLowerCase();
          const apiKeywords = ["api", "product", "search", "catalog", "query", "list", "items"];
          const isApiEndpoint = apiKeywords.some((keyword) => lowerUrl.includes(keyword));
          
          if (isApiEndpoint) {
            console.log(`[Scout Debug] Matches keywords, status: ${response.status()}`);
            if (response.status() === 200) {
              const json = await response.json();
              if (json) {
                const parsed = extractProductsFromJSON(json, resUrl, brandName);
                if (parsed.length > 0) {
                  console.log(`[Scout Debug] Successfully extracted ${parsed.length} products from ${resUrl}`);
                  capturedProducts.push(...parsed);
                }
              }
            }
          }
        }
      } catch (err) {
        // Suppress parsing/consumption errors
      }
    });
    
    // Go to URL
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    
    // Perform auto scrolling to trigger lazy loading APIs
    await autoScroll(page);
    
    // Wait for outstanding requests or timeout
    await page.waitForTimeout(2000);

    // DOM Fallback parsing if no AJAX responses were intercepted
    if (capturedProducts.length === 0) {
      console.log(`[Scout] Intercepted 0 API products. Executing DOM parser fallbacks...`);
      const domProducts = await extractProductsFromDOM(page, brandName);
      if (domProducts.length > 0) {
        capturedProducts.push(...domProducts);
      }
    }
    
  } catch (err) {
    console.error(`[Scout] Error during Playwright scout execution for ${brandName}:`, err);
  } finally {
    await browser.close();
  }
  
  // Deduplicate products based on source URL (productItem)
  const uniqueMap = new Map<string, DiscoveredProduct>();
  for (const p of capturedProducts) {
    if (p.productItem) {
      // Normalize URL slightly (remove trailing slash)
      const normUrl = p.productItem.replace(/\/$/, "");
      uniqueMap.set(normUrl, p);
    }
  }
  
  const results = Array.from(uniqueMap.values());
  console.log(`[Scout] Finished Network Scout for ${brandName}. Extracted ${results.length} unique products.`);
  
  if (results.length === 0) {
    console.error(`[Scout][ERROR] After 15 seconds, no suitable product API or DOM elements were captured for brand ${brandName}.`);
  }
  
  return results;
}

/**
 * Adapter/Mapping function to convert internal DiscoveredProduct schema to User Target DB schema.
 */
export function mapToTargetSchema(product: DiscoveredProduct, brandName: string): TargetProductSchema {
  return {
    brand: brandName,
    model_number: product.Product,
    product_name: product.Title,
    image_url: product.image,
    source_url: product.productItem,
  };
}
