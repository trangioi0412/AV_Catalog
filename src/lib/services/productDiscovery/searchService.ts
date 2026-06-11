import { chromium } from "playwright";
import { GoogleGenAI } from "@google/genai";
import { SEARCH_PROVIDER, ENABLE_GEMINI } from "./config";
import { 
  getOfficialDomain, 
  getProductFuzzyVariants, 
  isProductDetailPage, 
  isManufacturerDomain, 
  slugify,
  validateManufacturerDomain,
  validateProductDetailPage
} from "./brandDomainService";

export interface SearchResult {
  title: string;
  url: string;
  provider?: string;
}

export class SearchTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchTimeoutError";
  }
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0"
];

// Initialize the Google Gen AI client
const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

/**
 * Global queue system to control search concurrency.
 */
export class ConcurrencyQueue {
  public activeCount = 0;
  private queue: (() => void)[] = [];
  private concurrencyLimit: number;

  constructor(limit = 3) {
    this.concurrencyLimit = limit;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.activeCount >= this.concurrencyLimit) {
      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
    }

    this.activeCount++;
    try {
      return await fn();
    } finally {
      this.activeCount--;
      const next = this.queue.shift();
      if (next) {
        next();
      }
    }
  }
}

/**
 * Audit metrics tracker for search performance and rate limiting.
 */
export class SearchMetrics {
  private requestTimestamps: number[] = [];
  public successfulSearches = 0;
  public rateLimitedSearches = 0;
  public retryCount = 0;
  public providerRateLimits: Record<string, number> = {
    "Gemini": 0,
    "DuckDuckGo": 0,
    "Extron Search": 0,
    "Other": 0
  };

  public recordRequest() {
    this.requestTimestamps.push(Date.now());
  }

  public getRequestsPerMinute(): number {
    const oneMinuteAgo = Date.now() - 60000;
    this.requestTimestamps = this.requestTimestamps.filter((t) => t >= oneMinuteAgo);
    return this.requestTimestamps.length;
  }

  public recordRateLimit(provider: string) {
    this.rateLimitedSearches++;
    this.providerRateLimits[provider] = (this.providerRateLimits[provider] || 0) + 1;
  }

  public printMetrics() {
    console.log("=== PRODUCT DISCOVERY RATE LIMIT AUDIT REPORT ===");
    console.log(`Requests Per Minute (RPM): ${this.getRequestsPerMinute()}`);
    console.log(`Successful Searches:      ${this.successfulSearches}`);
    console.log(`Rate Limited Searches:    ${this.rateLimitedSearches}`);
    console.log(`Retry Count:              ${this.retryCount}`);
    console.log(`Provider Rate Limits:`);
    console.log(`  - Gemini:               ${this.providerRateLimits["Gemini"] || 0}`);
    console.log(`  - DuckDuckGo:           ${this.providerRateLimits["DuckDuckGo"] || 0}`);
    console.log(`  - Extron Search:        ${this.providerRateLimits["Extron Search"] || 0}`);
    console.log(`  - Other:                ${this.providerRateLimits["Other"] || 0}`);
    console.log("=================================================");
  }
}

export const metrics = new SearchMetrics();
export const searchConcurrencyQueue = new ConcurrencyQueue(3);

export function isRateLimitError(err: any): boolean {
  if (!err) return false;
  const errMsg = (err.message || String(err)).toLowerCase();
  const status = err.status || (err.response && err.response.status);
  return (
    status === 429 ||
    errMsg.includes("429") ||
    errMsg.includes("rate limit") ||
    errMsg.includes("quota") ||
    errMsg.includes("resource_exhausted") ||
    errMsg.includes("resource exhausted")
  );
}

export function mapProviderForReport(providerName: string, brand?: string): string {
  const pUpper = providerName.toUpperCase();
  if (pUpper.includes("GEMINI")) {
    return "Gemini";
  }
  if (pUpper.includes("DUCKDUCKGO")) {
    return "DuckDuckGo";
  }
  if (brand && brand.toLowerCase() === "extron" && (pUpper.includes("MANUFACTURER") || pUpper.includes("EXTRON"))) {
    return "Extron Search";
  }
  return "Other";
}

/**
 * Generic retry wrapper with exponential backoff on rate limits.
 */
export async function executeWithRetry<T>(
  providerName: string,
  brand: string | undefined,
  fn: () => Promise<T>
): Promise<T> {
  const maxAttempts = 4; // 1 initial + 3 retries
  let delay = 2000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      if (isRateLimitError(err)) {
        const reportProvider = mapProviderForReport(providerName, brand);
        metrics.recordRateLimit(reportProvider);
        
        if (attempt < maxAttempts) {
          metrics.retryCount++;
          console.warn(`[SearchService] Rate limited by ${providerName} (${reportProvider}). Attempt ${attempt}/${maxAttempts} failed. Waiting ${delay}ms before retry...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2; // exponential backoff: 2s -> 4s -> 8s
        } else {
          console.error(`[SearchService] Rate limited by ${providerName} (${reportProvider}). Max attempts (${maxAttempts}) reached.`);
          throw err;
        }
      } else {
        throw err;
      }
    }
  }
  throw new Error("Unreachable");
}

/**
 * Navigates to a URL and retries automatically on aborts or timeouts.
 */
async function gotoWithRetry(page: any, url: string, timeout = 15000, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout });
      if (response && response.status() === 429) {
        throw new Error(`Playwright Search Rate Limit (status 429) on ${url}`);
      }
      return;
    } catch (err: any) {
      if (err.message && err.message.includes("429")) {
        throw err; // bubble up rate limit immediately
      }
      if (attempt === maxRetries) {
        throw err;
      }
      const backoff = attempt * 2000 + Math.floor(Math.random() * 1500);
      console.warn(`[SearchService] Navigation failed, retrying in ${backoff}ms (Attempt ${attempt}/${maxRetries}): ${err.message || err}`);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
}

function decodeBingUrl(urlStr: string): string {
  try {
    const urlObj = new URL(urlStr);
    const u = urlObj.searchParams.get("u");
    if (u) {
      const index = u.indexOf("aHR0c");
      if (index !== -1) {
        const base64 = u.slice(index);
        const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, "=");
        return Buffer.from(padded, "base64").toString("utf8");
      }
    }
  } catch (e) {}
  return urlStr;
}

async function resolveGroundingUrl(url: string): Promise<string> {
  if (url.includes("grounding-api-redirect") || url.includes("vertexaisearch.cloud.google.com")) {
    try {
      const res = await fetch(url, { method: "HEAD", redirect: "manual" });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (location) {
          console.log(`[SearchService] Resolved grounding redirect: ${url} -> ${location}`);
          return location;
        }
      }
    } catch (err) {
      console.warn(`[SearchService] Failed to resolve grounding redirect ${url}:`, err);
    }
  }
  return url;
}

/**
 * Known Product URL Patterns Check (Manufacturer-first Stage A)
 */
async function findKnownUrlPatterns(brand: string, productName: string, officialDomain: string): Promise<SearchResult[]> {
  const domains = officialDomain.split(",").map(d => d.trim().toLowerCase());
  const primaryDomain = domains[0]; // Focus on primary domain to minimize requests
  const fuzzyVariants = getProductFuzzyVariants(productName);
  
  const urlsToCheck: string[] = [];
  for (const variant of fuzzyVariants) {
    const slug = slugify(variant);
    const cleaned = variant.toLowerCase().replace(/[^a-z0-9]/g, "");
    
    // Only try the most common product detail path patterns:
    const paths = Array.from(new Set([
      `/product/${slug}`,
      `/product/${cleaned}`,
      `/products/${slug}`,
      `/products/${cleaned}`
    ]));
    
    for (const p of paths) {
      if (primaryDomain.startsWith("www.")) {
        urlsToCheck.push(`https://${primaryDomain}${p}`);
      } else {
        urlsToCheck.push(`https://www.${primaryDomain}${p}`);
        urlsToCheck.push(`https://${primaryDomain}${p}`);
      }
    }
  }
  
  const uniqueUrls = Array.from(new Set(urlsToCheck));
  console.log(`[SearchService] findKnownUrlPatterns checking ${uniqueUrls.length} candidate URLs for ${brand} ${productName}...`);
  const results: SearchResult[] = [];
  
  for (const url of uniqueUrls) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
      
      const res = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      
      if (res.status === 429) {
        throw new Error(`Manufacturer Site Rate Limit (429) for ${url}`);
      }
      
      if (res.status === 200) {
        const pdpCheck = validateProductDetailPage(url, brand, productName);
        if (pdpCheck.isValid) {
          console.log(`[SearchService] Predictable URL matched and validated: ${url}`);
          results.push({ 
            title: `${brand} ${productName} Official Product Page`, 
            url,
            provider: "MANUFACTURER_SITE"
          });
          break; // Stop on first match
        } else {
          console.log(`[SearchService] Validation rejected predictable URL '${url}': ${pdpCheck.reason}`);
        }
      } else {
        console.log(`[SearchService] Predictable URL check ${url} returned status: ${res.status}`);
      }
    } catch (err: any) {
      console.log(`[SearchService] Predictable URL check failed for ${url}: ${err.message || err}`);
      if (err.message && err.message.includes("429")) {
        throw err;
      }
    }
    // Add small delay to avoid rate limit
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  
  return results;
}

/**
 * Manufacturer Website Search via HTTP GET (Manufacturer-first Stage B)
 */
async function searchManufacturerSite(brand: string, productName: string, officialDomain: string): Promise<SearchResult[]> {
  const domains = officialDomain.split(",").map(d => d.trim().toLowerCase());
  const primaryDomain = domains[0]; // Focus on primary domain
  const results: SearchResult[] = [];
  
  const searchUrls = [
    `https://www.${primaryDomain}/search?q=${encodeURIComponent(productName)}`,
    `https://www.${primaryDomain}/?s=${encodeURIComponent(productName)}`
  ];
  
  for (const searchUrl of searchUrls) {
    try {
      console.log(`[SearchService] Querying manufacturer search page: ${searchUrl}`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
      const res = await fetch(searchUrl, {
        headers: { "User-Agent": USER_AGENTS[0] },
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (res.status === 429) {
        throw new Error(`Manufacturer Site Search Rate Limit (429) for ${searchUrl}`);
      }
      if (res.status !== 200) {
        console.log(`[SearchService] Manufacturer search page returned non-200 status: ${res.status}`);
        continue;
      }
      
      const html = await res.text();
      const hrefRegex = /href="([^"]+)"/g;
      let match;
      const candidateUrls: string[] = [];
      let totalHrefFound = 0;
      let domainRejectedCount = 0;
      
      while ((match = hrefRegex.exec(html)) !== null) {
        totalHrefFound++;
        let link = match[1];
        if (link.startsWith("/")) {
          link = `https://www.${primaryDomain}${link}`;
        }
        if (link.startsWith("http")) {
          const domainCheck = validateManufacturerDomain(link, primaryDomain);
          if (domainCheck.isValid) {
            const pdpCheck = validateProductDetailPage(link, brand, productName);
            if (pdpCheck.isValid) {
              candidateUrls.push(link);
            } else {
              console.log(`[SearchService] Validation rejected manufacturer link '${link}': ${pdpCheck.reason}`);
            }
          } else {
            domainRejectedCount++;
          }
        }
      }
      
      console.log(`[SearchService] Extracted links: total=${totalHrefFound}, domainRejected=${domainRejectedCount}, candidatesMatchingPDP=${candidateUrls.length}`);
      
      if (candidateUrls.length === 0) {
        console.log(`[SearchService] Manufacturer search returned zero URLs for query "${searchUrl}"`);
        console.log(`[SearchService] Response status: ${res.status}`);
        console.log(`[SearchService] Raw HTML snippet:\n${html.slice(0, 1000)}\n...`);
        continue;
      }
      
      const uniqueCandidates = Array.from(new Set(candidateUrls)).slice(0, 5);
      console.log(`[SearchService] Verifying ${uniqueCandidates.length} unique candidates sequentially...`);
      
      const verifiedResults: SearchResult[] = [];
      for (const url of uniqueCandidates) {
        try {
          const checkController = new AbortController();
          const checkTimeout = setTimeout(() => checkController.abort(), 10000); // 10s
          const checkRes = await fetch(url, {
            method: "GET",
            headers: { "User-Agent": USER_AGENTS[0] },
            signal: checkController.signal
          });
          clearTimeout(checkTimeout);
          if (checkRes.status === 429) {
            throw new Error(`Manufacturer Site Search candidate Rate Limit (429) for ${url}`);
          }
          if (checkRes.status === 200) {
            console.log(`[SearchService] Candidate verified (200 OK): ${url}`);
            verifiedResults.push({ 
              title: `${brand} ${productName} Product Page`, 
              url,
              provider: "MANUFACTURER_SITE"
            });
          } else {
            console.log(`[SearchService] Candidate verification returned non-200 status ${checkRes.status} for ${url}`);
          }
        } catch (err: any) {
          console.log(`[SearchService] Candidate verification failed for ${url}: ${err.message || err}`);
          if (err.message && err.message.includes("429")) {
            throw err;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      
      for (const r of verifiedResults) {
        results.push(r);
      }
      
      if (results.length > 0) return results;
    } catch (err: any) {
      if (err.message && err.message.includes("429")) {
        throw err;
      }
      console.warn(`[SearchService] Site search failed for ${searchUrl}:`, err.message || err);
    }
  }
  return results;
}

/**
 * Direct HTTP search engine query on DuckDuckGo (HTTP Search fallback)
 */
async function httpSearchDuckDuckGo(query: string): Promise<SearchResult[]> {
  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  
  try {
    const res = await fetch(ddgUrl, {
      headers: {
        "User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5"
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    if (res.status === 403 || res.status === 429) {
      throw new Error(`DuckDuckGo HTTP Search Rate Limit/Blocked (status ${res.status})`);
    }
    if (res.status !== 200) {
      throw new Error(`DuckDuckGo HTTP Search status error: ${res.status}`);
    }
    
    const html = await res.text();
    const results: SearchResult[] = [];
    const linkRegex = /<a\s+class="result__a"\s+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      let rawUrl = match[1];
      let title = match[2].replace(/<[^>]*>/g, "").trim();
      
      if (rawUrl.includes("uddg=")) {
        try {
          const urlObj = new URL(rawUrl.startsWith("http") ? rawUrl : `https:${rawUrl}`);
          const uddg = urlObj.searchParams.get("uddg");
          if (uddg) rawUrl = uddg;
        } catch {}
      }
      if (rawUrl.startsWith("//")) {
        rawUrl = "https:" + rawUrl;
      }
      if (rawUrl.startsWith("http")) {
        results.push({ 
          title, 
          url: rawUrl,
          provider: "DUCKDUCKGO_HTTP"
        });
      }
    }
    return results;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === "AbortError" || err.message?.toLowerCase().includes("timeout") || err.message?.toLowerCase().includes("timed out")) {
      throw new SearchTimeoutError("DuckDuckGo HTTP Search timed out");
    }
    throw err;
  }
}

/**
 * Playwright-based Bing and DuckDuckGo Crawl (Absolute Last Resort Fallback)
 */
async function playwrightSearch(query: string): Promise<SearchResult[]> {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"]
    });

    const randomUserAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    const context = await browser.newContext({
      userAgent: randomUserAgent,
      viewport: { width: 1280, height: 720 },
      locale: "en-US",
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
        "Upgrade-Insecure-Requests": "1"
      }
    });
    const page = await context.newPage();
    const results: SearchResult[] = [];

    // --- TRY BING SEARCH ---
    const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
    try {
      await gotoWithRetry(page, bingUrl, 10000);
      const bingRawLinks = await page.evaluate(() => {
        const items: { title: string; href: string }[] = [];
        const headerLinks = Array.from(document.querySelectorAll("li.b_algo h2 a, .b_algo h2 a"));
        headerLinks.forEach((a) => {
          const href = a.getAttribute("href") || "";
          const title = (a.textContent || "").trim();
          if (href && title) {
            items.push({ title, href });
          }
        });
        return items;
      });

      for (const link of bingRawLinks) {
        let resolvedUrl = link.href;
        if (resolvedUrl.startsWith("http")) {
          results.push({ 
            title: link.title, 
            url: resolvedUrl,
            provider: "BING_PLAYWRIGHT"
          });
        }
      }
    } catch (bingErr) {
      console.warn(`[SearchService] Playwright Bing search failed:`, bingErr);
    }

    // --- TRY DUCKDUCKGO HTML ---
    if (results.length === 0) {
      const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      try {
        await gotoWithRetry(page, ddgUrl, 12000);
        const ddgRawLinks = await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll(".result__a"));
          return links.map((a) => ({
            title: (a.textContent || "").trim(),
            href: a.getAttribute("href") || "",
          }));
        });

        for (const link of ddgRawLinks) {
          if (!link.href) continue;
          let resolvedUrl = link.href;
          if (resolvedUrl.includes("uddg=")) {
            try {
              const urlObj = new URL(resolvedUrl.startsWith("http") ? resolvedUrl : `https:${resolvedUrl}`);
              const uddg = urlObj.searchParams.get("uddg");
              if (uddg) resolvedUrl = uddg;
            } catch {}
          }
          if (resolvedUrl.startsWith("http")) {
            results.push({ 
              title: link.title, 
              url: resolvedUrl,
              provider: "DUCKDUCKGO_PLAYWRIGHT"
            });
          }
        }
      } catch (ddgErr: any) {
        if (ddgErr.name === "TimeoutError" || ddgErr.message?.toLowerCase().includes("timeout") || ddgErr.message?.toLowerCase().includes("timed out")) {
          throw new SearchTimeoutError("DuckDuckGo Playwright search timed out");
        }
        throw ddgErr;
      }
    }

    return results;
  } catch (err: any) {
    if (err instanceof SearchTimeoutError) throw err;
    throw err;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Internal search implementation containing sequential search stages.
 */
async function executeSearchInternal(
  query: string,
  rateLimitMs = 2000,
  allowGeminiFallback = true,
  forceGemini = false,
  variants?: string[],
  brand?: string,
  productName?: string
): Promise<SearchResult[]> {
  // Jitter
  const jitterDelay = rateLimitMs + Math.floor(Math.random() * 2000);
  if (jitterDelay > 0) {
    await new Promise((resolve) => setTimeout(resolve, jitterDelay));
  }

  const results: SearchResult[] = [];

  // --- STAGE 0: AI MODE (Gemini Search Grounding) ---
  if (SEARCH_PROVIDER === "AI" || forceGemini) {
    if (!ENABLE_GEMINI) {
      console.warn("[SearchService] AI Mode requested but ENABLE_GEMINI is false. Falling back to crawl provider.");
    } else if (ai && allowGeminiFallback) {
      console.log(`[SearchService] SEARCH_PROVIDER: AI_GEMINI`);
      try {
        let prompt = `Find the official manufacturer product detail page URL and title for the query: "${query}". 
 
Return the results ONLY as a JSON array of objects, with each object having "title" and "url" fields. Do not include any other conversational text or explanation.
Example structure:
[
  {"title": "Product Title", "url": "https://example.com/product"}
]`;
        if (variants && variants.length > 0) {
          prompt += `\nNote: You can also search for and match any of these product name variants: ${variants.map(v => `"${v}"`).join(", ")}`;
        }
        const response = await executeWithRetry("AI_GEMINI", brand, async () => {
          return await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
              tools: [{ googleSearch: {} }]
            }
          });
        });

        let text = response.text;
        if (text) {
          text = text.trim();
          if (text.startsWith("```")) {
            text = text.replace(/^```(?:json)?\s*/i, "");
            text = text.replace(/\s*```$/, "");
          }
          text = text.trim();

          const aiResults = JSON.parse(text);
          if (Array.isArray(aiResults)) {
            console.log(`[SearchService] Gemini Search Grounding found ${aiResults.length} result(s).`);
            for (const r of aiResults) {
              if (r.url && r.url.startsWith("http")) {
                const resolvedUrl = await resolveGroundingUrl(r.url);
                results.push({
                  title: r.title || "Official Product Page (AI)",
                  url: resolvedUrl,
                  provider: "AI_GEMINI"
                });
              }
            }
          }
        }
      } catch (geminiErr: any) {
        console.warn(`[SearchService] Gemini Search Grounding failed:`, geminiErr);
        geminiErr.provider = "AI_GEMINI";
        throw geminiErr;
      }
      console.log(`[SearchService] Search query completed. Found ${results.length} total results.`);
      return results;
    }
  }

  // --- STAGE 1: MANUFACTURER FIRST STRATEGY ---
  if (brand && productName) {
    const officialDomain = getOfficialDomain(brand);
    if (officialDomain) {
      console.log(`[SearchService] SEARCH_PROVIDER: MANUFACTURER_SITE (Brand: ${brand})`);
      
      // Stage 1A: Known Predictable URL Patterns
      try {
        const patterns = await executeWithRetry("MANUFACTURER_SITE", brand, () =>
          findKnownUrlPatterns(brand, productName, officialDomain)
        );
        if (patterns.length > 0) {
          console.log(`[SearchService] Manufacturer match found via Known Patterns:`, patterns);
          return patterns;
        }
      } catch (err: any) {
        console.warn(`[SearchService] Known patterns check failed:`, err);
        if (isRateLimitError(err)) {
          err.provider = "MANUFACTURER_SITE";
          throw err;
        }
      }

      // Stage 1B: Manufacturer search endpoint crawling via HTTP GET
      try {
        const siteResults = await executeWithRetry("MANUFACTURER_SITE", brand, () =>
          searchManufacturerSite(brand, productName, officialDomain)
        );
        if (siteResults.length > 0) {
          console.log(`[SearchService] Manufacturer match found via Website Search:`, siteResults);
          return siteResults;
        }
      } catch (err: any) {
        console.warn(`[SearchService] Website search failed:`, err.message || err);
        if (isRateLimitError(err)) {
          err.provider = "MANUFACTURER_SITE";
          throw err;
        }
      }
    }
  }

  // --- STAGE 2: HTTP SEARCH FALLBACK ---
  console.log(`[SearchService] SEARCH_PROVIDER: DUCKDUCKGO_HTTP`);
  let lastError: any = null;
  try {
    const httpResults = await executeWithRetry("DUCKDUCKGO_HTTP", brand, () => httpSearchDuckDuckGo(query));
    if (httpResults.length > 0) {
      return httpResults;
    }
  } catch (err: any) {
    console.warn(`[SearchService] HTTP search fallback failed:`, err.message || err);
    err.provider = "DUCKDUCKGO_HTTP";
    lastError = err;
  }

  // --- STAGE 3: PLAYWRIGHT FALLBACK ---
  console.log(`[SearchService] SEARCH_PROVIDER: PLAYWRIGHT_FALLBACK`);
  try {
    const pwResults = await executeWithRetry("DUCKDUCKGO_PLAYWRIGHT", brand, () => playwrightSearch(query));
    if (pwResults.length > 0) {
      return pwResults;
    }
  } catch (err: any) {
    console.error(`[SearchService] Playwright search failed:`, err.message || err);
    err.provider = "PLAYWRIGHT_FALLBACK";
    lastError = err;
  }

  // --- STAGE 4: GEMINI FALLBACK (If crawlers fail or return 0) ---
  if (ENABLE_GEMINI && ai && allowGeminiFallback) {
    console.log(`[SearchService] SEARCH_PROVIDER: AI_GEMINI (Fallback)`);
    try {
      let prompt = `Find the official manufacturer product detail page URL and title for the query: "${query}". 
 
Return the results ONLY as a JSON array of objects, with each object having "title" and "url" fields. Do not include any other conversational text or explanation.`;
      const response = await executeWithRetry("AI_GEMINI", brand, async () => {
        return await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: prompt,
          config: {
            tools: [{ googleSearch: {} }]
          }
        });
      });

      let text = response.text;
      if (text) {
        text = text.trim();
        if (text.startsWith("```")) {
          text = text.replace(/^```(?:json)?\s*/i, "");
          text = text.replace(/\s*```$/, "");
        }
        text = text.trim();
        const aiResults = JSON.parse(text);
        if (Array.isArray(aiResults)) {
          for (const r of aiResults) {
            if (r.url && r.url.startsWith("http")) {
              const resolvedUrl = await resolveGroundingUrl(r.url);
              results.push({
                title: r.title || "Official Product Page (AI)",
                url: resolvedUrl,
                provider: "AI_GEMINI"
              });
            }
          }
        }
      }
    } catch (geminiErr: any) {
      console.error(`[SearchService] Fallback Gemini Search Grounding failed:`, geminiErr);
      geminiErr.provider = "AI_GEMINI";
      lastError = geminiErr;
    }
  }

  // If no results and there was a timeout/error, throw it
  if (results.length === 0 && lastError) {
    throw lastError;
  }

  console.log(`[SearchService] Search query completed. Found ${results.length} total results.`);
  return results;
}

/**
 * Central orchestrator for search requests.
 */
export async function executeSearch(
  query: string,
  rateLimitMs = 2000,
  allowGeminiFallback = true,
  forceGemini = false,
  variants?: string[],
  brand?: string,
  productName?: string
): Promise<SearchResult[]> {
  return searchConcurrencyQueue.run(async () => {
    metrics.recordRequest();
    console.log(`[SearchService] executeSearch queue slot acquired: "${query}" (active searches count: ${searchConcurrencyQueue.activeCount})`);

    let isSuccess = false;
    try {
      const results = await executeSearchInternal(
        query,
        rateLimitMs,
        allowGeminiFallback,
        forceGemini,
        variants,
        brand,
        productName
      );
      isSuccess = true;
      metrics.successfulSearches++;
      return results;
    } finally {
      // Print metrics report dynamically on every search execution completion
      metrics.printMetrics();
    }
  });
}
