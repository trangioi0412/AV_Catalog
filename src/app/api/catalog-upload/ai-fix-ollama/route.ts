/**
 * POST /api/catalog-upload/ai-fix-ollama
 * ─────────────────────────────────────────────────────────────────────────────
 * Bulk AI-proposed fixes for one batch of already AI-Review-flagged products,
 * using a local Ollama model (qwen3.5:9b by default) instead of Gemini's
 * grounded search (see catalogAiFixOllama.ts for why its scope is narrower —
 * no internet access, so it can only clean up existing data, never invent
 * specs). The client (src/app/page.tsx) chunks all flagged products into
 * batches of CATALOG_AI_FIX_BATCH_SIZE and calls this once per batch,
 * sequentially, mirroring /api/catalog-upload/ai-review's flow. This endpoint
 * never writes to the catalog itself — suggestions are stored per-row and
 * only applied once a human confirms them in AiFixReviewModal.
 *
 * Admin-only. `proxy.ts` excludes `/api/*` from its route protection, so the
 * admin_session cookie is re-checked here (same pattern as
 * /api/catalog-upload/ai-review).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminSession } from "@/lib/services/wixCatalogPdf";
import {
  fixCatalogBatch,
  isCatalogAiFixOllamaConfigured,
  CatalogAiFixError,
  CATALOG_AI_FIX_BATCH_SIZE,
} from "@/lib/services/catalogAiFixOllama";

export const runtime = "nodejs";
// fixCatalogBatch can make up to 3 sequential Ollama calls on a malformed/
// oversized batch (the original attempt plus a split-in-half retry) — same
// reasoning as /api/catalog-upload/ai-review's maxDuration.
export const maxDuration = 600;

const MAX_ITEMS = Math.max(CATALOG_AI_FIX_BATCH_SIZE * 2, 20);

const requestSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        fields: z.record(z.string(), z.string()),
        issues: z.array(z.string()).max(50),
      })
    )
    .min(1)
    .max(MAX_ITEMS),
  model: z.string().min(1).max(200).optional(),
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

  if (!isCatalogAiFixOllamaConfigured()) {
    return noStore({ error: "AI fix is not configured (OLLAMA_BASE_URL is missing).", code: "NOT_CONFIGURED" }, { status: 503 });
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
    const results = await fixCatalogBatch(parsed.data.items, parsed.data.model);
    return noStore({ results });
  } catch (err) {
    if (err instanceof CatalogAiFixError) {
      const status = err.code === "NOT_CONFIGURED" ? 503 : err.code === "TIMEOUT" ? 504 : 502;
      return noStore({ error: err.message, code: err.code }, { status });
    }
    console.error("[/api/catalog-upload/ai-fix-ollama] Unexpected error:", err);
    return noStore({ error: "Internal server error." }, { status: 500 });
  }
}
