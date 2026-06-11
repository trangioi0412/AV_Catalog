import fs from "fs";
import path from "path";
import { 
  getOfficialDomain, 
  isManufacturerDomain, 
  isProductDetailPage, 
  slugify,
  validateManufacturerDomain,
  validateProductDetailPage,
  getProductFuzzyVariants,
  getProductSearchVariants
} from "./brandDomainService";
import { executeSearch, SearchResult } from "./searchService";
import { scrapeProductPage } from "./pageScraper";
import { rankCandidates, CandidateRecord } from "./rankingEngine";
import { logDiscoveryEntry, logDiscoveryStep } from "./loggingService";
import { SEARCH_PROVIDER, ENABLE_GEMINI, NEGATIVE_CACHE_TTL, POSITIVE_CACHE_TTL, CACHE_VERSION } from "./config";

const CACHE_FILE = path.join(process.cwd(), "logs", "search-cache.json");

function getSearchCache(): Record<string, DiscoveryOutput> {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const content = fs.readFileSync(CACHE_FILE, "utf8");
      return JSON.parse(content);
    }
  } catch (err) {
    console.error("[ProductDiscovery] Failed to read search cache:", err);
  }
  return {};
}

function saveSearchCache(cache: Record<string, DiscoveryOutput>) {
  try {
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf8");
  } catch (err) {
    console.error("[ProductDiscovery] Failed to write search cache:", err);
  }
}

export interface DiscoveryOutput {
  success?: boolean;
  productName: string;
  brand: string;
  productUrl: string;
  imageUrl: string;
  datasheetUrl: string;
  source: string;
  confidenceScore: number;
  status: "FOUND_LOCAL_IMAGE" | "SUCCESS" | "PRODUCT_PAGE_NOT_FOUND" | "IMAGE_NOT_FOUND" | "FAILED" | "MISSING_BRAND" | "SEARCH_PROVIDER_TIMEOUT" | "SEARCH_PROVIDER_ERROR" | "RATE_LIMITED";
  reason?: string;
  timestamp?: string;
  logicVersion?: number;
  provider?: string;
  query?: string;
  errorType?: string;
}

// ─── Rule 7: Confidence threshold ────────────────────────────────────────
const CONFIDENCE_THRESHOLD = 80;

// slugify is now imported from brandDomainService

/**
 * Rule 1: Build diverse AV-context search queries for a product.
 * Multiple query strategies prevent the search engine from misinterpreting
 * ambiguous model codes (e.g. NAV → Net Asset Value).
 */
function buildSearchQueries(productName: string, brand: string, officialDomain: string | null): string[] {
  const queries: string[] = [];
  const searchVariants = getProductSearchVariants(productName);
  const raw = searchVariants[0];
  const cleaned = searchVariants[1] || raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  const hyphenated = searchVariants[2] || raw.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");

  if (officialDomain) {
    const primaryDomain = officialDomain.split(",")[0].trim();
    queries.push(`site:${primaryDomain} ${raw}`);
    queries.push(`site:${primaryDomain} "${raw}"`);
    queries.push(`${brand} ${raw} product`);
    queries.push(`${brand} ${raw} datasheet`);
    queries.push(`site:${primaryDomain} ${cleaned}`);
    queries.push(`site:${primaryDomain} ${hyphenated}`);
  } else {
    queries.push(`${brand} ${raw}`);
    queries.push(`${brand} "${raw}"`);
    queries.push(`${brand} ${raw} product`);
    queries.push(`${brand} ${raw} datasheet`);
    queries.push(`${brand} ${cleaned}`);
    queries.push(`${brand} ${hyphenated}`);
  }
  return queries;
}

/**
 * Rule 8: When brand is unknown/empty, fetch top 20 results from a generic
 * query, parse all domains, and return the most-common AV manufacturer domain.
 */
async function detectBrandFromResults(
  productName: string,
  rateLimitMs: number
): Promise<string> {
  const AV_MANUFACTURER_WHITELIST_DOMAINS: Record<string, string> = {
    "neat.no": "Neat", "neat.com": "Neat", "neatvideo.com": "Neat",
    "yamaha.com": "Yamaha", "yamahaaudio.com": "Yamaha",
    "denon.com": "Denon", "marantz.com": "Marantz",
    "harmankardon.com": "Harman Kardon", "jbl.com": "JBL", "jblpro.com": "JBL",
    "bose.com": "Bose",
    "sennheiser.com": "Sennheiser", "shure.com": "Shure",
    "qsc.com": "QSC", "crown.com": "Crown",
    "klipsch.com": "Klipsch", "polk.com": "Polk Audio",
    "svs.com": "SVS", "naim.com": "Naim", "naimaudio.com": "Naim",
    "linn.co.uk": "Linn",
    "dali.com": "DALI", "focal.com": "Focal",
    "monitor-audio.com": "Monitor Audio",
    "rega.co.uk": "Rega",
    "rotel.com": "Rotel", "cambridge-audio.com": "Cambridge Audio", "cambridgeaudio.com": "Cambridge Audio",
    "emotiva.com": "Emotiva",
    "parasound.com": "Parasound", "mcintoshlabs.com": "McIntosh",
    "aurender.com": "Aurender", "bryston.com": "Bryston",
    "pioneer.com": "Pioneer", "onkyo.com": "Onkyo",
    "sony.com": "Sony", "samsung.com": "Samsung", "lg.com": "LG", "panasonic.com": "Panasonic",
    "epson.com": "Epson", "benq.com": "BenQ", "optoma.com": "Optoma",
    "barco.com": "Barco", "christie.com": "Christie",
    "crestron.com": "Crestron", "extron.com": "Extron", "atlona.com": "Atlona",
    "biamp.com": "Biamp",
    "logitech.com": "Logitech", "poly.com": "Poly", "polycom.com": "Poly",
    "audeze.com": "Audeze", "beyerdynamic.com": "beyerdynamic", "akg.com": "AKG",
    "wiim.com": "WiiM", "bluesound.com": "Bluesound", "sonos.com": "Sonos",
  };

  console.log(`[ProductDiscovery] Brand unknown – detecting brand from search results for: ${productName}`);

  const fallbackQuery = `"${productName}" audio product specifications`;
  const results = await executeSearch(fallbackQuery, rateLimitMs);

  const domainCount: Record<string, number> = {};
  for (const r of results.slice(0, 20)) {
    try {
      const hostname = new URL(r.url).hostname.toLowerCase().replace(/^www\./, "");
      domainCount[hostname] = (domainCount[hostname] || 0) + 1;
    } catch { /* skip */ }
  }

  // Find the whitelisted domain with most appearances
  let bestDomain = "";
  let bestCount = 0;
  for (const [domain, count] of Object.entries(domainCount)) {
    const isWhitelisted = Object.keys(AV_MANUFACTURER_WHITELIST_DOMAINS).some(
      (d) => domain === d || domain.endsWith("." + d)
    );
    if (isWhitelisted && count > bestCount) {
      bestCount = count;
      bestDomain = domain;
    }
  }

  if (bestDomain) {
    // Find corresponding brand name
    for (const [d, brandName] of Object.entries(AV_MANUFACTURER_WHITELIST_DOMAINS)) {
      if (bestDomain === d || bestDomain.endsWith("." + d)) {
        console.log(`[ProductDiscovery] Detected brand: ${brandName} from domain: ${bestDomain}`);
        return brandName;
      }
    }
  }

  return "";
}

/**
 * Performs local image check, brand query search, page scraping, and candidates scoring.
 * Downloads the winning product images into /public/product_image/[brandName]/ folder.
 *
 * Rules applied:
 *  1. Diverse search queries (brand + AV context)
 *  2. Official domain priority
 *  3. Blacklist domains (in rankingEngine)
 *  4. AV intent scoring (in rankingEngine)
 *  5. AV manufacturer whitelist (in rankingEngine)
 *  6. Model pattern detection (in rankingEngine)
 *  7. Confidence score > CONFIDENCE_THRESHOLD required
 *  8. If brand empty: detect from top 20 results
 */
export async function discoverProductInfo(
  productNameOrObj: string | { name?: string; productName?: string; brand?: string; brandName?: string },
  brandOrOptions?: string | { bypassCache?: boolean; rateLimitMs?: number },
  rateLimitMsOrOptions?: number | { bypassCache?: boolean; rateLimitMs?: number },
  options?: { bypassCache?: boolean }
): Promise<DiscoveryOutput> {
  let resolvedProductName = "";
  let resolvedBrand = "";
  let resolvedRateLimitMs = 2000;
  let resolvedBypassCache = false;

  if (typeof productNameOrObj === "object" && productNameOrObj !== null) {
    resolvedProductName = productNameOrObj.productName || productNameOrObj.name || "";
    const rawBrand = productNameOrObj.brand || productNameOrObj.brandName || "";
    if (typeof rawBrand === "object" && rawBrand !== null) {
      resolvedBrand = (rawBrand as any).name || (rawBrand as any).title || "";
    } else {
      resolvedBrand = String(rawBrand || "");
    }

    if (typeof brandOrOptions === "object" && brandOrOptions !== null) {
      resolvedBypassCache = !!brandOrOptions.bypassCache;
      if (typeof brandOrOptions.rateLimitMs === "number") {
        resolvedRateLimitMs = brandOrOptions.rateLimitMs;
      }
    }
  } else {
    resolvedProductName = productNameOrObj;
    if (typeof brandOrOptions === "string") {
      resolvedBrand = brandOrOptions;
      if (typeof rateLimitMsOrOptions === "number") {
        resolvedRateLimitMs = rateLimitMsOrOptions;
        resolvedBypassCache = !!(options && options.bypassCache);
      } else if (typeof rateLimitMsOrOptions === "object" && rateLimitMsOrOptions !== null) {
        resolvedBypassCache = !!rateLimitMsOrOptions.bypassCache;
        if (typeof rateLimitMsOrOptions.rateLimitMs === "number") {
          resolvedRateLimitMs = rateLimitMsOrOptions.rateLimitMs;
        }
      }
    } else if (typeof brandOrOptions === "object" && brandOrOptions !== null) {
      resolvedBypassCache = !!brandOrOptions.bypassCache;
      if (typeof brandOrOptions.rateLimitMs === "number") {
        resolvedRateLimitMs = brandOrOptions.rateLimitMs;
      }
    }
  }

  resolvedBrand = resolvedBrand.trim();
  resolvedProductName = resolvedProductName.trim();

  if (!resolvedBrand || resolvedBrand.toLowerCase() === "unknown") {
    return {
      success: false,
      productName: resolvedProductName,
      brand: resolvedBrand,
      productUrl: "",
      imageUrl: "",
      datasheetUrl: "",
      source: "NONE",
      confidenceScore: 0,
      status: "MISSING_BRAND"
    };
  }

  // ── STEP 0.5: CACHE LOOKUP ──────────────────────────────────────────────
  const cacheKey = `${resolvedBrand.toLowerCase().trim()}|${resolvedProductName.toLowerCase().trim()}`;
  const cache = getSearchCache();
  
  if (cache[cacheKey]) {
    const cached = cache[cacheKey];
    const isNegative = ["PRODUCT_PAGE_NOT_FOUND", "SEARCH_FAILED", "SCRAPE_FAILED", "IMAGE_NOT_FOUND", "FAILED", "MISSING_BRAND"].includes(cached.status);
    
    if (resolvedBypassCache) {
      logDiscoveryStep("CACHE_BYPASSED", resolvedProductName, resolvedBrand, 0, cached.status);
      console.log(`[ProductDiscovery] Cache bypassed (force refresh) for: ${resolvedBrand} - ${resolvedProductName}`);
    } else {
      const now = Date.now();
      const cacheAge = cached.timestamp ? (now - new Date(cached.timestamp).getTime()) : Infinity;
      const ttl = isNegative ? NEGATIVE_CACHE_TTL : POSITIVE_CACHE_TTL;
      const isExpired = cacheAge > ttl;
      const isOldVersion = isNegative && (!cached.logicVersion || cached.logicVersion < CACHE_VERSION);

      if (isExpired || isOldVersion) {
        const reason = isExpired ? "TTL_EXPIRED" : "OLD_VERSION";
        logDiscoveryStep("CACHE_EXPIRED", resolvedProductName, resolvedBrand, cacheAge, cached.status, reason);
        console.log(`[ProductDiscovery] Cache expired (${reason}, age: ${Math.round(cacheAge / 3600000)}h) for: ${resolvedBrand} - ${resolvedProductName}`);
      } else {
        // Cache is valid! Check type
        if (!isNegative) {
          // Positive cache hit
          // For positive cache, make sure local file exists if status is SUCCESS or FOUND_LOCAL_IMAGE
          let localFileExists = false;
          if (cached.imageUrl) {
            try {
              const decodedUrl = decodeURIComponent(cached.imageUrl);
              const localPath = path.join(process.cwd(), "public", decodedUrl);
              if (fs.existsSync(localPath)) {
                localFileExists = true;
              }
            } catch (err) {
              // ignore
            }
          }
          if (localFileExists || cached.status === "FOUND_LOCAL_IMAGE") {
            logDiscoveryStep("CACHE_HIT_POSITIVE", resolvedProductName, resolvedBrand, cacheAge, cached.status);
            console.log(`[ProductDiscovery] Cache hit (positive) for: ${resolvedBrand} - ${resolvedProductName}`);
            return cached;
          }
        } else {
          // Negative cache hit
          logDiscoveryStep("CACHE_HIT_NEGATIVE", resolvedProductName, resolvedBrand, cacheAge, cached.status);
          console.log(`[ProductDiscovery] Cache hit (negative status: ${cached.status}) for: ${resolvedBrand} - ${resolvedProductName}`);
          return cached;
        }
      }
    }
  }

  const output = await discoverProductInfoInternal(resolvedProductName, resolvedBrand, resolvedRateLimitMs);

  const TEMPORARY_FAILURES = ["FAILED", "SEARCH_PROVIDER_TIMEOUT", "SEARCH_PROVIDER_ERROR", "RATE_LIMITED"];
  const cacheWritten = !TEMPORARY_FAILURES.includes(output.status);
  if (cacheWritten) {
    const updatedCache = getSearchCache();
    updatedCache[cacheKey] = {
      ...output,
      timestamp: new Date().toISOString(),
      logicVersion: CACHE_VERSION
    };
    saveSearchCache(updatedCache);
  }

  // Print failure details for audit
  if (output.status !== "SUCCESS" && output.status !== "FOUND_LOCAL_IMAGE") {
    console.log("=== FAILURE FLOW AUDIT ===");
    console.log(JSON.stringify({
      product: output.productName,
      brand: output.brand,
      provider: output.provider || "NONE",
      query: output.query || "NONE",
      errorType: output.errorType || "None",
      finalStatus: output.status,
      cacheWritten: cacheWritten
    }, null, 2));
    console.log("==========================");
  }

  return output;
}

function determineErrorStatus(searchError: any, candidateCount: number): { status: "SEARCH_PROVIDER_TIMEOUT" | "RATE_LIMITED" | "SEARCH_PROVIDER_ERROR"; reason: string; errorType: string } {
  let status: "SEARCH_PROVIDER_TIMEOUT" | "RATE_LIMITED" | "SEARCH_PROVIDER_ERROR" = "SEARCH_PROVIDER_ERROR";
  let reason = "Search provider failure.";
  let errorType = "Search Provider Failure";

  if (searchError) {
    const errMsg = (searchError.message || String(searchError)).toLowerCase();
    const errName = searchError.name || "";

    if (
      errName === "SearchTimeoutError" || 
      errName === "TimeoutError" || 
      errName === "AbortError" || 
      errMsg.includes("timeout") || 
      errMsg.includes("timed out") || 
      (errMsg.includes("abort") && errMsg.includes("timeout")) ||
      errMsg.includes("duckduckgo timeout")
    ) {
      status = "SEARCH_PROVIDER_TIMEOUT";
      reason = `Search provider timed out: ${searchError.message || searchError}`;
      errorType = "TimeoutError";
    } else if (
      errMsg.includes("429") || 
      errMsg.includes("rate limit") || 
      errMsg.includes("quota") || 
      errMsg.includes("resource_exhausted") ||
      errMsg.includes("resource exhausted")
    ) {
      status = "RATE_LIMITED";
      reason = `Search provider rate limited: ${searchError.message || searchError}`;
      errorType = "429 Rate Limit";
    } else if (
      errMsg.includes("connection reset") || 
      errMsg.includes("err_connection_reset")
    ) {
      status = "SEARCH_PROVIDER_ERROR";
      reason = `Search provider connection reset: ${searchError.message || searchError}`;
      errorType = "ERR_CONNECTION_RESET";
    } else if (errMsg.includes("network error")) {
      status = "SEARCH_PROVIDER_ERROR";
      reason = `Search provider network error: ${searchError.message || searchError}`;
      errorType = "Network Error";
    } else if (errMsg.includes("dns")) {
      status = "SEARCH_PROVIDER_ERROR";
      reason = `Search provider DNS error: ${searchError.message || searchError}`;
      errorType = "DNS Error";
    } else if (errMsg.includes("ssl")) {
      status = "SEARCH_PROVIDER_ERROR";
      reason = `Search provider SSL error: ${searchError.message || searchError}`;
      errorType = "SSL Error";
    } else {
      status = "SEARCH_PROVIDER_ERROR";
      reason = `Search provider failure: ${searchError.message || searchError}`;
      errorType = "Search Provider Failure";
    }
  } else if (candidateCount === 0) {
    status = "SEARCH_PROVIDER_ERROR";
    reason = "Search provider returned zero candidate URLs.";
    errorType = "Search Provider Failure";
  }

  return { status, reason, errorType };
}

async function discoverProductInfoInternal(
  productName: string,
  brand: string,
  rateLimitMs = 2000
): Promise<DiscoveryOutput> {
  const slug = slugify(productName);
  const extensions = [".webp", ".jpg", ".jpeg", ".png"];

  // ── STEP 0: BRAND VALIDATION (Step 2) ──────────────────────────────────
  if (!brand || brand.trim() === "" || brand.toLowerCase() === "unknown") {
    return {
      success: false,
      productName,
      brand,
      productUrl: "",
      imageUrl: "",
      datasheetUrl: "",
      source: "NONE",
      confidenceScore: 0,
      status: "MISSING_BRAND",
      provider: "NONE",
      query: "NONE",
      errorType: "None"
    };
  }

  const resolvedBrand = brand.trim();

  // Cache Lookup is handled in the outer wrapper wrapper wrapper

  // ── STEP 1: LOCAL IMAGE SEARCH ──────────────────────────────────────────
  const checkPaths = [
    path.join(process.cwd(), "public", "product_images"),
    path.join(process.cwd(), "public", "product_image"),
    path.join(process.cwd(), "product_images"),
  ];

  for (const baseDir of checkPaths) {
    if (!fs.existsSync(baseDir)) continue;

    for (const ext of extensions) {
      const filePath = path.join(baseDir, `${slug}${ext}`);
      if (fs.existsSync(filePath)) {
        console.log(`[ProductDiscovery] Found local image: ${filePath}`);
        return {
          success: true,
          productName, brand: resolvedBrand, productUrl: "",
          imageUrl: `/product_images/${slug}${ext}`,
          datasheetUrl: "", source: "LOCAL_IMAGE",
          confidenceScore: 100, status: "FOUND_LOCAL_IMAGE"
        };
      }
    }

    // Check inside brand subfolder fallback
    const brandSubfolder = path.join(baseDir, resolvedBrand);
    if (fs.existsSync(brandSubfolder)) {
      for (const ext of extensions) {
        const filePath = path.join(brandSubfolder, `${slug}${ext}`);
        if (fs.existsSync(filePath)) {
          console.log(`[ProductDiscovery] Found local image in brand subfolder: ${filePath}`);
          return {
            success: true,
            productName, brand: resolvedBrand, productUrl: "",
            imageUrl: `/product_images/${resolvedBrand}/${slug}${ext}`,
            datasheetUrl: "", source: "LOCAL_IMAGE",
            confidenceScore: 100, status: "FOUND_LOCAL_IMAGE"
          };
        }
      }
    }
  }

  // ── STEP 3: BUILD BRAND SEARCH QUERIES & SEARCH ────────────────────────
  const officialDomain = getOfficialDomain(resolvedBrand);
  if (!officialDomain) {
    return {
      success: false,
      productName,
      brand: resolvedBrand,
      productUrl: "",
      imageUrl: "",
      datasheetUrl: "",
      source: "NONE",
      confidenceScore: 0,
      status: "MISSING_BRAND",
      reason: `Official domain not mapped for brand: ${resolvedBrand}`,
      provider: "NONE",
      query: "NONE",
      errorType: "None"
    };
  }

  const queries = buildSearchQueries(productName, resolvedBrand, officialDomain);

  let searchResults: SearchResult[] = [];
  let usedQuery = "";
  let activeProvider = "NONE";
  let activeQuery = "NONE";

  // ── AUDIT LOG TRACKING ──────────────────────────────────────────────────
  interface AuditLogItem {
    product: string;
    brand: string;
    candidateUrl: string;
    score: number;
    accepted: boolean;
    rejectReason: string;
  }

  const auditLogs: AuditLogItem[] = [];
  const checkedUrls = new Set<string>();

  const trackCandidates = (results: SearchResult[]) => {
    for (const r of results) {
      if (checkedUrls.has(r.url)) continue;
      checkedUrls.add(r.url);
      
      const domainCheck = validateManufacturerDomain(r.url, officialDomain);
      const pdpCheck = validateProductDetailPage(r.url, resolvedBrand, productName);
      
      const accepted = domainCheck.isValid && pdpCheck.isValid;
      let rejectReason = "";
      if (!domainCheck.isValid) {
        rejectReason = domainCheck.reason;
      } else if (!pdpCheck.isValid) {
        rejectReason = pdpCheck.reason;
      }
      
      auditLogs.push({
        product: productName,
        brand: resolvedBrand,
        candidateUrl: r.url,
        score: 0,
        accepted,
        rejectReason
      });
    }
  };

  const printAuditLog = () => {
    console.log("=== PRODUCT DISCOVERY AUDIT LOG ===");
    console.log(`1. Search query sent: ${usedQuery || queries.join(" | ")}`);
    console.log("2. All URLs returned and evaluated:");
    for (const item of auditLogs) {
      console.log(JSON.stringify(item, null, 2));
    }
    console.log(`5. Domain whitelist: ${officialDomain}`);
    console.log(`6. Product name variants (normalized): ${getProductFuzzyVariants(productName).join(", ")}`);
    console.log(`7. Validation criteria: requires manufacturer domain match and product name/slug detail page structure`);
    console.log("====================================");
  };

  // Structured Log: Search Start
  const searchStartTime = Date.now();
  logDiscoveryStep("SEARCH_STARTED", productName, resolvedBrand);

  let searchError: any = null;
  let hasSuccessfulQuery = false;

  if (SEARCH_PROVIDER === "AI") {
    const aiQuery = `${resolvedBrand} ${productName}`;
    console.log(`[ProductDiscovery] [AI Mode] Querying Gemini Search Grounding: "${aiQuery}"`);
    activeQuery = aiQuery;
    activeProvider = "AI_GEMINI";
    const searchVariants = getProductSearchVariants(productName);
    try {
      const results = await executeSearch(aiQuery, rateLimitMs, true, false, searchVariants, resolvedBrand, productName);
      trackCandidates(results);
      searchResults = results.filter(
        (r) => isManufacturerDomain(r.url, officialDomain) && isProductDetailPage(r.url, resolvedBrand, productName)
      );
      
      const rawResultsCount = results.length;
      const candidateCount = results.filter(r => isManufacturerDomain(r.url, officialDomain)).length;
      const validatedCount = searchResults.length;
      console.log("[StructuredLog] search-metrics:", JSON.stringify({
        provider: activeProvider,
        rawResultsCount,
        candidateCount,
        validatedCount
      }, null, 2));

      usedQuery = `Gemini: ${aiQuery}`;
      hasSuccessfulQuery = true;
    } catch (err: any) {
      searchError = err;
      if (err.provider) {
        activeProvider = err.provider;
      }
      console.error(`[ProductDiscovery] [AI Mode] Search failed:`, err);
      console.log("[StructuredLog] search-metrics:", JSON.stringify({
        provider: activeProvider,
        rawResultsCount: 0,
        candidateCount: 0,
        validatedCount: 0
      }, null, 2));
    }
  } else {
    const allSearchResults: SearchResult[] = [];
    for (const q of queries) {
      console.log(`[ProductDiscovery] Trying crawl query: ${q}`);
      activeQuery = q;
      activeProvider = "MANUFACTURER_SITE";
      try {
        const results = await executeSearch(q, rateLimitMs, false, false, undefined, resolvedBrand, productName);
        allSearchResults.push(...results);
        hasSuccessfulQuery = true;
        
        const foundValidPdp = results.some(r => isManufacturerDomain(r.url, officialDomain) && isProductDetailPage(r.url, resolvedBrand, productName));
        if (foundValidPdp) {
          console.log(`[ProductDiscovery] Found valid manufacturer PDP early, skipping remaining crawl queries.`);
          break;
        }
      } catch (err: any) {
        searchError = err;
        if (err.provider) {
          activeProvider = err.provider;
        }
        console.error(`[ProductDiscovery] Crawler failed on query "${q}":`, err.message || err);
        break;
      }
    }

    // Deduplicate search results by URL
    const uniqueResultsMap = new Map<string, SearchResult>();
    for (const r of allSearchResults) {
      uniqueResultsMap.set(r.url, r);
    }
    const uniqueResults = Array.from(uniqueResultsMap.values());
    trackCandidates(uniqueResults);

    searchResults = uniqueResults.filter(
      (r) => isManufacturerDomain(r.url, officialDomain) && isProductDetailPage(r.url, resolvedBrand, productName)
    );
    usedQuery = queries.join(" | ");

    const rawResultsCount = uniqueResults.length;
    const candidateCount = uniqueResults.filter(r => isManufacturerDomain(r.url, officialDomain)).length;
    const validatedCount = searchResults.length;
    
    console.log("[StructuredLog] search-metrics:", JSON.stringify({
      provider: activeProvider,
      rawResultsCount,
      candidateCount,
      validatedCount
    }, null, 2));

    // Fallback to EXACTLY ONE Gemini Search Grounding query if crawling returned nothing
    if (searchResults.length === 0 && ENABLE_GEMINI) {
      const fallbackQuery = `${resolvedBrand} ${productName}`;
      console.log(`[ProductDiscovery] Crawling returned 0 results or failed. Fallback to Gemini Search Grounding: "${fallbackQuery}"`);
      activeQuery = fallbackQuery;
      activeProvider = "AI_GEMINI";
      const searchVariants = getProductSearchVariants(productName);
      try {
        const results = await executeSearch(fallbackQuery, rateLimitMs, true, true, searchVariants, resolvedBrand, productName);
        trackCandidates(results);
        searchResults = results.filter((r) => isManufacturerDomain(r.url, officialDomain) && isProductDetailPage(r.url, resolvedBrand, productName));
        
        const fallbackRawCount = results.length;
        const fallbackCandidateCount = results.filter(r => isManufacturerDomain(r.url, officialDomain)).length;
        const fallbackValidatedCount = searchResults.length;
        
        console.log("[StructuredLog] search-metrics:", JSON.stringify({
          provider: activeProvider,
          rawResultsCount: fallbackRawCount,
          candidateCount: fallbackCandidateCount,
          validatedCount: fallbackValidatedCount
        }, null, 2));

        usedQuery = `Gemini: ${fallbackQuery}`;
        hasSuccessfulQuery = true;
      } catch (geminiErr: any) {
        searchError = geminiErr;
        if (geminiErr.provider) {
          activeProvider = geminiErr.provider;
        }
        console.error(`[ProductDiscovery] Gemini Fallback failed:`, geminiErr);
        console.log("[StructuredLog] search-metrics:", JSON.stringify({
          provider: activeProvider,
          rawResultsCount: 0,
          candidateCount: 0,
          validatedCount: 0
        }, null, 2));
      }
    } else if (searchResults.length === 0 && !ENABLE_GEMINI) {
      console.log(`[ProductDiscovery] Crawling returned 0 results or failed. Gemini is disabled, bypassing AI fallback.`);
    }
  }

  const searchDuration = Date.now() - searchStartTime;
  logDiscoveryStep("SEARCH_FINISHED", productName, resolvedBrand, searchDuration, searchResults.length > 0 ? "SUCCESS" : "FAILED");

  if (searchResults.length === 0) {
    printAuditLog();
    
    const candidateCount = auditLogs.length;
    if (searchError || candidateCount === 0) {
      const { status, reason, errorType } = determineErrorStatus(searchError, candidateCount);
      
      logDiscoveryEntry({
        searchQuery: usedQuery || queries.join(" | "),
        productName, brand: resolvedBrand,
        selectedUrl: "", imageFound: false, datasheetFound: false, confidenceScore: 0,
        provider: activeProvider,
        duration: searchDuration,
        candidates: auditLogs.map(item => ({
          url: item.candidateUrl,
          accepted: item.accepted,
          rejectReason: item.rejectReason,
          score: item.score
        }))
      });

      return {
        success: false,
        productName, brand: resolvedBrand, productUrl: "", imageUrl: "",
        datasheetUrl: "", source: "NONE", confidenceScore: 0,
        status,
        reason,
        provider: activeProvider,
        query: activeQuery,
        errorType
      };
    } else {
      const candidateUrls = auditLogs.map(a => a.candidateUrl);
      const rejectReasons = auditLogs.map(a => `${a.candidateUrl}: ${a.rejectReason}`);
      
      const validationLog = {
        searchCompleted: true,
        candidateCount,
        candidateUrls,
        rejectReasons
      };
      console.log("PRODUCT_PAGE_NOT_FOUND Validation Logs:", JSON.stringify(validationLog, null, 2));

      logDiscoveryEntry({
        searchQuery: usedQuery || queries.join(" | "),
        productName, brand: resolvedBrand,
        selectedUrl: "", imageFound: false, datasheetFound: false, confidenceScore: 0,
        provider: activeProvider,
        duration: searchDuration,
        candidates: auditLogs.map(item => ({
          url: item.candidateUrl,
          accepted: item.accepted,
          rejectReason: item.rejectReason,
          score: item.score
        }))
      });

      return {
        success: false,
        productName, brand: resolvedBrand, productUrl: "", imageUrl: "",
        datasheetUrl: "", source: "NONE", confidenceScore: 0,
        status: "PRODUCT_PAGE_NOT_FOUND",
        reason: "No official manufacturer product page found.",
        provider: activeProvider,
        query: activeQuery,
        errorType: "None"
      };
    }
  }

  // ── STEP 4: SCRAPE TOP CANDIDATES ──────────────────────────────────────
  // Pick top 5 results so we have enough signal for ranking
  const topCandidates = searchResults.slice(0, 5);
  const candidatesList: CandidateRecord[] = [];

  for (const result of topCandidates) {
    try {
      // Pass brand, productName, and officialDomain so pageScraper validates the page
      const scraped = await scrapeProductPage(result.url, resolvedBrand, productName, officialDomain);
      if (scraped.imageUrls.length > 0) {
        candidatesList.push({
          url: result.url,
          title: result.title,
          imageUrl: scraped.imageUrls[0] || "",
          imageUrls: scraped.imageUrls,
          datasheetUrl: scraped.datasheetUrls[0] || "",
          datasheetUrls: scraped.datasheetUrls,
          provider: result.provider
        });
      } else {
        const auditItem = auditLogs.find(a => a.candidateUrl === result.url);
        if (auditItem) {
          auditItem.accepted = false;
          auditItem.rejectReason = "Scraped successfully but no product images found on the page.";
        }
      }
    } catch (err: any) {
      console.error(`[ProductDiscovery] Failed to scrape candidate ${result.url}:`, err);
      const auditItem = auditLogs.find(a => a.candidateUrl === result.url);
      if (auditItem) {
        auditItem.accepted = false;
        auditItem.rejectReason = `Scrape failed: ${err.message || err}`;
      }
    }
  }

  if (candidatesList.length === 0) {
    printAuditLog();
    
    const candidateCount = auditLogs.length;
    if (searchError || candidateCount === 0) {
      const { status, reason, errorType } = determineErrorStatus(searchError, candidateCount);
      
      logDiscoveryEntry({
        searchQuery: usedQuery, productName, brand: resolvedBrand,
        selectedUrl: "", imageFound: false, datasheetFound: false, confidenceScore: 0,
        provider: activeProvider,
        duration: searchDuration,
        candidates: auditLogs.map(item => ({
          url: item.candidateUrl,
          accepted: item.accepted,
          rejectReason: item.rejectReason,
          score: item.score
        }))
      });

      return {
        success: false,
        productName, brand: resolvedBrand, productUrl: "", imageUrl: "",
        datasheetUrl: "", source: "NONE", confidenceScore: 0,
        status,
        reason,
        provider: activeProvider,
        query: activeQuery,
        errorType
      };
    } else {
      const candidateUrls = auditLogs.map(a => a.candidateUrl);
      const rejectReasons = auditLogs.map(a => `${a.candidateUrl}: ${a.rejectReason}`);
      const validationLog = {
        searchCompleted: true,
        candidateCount: auditLogs.length,
        candidateUrls,
        rejectReasons
      };
      console.log("PRODUCT_PAGE_NOT_FOUND Validation Logs:", JSON.stringify(validationLog, null, 2));

      logDiscoveryEntry({
        searchQuery: usedQuery, productName, brand: resolvedBrand,
        selectedUrl: "", imageFound: false, datasheetFound: false, confidenceScore: 0,
        provider: activeProvider,
        duration: searchDuration,
        candidates: auditLogs.map(item => ({
          url: item.candidateUrl,
          accepted: item.accepted,
          rejectReason: item.rejectReason,
          score: item.score
        }))
      });

      return {
        success: false,
        productName, brand: resolvedBrand, productUrl: "", imageUrl: "",
        datasheetUrl: "", source: "NONE", confidenceScore: 0,
        status: "PRODUCT_PAGE_NOT_FOUND",
        reason: "No official manufacturer product page found.",
        provider: activeProvider,
        query: activeQuery,
        errorType: "None"
      };
    }
  }

  // ── STEP 5: RANK CANDIDATES ─────────────────────────────────────────────
  const ranked = rankCandidates(candidatesList, productName, resolvedBrand, officialDomain);
  for (const cand of ranked) {
    const auditItem = auditLogs.find(a => a.candidateUrl === cand.url);
    if (auditItem) {
      auditItem.score = cand.score;
      if (cand.score < CONFIDENCE_THRESHOLD) {
        auditItem.accepted = false;
        auditItem.rejectReason = `Score ${cand.score} did not meet confidence threshold of ${CONFIDENCE_THRESHOLD}.`;
      }
    }
  }
  const winner = ranked[0];

  // ── STEP 6: RULE 7 – Confidence threshold check ─────────────────────────
  if (!winner || winner.score < CONFIDENCE_THRESHOLD) {
    printAuditLog();

    const candidateCount = auditLogs.length;
    if (searchError || candidateCount === 0) {
      const { status, reason, errorType } = determineErrorStatus(searchError, candidateCount);
      
      logDiscoveryEntry({
        searchQuery: usedQuery, productName, brand: resolvedBrand,
        selectedUrl: winner?.url || "",
        imageFound: !!winner?.imageUrl,
        datasheetFound: !!winner?.datasheetUrl,
        confidenceScore: winner ? Math.max(0, winner.score) : 0,
        provider: winner?.provider || "UNKNOWN",
        duration: searchDuration,
        candidates: auditLogs.map(item => ({
          url: item.candidateUrl,
          accepted: item.accepted,
          rejectReason: item.rejectReason,
          score: item.score
        }))
      });

      return {
        success: false,
        productName, brand: resolvedBrand,
        productUrl: winner?.url || "", imageUrl: "", datasheetUrl: "",
        source: "SCRAPED",
        confidenceScore: winner ? Math.max(0, winner.score) : 0,
        status,
        reason,
        provider: winner?.provider || activeProvider,
        query: activeQuery,
        errorType
      };
    } else {
      const candidateUrls = auditLogs.map(a => a.candidateUrl);
      const rejectReasons = auditLogs.map(a => `${a.candidateUrl}: ${a.rejectReason}`);
      const validationLog = {
        searchCompleted: true,
        candidateCount: auditLogs.length,
        candidateUrls,
        rejectReasons
      };
      console.log("PRODUCT_PAGE_NOT_FOUND Validation Logs:", JSON.stringify(validationLog, null, 2));

      logDiscoveryEntry({
        searchQuery: usedQuery, productName, brand: resolvedBrand,
        selectedUrl: winner?.url || "",
        imageFound: !!winner?.imageUrl,
        datasheetFound: !!winner?.datasheetUrl,
        confidenceScore: winner ? Math.max(0, winner.score) : 0,
        provider: winner?.provider || "UNKNOWN",
        duration: searchDuration,
        candidates: auditLogs.map(item => ({
          url: item.candidateUrl,
          accepted: item.accepted,
          rejectReason: item.rejectReason,
          score: item.score
        }))
      });

      return {
        success: false,
        productName, brand: resolvedBrand,
        productUrl: winner?.url || "", imageUrl: "", datasheetUrl: "",
        source: "SCRAPED",
        confidenceScore: winner ? Math.max(0, winner.score) : 0,
        status: "PRODUCT_PAGE_NOT_FOUND",
        reason: "No official manufacturer product page found.",
        provider: winner?.provider || activeProvider,
        query: activeQuery,
        errorType: "None"
      };
    }
  }

  // ── STEP 7: DOWNLOAD IMAGES ─────────────────────────────────────────────
  let finalImageUrl = "";
  const uniqueUrls = Array.from(
    new Set(
      winner.imageUrls && winner.imageUrls.length > 0
        ? winner.imageUrls
        : winner.imageUrl ? [winner.imageUrl] : []
    )
  ).filter(Boolean);

  const targetUrls = uniqueUrls.slice(0, 1);
  const cleanBrandFolder = resolvedBrand.replace(/[^a-zA-Z0-9_\-\s]/g, "");
  const brandDir = path.join(process.cwd(), "public", "product_image", cleanBrandFolder);

  let downloadedCount = 0;
  const dlStart = Date.now();
  logDiscoveryStep("IMAGE_DOWNLOAD_STARTED", productName, resolvedBrand);

  for (const imgUrl of targetUrls) {
    try {
      console.log(`[ProductDiscovery] Downloading image: ${imgUrl}`);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const res = await fetch(imgUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Referer": winner.url // Bypass anti-hotlinking
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const contentType = res.headers.get("content-type") || "";
        if (!contentType.toLowerCase().startsWith("image/")) {
          console.warn(`[ProductDiscovery] Skipping non-image resource download: ${imgUrl} (Content-Type: ${contentType})`);
          continue;
        }

        const buffer = Buffer.from(await res.arrayBuffer());

        if (!fs.existsSync(brandDir)) {
          fs.mkdirSync(brandDir, { recursive: true });
        }

        const parsedUrl = new URL(imgUrl);
        const ext = path.extname(parsedUrl.pathname) || ".jpg";
        const cleanExt = [".webp", ".jpg", ".jpeg", ".png"].includes(ext.toLowerCase()) ? ext : ".jpg";

        downloadedCount++;
        const localFileName = downloadedCount === 1
          ? `${slug}${cleanExt}`
          : `${slug}-${downloadedCount}${cleanExt}`;
        const localFilePath = path.join(brandDir, localFileName);

        fs.writeFileSync(localFilePath, buffer);

        if (downloadedCount === 1) {
          finalImageUrl = `/product_image/${encodeURIComponent(cleanBrandFolder)}/${encodeURIComponent(localFileName)}`;
        }
        console.log(`[ProductDiscovery] Image ${downloadedCount} downloaded: ${localFilePath}`);
      } else {
        console.warn(`[ProductDiscovery] Failed download from ${imgUrl}. Status: ${res.status}`);
      }
    } catch (dlErr: any) {
      console.warn(`[ProductDiscovery] Failed to download image from ${imgUrl}:`, dlErr.message || dlErr);
    }
  }

  const dlDuration = Date.now() - dlStart;
  if (downloadedCount > 0) {
    logDiscoveryStep("IMAGE_DOWNLOAD_SUCCESS", productName, resolvedBrand, dlDuration, `DOWNLOADED_${downloadedCount}`);
  } else {
    logDiscoveryStep("IMAGE_DOWNLOAD_FAILED", productName, resolvedBrand, dlDuration, "FAILED", "All downloads timed out or failed validation");
  }

  // ── LOG & RETURN ────────────────────────────────────────────────────────
  logDiscoveryEntry({
    searchQuery: usedQuery, productName, brand: resolvedBrand,
    selectedUrl: winner.url,
    imageFound: !!finalImageUrl,
    datasheetFound: !!winner.datasheetUrl,
    confidenceScore: winner.score,
    provider: winner.provider || "UNKNOWN",
    duration: searchDuration,
    candidates: auditLogs.map(item => ({
      url: item.candidateUrl,
      accepted: item.accepted,
      rejectReason: item.rejectReason,
      score: item.score
    }))
  });

  const output: DiscoveryOutput = {
    success: finalImageUrl ? true : false,
    productName, brand: resolvedBrand,
    productUrl: winner.url,
    imageUrl: finalImageUrl,
    datasheetUrl: winner.datasheetUrl || "",
    source: "OFFICIAL_PRODUCT_PAGE",
    confidenceScore: winner.score,
    status: finalImageUrl ? "SUCCESS" : "IMAGE_NOT_FOUND",
    provider: winner.provider || activeProvider,
    query: activeQuery,
    errorType: "None"
  };

  // Save to cache is handled in the outer wrapper wrapper wrapper

  return output;
}

/**
 * Utility to clear negative search cache entries from the cache file.
 */
export function clearNegativeCache(): { removedCount: number } {
  const cache = getSearchCache();
  const keys = Object.keys(cache);
  let removedCount = 0;

  const NEGATIVE_STATUSES = [
    "PRODUCT_PAGE_NOT_FOUND",
    "SEARCH_FAILED",
    "SCRAPE_FAILED",
    "IMAGE_NOT_FOUND",
    "FAILED",
    "MISSING_BRAND"
  ];

  for (const key of keys) {
    const entry = cache[key];
    if (entry && NEGATIVE_STATUSES.includes(entry.status)) {
      delete cache[key];
      removedCount++;
    }
  }

  if (removedCount > 0) {
    saveSearchCache(cache);
  }

  console.log(`[ProductDiscovery] cleared negative cache: removed ${removedCount} entries.`);
  return { removedCount };
}

