/**
 * imageSyncService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Core logic for matching local product images to Wix CMS products and
 * orchestrating batch uploads with progress reporting.
 */

import { normalizeName, ProductImageItem } from "./wixCms";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface ImageFile {
  /** Original filename including extension, e.g. "Neat Board Pro-2.jpg" */
  name: string;
  /** File size in bytes */
  size: number;
  /** MIME type, e.g. "image/jpeg" */
  type: string;
  /** Base64-encoded data URL for preview (populated in browser) */
  previewUrl?: string;
}

/** Group of images that belong to the same product. */
export interface ImageGroup {
  /** Normalized product name key, e.g. "neat board pro" */
  normalizedKey: string;
  /** Display name derived from filename, e.g. "Neat Board Pro" */
  displayName: string;
  /** The primary/main image (the first one, or -1 suffix) */
  mainImage: ImageFile;
  /** Additional gallery images (-2, -3, etc.) */
  galleryImages: ImageFile[];
}

/** One matched product: CMS record + grouped images. */
export interface MatchedProduct {
  cmsItem: ProductImageItem;
  imageGroup: ImageGroup;
}

/** Full analysis result from matchImages(). */
export interface MatchResult {
  /** Products that have matching images */
  matched: MatchedProduct[];
  /** Image groups that didn't match any CMS product */
  unmatched: ImageGroup[];
  /** CMS products that have no corresponding image */
  missing: ProductImageItem[];
}

/** Progress event emitted during upload. */
export interface UploadProgressEvent {
  type: "progress" | "done" | "error";
  productName: string;
  cmsId: string;
  fileName: string;
  /** wix:image://v1/... URL, present when type === "done" */
  wixUrl?: string;
  error?: string;
  /** 0–100 */
  percent: number;
  processed: number;
  total: number;
}

/** Final sync report produced after all uploads complete. */
export interface SyncReport {
  matched: Array<{
    productName: string;
    cmsId: string;
    imageFile: string;
    galleryFiles: string[];
    status: "success" | "error";
    wixUrl?: string;
    galleryWixUrls?: string[];
    error?: string;
  }>;
  unmatched: string[];   // filenames with no CMS match
  missing: string[];     // CMS product names with no image
  summary: {
    total: number;
    success: number;
    failed: number;
    unmatched: number;
    missing: number;
    durationMs: number;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// REASON TYPES — explain why a file/product is unmatched
// ─────────────────────────────────────────────────────────────────────────────

/** A suggestion: the closest CMS product or image file. */
export interface ClosestMatch {
  /** Display label (productName or filename) */
  label: string;
  /** Normalized key that was compared */
  normalizedKey: string;
  /** Jaccard word-set similarity score 0–1 */
  score: number;
}

/** Unmatched image file with detailed reason. */
export interface UnmatchedReason {
  /** Original display name (e.g. "Logitech Rally Bar") */
  displayName: string;
  /** What normalizeName() produced and we searched for */
  normalizedKey: string;
  /** Why it failed (human readable) */
  reason: string;
  /** Closest CMS product, if any (score ≥ 0.3) */
  suggestion?: ClosestMatch;
}

/** CMS product with no image, with detailed reason. */
export interface MissingReason {
  /** Original CMS product name */
  productName: string;
  /** What normalizeName() produced — what an image filename must normalize to */
  normalizedKey: string;
  /** Why it failed (human readable) */
  reason: string;
  /** Closest image file, if any (score ≥ 0.3) */
  suggestion?: ClosestMatch;
}

// ─────────────────────────────────────────────────────────────────────────────
// SUPPORTED EXTENSIONS
// ─────────────────────────────────────────────────────────────────────────────

const SUPPORTED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);

export function isSupportedImageFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return Array.from(SUPPORTED_EXTENSIONS).some((ext) => lower.endsWith(ext));
}

// ─────────────────────────────────────────────────────────────────────────────
// SIMILARITY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Jaccard word-set similarity between two normalized strings.
 * Returns 0.0–1.0. Uses word-level overlap, so:
 *   "logitech rally bar" vs "logitech rally bar mini" → 0.75
 *   "shure mxa920" vs "shure mxa 920" → 1.0
 */
export function wordSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const wordsA = new Set(a.split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersectionSize = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersectionSize++;
  }
  const unionSize = wordsA.size + wordsB.size - intersectionSize;
  return intersectionSize / unionSize;
}

/**
 * Find the closest item in a collection by normalized-key similarity.
 * Returns undefined if best score < threshold.
 */
function findClosest(
  key: string,
  candidates: Map<string, { label: string }>,
  threshold = 0.3
): ClosestMatch | undefined {
  let best: ClosestMatch | undefined;
  for (const [candidateKey, { label }] of candidates.entries()) {
    const score = wordSimilarity(key, candidateKey);
    if (score >= threshold && (!best || score > best.score)) {
      best = { label, normalizedKey: candidateKey, score };
    }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// FILE GROUPING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Strip the file extension from a filename.
 * "Neat Board Pro.jpg" → "Neat Board Pro"
 */
export function stripExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) return filename;
  return filename.slice(0, lastDot);
}

export function parseImageName(filename: string): { base: string; index: number } {
  const nameNoExt = stripExtension(filename);
  
  // Matches trailing indices like:
  // - "_(1)", " (1)", "-(1)"
  // - "_1", "-1", " 1"
  const match = nameNoExt.match(/^(.+?)[-\s_](?:\((\d{1,2})\)|(\d{1,2}))$/);
  if (match) {
    const base = match[1].trim();
    const indexStr = match[2] || match[3];
    const index = parseInt(indexStr, 10);
    // Limit index to <= 9 for general matching to avoid matching model number suffixes (e.g. -16 in CEN-SWPOE-16)
    if (index >= 1 && index <= 9) {
      return { base, index };
    }
  }
  return { base: nameNoExt, index: 0 };
}

/**
 * Intelligent image name parser that references existing CMS keys to distinguish
 * true gallery index suffixes (e.g., -2 in Model-2) from model numbers (e.g., -16 in Model-16).
 */
export function parseImageNameWithKeys(
  filename: string,
  existingKeys?: Set<string>
): { base: string; index: number } {
  const nameNoExt = stripExtension(filename);

  // 1. Parentheses (almost always a gallery index) e.g., "Model (1)", "Model (2)"
  const parenMatch = nameNoExt.match(/^(.+?)[-\s_]\((\d{1,2})\)$/);
  if (parenMatch) {
    const base = parenMatch[1].trim();
    const index = parseInt(parenMatch[2], 10);
    return { base, index };
  }

  // 2. If existingKeys are loaded, do direct lookups
  if (existingKeys && existingKeys.size > 0) {
    const normalizedFull = normalizeName(nameNoExt);
    if (existingKeys.has(normalizedFull)) {
      // Exact product key match, this is the main image (index 0)
      return { base: nameNoExt, index: 0 };
    }

    // Try splitting at the last separator to check if prefix matches an existing key
    const lastSepIndex = Math.max(
      nameNoExt.lastIndexOf("-"),
      nameNoExt.lastIndexOf("_"),
      nameNoExt.lastIndexOf(" ")
    );
    if (lastSepIndex !== -1) {
      const basePart = nameNoExt.slice(0, lastSepIndex).trim();
      const suffixPart = nameNoExt.slice(lastSepIndex + 1).trim();

      if (/^\d{1,2}$/.test(suffixPart)) {
        const baseNormalized = normalizeName(basePart);
        if (existingKeys.has(baseNormalized)) {
          // Found base product key match, the suffix is a gallery index
          const index = parseInt(suffixPart, 10);
          return { base: basePart, index };
        }
      }
    }
  }

  // 3. Fallback to regular parser
  return parseImageName(filename);
}

/**
 * Group an array of ImageFile objects by product name.
 *
 * Algorithm:
 *   1. For each file, parse base name + index.
 *   2. Normalize base → lookup key.
 *   3. Collect into groups keyed by normalized name.
 *   4. Within each group: index 0 or 1 → mainImage; rest → galleryImages.
 *   5. Sort gallery by index ascending.
 */
export function groupImagesByProduct(
  files: ImageFile[],
  existingKeys?: Set<string>
): ImageGroup[] {
  type Accumulator = {
    displayName: string;
    entries: Array<{ file: ImageFile; index: number }>;
  };

  const accMap = new Map<string, Accumulator>();

  for (const file of files) {
    if (!isSupportedImageFile(file.name)) continue;

    const { base, index } = parseImageNameWithKeys(file.name, existingKeys);
    const key = normalizeName(base);

    if (!accMap.has(key)) {
      accMap.set(key, { displayName: base, entries: [] });
    }
    accMap.get(key)!.entries.push({ file, index });
  }

  const groups: ImageGroup[] = [];

  for (const [normalizedKey, acc] of accMap.entries()) {
    acc.entries.sort((a, b) => {
      const ai = a.index === 0 ? 0 : a.index;
      const bi = b.index === 0 ? 0 : b.index;
      return ai - bi;
    });

    const [first, ...rest] = acc.entries;

    groups.push({
      normalizedKey,
      displayName: acc.displayName,
      mainImage: first.file,
      galleryImages: rest.map((e) => e.file),
    });
  }

  return groups;
}

// ─────────────────────────────────────────────────────────────────────────────
// MATCHING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Match image groups against the CMS product Map.
 * O(n) time complexity — uses Map for O(1) lookup per group.
 */
export function matchImages(
  imageGroups: ImageGroup[],
  productMap: Map<string, ProductImageItem>
): MatchResult {
  const matched: MatchedProduct[] = [];
  const unmatched: ImageGroup[] = [];
  const matchedCmsIds = new Set<string>();

  for (const group of imageGroups) {
    const cmsItem = productMap.get(group.normalizedKey);
    if (cmsItem) {
      matched.push({ cmsItem, imageGroup: group });
      matchedCmsIds.add(cmsItem._id);
    } else {
      unmatched.push(group);
    }
  }

  const missing: ProductImageItem[] = [];
  for (const [, product] of productMap.entries()) {
    if (!matchedCmsIds.has(product._id)) {
      missing.push(product);
    }
  }

  return { matched, unmatched, missing };
}

// ─────────────────────────────────────────────────────────────────────────────
// SCAN PREVIEW (server-side, no upload)
// ─────────────────────────────────────────────────────────────────────────────

export interface ScanPreviewInput {
  fileNames: string[];
  productMap: Map<string, ProductImageItem>;
}

export interface ScanPreviewResult {
  matched: Array<{
    normalizedKey: string;
    displayName: string;
    mainFileName: string;
    galleryFileNames: string[];
    cmsId: string;
    productName: string;
    existingImageUrl?: string;
  }>;
  /** Unmatched image files with detailed reason & suggestion */
  unmatched: UnmatchedReason[];
  /** CMS products with no image, with detailed reason & suggestion */
  missing: MissingReason[];
}

/**
 * Lightweight scan preview — does NOT upload anything.
 * Accepts raw file names and a pre-built product Map.
 *
 * Also computes reasons and closest-match suggestions for
 * unmatched files and missing CMS products.
 */
export function buildScanPreview(
  fileNames: string[],
  productMap: Map<string, ProductImageItem>
): ScanPreviewResult {
  const imageFiles: ImageFile[] = fileNames
    .filter(isSupportedImageFile)
    .map((name) => ({ name, size: 0, type: "image/jpeg" }));

  const existingKeys = new Set(productMap.keys());
  const groups = groupImagesByProduct(imageFiles, existingKeys);
  const { matched, unmatched, missing } = matchImages(groups, productMap);

  // Build candidate maps for suggestion lookups
  // candidate map: normalizedKey → display label
  const cmsProductCandidates = new Map<string, { label: string }>();
  for (const [key, item] of productMap.entries()) {
    cmsProductCandidates.set(key, { label: item.productName });
  }

  const imageCandidates = new Map<string, { label: string }>();
  for (const group of groups) {
    imageCandidates.set(group.normalizedKey, { label: group.displayName });
  }

  // Build unmatched with reasons
  const unmatchedWithReason: UnmatchedReason[] = unmatched.map((group) => {
    const suggestion = findClosest(group.normalizedKey, cmsProductCandidates);

    // Build a human-readable reason
    let reason = `Tìm kiếm key: "${group.normalizedKey}" — không khớp với bất kỳ sản phẩm nào trong CMS.`;
    if (suggestion) {
      reason += ` Sản phẩm gần nhất: "${suggestion.label}" (${Math.round(suggestion.score * 100)}% tương đồng).`;
    } else {
      reason += " Không tìm thấy sản phẩm tương tự trong CMS.";
    }

    return {
      displayName: group.displayName,
      normalizedKey: group.normalizedKey,
      reason,
      suggestion,
    };
  });

  // Build missing with reasons
  const missingWithReason: MissingReason[] = missing.map((product) => {
    const key = normalizeName(product.productName);
    const suggestion = findClosest(key, imageCandidates);

    let reason = `Sản phẩm "${product.productName}" có key: "${key}" — không tìm thấy file ảnh tương ứng.`;
    if (suggestion) {
      reason += ` File gần nhất: "${suggestion.label}" (${Math.round(suggestion.score * 100)}% tương đồng).`;
    } else {
      reason += " Không có file ảnh nào tương tự.";
    }

    return {
      productName: product.productName,
      normalizedKey: key,
      reason,
      suggestion,
    };
  });

  return {
    matched: matched.map(({ cmsItem, imageGroup }) => ({
      normalizedKey: imageGroup.normalizedKey,
      displayName: imageGroup.displayName,
      mainFileName: imageGroup.mainImage.name,
      galleryFileNames: imageGroup.galleryImages.map((f) => f.name),
      cmsId: cmsItem._id,
      productName: cmsItem.productName,
      existingImageUrl: cmsItem.image,
    })),
    unmatched: unmatchedWithReason,
    missing: missingWithReason,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// RATE-LIMITED UPLOAD QUEUE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sleep helper for retry/rate-limit backoff.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry wrapper with exponential backoff.
 * Retries on HTTP 429 (rate limit) or 5xx errors.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
  baseDelayMs = 1000
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const msg = String(err?.message ?? err);
      const isRetryable =
        msg.includes("429") ||
        msg.includes("503") ||
        msg.includes("502") ||
        msg.includes("ECONNRESET");
      if (!isRetryable || attempt === maxRetries) throw err;
      const delay = baseDelayMs * Math.pow(2, attempt);
      console.warn(`[ImageSync] Retry ${attempt + 1}/${maxRetries} after ${delay}ms: ${msg}`);
      await sleep(delay);
    }
  }
  throw lastError;
}

/**
 * Run async tasks in chunks of `concurrency` at a time.
 * Uses Promise.allSettled so one failure doesn't abort the rest.
 */
export async function processBatch<T, R>(
  items: T[],
  concurrency: number,
  handler: (item: T, index: number) => Promise<R>
): Promise<Array<PromiseSettledResult<R>>> {
  const results: Array<PromiseSettledResult<R>> = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const chunkResults = await Promise.allSettled(
      chunk.map((item, j) => handler(item, i + j))
    );
    results.push(...chunkResults);
  }
  return results;
}
