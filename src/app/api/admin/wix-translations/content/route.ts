/**
 * GET /api/admin/wix-translations/content
 * ─────────────────────────────────────────────────────────────────────────────
 * Read-only lookup of one CMS item's already-saved Wix Multilingual translation
 * content, side by side with its source-locale field values. Never calls the
 * AI translation provider and never writes to Wix — purely for the "Xem bản
 * dịch" viewer in the admin UI so an admin can inspect what is already stored
 * for an item/locale without re-running (and re-billing) a translation.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminSession } from "@/lib/services/wixCatalogPdf";
import { resolveCollection } from "@/config/wix-translation.config";
import { getWixCmsItemById, getWixCollectionSchema } from "@/services/wix-translation/wix-cms.service";
import { getTranslatableFields, queryContentForEntity, WixMultilingualError } from "@/services/wix-translation/wix-multilingual.service";
import { sanitizeHtmlForPreview } from "@/services/wix-translation/translation-mapper.service";
import { WixServerClientError } from "@/lib/wix/server-client";
import type { CmsFieldValueType, CmsTranslationStatus, WixTranslatedContentResponse } from "@/types/wix-translation";

export const runtime = "nodejs";

const querySchema = z.object({
  collectionKey: z.string().min(1).max(100),
  itemId: z.string().min(1).max(100),
  targetLocale: z.string().min(1).max(20),
});

function noStore(json: unknown, init?: ResponseInit) {
  const res = NextResponse.json(json, init);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function resolveItemName(rawItem: Record<string, unknown>, fallback: string): string {
  const title = rawItem.title ?? rawItem.Title;
  const product = rawItem.product ?? rawItem.Product;
  const name = rawItem.name ?? rawItem.Name;
  return String(title || product || name || fallback);
}

export async function GET(req: NextRequest) {
  if (!checkAdminSession(req)) {
    return noStore({ error: "Unauthorized: Administrator access required." }, { status: 401 });
  }

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return noStore({ error: "Invalid query parameters.", details: parsed.error.flatten() }, { status: 400 });
  }
  const { collectionKey, itemId, targetLocale } = parsed.data;

  const collection = resolveCollection(collectionKey);
  if (!collection) {
    return noStore({ error: `Collection "${collectionKey}" không nằm trong danh sách cho phép.`, code: "COLLECTION_NOT_ALLOWED" }, { status: 422 });
  }

  try {
    const schema = await getWixCollectionSchema(collection.collectionId);
    if (!schema) {
      return noStore(
        { error: `Không tìm thấy translation schema cho collection "${collection.label}".`, code: "SCHEMA_NOT_FOUND" },
        { status: 422 }
      );
    }

    const rawItem = await getWixCmsItemById(collection.collectionId, itemId);
    if (!rawItem) {
      return noStore({ error: "Không tìm thấy item trong Wix CMS.", code: "ITEM_NOT_FOUND" }, { status: 404 });
    }

    const fieldDefs = getTranslatableFields(schema);
    const content = await queryContentForEntity(schema.id, itemId, targetLocale);

    const fields = fieldDefs.map((def) => {
      const type = (schema.fields[def.key]?.type as CmsFieldValueType) || "LONG_TEXT";
      const isHtml = type === "HTML";
      const sourceVal = rawItem[def.key];
      const sourceValue = sourceVal != null ? String(sourceVal) : "";
      const translatedField = content?.fields[def.key];
      const translatedValue = translatedField?.textValue ?? null;
      return {
        key: def.key,
        displayName: def.displayName,
        type,
        sourceValue: isHtml ? sanitizeHtmlForPreview(sourceValue) : sourceValue,
        translatedValue: isHtml && translatedValue != null ? sanitizeHtmlForPreview(translatedValue) : translatedValue,
        published: translatedField?.published ?? false,
      };
    });

    const anyPublished = fields.some((f) => f.published);
    const anyTranslated = fields.some((f) => f.translatedValue);
    const status: CmsTranslationStatus = anyPublished ? "published" : anyTranslated ? "draft" : "none";

    const response: WixTranslatedContentResponse = {
      itemId,
      itemName: resolveItemName(rawItem, itemId),
      targetLocale,
      status,
      fields,
    };
    return noStore(response);
  } catch (err) {
    if (err instanceof WixMultilingualError || err instanceof WixServerClientError) {
      return noStore({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error("[/api/admin/wix-translations/content] Unexpected error:", err);
    return noStore({ error: "Internal server error." }, { status: 500 });
  }
}
