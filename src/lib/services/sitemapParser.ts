import { WixBrand } from "./wixCms";

export interface DiscoveredProduct {
  Category: string;
  Product: string;
  Title: string;
  productItem: string; // Storing the source URL or identifier
  Series: string;
  MainFeature: string;
  ProductOverview: string;
  TechnicalSpecifications: string; // JSON string or text
  image: string;
  Datasheet: string;
}

const EXCLUDED_PATTERNS = [
  /\/about/i,
  /\/contact/i,
  /\/privacy/i,
  /\/terms/i,
  /\/blog/i,
  /\/careers/i,
  /\/cart/i,
  /\/checkout/i,
  /\/my-account/i,
  /\/faq/i,
  /\/help/i,
  /\/support/i,
  /\/news/i,
  /\/events/i,
  /\/download/i,
  /\.pdf$/i,
  /\.png$/i,
  /\.jpg$/i,
  /\.jpeg$/i,
  /\.zip$/i,
];

const PRODUCT_PATH_PATTERNS = [
  /\/product\//i,
  /\/products\//i,
  /\/item\//i,
  /\/shop\//i,
  /\/p\//i,
  /\/store\//i,
];

/**
 * Fetch all locs from a sitemap XML.
 */
async function fetchLocsFromSitemap(url: string, depth = 0): Promise<string[]> {
  if (depth > 3) return []; // Stop infinite loops

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });

    if (!res.ok) {
      console.warn(`Failed to fetch sitemap: ${url} (${res.statusText})`);
      return [];
    }

    const xml = await res.text();
    const locRegex = /<loc>(https?:\/\/[^\s<]+)<\/loc>/gi;
    const urls: string[] = [];
    let match;

    while ((match = locRegex.exec(xml)) !== null) {
      urls.push(match[1]);
    }

    const htmlUrls: string[] = [];
    const xmlUrls: string[] = [];

    urls.forEach((u) => {
      if (u.endsWith(".xml") || u.includes("/sitemap")) {
        xmlUrls.push(u);
      } else {
        htmlUrls.push(u);
      }
    });

    // Recursively parse nested sitemaps
    let nestedUrls: string[] = [];
    for (const xmlUrl of xmlUrls) {
      const nested = await fetchLocsFromSitemap(xmlUrl, depth + 1);
      nestedUrls = nestedUrls.concat(nested);
    }

    return [...htmlUrls, ...nestedUrls];
  } catch (err) {
    console.error(`Error parsing sitemap ${url}:`, err);
    return [];
  }
}

/**
 * Extract meta tags from HTML string.
 */
function extractMeta(html: string, nameOrProperty: string): string {
  const match = new RegExp(`<meta[^>]*(?:name|property)=["']${nameOrProperty}["'][^>]*content=["']([^"']*)["']`, "i").exec(html)
    || new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*(?:name|property)=["']${nameOrProperty}["']`, "i").exec(html);
  return match ? match[1].trim() : "";
}

/**
 * Scrapes metadata from a product URL.
 */
async function scrapeProductPage(url: string, brandName: string): Promise<DiscoveredProduct | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
      next: { revalidate: 3600 },
    });

    if (!res.ok) return null;

    const html = await res.text();

    // Extract title
    let title = extractMeta(html, "og:title") || extractMeta(html, "twitter:title");
    if (!title) {
      const titleMatch = /<title>([^<]*)<\/title>/i.exec(html);
      title = titleMatch ? titleMatch[1].trim() : "";
    }

    // Clean brand suffixes from title
    if (title && brandName) {
      const brandRegex = new RegExp(`\\s*[-|•]\\s*${brandName}.*$`, "i");
      title = title.replace(brandRegex, "");
    }

    if (!title) return null;

    // Extract description
    const overview = extractMeta(html, "og:description") || extractMeta(html, "description") || extractMeta(html, "twitter:description");

    // Extract image
    const image = extractMeta(html, "og:image") || extractMeta(html, "twitter:image") || "";

    // Guess category from URL or keywords
    let category = "General";
    try {
      const urlObj = new URL(url);
      const paths = urlObj.pathname.split("/").filter(Boolean);
      // If we have something like /products/cameras/camera-a, guess "cameras"
      const productIndex = paths.findIndex(p => p.toLowerCase() === "product" || p.toLowerCase() === "products");
      if (productIndex !== -1 && paths[productIndex + 1] && paths[productIndex + 2]) {
        category = paths[productIndex + 1].replace(/-/g, " ");
        category = category.charAt(0).toUpperCase() + category.slice(1);
      } else if (paths.length > 1) {
        category = paths[paths.length - 2].replace(/-/g, " ");
        category = category.charAt(0).toUpperCase() + category.slice(1);
      }
    } catch {
      // Ignored
    }

    // Extract product model / SKU from title or URL
    const productSlug = url.split("/").pop() || "";
    let product = productSlug.replace(/-/g, " ");
    product = product.charAt(0).toUpperCase() + product.slice(1);
    
    // Heuristic: If title is clean, use it as product name if short, otherwise use first 3 words of title
    if (title && title.split(" ").length <= 4) {
      product = title;
    }

    // Guess Series
    let series = "";
    const seriesMatch = /(?:Series|Family|Range)\s*([A-Za-z0-9-]+)/i.exec(overview + " " + title);
    if (seriesMatch) {
      series = seriesMatch[1];
    }

    // Guess Main Feature
    let mainFeature = "";
    const featureMatch = /(?:key features|features|highlight):\s*([^.]*\.)/i.exec(overview);
    if (featureMatch) {
      mainFeature = featureMatch[1].trim();
    }

    // Find Datasheet pdf links
    let datasheet = "";
    const pdfRegex = /<a[^>]*href=["']([^"']*\.pdf)["'][^>]*>/gi;
    let pdfMatch;
    while ((pdfMatch = pdfRegex.exec(html)) !== null) {
      const href = pdfMatch[1];
      if (href.toLowerCase().includes("datasheet") || href.toLowerCase().includes("spec") || href.toLowerCase().includes("manual")) {
        // Resolve relative URL
        if (href.startsWith("http")) {
          datasheet = href;
        } else {
          try {
            const base = new URL(url);
            datasheet = new URL(href, base.origin).toString();
          } catch {
            datasheet = href;
          }
        }
        break; // take first datasheet found
      }
    }

    // Simple Technical Specifications parser (find tables or description lists)
    const specs: Record<string, string> = {};
    const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
    let tableMatch = tableRegex.exec(html);
    let tableCount = 0;
    while (tableMatch && tableCount < 2) { // parse max 2 tables
      const tableContent = tableMatch[1];
      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rowMatch;
      while ((rowMatch = rowRegex.exec(tableContent)) !== null) {
        const rowContent = rowMatch[1];
        const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
        const cells: string[] = [];
        let cellMatch;
        while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
          cells.push(cellMatch[1].replace(/<[^>]*>/g, "").trim());
        }
        if (cells.length === 2 && cells[0] && cells[1]) {
          const label = cells[0].replace(/:$/, "").trim();
          const value = cells[1].trim();
          if (label.length < 50 && value.length < 200) {
            specs[label] = value;
          }
        }
      }
      tableCount++;
      tableMatch = tableRegex.exec(html);
    }

    return {
      Category: category,
      Product: product,
      Title: title,
      productItem: url,
      Series: series,
      MainFeature: mainFeature,
      ProductOverview: overview,
      TechnicalSpecifications: JSON.stringify(Object.entries(specs).map(([label, value]) => ({ label, value }))),
      image,
      Datasheet: datasheet,
    };
  } catch (err) {
    console.error(`Error scraping page ${url}:`, err);
    return null;
  }
}

/**
 * Scan Brand Sitemap. Returns a list of discovered product candidates.
 */
export async function scanBrandSitemap(brand: WixBrand): Promise<DiscoveredProduct[]> {
  if (!brand.sitemapUrl) return [];

  console.log(`Fetching locs for ${brand.name} sitemap...`);
  const locs = await fetchLocsFromSitemap(brand.sitemapUrl);
  console.log(`Found ${locs.length} total URLs in ${brand.name} sitemap.`);

  // Filter for URLs that are likely products
  const productUrls = locs.filter((url) => {
    // Must not match excluded patterns
    const isExcluded = EXCLUDED_PATTERNS.some((p) => p.test(url));
    if (isExcluded) return false;

    // If there are explicit product path indicators, prioritize them
    const matchesProductPath = PRODUCT_PATH_PATTERNS.some((p) => p.test(url));
    if (matchesProductPath) return true;

    // Otherwise, accept URLs that have at least 2 slashes after host
    try {
      const urlObj = new URL(url);
      const segments = urlObj.pathname.split("/").filter(Boolean);
      return segments.length >= 2;
    } catch {
      return false;
    }
  });

  console.log(`Filtered down to ${productUrls.length} candidate product URLs for ${brand.name}.`);

  // We scan a maximum of 50 candidate URLs in parallel or sequence to prevent rate limits
  const maxScanLimit = 50;
  const targetUrls = productUrls.slice(0, maxScanLimit);

  const results: DiscoveredProduct[] = [];
  for (const url of targetUrls) {
    const product = await scrapeProductPage(url, brand.name);
    if (product) {
      results.push(product);
    }
  }

  return results;
}

/**
 * Scan Brand REST API.
 */
export async function scanBrandAPI(brand: WixBrand): Promise<DiscoveredProduct[]> {
  if (!brand.apiUrl) return [];

  try {
    const res = await fetch(brand.apiUrl, {
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
      },
    });

    if (!res.ok) {
      console.warn(`Failed to fetch brand API ${brand.apiUrl}: ${res.statusText}`);
      return [];
    }

    const data = await res.json();
    
    // Guess how products are list inside the JSON
    let items: any[] = [];
    if (Array.isArray(data)) {
      items = data;
    } else if (data && typeof data === "object") {
      // Find the first array property in the object (e.g. data.products, data.items)
      const arrayKey = Object.keys(data).find(k => Array.isArray((data as any)[k]));
      if (arrayKey) {
        items = (data as any)[arrayKey];
      } else {
        // Wrap object in array
        items = [data];
      }
    }

    const results: DiscoveredProduct[] = [];
    for (const item of items) {
      const title = item.title || item.name || item.model || "";
      if (!title) continue;

      const product = item.product || item.productName || item.sku || title;
      const category = item.category || item.type || "General";
      const overview = item.description || item.overview || item.summary || "";
      const image = item.image || item.imageUrl || item.thumbnail || "";
      const datasheet = item.datasheet || item.pdf || item.pdfUrl || "";
      const series = item.series || item.family || "";
      const mainFeature = item.mainFeature || item.feature || "";
      
      // Handle specifications mapping
      let specifications = "[]";
      if (item.specifications && Array.isArray(item.specifications)) {
        specifications = JSON.stringify(item.specifications.map((s: any) => ({
          label: s.label || s.name || "",
          value: s.value || s.content || "",
        })));
      } else if (item.specs && typeof item.specs === "object") {
        specifications = JSON.stringify(Object.entries(item.specs).map(([label, value]) => ({
          label,
          value: String(value),
        })));
      }

      results.push({
        Category: category,
        Product: product,
        Title: title,
        productItem: item.id || item.url || title,
        Series: series,
        MainFeature: mainFeature,
        ProductOverview: overview,
        TechnicalSpecifications: specifications,
        image,
        Datasheet: datasheet,
      });
    }

    return results;
  } catch (err) {
    console.error(`Error scanning API for brand ${brand.name}:`, err);
    return [];
  }
}
