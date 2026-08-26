/**
 * GET /api/admin/wix-translations/items
 * ─────────────────────────────────────────────────────────────────────────────
 * Paginated, searchable list of CMS items from an allowlisted collection,
 * annotated with each item's translation status for the requested target
 * locale. `collectionKey` is resolved server-side — the client never supplies
 * a raw Wix collection ID.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminSession } from "@/lib/services/wixCatalogPdf";
import { resolveCollection } from "@/config/wix-translation.config";
import { getWixCmsItems, getWixCollectionSchema } from "@/services/wix-translation/wix-cms.service";
import { queryContentForEntity, WixMultilingualError } from "@/services/wix-translation/wix-multilingual.service";
import { WixServerClientError } from "@/lib/wix/server-client";
import { mapWithConcurrency } from "@/lib/utils/concurrencyLimit";
import type { CmsTranslationStatus, WixTranslationItemsResponse, WixTranslationListItem } from "@/types/wix-translation";

export const runtime = "nodejs";

const querySchema = z.object({
  collectionKey: z.string().min(1).max(100),
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  search: z.string().max(200).optional().default(""),
  targetLocale: z.string().min(1).max(20),
});

function noStore(json: unknown, init?: ResponseInit) {
  const res = NextResponse.json(json, init);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

async function statusFor(schemaId: string | null, itemId: string, targetLocale: string): Promise<CmsTranslationStatus> {
  if (!schemaId) return "none";
  try {
    const content = await queryContentForEntity(schemaId, itemId, targetLocale);
    if (!content) return "none";
    const anyPublished = Object.values(content.fields).some((f) => f.published === true);
    return anyPublished ? "published" : "draft";
  } catch {
    return "none";
  }
}

export async function GET(req: NextRequest) {
  if (!checkAdminSession(req)) {
    return noStore({ error: "Unauthorized: Administrator access required." }, { status: 401 });
  }

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return noStore({ error: "Invalid query parameters.", details: parsed.error.flatten() }, { status: 400 });
  }
  const { collectionKey, page, limit, search, targetLocale } = parsed.data;

  const collection = resolveCollection(collectionKey);
  if (!collection) {
    return noStore({ error: `Collection "${collectionKey}" không nằm trong danh sách cho phép.`, code: "COLLECTION_NOT_ALLOWED" }, { status: 422 });
  }

  try {
    const [page_, schema] = await Promise.all([
      getWixCmsItems({ collectionId: collection.collectionId, page, limit, search }),
      getWixCollectionSchema(collection.collectionId).catch(() => null),
    ]);

    const items: WixTranslationListItem[] = await mapWithConcurrency(page_.items, 5, async (raw): Promise<WixTranslationListItem> => {
      const data = raw.data;
      const name = String(data.title ?? data.Title ?? data.product ?? data.Product ?? raw.itemId);
      const model = data.product != null ? String(data.product) : data.Product != null ? String(data.Product) : undefined;
      const brand = data.brand != null ? String(data.brand) : data.Brand != null ? String(data.Brand) : undefined;
      const translationStatus = await statusFor(schema?.id || null, raw.itemId, targetLocale);
      return { itemId: raw.itemId, name, model, brand, updatedDate: raw.updatedDate, translationStatus };
    });

    const response: WixTranslationItemsResponse = { items, page, limit, total: page_.total };
    return noStore(response);
  } catch (err) {
    if (err instanceof WixMultilingualError || err instanceof WixServerClientError) {
      return noStore({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error("[/api/admin/wix-translations/items] Unexpected error:", err);
    return noStore({ error: "Internal server error." }, { status: 500 });
  }
}
