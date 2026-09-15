/**
 * POST /api/catalog-upload/ai-fix
 * ─────────────────────────────────────────────────────────────────────────────
 * Suggests a corrected set of fields for ONE product from the Catalog Upload
 * tool, grounded in real Google Search results scoped to the exact Brand +
 * Product/model (via enrichProductDataWithGeminiAgent — the same
 * search-grounded research agent the Discovery Queue uses, which is
 * instructed to prefer official manufacturer sources, never invent
 * specifications, and reject products with insufficient evidence). Returns
 * the cited web sources alongside the suggestion so a human can verify the
 * fix traces back to real data before applying it — this endpoint never
 * writes anything itself; the client (AiFixReviewModal) applies the fields
 * the user approves via the local store.
 *
 * Admin-only. `proxy.ts` excludes `/api/*` from its route protection, so the
 * admin_session cookie is re-checked here (same pattern as
 * /api/catalog-upload/ai-review).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminSession } from "@/lib/services/wixCatalogPdf";
import { enrichProductDataWithGeminiAgent } from "@/lib/services/geminiEnricher";

export const runtime = "nodejs";
export const maxDuration = 120;

const requestSchema = z.object({
  brand: z.string().min(1).max(200),
  product: z.string().min(1).max(200),
  title: z.string().max(300).optional(),
  category: z.string().max(200).optional(),
});

function noStore(json: unknown, init?: ResponseInit) {
  const res = NextResponse.json(json, init);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function POST(req: NextRequest) {
  if (!checkAdminSession(req)) {
    return noStore({ error: "Unauthorized: Administrator access required." }, { status: 401 });
  }

  if (!process.env.GEMINI_API_KEY) {
    return noStore({ error: "AI fix is not configured (GEMINI_API_KEY is missing)." }, { status: 503 });
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
    const enriched = await enrichProductDataWithGeminiAgent({
      Brand: parsed.data.brand,
      Product: parsed.data.product,
      Title: parsed.data.title,
      Category: parsed.data.category,
    });
    return noStore({ suggestion: { ...enriched, engine: "gemini" } });
  } catch (err) {
    console.error("[/api/catalog-upload/ai-fix] Unexpected error:", err);
    return noStore({ error: err instanceof Error ? err.message : "Internal server error." }, { status: 500 });
  }
}
