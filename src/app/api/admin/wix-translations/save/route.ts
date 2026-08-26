/**
 * POST /api/admin/wix-translations/save
 * ─────────────────────────────────────────────────────────────────────────────
 * Calls `translateAndSyncWixCmsItems({ ..., mode: "draft" | "publish" })` to
 * write the user-reviewed translation into Wix Multilingual. Rejects a save
 * whose source content has drifted since preview (stale `sourceHash`), and
 * never overwrites an existing translation unless `overwriteExisting` is set.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminSession } from "@/lib/services/wixCatalogPdf";
import { MAX_TRANSLATION_BATCH_SIZE } from "@/config/wix-translation.config";
import { translateAndSyncWixCmsItems, TranslateAndSyncError } from "@/services/wix-translation/translate-and-sync";
import { WixMultilingualError } from "@/services/wix-translation/wix-multilingual.service";
import { WixServerClientError } from "@/lib/wix/server-client";

export const runtime = "nodejs";

const itemSchema = z.object({
  itemId: z.string().min(1).max(100),
  fieldValues: z.record(z.string(), z.string().max(100000)),
  sourceHash: z.string().max(200).optional(),
});

const requestSchema = z.object({
  collectionKey: z.string().min(1).max(100),
  sourceLocale: z.string().min(1).max(20),
  targetLocale: z.string().min(1).max(20),
  fieldKeys: z.array(z.string().min(1).max(100)).min(1).max(50),
  items: z.array(itemSchema).min(1).max(MAX_TRANSLATION_BATCH_SIZE),
  mode: z.enum(["draft", "publish"]),
  overwriteExisting: z.boolean().optional().default(false),
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
  console.error("[/api/admin/wix-translations/save] Unexpected error:", err);
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
  const { collectionKey, sourceLocale, targetLocale, fieldKeys, items, mode, overwriteExisting } = parsed.data;

  try {
    const result = await translateAndSyncWixCmsItems({
      collectionKey,
      sourceLocale,
      targetLocale,
      fieldKeys,
      mode,
      overwriteExisting,
      itemIds: items.map((i) => i.itemId),
      items,
    });
    return noStore(result);
  } catch (err) {
    return errorResponse(err);
  }
}
