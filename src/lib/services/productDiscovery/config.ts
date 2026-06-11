export const SEARCH_PROVIDER: "AI" | "crawl" = (process.env.SEARCH_PROVIDER || "crawl") as "AI" | "crawl";

// Whether Gemini API is enabled overall
export const ENABLE_GEMINI = process.env.ENABLE_GEMINI !== "false";

// Whether to run Gemini Search Grounding as a last resort fallback if crawling yields 0 results
export const ENABLE_GEMINI_FALLBACK = process.env.ENABLE_GEMINI_FALLBACK === "true";

// Cache TTL configurations (in milliseconds)
export const NEGATIVE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
export const POSITIVE_CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days
export const CACHE_VERSION = 2; // Cache logic version for automatic invalidation
