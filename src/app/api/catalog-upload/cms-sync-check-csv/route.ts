/**
 * POST /api/catalog-upload/cms-sync-check-csv
 * ─────────────────────────────────────────────────────────────────────────────
 * CSV-based counterpart to the old live-Wix-API CMS Sync check: instead of
 * looking up each product on Wix one at a time (one network round-trip per
 * product — the real bottleneck for a catalog of any real size), the admin
 * exports the Wix collection to CSV and uploads it. The client
 * (CmsSyncDashboard) parses that CSV and matches it against the local
 * catalog by product/model name (see cmsCsvUtils.ts) BEFORE calling this
 * route, so this route only ever does in-memory diffing — no Wix API calls
 * at all — which is what makes this comparison fast regardless of catalog
 * size.
 *
 * The actual field-diff + Vietnamese-normalization logic is identical to the
 * old live-API path — see cmsSyncCompare.ts, shared so the two can never
 * drift apart on how a diff is computed.
 *
 * Read-only: never writes anything. Admin-only, matching every other
 * catalog-upload AI route (proxy.ts excludes /api/* from its own protection).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminSession } from "@/lib/services/wixCatalogPdf";
import { isTranslationProviderConfigured, getTranslationProviderKind, getSafeConcurrency } from "@/lib/services/translationProvider";
import { mapWithConcurrency } from "@/lib/utils/concurrencyLimit";
import { computeNaturalLanguageDiffs, type CmsSyncDiff } from "@/lib/services/cmsSyncCompare";

export const runtime = "nodejs";
export const maxDuration = 300;

// No Wix I/O per item here — every request is pure in-memory diffing (plus,
// when a field needs it, one Ollama translate call), so a much larger batch
// per request is safe compared to the old live-API route's cap of 20.
const CONCURRENCY = 8;

// No max length — see the same note in the old cms-sync-check route: real
// AI-enriched overviews routinely run past a few thousand characters.
const naturalLanguageFieldsSchema = z.object({
  Title: z.string().optional(),
  MainFeature: z.string().optional(),
  ProductOverview: z.string().optional(),
});

const itemSchema = z.object({
  id: z.string().min(1).max(100),
  localFields: naturalLanguageFieldsSchema,
  // null = this product's model name wasn't found anywhere in the uploaded CSV.
  cmsFields: naturalLanguageFieldsSchema.nullable(),
});

const requestSchema = z.object({
  items: z.array(itemSchema).min(1).max(500),
});

export interface CmsSyncCheckResult {
  id: string;
  found: boolean;
  diffs: CmsSyncDiff[];
}

function noStore(json: unknown, init?: ResponseInit) {
  const res = NextResponse.json(json, init);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function POST(req: NextRequest) {
  if (!(await checkAdminSession(req, "editor"))) {
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

  // Same guard as the old live-API route: a local/self-hosted Ollama server
  // can't usefully serve several concurrent generations (see
  // getSafeConcurrency()'s doc comment) — fold concurrency down to 1 for it
  // so its translate calls across different items never overlap.
  const concurrency = translationAvailable ? getSafeConcurrency(CONCURRENCY, getTranslationProviderKind()) : CONCURRENCY;

  const results = await mapWithConcurrency(items, concurrency, async (item): Promise<CmsSyncCheckResult> => {
    if (!item.cmsFields) return { id: item.id, found: false, diffs: [] };
    const diffs = await computeNaturalLanguageDiffs(item.localFields, item.cmsFields, translationAvailable);
    return { id: item.id, found: true, diffs };
  });

  return noStore({ results, translationAvailable });
}
