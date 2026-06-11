import { chromium } from "playwright";
import { isManufacturerDomain, isProductDetailPage } from "./brandDomainService";

export interface ScrapedPageDetails {
  imageUrls: string[];
  datasheetUrls: string[];
  pageHtml: string;
}

function cleanString(str: string): string {
  return str.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function gotoWithRetry(page: any, url: string, timeout = 15000, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout });
      return; // Success!
    } catch (err: any) {
      if (attempt === maxRetries) {
        throw err;
      }
      const backoff = attempt * 2000 + Math.floor(Math.random() * 1500);
      console.warn(`[PageScraper] Navigation failed, retrying in ${backoff}ms (Attempt ${attempt}/${maxRetries}): ${err.message || err}`);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
}

// ─── Regex Helpers for Raw HTML Parsing (Method B/C) ───

function extractTitle(html: string): string {
  const titleRegex = /<title[^>]*>([\s\S]*?)<\/title>/i;
  const match = titleRegex.exec(html);
  return match ? match[1].trim() : "";
}

function extractH1s(html: string): string[] {
  const h1s: string[] = [];
  const h1Regex = /<h1[^>]*>([\s\S]*?)<\/h1>/gi;
  let match;
  while ((match = h1Regex.exec(html)) !== null) {
    h1s.push(match[1].replace(/<[^>]*>/g, "").trim()); // Strip internal HTML tags
  }
  return h1s;
}

function extractMetaImages(html: string): string[] {
  const images: string[] = [];
  let match;
  
  // Property then content
  const ogImgRegex1 = /<meta\s+[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["'][^>]*>/gi;
  while ((match = ogImgRegex1.exec(html)) !== null) {
    if (match[1]) images.push(match[1].trim());
  }
  
  // Content then property
  const ogImgRegex2 = /<meta\s+[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["'][^>]*>/gi;
  while ((match = ogImgRegex2.exec(html)) !== null) {
    if (match[1]) images.push(match[1].trim());
  }

  // Name then content
  const twitterImgRegex1 = /<meta\s+[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["'][^>]*>/gi;
  while ((match = twitterImgRegex1.exec(html)) !== null) {
    if (match[1]) images.push(match[1].trim());
  }
  
  // Content then name
  const twitterImgRegex2 = /<meta\s+[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["'][^>]*>/gi;
  while ((match = twitterImgRegex2.exec(html)) !== null) {
    if (match[1]) images.push(match[1].trim());
  }

  return images;
}

function extractJsonLdImages(html: string): string[] {
  const images: string[] = [];
  const scriptRegex = /<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  
  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const content = match[1].trim();
      const json = JSON.parse(content);
      
      function findImagesInObj(obj: any) {
        if (!obj || typeof obj !== "object") return;
        if (obj["@type"] === "Product" || obj["@type"] === "http://schema.org/Product") {
          if (obj.image) {
            if (Array.isArray(obj.image)) {
              obj.image.forEach((img: any) => {
                if (typeof img === "string") images.push(img.trim());
                else if (img && typeof img === "object" && img.url) images.push(String(img.url).trim());
              });
            } else if (typeof obj.image === "string") {
              images.push(obj.image.trim());
            } else if (obj.image && typeof obj.image === "object" && obj.image.url) {
              images.push(String(obj.image.url).trim());
            }
          }
        }
        Object.keys(obj).forEach((k) => findImagesInObj(obj[k]));
      }
      
      findImagesInObj(json);
    } catch {
      // Ignore JSON parse errors
    }
  }
  return images;
}

function extractPdfLinks(html: string, pageUrl: string): string[] {
  const pdfs: string[] = [];
  const anchorRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  
  while ((match = anchorRegex.exec(html)) !== null) {
    const href = match[1].trim();
    const text = match[2].toLowerCase().replace(/<[^>]*>/g, "").trim();
    const lowerHref = href.toLowerCase();
    
    const isPdf =
      lowerHref.endsWith(".pdf") ||
      lowerHref.includes("pdf=true") ||
      lowerHref.includes("/download/");
    const hasKeyword =
      /datasheet|spec|manual|brochure|specifications|resource|download/i.test(text) ||
      /datasheet|spec|manual|specifications/i.test(lowerHref);
      
    if (isPdf || (hasKeyword && lowerHref.includes(".pdf"))) {
      pdfs.push(href);
    }
  }
  return pdfs;
}

/**
 * Scrapes a product detail page and extracts image + datasheet URLs.
 * 
 * Strategy Priority:
 * 1. Validate page is a Product Detail Page (reject homepages/root domains).
 * 2. Method A: HEAD request to quickly resolve redirects.
 * 3. Method B: HTTP Fetch (GET HTML) to extract metadata (og:image, JSON-LD, etc.).
 * 4. Method C: Axios (GET HTML) if fetch fails or yields no images.
 * 5. Method D: Playwright (last resort fallback) if JavaScript rendering is required.
 */
export async function scrapeProductPage(
  url: string,
  brand: string,
  productName: string,
  manufacturerDomain?: string,
  timeoutMs = 15000
): Promise<ScrapedPageDetails> {
  console.log(`[PageScraper] Scraping product page: ${url}`);
  if (manufacturerDomain) {
    console.log(`[PageScraper] Domain filter active – only accepting images from: ${manufacturerDomain} (and subdomains)`);
  }

  const details: ScrapedPageDetails = {
    imageUrls: [],
    datasheetUrls: [],
    pageHtml: ""
  };

  // 1. Initial Guard: URL must be a valid Product Detail Page (PDP)
  if (!isProductDetailPage(url, brand, productName)) {
    console.log(`[PageScraper] URL ${url} is not a valid Product Detail Page (not matching PDP indicators or slug/name). REJECTED.`);
    return details;
  }

  const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  // Helper to process raw HTML text and perform checks/extraction
  const processRawHtml = (htmlContent: string, pageUrl: string): ScrapedPageDetails | null => {
    const pageTitle = extractTitle(htmlContent);
    const h1Texts = extractH1s(htmlContent);

    const titleClean = cleanString(pageTitle);
    const h1sClean = h1Texts.map(h => cleanString(h));
    const brandClean = cleanString(brand);
    const productClean = cleanString(productName);

    const titleHasBrand = titleClean.includes(brandClean);
    const titleHasProduct = titleClean.includes(productClean);
    const titleIsValid = titleHasBrand && titleHasProduct;

    const h1sHaveBrand = h1sClean.some(h => h.includes(brandClean));
    const h1sHaveProduct = h1sClean.some(h => h.includes(productClean));
    const h1sAreValid = h1sClean.some(h => h.includes(brandClean) && h.includes(productClean));

    const isValid = titleIsValid || h1sAreValid || (
      (titleHasBrand || h1sHaveBrand) && (titleHasProduct || h1sHaveProduct)
    );

    if (!isValid) {
      console.log(`[PageScraper] Page validation failed in raw HTML for ${pageUrl}. Title: "${pageTitle}", H1s: [${h1Texts.join(", ")}].`);
      return null;
    }

    const origin = new URL(pageUrl).origin;
    const metaImages = extractMetaImages(htmlContent);
    const jsonLdImages = extractJsonLdImages(htmlContent);
    const pdfLinks = extractPdfLinks(htmlContent, pageUrl);

    let imageUrls = [...metaImages, ...jsonLdImages];
    // Resolve relative URLs to absolute
    imageUrls = imageUrls
      .map((imgUrl) => {
        if (!imgUrl) return "";
        try {
          return new URL(imgUrl, origin).toString();
        } catch {
          return imgUrl;
        }
      })
      .filter((imgUrl) => imgUrl.startsWith("http"));

    imageUrls = Array.from(new Set(imageUrls));

    if (manufacturerDomain) {
      imageUrls = imageUrls.filter((imgUrl) =>
        isManufacturerDomain(imgUrl, manufacturerDomain)
      );
    }

    let datasheetUrls = pdfLinks
      .map((pdfUrl) => {
        if (!pdfUrl) return "";
        try {
          return new URL(pdfUrl, origin).toString();
        } catch {
          return pdfUrl;
        }
      })
      .filter((pdfUrl) => pdfUrl.startsWith("http"));

    datasheetUrls = Array.from(new Set(datasheetUrls));

    return {
      imageUrls,
      datasheetUrls,
      pageHtml: htmlContent
    };
  };

  let targetUrl = url;

  // --- METHOD A: HEAD Request (to resolve redirects fast) ---
  try {
    console.log(`[PageScraper] Method A: Sending HEAD request to check redirects...`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const headRes = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": userAgent },
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (headRes.url && headRes.url !== url) {
      console.log(`[PageScraper] Resolved redirect via HEAD: ${url} -> ${headRes.url}`);
      targetUrl = headRes.url;
      // Re-verify the resolved URL is still a valid PDP
      if (!isProductDetailPage(targetUrl, brand, productName)) {
        console.log(`[PageScraper] Resolved redirect URL ${targetUrl} is not a valid PDP. REJECTED.`);
        return details;
      }
    }
  } catch (err: any) {
    console.log(`[PageScraper] Method A (HEAD Request) failed or timed out: ${err.message || err}`);
  }

  // --- METHOD B: HTTP Fetch (GET HTML) ---
  try {
    console.log(`[PageScraper] Method B: Attempting direct HTTP Fetch GET...`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const fetchRes = await fetch(targetUrl, {
      headers: { "User-Agent": userAgent },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (fetchRes.ok) {
      const htmlContent = await fetchRes.text();
      const result = processRawHtml(htmlContent, targetUrl);
      if (result && result.imageUrls.length > 0) {
        console.log(`[PageScraper] Scraped successfully via Method B (HTTP Fetch). Found ${result.imageUrls.length} image(s).`);
        return result;
      }
      console.log(`[PageScraper] Method B fetch succeeded, but did not yield product images. Trying Method C.`);
    } else {
      console.log(`[PageScraper] Method B HTTP Fetch returned status ${fetchRes.status}. Trying Method C.`);
    }
  } catch (err: any) {
    console.log(`[PageScraper] Method B HTTP Fetch failed: ${err.message || err}. Trying Method C.`);
  }

  // --- METHOD C: Axios (GET HTML) ---
  try {
    console.log(`[PageScraper] Method C: Attempting Axios GET...`);
    const axios = require("axios");
    const axiosRes = await axios.get(targetUrl, {
      headers: {
        "User-Agent": userAgent,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5"
      },
      timeout: 10000,
      validateStatus: () => true
    });

    if (axiosRes.status === 200 && axiosRes.data) {
      const htmlContent = typeof axiosRes.data === "string" ? axiosRes.data : JSON.stringify(axiosRes.data);
      const result = processRawHtml(htmlContent, targetUrl);
      if (result && result.imageUrls.length > 0) {
        console.log(`[PageScraper] Scraped successfully via Method C (Axios). Found ${result.imageUrls.length} image(s).`);
        return result;
      }
      console.log(`[PageScraper] Method C Axios succeeded, but did not yield product images. Falling back to Method D (Playwright).`);
    } else {
      console.log(`[PageScraper] Method C Axios returned status ${axiosRes.status}. Falling back to Method D (Playwright).`);
    }
  } catch (err: any) {
    console.log(`[PageScraper] Method C Axios failed: ${err.message || err}. Falling back to Method D (Playwright).`);
  }

  // --- METHOD D: Playwright Fallback (Rendered Javascript) ---
  console.log(`[PageScraper] Method D: Spawning Playwright browser for JS rendering...`);
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"]
  });

  try {
    const context = await browser.newContext({
      userAgent: userAgent,
    });
    const page = await context.newPage();
    await gotoWithRetry(page, targetUrl, timeoutMs);

    // Allow brief hydration time for JS-rendered pages
    await page.waitForTimeout(1000);

    const pageTitle = await page.title();
    const h1Texts = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("h1")).map(h => (h.textContent || "").trim());
    });

    const titleClean = cleanString(pageTitle);
    const h1sClean = h1Texts.map(h => cleanString(h));
    const brandClean = cleanString(brand);
    const productClean = cleanString(productName);

    const titleHasBrand = titleClean.includes(brandClean);
    const titleHasProduct = titleClean.includes(productClean);
    const titleIsValid = titleHasBrand && titleHasProduct;

    const h1sHaveBrand = h1sClean.some(h => h.includes(brandClean));
    const h1sHaveProduct = h1sClean.some(h => h.includes(productClean));
    const h1sAreValid = h1sClean.some(h => h.includes(brandClean) && h.includes(productClean));

    const isValid = titleIsValid || h1sAreValid || (
      (titleHasBrand || h1sHaveBrand) && (titleHasProduct || h1sHaveProduct)
    );

    if (!isValid) {
      console.log(`[PageScraper] Page validation failed for ${targetUrl} via Playwright. Title: "${pageTitle}", H1s: [${h1Texts.join(", ")}]. REJECTED.`);
      await browser.close();
      return details;
    }

    const pageUrl = page.url();
    const origin = new URL(pageUrl).origin;

    details.pageHtml = await page.content();

    // Extract images via DOM evaluate
    const metaImages = await page.evaluate(() => {
      const images: string[] = [];
      const ogImg = document.querySelector('meta[property="og:image"]');
      if (ogImg) {
        const content = ogImg.getAttribute("content");
        if (content) images.push(content.trim());
      }
      const twitterImg = document.querySelector('meta[name="twitter:image"]');
      if (twitterImg) {
        const content = twitterImg.getAttribute("content");
        if (content) images.push(content.trim());
      }
      return images;
    });
    details.imageUrls.push(...metaImages);

    const jsonLdImages = await page.evaluate(() => {
      const images: string[] = [];
      const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      scripts.forEach((script) => {
        try {
          const json = JSON.parse(script.textContent || "");
          function findImagesInObj(obj: any) {
            if (!obj || typeof obj !== "object") return;
            if (obj["@type"] === "Product" || obj["@type"] === "http://schema.org/Product") {
              if (obj.image) {
                if (Array.isArray(obj.image)) {
                  obj.image.forEach((img: any) => {
                    if (typeof img === "string") images.push(img.trim());
                    else if (img && typeof img === "object" && img.url) images.push(String(img.url).trim());
                  });
                } else if (typeof obj.image === "string") {
                  images.push(obj.image.trim());
                } else if (obj.image && typeof obj.image === "object" && obj.image.url) {
                  images.push(String(obj.image.url).trim());
                }
              }
            }
            Object.keys(obj).forEach((k) => findImagesInObj(obj[k]));
          }
          findImagesInObj(json);
        } catch {}
      });
      return images;
    });
    details.imageUrls.push(...jsonLdImages);

    // Dom gallery selectors matching
    const domImages = await page.evaluate(() => {
      const imgs: string[] = [];
      const selectorPatterns = [
        "img[src*='product']",
        "img[src*='hero']",
        "img[src*='gallery']",
        ".product-image img",
        ".product-gallery img",
        ".gallery img",
        "main img",
        "#content img",
        "article img"
      ];
      const elements = new Set<HTMLImageElement>();
      selectorPatterns.forEach((pattern) => {
        try {
          const matched = document.querySelectorAll(pattern);
          matched.forEach((el) => {
            if (el instanceof HTMLImageElement) elements.add(el);
          });
        } catch {}
      });
      if (elements.size === 0) {
        document.querySelectorAll("img").forEach((el) => elements.add(el));
      }
      elements.forEach((img) => {
        const src = img.getAttribute("src") || img.getAttribute("data-src") || img.getAttribute("data-original");
        if (!src) return;
        const lowerSrc = src.toLowerCase();
        if (
          lowerSrc.includes("logo") || lowerSrc.includes("icon") ||
          lowerSrc.includes("social") || lowerSrc.includes("avatar") ||
          lowerSrc.includes("banner") || lowerSrc.includes("sprite")
        ) return;
        const width = img.naturalWidth || img.width || 0;
        const height = img.naturalHeight || img.height || 0;
        if (width > 0 && width < 100) return;
        if (height > 0 && height < 100) return;
        imgs.push(src.trim());
      });
      return imgs;
    });
    details.imageUrls.push(...domImages);

    // Resolve relative and filter
    details.imageUrls = details.imageUrls
      .map((imgUrl) => {
        if (!imgUrl) return "";
        try {
          return new URL(imgUrl, origin).toString();
        } catch {
          return imgUrl;
        }
      })
      .filter((imgUrl) => imgUrl.startsWith("http"));
    details.imageUrls = Array.from(new Set(details.imageUrls));

    if (manufacturerDomain) {
      details.imageUrls = details.imageUrls.filter((imgUrl) =>
        isManufacturerDomain(imgUrl, manufacturerDomain)
      );
    }

    // Datasheets
    const pdfLinks = await page.evaluate(() => {
      const pdfs: string[] = [];
      const anchors = Array.from(document.querySelectorAll("a"));
      anchors.forEach((a) => {
        const href = a.getAttribute("href");
        if (!href) return;
        const lowerHref = href.toLowerCase();
        const text = (a.textContent || "").toLowerCase().trim();
        const isPdf = lowerHref.endsWith(".pdf") || lowerHref.includes("pdf=true") || lowerHref.includes("/download/");
        const hasKeyword = /datasheet|spec|manual|brochure|specifications|resource|download/i.test(text) ||
                            /datasheet|spec|manual|specifications/i.test(lowerHref);
        if (isPdf || (hasKeyword && lowerHref.includes(".pdf"))) {
          pdfs.push(href.trim());
        }
      });
      return pdfs;
    });

    details.datasheetUrls = pdfLinks
      .map((pdfUrl) => {
        if (!pdfUrl) return "";
        try {
          return new URL(pdfUrl, origin).toString();
        } catch {
          return pdfUrl;
        }
      })
      .filter((pdfUrl) => pdfUrl.startsWith("http"));
    details.datasheetUrls = Array.from(new Set(details.datasheetUrls));

    console.log(`[PageScraper] Final Playwright results: ${details.imageUrls.length} validated images, ${details.datasheetUrls.length} datasheets`);
  } catch (err: any) {
    console.error(`[PageScraper] Method D Playwright failed:`, err.message || err);
  } finally {
    await browser.close();
  }

  return details;
}
