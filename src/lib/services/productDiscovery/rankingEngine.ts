export interface CandidateRecord {
  url: string;
  title: string;
  imageUrl?: string;
  imageUrls?: string[];
  datasheetUrl?: string;
  datasheetUrls?: string[];
  provider?: string;
}

export interface RankedResult extends CandidateRecord {
  score: number;
}

// ─── Rule 3: Blacklist domains – never pick these ──────────────────────────
const BLACKLIST_DOMAINS = [
  "finnomena.com", "investopedia.com", "wikipedia.org", "reddit.com",
  "quora.com", "bloomberg.com", "forbes.com", "wsj.com", "reuters.com",
  "cnbc.com", "money.cnn.com", "thestreet.com", "seekingalpha.com",
  "morningstar.com", "marketwatch.com", "fool.com", "nytimes.com",
  "theguardian.com", "medium.com", "tumblr.com", "blogspot.com",
  "wordpress.com", "twitter.com", "facebook.com", "instagram.com",
  "youtube.com", "tiktok.com", "linkedin.com", "pinterest.com",
  "ebay.com", "amazon.com", "aliexpress.com", "alibaba.com",
  "shopee.vn", "lazada.vn", "tiki.vn", "walmart.com", "bestbuy.com",
  "etsy.com", "newegg.com"
];

// ─── Rule 4: AV Intent Scoring ─────────────────────────────────────────────
// Finance keywords that indicate a completely wrong domain → heavy penalty
const FINANCE_KEYWORDS = [
  "net asset value", "nav fund", "mutual fund", "stock", "investment",
  "portfolio", "forex", "trading", "dividend", "etf", "index fund",
  "financial advisor", "securities", "bonds", "equities", "asset management",
  "crypto", "bitcoin", "blockchain", "nft", "defi", "yield",
  "price per share", "share price", "market cap"
];

// AV / Audio-Visual keywords that indicate a correct product domain → bonus
const AV_KEYWORDS = [
  "amplifier", "receiver", "speaker", "subwoofer", "preamplifier", "integrated",
  "power amp", "surround sound", "home theater", "hi-fi", "hifi", "audio",
  "dac", "digital-to-analog", "turntable", "cd player", "streamer", "network player",
  "av receiver", "projector", "screen", "soundbar", "bluetooth speaker",
  "headphone", "headphones", "earphone", "earphones", "in-ear", "over-ear",
  "microphone", "mixer", "dsp", "crossover", "woofer", "tweeter", "midrange",
  "high end audio", "audiophile", "stereo", "mono", "watts rms", "impedance",
  "frequency response", "thd", "snr", "sensitivity db", "ohm", "watts",
  "video conference", "conference room", "collaboration", "camera", "codec",
  "video bar", "huddle room", "ptz", "display", "monitor"
];

// ─── Rule 5: AV Manufacturer Whitelist ────────────────────────────────────
// Top-level domains of known AV brands get an automatic bonus
const AV_MANUFACTURER_WHITELIST_DOMAINS = [
  "neat.no", "neat.com", "neatvideo.com",
  "yamaha.com", "yamahaaudio.com",
  "denon.com", "marantz.com",
  "harmankardon.com", "jbl.com", "jblpro.com",
  "bose.com", "boseproaudio.com",
  "sennheiser.com", "shure.com",
  "qsc.com", "crown.com", "crownintl.com",
  "klipsch.com", "polk.com", "polkaudio.com",
  "svs.com", "hsu.com",
  "naim.com", "naimaudio.com",
  "linn.co.uk",
  "dali.com", "dali-speakers.com",
  "focal.com", "focalprofessional.com",
  "monitor-audio.com",
  "rega.co.uk",
  "rotel.com", "cambridge-audio.com", "cambridgeaudio.com",
  "audiolab.co.uk",
  "emotiva.com",
  "parasound.com", "mcintoshlabs.com",
  "aurender.com", "bryston.com",
  "pioneer.com", "pioneerhomeusa.com",
  "onkyo.com",
  "sony.com", "samsung.com", "lg.com", "panasonic.com",
  "epson.com", "benq.com", "optoma.com",
  "barco.com", "christie.com", "nec.com",
  "avocor.com", "crestron.com", "extron.com", "atlona.com",
  "audac.com", "apart-audio.com",
  "biamp.com", "bss.com",
  "logitech.com", "poly.com", "polycom.com", "cisco.com",
  "avaya.com",
  "audeze.com", "beyerdynamic.com", "akg.com",
  "wiim.com", "bluesound.com", "sonos.com",
  "denon.com"
];

// ─── Rule 6: Model pattern detection ─────────────────────────────────────
// These regex patterns help detect AV model codes in titles/URLs
const MODEL_PATTERNS = [
  /\b[A-Z]{1,4}[-\s]?\d{2,5}[A-Z]{0,3}\b/,   // e.g. NAV D 121, AX-V685
  /\b\d{3,5}[A-Z]{1,4}\b/,                     // e.g. 3020i, 6006
  /\b[A-Z]{2,6}\d{2,5}\b/,                     // e.g. SB3000, PM7005
  /\b[A-Z][-\s]?\d{2,4}[-\s]?[A-Z0-9]{1,4}\b/ // e.g. Q-3000, X 6j
];

// ─── Reseller / Forum / Blog patterns (URL path penalty) ──────────────────
const RESELLER_PATTERNS = [
  "cart", "checkout", "my-account", "/buy/", "/shop/", "/order/",
  "price-comparison"
];

const FORUM_PATTERNS = [
  "forum", "community", "thread", "helpdesk", "support.apple", "answers.",
  "discuss."
];

const BLOG_PATTERNS = [
  "/blog/", "/news/", "/press-release/", "/editorial/", "/opinion/",
  "/interview/", "/article/"
];

const EXCLUDED_EXTENSIONS = [".pdf", ".zip", ".tar", ".gz", ".xlsx", ".csv", ".docx"];

// ─── Helper ───────────────────────────────────────────────────────────────
function extractHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Ranks candidate URLs based on a strict 8-rule scoring system optimised
 * for AV / Audio-Visual product pages.
 *
 * Scoring summary:
 *  +200  Official brand domain match
 *  +100  AV manufacturer whitelist domain
 *  + 80  Brand name in URL or title
 *  + 80  Full product name match in URL or title
 *  + 30  Partial model code match (≥70% parts)
 *  + 20  AV keyword in title / URL (per keyword, capped at +100)
 *  + 20  Model pattern detection in title / URL
 *  + 25  Product image found
 *  + 25  Datasheet found
 *  -1000 Finance keyword detected (Rule 4 – instant disqualifier)
 *  -1000 Blacklisted domain (Rule 3 – instant disqualifier)
 *  - 200 Raw file extension link
 *  - 100 Reseller path pattern
 *  - 100 Forum path pattern
 *  -  50 Blog path pattern
 *
 * Returns sorted list (highest first). Items with score < 0 are filtered out
 * when confidence threshold is applied at call-site (> 80 required).
 */
export function rankCandidates(
  candidates: CandidateRecord[],
  productName: string,
  brand: string,
  officialDomain: string | null
): RankedResult[] {
  const brandLower = brand.toLowerCase().trim();
  const prodNameLower = productName.toLowerCase().trim();

  const ranked: RankedResult[] = candidates.map((cand) => {
    let score = 0;
    const urlLower = cand.url.toLowerCase();
    const titleLower = cand.title.toLowerCase();
    const hostname = extractHostname(cand.url);
    const combined = `${urlLower} ${titleLower}`;

    // ── Rule 3: Blacklist domain – instant heavy penalty ────────────────
    const isBlacklisted = BLACKLIST_DOMAINS.some(
      (d) => hostname === d || hostname.endsWith("." + d)
    );
    if (isBlacklisted) {
      score -= 1000;
    }

    // ── Rule 4a: Finance keyword penalty (instant disqualifier) ─────────
    const hasFinanceKeyword = FINANCE_KEYWORDS.some((kw) => combined.includes(kw));
    if (hasFinanceKeyword) {
      score -= 1000;
    }

    // ── Rule 4b: AV keyword bonus (capped at +100) ──────────────────────
    let avBonus = 0;
    for (const kw of AV_KEYWORDS) {
      if (combined.includes(kw)) {
        avBonus += 20;
        if (avBonus >= 100) break;
      }
    }
    score += avBonus;

    // ── Penalty for direct file links ────────────────────────────────────
    const isDirectFile = EXCLUDED_EXTENSIONS.some((ext) => urlLower.endsWith(ext));
    if (isDirectFile) {
      score -= 200;
    }

    // ── Rule 2 + 5: Official brand domain & AV manufacturer whitelist ────
    if (officialDomain) {
      const domainLower = officialDomain.toLowerCase().trim();
      if (hostname === domainLower || hostname.endsWith("." + domainLower)) {
        score += 200; // Rule 2: official brand domain (highest priority)
      }
    }

    const isAVManufacturer = AV_MANUFACTURER_WHITELIST_DOMAINS.some(
      (d) => hostname === d || hostname.endsWith("." + d)
    );
    if (isAVManufacturer) {
      score += 100; // Rule 5
    }

    // ── Brand match in URL or title ──────────────────────────────────────
    if (brandLower && (urlLower.includes(brandLower) || titleLower.includes(brandLower))) {
      score += 80;
    }

    // ── Rule 1 / 6: Product name & model code matching ───────────────────
    const cleanProd = prodNameLower.replace(/[^a-z0-9]/g, "");
    const cleanUrl = urlLower.replace(/[^a-z0-9]/g, "");
    const cleanTitle = titleLower.replace(/[^a-z0-9]/g, "");

    if (cleanProd.length > 0 && (cleanUrl.includes(cleanProd) || cleanTitle.includes(cleanProd))) {
      score += 80; // Full product name match
    } else {
      // Partial model parts match
      const parts = prodNameLower.split(/[\s\-]+/).filter((p) => p.length >= 2);
      let matchedParts = 0;
      parts.forEach((part) => {
        if (urlLower.includes(part) || titleLower.includes(part)) {
          matchedParts++;
        }
      });
      if (parts.length > 0 && matchedParts / parts.length >= 0.7) {
        score += 30;
      }
    }

    // ── Rule 6: Model pattern detection ─────────────────────────────────
    const modelPatternFound = MODEL_PATTERNS.some(
      (rx) => rx.test(cand.title) || rx.test(cand.url)
    );
    if (modelPatternFound) {
      score += 20;
    }

    // ── Media bonuses ────────────────────────────────────────────────────
    if (cand.imageUrl && cand.imageUrl.trim() !== "") {
      score += 25;
    }
    if (cand.datasheetUrl && cand.datasheetUrl.trim() !== "") {
      score += 25;
    }

    // ── Reseller / Forum / Blog path penalties ───────────────────────────
    if (RESELLER_PATTERNS.some((pat) => urlLower.includes(pat))) {
      score -= 100;
    }
    if (FORUM_PATTERNS.some((pat) => urlLower.includes(pat))) {
      score -= 100;
    }
    if (BLOG_PATTERNS.some((pat) => urlLower.includes(pat))) {
      score -= 50;
    }

    return { ...cand, score };
  });

  return ranked.sort((a, b) => b.score - a.score);
}
