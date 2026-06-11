/**
 * Official domain registry for AV / UC manufacturers.
 *
 * Rules for entries:
 * - Use the root domain only (no www, no protocol, no trailing slash).
 * - A domain is considered valid if the image hostname equals this value
 *   OR ends with "." + this value (subdomain match).
 * - Add all known brand name variants as separate keys mapping to the same domain.
 */
export const BRAND_DOMAINS: Record<string, string> = {
  Extron: "extron.com,extron.it,extron.fr,extron.de",
  Shure: "shure.com",
  Logitech: "logitech.com",
  Neat: "neat.no",
  QSC: "qsys.com",
  Biamp: "biamp.com",
  Crestron: "crestron.com",
  Cisco: "cisco.com",
  Poly: "hp.com",
  Yamaha: "yamaha.com",
  Sony: "sony.com",
  Jabra: "jabra.com"
};

// Map normalized brand variants to their main brand names
const BRAND_VARIANTS: Record<string, string> = {
  "neat video": "Neat",
  "polycom": "Poly",
  "qsys": "QSC",
  "q-sys": "QSC",
  "yamaha audio": "Yamaha"
};

/**
 * Resolves the official manufacturer root domain for a given brand name.
 * Returns null if the brand is not in the registry.
 */
export function getOfficialDomain(brand: string): string | null {
  if (!brand) return null;
  const normalized = brand.trim().toLowerCase();
  
  // Check variants first
  const mappedBrand = BRAND_VARIANTS[normalized] || brand;
  const normalizedMapped = mappedBrand.trim().toLowerCase();
  
  const matchedKey = Object.keys(BRAND_DOMAINS).find(
    (k) => k.toLowerCase() === normalizedMapped
  );
  return matchedKey ? BRAND_DOMAINS[matchedKey] : null;
}

/**
 * Checks whether a given URL belongs to the manufacturer's domain.
 * Accepts exact domain match AND all subdomains (e.g. media.extron.com for extron.com).
 */
export function validateManufacturerDomain(url: string, manufacturerDomain: string): { isValid: boolean; reason: string } {
  if (!url) return { isValid: false, reason: "URL is empty" };
  if (!manufacturerDomain) return { isValid: false, reason: "Manufacturer domain whitelist is empty" };
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const domains = manufacturerDomain.split(",").map(d => d.trim().toLowerCase().replace(/^www\./, ""));
    const isMatch = domains.some(mfDomain => hostname === mfDomain || hostname.endsWith("." + mfDomain));
    if (isMatch) {
      return { isValid: true, reason: "" };
    } else {
      return { isValid: false, reason: `Hostname '${hostname}' does not match manufacturer domains [${domains.join(", ")}]` };
    }
  } catch (err: any) {
    return { isValid: false, reason: `Invalid URL hostname: ${err.message}` };
  }
}

export function isManufacturerDomain(url: string, manufacturerDomain: string): boolean {
  return validateManufacturerDomain(url, manufacturerDomain).isValid;
}

/**
 * Generates a URL-friendly slug from text.
 */
export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

const PRODUCT_PATH_INDICATORS = [
  "/product/",
  "/products/",
  "/productdetails/",
  "/p/",
  "/device/",
  "/devices/",
  "/model/",
  "/item/",
  "/catalog/",
];

/**
 * Normalizes a product name into three standard formats:
 * 1. Raw original (e.g. "DTP T DSW 4K 233")
 * 2. Completely cleaned, no spaces/special characters (e.g. "dtptdsw4k233")
 * 3. Hyphenated, spaces replaced with hyphens (e.g. "DTP-T-DSW-4K-233")
 */
export function getProductSearchVariants(productName: string): string[] {
  const raw = productName.trim();
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  
  const hyphenated = raw
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
    
  return Array.from(new Set([raw, cleaned, hyphenated]));
}

/**
 * Generates all potential fuzzy variants for a product model code.
 * (e.g. NAV 10E 401 D, NAV10E401D, nav10e401d, nav-10e-401-d)
 */
export function getProductFuzzyVariants(productName: string): string[] {
  const searchVariants = getProductSearchVariants(productName);
  const variants = new Set<string>();
  const normalized = productName.toLowerCase().trim();
  
  for (const v of searchVariants) {
    variants.add(v.toLowerCase());
  }
  
  const cleaned = productName.toLowerCase().replace(/[^a-z0-9]/g, "");
  
  // Fully segmented transitions (e.g. nav10e401d -> nav-10-e-401-d)
  const segmented = cleaned
    .replace(/([a-z]+)(\d+)/g, "$1-$2")
    .replace(/(\d+)([a-z]+)/g, "$1-$2");
  variants.add(segmented);
  variants.add(segmented.replace(/-/g, " "));
  
  // Partially joined transition formats (e.g., nav-10e-401-d)
  const tokens = cleaned.split(/([a-z]+|\d+)/).filter(t => t.length > 0);
  const combinedTokens: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const nextToken = tokens[i + 1];
    if (/^\d+$/.test(token) && nextToken && /^[a-z]$/.test(nextToken)) {
      combinedTokens.push(token + nextToken);
      i++;
    } else {
      combinedTokens.push(token);
    }
  }
  variants.add(combinedTokens.join("-"));
  variants.add(combinedTokens.join(" "));
  
  // 6. Original split by whitespace/dash if applicable
  const parts = normalized.split(/[^a-z0-9]+/);
  if (parts.length > 1) {
    variants.add(parts.join("-"));
    variants.add(parts.join(" "));
    variants.add(parts.join(""));
  }
  
  return Array.from(variants);
}

/**
 * Validates whether a given URL is a Product Detail Page (PDP) for a brand and product.
 * Returns detailed check status indicating if it is valid and why/why not.
 */
export function validateProductDetailPage(url: string, brand: string, productName: string): { isValid: boolean; reason: string } {
  if (!url) return { isValid: false, reason: "URL is empty" };
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname.toLowerCase();
    
    // 1. Reject root or empty path
    if (pathname === "/" || pathname === "") {
      return { isValid: false, reason: "Homepage or root domain (empty pathname)" };
    }
    
    // 2. Filter out common language codes to detect homepages
    const languageCodes = new Set([
      "en", "en-us", "en-gb", "en-ca", "en-au", "us", "gb", "ca", "au",
      "zh", "zh-cn", "cn", "ja", "jp", "ko", "kr", "de", "fr", "es", "it", 
      "vn", "vi", "th", "global", "en-global", "intl", "en-intl"
    ]);
    
    const segments = pathname.split("/").filter(s => s.trim() !== "");
    const remainingSegments = segments.filter(s => !languageCodes.has(s));
    
    // If no segments remaining after language filtering, or just index files, it's a homepage
    const commonIndexFiles = new Set(["index.html", "index.htm", "index.aspx", "index.php", "default.aspx"]);
    const finalSegments = remainingSegments.filter(s => !commonIndexFiles.has(s));
    
    if (finalSegments.length === 0) {
      return { isValid: false, reason: "Homepage path (only language or index files)" };
    }
    
    // 3. Must contain product slug or product name in URL path/search (using fuzzy matching)
    const urlLower = url.toLowerCase();
    const fuzzyVariants = getProductFuzzyVariants(productName);
    
    let matchesProduct = false;
    for (const variant of fuzzyVariants) {
      if (urlLower.includes(variant)) {
        matchesProduct = true;
        break;
      }
    }
    
    if (!matchesProduct) {
      // Fallback: check word match (all significant words of length >= 2 must be present)
      const brandClean = brand.toLowerCase().replace(/[^a-z0-9]/g, "");
      const words = productName
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(w => w.length >= 2 && w !== brandClean);
      
      if (words.length > 0) {
        matchesProduct = words.every(w => urlLower.includes(w));
      }
    }
    
    if (!matchesProduct) {
      return { isValid: false, reason: `URL does not contain product name/slug or fuzzy variants: [${fuzzyVariants.join(", ")}]` };
    }
    
    // 4. Must have a product path indicator or match brand specific layouts
    const hasProductIndicator = PRODUCT_PATH_INDICATORS.some(ind => pathname.includes(ind));
    if (hasProductIndicator) {
      return { isValid: true, reason: "" };
    }
    
    // If it doesn't have a product indicator, check if the last segment is the slug/name/variant
    const lastSegment = finalSegments[finalSegments.length - 1];
    const slug = slugify(productName);
    const cleanedName = productName.toLowerCase().replace(/[^a-z0-9]/g, "");
    
    const lastSegmentMatches = lastSegment === slug || 
                               lastSegment === cleanedName || 
                               lastSegment.includes(slug) || 
                               lastSegment.includes(cleanedName) ||
                               fuzzyVariants.some(variant => lastSegment === variant || lastSegment.includes(variant));
                               
    if (lastSegmentMatches) {
      return { isValid: true, reason: "" };
    }
    
    // Allow exceptions for specific brands known to put product pages directly under root
    const normalizedBrand = brand.toLowerCase();
    if (normalizedBrand === "neat" || normalizedBrand === "poly" || normalizedBrand === "logitech") {
      return { isValid: true, reason: "" };
    }
    
    return { isValid: false, reason: "No product path indicator and last path segment does not match product slug/name" };
  } catch {
    return { isValid: false, reason: "Failed to parse URL structure" };
  }
}

/**
 * Validates whether a given URL is a Product Detail Page (PDP) for a brand and product.
 * Returns false for root domains, homepages, language-only paths, and non-product pages.
 */
export function isProductDetailPage(url: string, brand: string, productName: string): boolean {
  return validateProductDetailPage(url, brand, productName).isValid;
}


