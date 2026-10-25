/**
 * POST /api/catalog-upload/ai-review
 * ─────────────────────────────────────────────────────────────────────────────
 * AI data-quality review for one batch of products from the Catalog Upload
 * tool (see catalogAiReview.ts for what it checks and why this is batched
 * rather than a single call for the whole catalog). The client
 * (src/app/page.tsx) chunks the full uploaded catalog into batches of
 * CATALOG_AI_REVIEW_BATCH_SIZE and calls this endpoint once per batch,
 * sequentially, so progress is visible and one failed batch doesn't lose
 * findings already gathered for the rest of the catalog.
 *
 * Admin-only. `proxy.ts` excludes `/api/*` from its route protection, so the
 * admin_session cookie is re-checked here (same pattern as
 * /api/admin/translations/generate).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminSession } from "@/lib/services/wixCatalogPdf";
import {
  reviewCatalogBatch,
  isCatalogAiReviewConfigured,
  CatalogAiReviewError,
  CATALOG_AI_REVIEW_BATCH_SIZE,
  AI_REVIEW_TARGET_FIELDS,
} from "@/lib/services/catalogAiReview";

export const runtime = "nodejs";
// reviewCatalogBatch can make up to 3 sequential Ollama calls on a malformed/
// oversized batch (the original attempt plus a split-in-half retry) — give it
// headroom beyond a single CATALOG_AI_REVIEW_TIMEOUT_MS (default 300s).
export const maxDuration = 300; // Vercel Hobby plan max (1–300s)

// A little above CATALOG_AI_REVIEW_BATCH_SIZE so the client can't be blocked
// by a hard cap that's tighter than the batch size the service itself expects.
const MAX_ITEMS = Math.max(CATALOG_AI_REVIEW_BATCH_SIZE * 2, 20);

const requestSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        fields: z.record(z.string(), z.string()),
      })
    )
    .min(1)
    .max(MAX_ITEMS),
  model: z.string().min(1).max(200).optional(),
  // Which fields the reviewer wants AI to actually flag issues on this run
  // (see catalogAiReview.ts's FIELD_CATEGORY_MAP) — every field is still
  // given to the model as context regardless. Defaults to every field if
  // omitted, matching the previous "check everything" behavior.
  targetFields: z.array(z.enum(AI_REVIEW_TARGET_FIELDS)).min(1).max(AI_REVIEW_TARGET_FIELDS.length).optional(),
});

function noStore(json: unknown, init?: ResponseInit) {
  const res = NextResponse.json(json, init);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function POST(req: NextRequest) {
  if (!(await checkAdminSession(req, "editor"))) {
    return noStore({ error: "Unauthorized: Administrator access required." }, { status: 401 });
  }

  if (!isCatalogAiReviewConfigured()) {
    return noStore(
      { error: "AI review is not configured (OLLAMA_BASE_URL is missing).", code: "NOT_CONFIGURED" },
      { status: 503 }
    );
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

  try {
    const results = await reviewCatalogBatch(parsed.data.items, parsed.data.targetFields ?? AI_REVIEW_TARGET_FIELDS, parsed.data.model);
    return noStore({ results });
  } catch (err) {
    if (err instanceof CatalogAiReviewError) {
      const status = err.code === "NOT_CONFIGURED" ? 503 : err.code === "TIMEOUT" ? 504 : 502;
      return noStore({ error: err.message, code: err.code }, { status });
    }
    console.error("[/api/catalog-upload/ai-review] Unexpected error:", err);
    return noStore({ error: "Internal server error." }, { status: 500 });
  }
}
