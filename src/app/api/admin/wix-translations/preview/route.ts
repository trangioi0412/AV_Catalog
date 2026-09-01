/**
 * POST /api/admin/wix-translations/preview
 * ─────────────────────────────────────────────────────────────────────────────
 * Calls `translateAndSyncWixCmsItems({ ..., mode: "preview" })`. Reads live
 * Vietnamese CMS content, translates the requested fields, and returns
 * original + translated pairs for review. Never writes to Wix.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminSession } from "@/lib/services/wixCatalogPdf";
import { MAX_TRANSLATION_BATCH_SIZE } from "@/config/wix-translation.config";
import { translateAndSyncWixCmsItems, TranslateAndSyncError } from "@/services/wix-translation/translate-and-sync";
import { WixMultilingualError } from "@/services/wix-translation/wix-multilingual.service";
import { TranslationProviderError } from "@/services/wix-translation/translation-provider.service";
import { WixServerClientError } from "@/lib/wix/server-client";

export const runtime = "nodejs";

const requestSchema = z.object({
  collectionKey: z.string().min(1).max(100),
  itemIds: z.array(z.string().min(1).max(100)).min(1).max(MAX_TRANSLATION_BATCH_SIZE),
  sourceLocale: z.string().min(1).max(20),
  targetLocale: z.string().min(1).max(20),
  fieldKeys: z.array(z.string().min(1).max(100)).min(1).max(50),
  overwriteExisting: z.boolean().optional().default(false),
  providerKind: z.enum(["gemini", "gpt", "ollama"]).optional(),
  providerModel: z.string().min(1).max(200).optional(),
});

function noStore(json: unknown, init?: ResponseInit) {
  const res = NextResponse.json(json, init);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function errorResponse(err: unknown): NextResponse {
  if (err instanceof TranslateAndSyncError) return noStore({ error: err.message, code: err.code }, { status: err.status });
  if (err instanceof WixMultilingualError || err instanceof WixServerClientError) {
    return noStore({ error: err.message, code: err.code }, { status: err.status });
  }
  if (err instanceof TranslationProviderError) {
    const status = err.code === "NOT_CONFIGURED" ? 503 : err.code === "RATE_LIMITED" ? 429 : 502;
    return noStore({ error: err.message, code: err.code }, { status });
  }
  console.error("[/api/admin/wix-translations/preview] Unexpected error:", err);
  return noStore({ error: "Internal server error." }, { status: 500 });
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

  try {
    const result = await translateAndSyncWixCmsItems({ ...parsed.data, mode: "preview" });
    return noStore(result);
  } catch (err) {
    return errorResponse(err);
  }
}
