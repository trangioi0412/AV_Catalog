/**
 * POST /api/admin/translations/generate
 * ─────────────────────────────────────────────────────────────────────────────
 * Reads the live Vietnamese content for the selected Wix CMS product(s),
 * translates the allowed fields to English (Gemini), and returns the
 * original/translated pairs for review. Does NOT write anything to Wix.
 *
 * If an "en" translation already exists for an item, it is returned as-is
 * (no AI call) unless the item's ID is listed in `forceIds` — this backs the
 * "Dịch lại" (regenerate) action in the UI, per the "don't re-translate items
 * that already have a translation unless the user asks to" rule.
 *
 * Admin-only. `proxy.ts` excludes `/api/*` from its route protection, so the
 * admin_session cookie is re-checked here (same pattern as /api/admin/wix-media).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminSession } from "@/lib/services/wixCatalogPdf";
import {
  findCollectionSchema,
  getRawCmsItem,
  getTranslatableFields,
  isLocaleAvailable,
  queryContentForEntity,
  WixMultilingualError,
} from "@/lib/services/wixMultilingual";
import { getTranslationProvider, TranslationProviderError } from "@/lib/services/translationProvider";
import { mapWithConcurrency } from "@/lib/utils/concurrencyLimit";
import type {
  GenerateTranslationsResponse,
  TranslationFieldPair,
  TranslationItemResult,
} from "@/types/translation";

export const runtime = "nodejs";

const TARGET_LOCALE = "en";
const MAX_BATCH_SIZE = 20;
const CONCURRENCY = 4;

const requestSchema = z.object({
  collectionId: z.string().min(1).max(100).optional().default("Import1"),
  itemIds: z.array(z.string().min(1).max(100)).min(1).max(MAX_BATCH_SIZE),
  forceIds: z.array(z.string().min(1).max(100)).max(MAX_BATCH_SIZE).optional().default([]),
});

function noStore(json: unknown, init?: ResponseInit) {
  const res = NextResponse.json(json, init);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function errorResponse(err: unknown): NextResponse {
  if (err instanceof WixMultilingualError) {
    return noStore({ error: err.message, code: err.code }, { status: err.status });
  }
  if (err instanceof TranslationProviderError) {
    const status = err.code === "NOT_CONFIGURED" ? 503 : err.code === "RATE_LIMITED" ? 429 : 502;
    return noStore({ error: err.message, code: err.code }, { status });
  }
  console.error("[/api/admin/translations/generate] Unexpected error:", err);
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
  const { collectionId, itemIds, forceIds } = parsed.data;
  const forceSet = new Set(forceIds);

  try {
    const schema = await findCollectionSchema(collectionId);
    if (!schema) {
      return noStore(
        {
          error: `No Wix Multilingual translation schema found for collection "${collectionId}". Mark the collection's translatable fields in Wix Studio CMS field settings first.`,
          code: "SCHEMA_NOT_FOUND",
        },
        { status: 422 }
      );
    }

    const translatableFields = getTranslatableFields(schema);
    if (translatableFields.length === 0) {
      return noStore(
        {
          error: `The Wix Multilingual schema for "${collectionId}" has no translatable text fields.`,
          code: "SCHEMA_NOT_FOUND",
        },
        { status: 422 }
      );
    }

    const localeOk = await isLocaleAvailable(TARGET_LOCALE);
    if (!localeOk) {
      return noStore(
        {
          error: `Locale "${TARGET_LOCALE}" is not enabled/visible in Wix Multilingual for this site.`,
          code: "LOCALE_NOT_AVAILABLE",
        },
        { status: 409 }
      );
    }

    const provider = getTranslationProvider();

    const items: TranslationItemResult[] = await mapWithConcurrency<string, TranslationItemResult>(
      itemIds,
      CONCURRENCY,
      async (entityId) => {
        try {
          const rawItem = await getRawCmsItem(collectionId, entityId);
          if (!rawItem) {
            return { entityId, name: entityId, status: "failed", message: "Item not found in Wix CMS." };
          }
          const name = String(rawItem.title || rawItem.product || entityId);

          const existing = await queryContentForEntity(schema.id, entityId, TARGET_LOCALE);
          const hasExistingTranslation = !!existing;
          const shouldRegenerate = !existing || forceSet.has(entityId);

          const sourceFields: Record<string, string> = {};
          for (const f of translatableFields) {
            sourceFields[f.key] = rawItem[f.key] != null ? String(rawItem[f.key]) : "";
          }

          let translatedFields: Record<string, string>;
          if (shouldRegenerate) {
            const result = await provider.translate({
              fields: sourceFields,
              context: { category: rawItem.category != null ? String(rawItem.category) : undefined, productName: name },
            });
            translatedFields = result.fields;
          } else {
            translatedFields = {};
            for (const f of translatableFields) {
              translatedFields[f.key] = existing!.fields[f.key]?.textValue || "";
            }
          }

          const fields: TranslationFieldPair[] = translatableFields.map((f) => ({
            key: f.key,
            displayName: f.displayName,
            original: sourceFields[f.key],
            translated: translatedFields[f.key] ?? "",
          }));

          return { entityId, name, status: "success", fields, hasExistingTranslation };
        } catch (err) {
          const message =
            err instanceof WixMultilingualError || err instanceof TranslationProviderError
              ? err.message
              : `Unexpected error: ${(err as Error)?.message ?? err}`;
          return { entityId, name: entityId, status: "failed", message };
        }
      }
    );

    const response: GenerateTranslationsResponse = {
      schemaId: schema.id,
      collectionId,
      locale: TARGET_LOCALE,
      translatableFields,
      items,
    };
    return noStore(response);
  } catch (err) {
    return errorResponse(err);
  }
}
