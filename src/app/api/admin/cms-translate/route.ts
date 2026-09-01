/**
 * POST /api/admin/cms-translate
 * ─────────────────────────────────────────────────────────────────────────────
 * Two-step, human-in-the-loop translation of English field(s) on Wix CMS
 * item(s) into their sibling Vietnamese field(s) — see
 * `translateCmsEnglishToVietnamese()`.
 *   - `mode: "preview"` (needs `itemIds`): AI-translates and returns the
 *     result for review. Never writes to Wix.
 *   - `mode: "write"` (needs `items`, the admin-approved/edited values from a
 *     prior preview response): writes exactly those values. Never calls the
 *     AI provider — nothing reaches the CMS without a human having reviewed
 *     it first via a "preview" call.
 *
 * `collectionKey` (not a raw Wix collection ID) is resolved server-side
 * against the same allowlist the Wix Multilingual Translator uses — the
 * client can never point this at an arbitrary collection. Field names are
 * restricted to a safe identifier pattern and a denylist of Wix system
 * fields, so a caller can't target `_id`/`_owner`/etc.
 *
 * Admin-only. `proxy.ts` excludes `/api/*` from its route protection, so the
 * admin_session cookie is re-checked here (same pattern as the other admin routes).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminSession } from "@/lib/services/wixCatalogPdf";
import { translateCmsEnglishToVietnamese, TranslateCmsError } from "@/services/cms-translation/translate-cms.service";
import { TranslationProviderError } from "@/lib/services/translationProvider";
import { WixServerClientError } from "@/lib/wix/server-client";

export const runtime = "nodejs";

const MAX_ITEMS = 50;
const MAX_FIELD_MAPPINGS = 20;

// Wix Data metadata fields — never a valid translation source/target.
const SYSTEM_FIELD_DENYLIST = new Set(["_id", "_owner", "_createdDate", "_updatedDate", "_updatedDateVersion"]);
const FIELD_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const fieldNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(FIELD_NAME_PATTERN, "Field name must be a plain identifier (letters, digits, underscore).")
  .refine((v) => !SYSTEM_FIELD_DENYLIST.has(v), { message: "System fields cannot be used in a field mapping." });

// sourceField may equal targetField — an "in place" translation for a field with no
// separate VI sibling. translateCmsEnglishToVietnamese() only ever writes it when
// `overwrite: true`, since source and target reading the same value otherwise makes
// the field look "already filled in" and it gets skipped.
const fieldMappingSchema = z.object({
  sourceField: fieldNameSchema,
  targetField: fieldNameSchema,
  type: z.enum(["text", "richText"]),
});

const itemInputSchema = z.object({
  itemId: z.string().min(1).max(100),
  fieldValues: z.record(z.string(), z.string().max(100000)),
});

const requestSchema = z
  .object({
    collectionKey: z.string().min(1).max(100),
    fieldMappings: z.array(fieldMappingSchema).min(1).max(MAX_FIELD_MAPPINGS),
    mode: z.enum(["preview", "write"]),
    itemIds: z.array(z.string().min(1).max(100)).min(1).max(MAX_ITEMS).optional(),
    items: z.array(itemInputSchema).min(1).max(MAX_ITEMS).optional(),
    overwrite: z.boolean().optional().default(false),
    batchSize: z.coerce.number().int().min(1).max(20).optional().default(5),
  })
  .refine((v) => v.mode !== "preview" || (v.itemIds && v.itemIds.length > 0), {
    message: 'itemIds is required for mode "preview".',
  })
  .refine((v) => v.mode !== "write" || (v.items && v.items.length > 0), {
    message: 'items is required for mode "write".',
  });

function noStore(json: unknown, init?: ResponseInit) {
  const res = NextResponse.json(json, init);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function errorResponse(err: unknown): NextResponse {
  if (err instanceof TranslateCmsError) return noStore({ error: err.message, code: err.code }, { status: err.status });
  if (err instanceof WixServerClientError) return noStore({ error: err.message, code: err.code }, { status: err.status });
  if (err instanceof TranslationProviderError) {
    const status = err.code === "NOT_CONFIGURED" ? 503 : err.code === "RATE_LIMITED" ? 429 : 502;
    return noStore({ error: err.message, code: err.code }, { status });
  }
  console.error("[/api/admin/cms-translate] Unexpected error:", err);
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
    const result = await translateCmsEnglishToVietnamese(parsed.data);
    return noStore(result);
  } catch (err) {
    return errorResponse(err);
  }
}
