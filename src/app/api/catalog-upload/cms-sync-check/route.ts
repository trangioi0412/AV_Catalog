/**
 * POST /api/catalog-upload/cms-sync-check
 * ─────────────────────────────────────────────────────────────────────────────
 * Bulk CMS comparison for the "CMS Sync" dashboard, scoped to the three
 * natural-language fields (Title, Main Feature, Product Overview) — Category/
 * Series/Specs/Brand aren't prose, so language normalization doesn't apply to
 * them and they're out of scope here (see CmsCompareModal for a full 8-field,
 * single-product comparison instead).
 *
 * Before comparing, whichever side (local catalog value or the live CMS
 * value) doesn't look Vietnamese gets translated to Vietnamese first (see
 * languageUtils.looksVietnamese) — otherwise a field that's substantively
 * identical but stored in English on one side and Vietnamese on the other
 * would be flagged as "different" for no real reason. The returned
 * `localValue` for a translated field is the Vietnamese version, which is
 * exactly what a human-approved "Ghi đè lên CMS" write (via
 * updateCmsProductFieldsAction) should push — never the original
 * English/mixed text.
 *
 * Read-only: never writes anything. Admin-only, matching every other
 * catalog-upload AI route (proxy.ts excludes /api/* from its own protection).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminSession } from "@/lib/services/wixCatalogPdf";
import { compareProductWithCms, type CmsFieldDiff } from "@/lib/services/wixCms";
import { getTranslationProvider, isTranslationProviderConfigured } from "@/lib/services/translationProvider";
import { looksVietnamese } from "@/lib/utils/languageUtils";

export const runtime = "nodejs";
export const maxDuration = 300;

const NATURAL_LANGUAGE_FIELDS = new Set(["Title", "Main Feature", "Product Overview"]);
const CONCURRENCY = 5;

// No max length on content fields (Title/MainFeature/ProductOverview etc.) —
// real AI-enriched product overviews routinely run well past a few thousand
// characters, and a tight cap here (previously 2000/1000) rejected the whole
// batch with "Invalid request" for any product with a full description,
// which is most of them. Matches the unbounded z.string() the ai-review and
// ai-fix-ollama routes already use for the same kind of content.
const itemSchema = z.object({
  id: z.string().min(1).max(100),
  fields: z.object({
    Product: z.string().min(1),
    Category: z.string().optional(),
    Title: z.string().optional(),
    Series: z.string().optional(),
    MainFeature: z.string().optional(),
    ProductOverview: z.string().optional(),
    Brand: z.string().optional(),
  }),
});

const requestSchema = z.object({
  items: z.array(itemSchema).min(1).max(20),
});

export interface CmsSyncDiff extends CmsFieldDiff {
  wasTranslated?: boolean;
  /** A translation was attempted (text didn't look Vietnamese) but the provider failed — localValue/cmsValue are the untouched originals, so this diff may just be a language mismatch rather than a real content difference. */
  translationFailed?: boolean;
}

export interface CmsSyncCheckResult {
  id: string;
  found: boolean;
  diffs: CmsSyncDiff[];
  error?: string;
}

function noStore(json: unknown, init?: ResponseInit) {
  const res = NextResponse.json(json, init);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/** `success: false` means the provider call itself failed (e.g. Ollama unreachable) — `text` is then just the untouched original, NOT a real translation, so callers must not treat it as one. */
async function translateToVietnamese(text: string): Promise<{ text: string; success: boolean }> {
  try {
    const provider = getTranslationProvider();
    const result = await provider.translate({ fields: { value: text }, sourceLocale: "en", targetLocale: "vi" });
    return { text: result.fields.value || text, success: true };
  } catch (err) {
    console.warn("[cms-sync-check] Translation failed, keeping original text:", err);
    return { text, success: false };
  }
}

async function checkOne(item: z.infer<typeof itemSchema>, translationAvailable: boolean): Promise<CmsSyncCheckResult> {
  try {
    const compareResult = await compareProductWithCms(item.fields);
    if (!compareResult.found) {
      return { id: item.id, found: false, diffs: [] };
    }

    const diffs: CmsSyncDiff[] = [];
    for (const d of compareResult.diffs) {
      if (!NATURAL_LANGUAGE_FIELDS.has(d.field)) continue;
      if (d.status === "same" || !translationAvailable) {
        diffs.push(d);
        continue;
      }

      let localValue = d.localValue;
      let cmsValue = d.cmsValue;
      let wasTranslated = false;
      let translationFailed = false;

      if (localValue && !looksVietnamese(localValue)) {
        const r = await translateToVietnamese(localValue);
        localValue = r.text;
        if (r.success) wasTranslated = true;
        else translationFailed = true;
      }
      if (cmsValue && !looksVietnamese(cmsValue)) {
        const r = await translateToVietnamese(cmsValue);
        cmsValue = r.text;
        if (r.success) wasTranslated = true;
        else translationFailed = true;
      }

      // Re-derive status from the Vietnamese-normalized values — a field that
      // was only "different" because the two sides were in different
      // languages should now correctly read as the same. Only do this when a
      // translation actually succeeded — if it failed, localValue/cmsValue
      // are just the untouched originals and the original status still holds.
      let status: CmsFieldDiff["status"] = d.status;
      if (wasTranslated) {
        if (!cmsValue && localValue) status = "missing_in_cms";
        else if (!localValue && cmsValue) status = "missing_locally";
        else if (localValue.trim().toLowerCase() === cmsValue.trim().toLowerCase()) status = "same";
        else status = "different";
      }

      diffs.push({ ...d, localValue, cmsValue, status, wasTranslated, translationFailed });
    }

    return { id: item.id, found: true, diffs };
  } catch (err) {
    console.error(`[cms-sync-check] Failed for item ${item.id}:`, err);
    return { id: item.id, found: false, diffs: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export async function POST(req: NextRequest) {
  if (!checkAdminSession(req)) {
    return noStore({ error: "Unauthorized: Administrator access required." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return noStore({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return noStore({ error: "Invalid request.", details: parsed.error.flatten() }, { status: 400 });
  }

  const translationAvailable = isTranslationProviderConfigured();
  const items = parsed.data.items;
  const results: CmsSyncCheckResult[] = [];

  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const chunk = items.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(chunk.map((item) => checkOne(item, translationAvailable)));
    results.push(...chunkResults);
  }

  return noStore({ results, translationAvailable });
}
