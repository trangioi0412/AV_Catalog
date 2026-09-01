/**
 * GET /api/admin/cms-translate/items
 * ─────────────────────────────────────────────────────────────────────────────
 * Paginated, searchable list of CMS items for the "Dịch CMS Anh → Việt" item
 * picker — deliberately separate from `/api/admin/wix-translations/items`,
 * which is specific to Wix Multilingual's translation-schema model and
 * doesn't apply here (this feature's fields are plain sibling columns like
 * `title_EN`/`title_VI`, not a Wix Multilingual schema).
 *
 * Each item is annotated with `translated` (whether every field in
 * `targetFields` — the target side of the caller's current field mappings —
 * already has non-empty content, so the UI can hide already-translated
 * items) and `untranslatedFields` (which of those target field keys are
 * still missing, so the UI can show exactly what's left instead of just a
 * yes/no). `getWixCmsItems()` already returns each item's full raw field
 * data in one query, so this needs no extra per-item Wix calls.
 *
 * `collectionKey` is resolved server-side against the allowlist — the client
 * never supplies a raw Wix collection ID.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminSession } from "@/lib/services/wixCatalogPdf";
import { resolveCollection } from "@/config/wix-translation.config";
import { getWixCmsItems } from "@/services/wix-translation/wix-cms.service";
import { WixServerClientError } from "@/lib/wix/server-client";

export const runtime = "nodejs";

const querySchema = z.object({
  collectionKey: z.string().min(1).max(100),
  page: z.coerce.number().int().min(1).max(100000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  search: z.string().max(200).optional().default(""),
  /** Comma-separated target field keys — the target side of the caller's current field mappings. */
  targetFields: z.string().max(2000).optional().default(""),
});

function noStore(json: unknown, init?: ResponseInit) {
  const res = NextResponse.json(json, init);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function resolveItemName(data: Record<string, unknown>, fallback: string): string {
  const title = data.title ?? data.Title;
  const name = data.name ?? data.Name;
  const product = data.product ?? data.Product;
  return String(title || name || product || fallback);
}

export async function GET(req: NextRequest) {
  if (!checkAdminSession(req)) {
    return noStore({ error: "Unauthorized: Administrator access required." }, { status: 401 });
  }

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return noStore({ error: "Invalid query parameters.", details: parsed.error.flatten() }, { status: 400 });
  }
  const { collectionKey, page, limit, search, targetFields } = parsed.data;

  const collection = resolveCollection(collectionKey);
  if (!collection) {
    return noStore({ error: `Collection "${collectionKey}" không nằm trong danh sách cho phép.`, code: "COLLECTION_NOT_ALLOWED" }, { status: 422 });
  }

  const targetFieldKeys = targetFields
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    const { items: rawItems, total } = await getWixCmsItems({ collectionId: collection.collectionId, page, limit, search });

    const items = rawItems.map((raw) => {
      const untranslatedFields = targetFieldKeys.filter((key) => {
        const val = raw.data[key];
        return !(typeof val === "string" && val.trim() !== "");
      });
      return {
        itemId: raw.itemId,
        name: resolveItemName(raw.data, raw.itemId),
        translated: targetFieldKeys.length > 0 && untranslatedFields.length === 0,
        untranslatedFields,
      };
    });

    return noStore({ items, page, limit, total });
  } catch (err) {
    if (err instanceof WixServerClientError) {
      return noStore({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error("[/api/admin/cms-translate/items] Unexpected error:", err);
    return noStore({ error: "Internal server error." }, { status: 500 });
  }
}
