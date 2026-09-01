/**
 * GET /api/admin/cms-translate/fields
 * ─────────────────────────────────────────────────────────────────────────────
 * Lists the real field names of an allowlisted Wix CMS collection, so the
 * "Dịch CMS Anh → Việt" UI can offer a dropdown of actual fields instead of
 * letting an admin type a field key that doesn't exist. `collectionKey` is
 * resolved server-side against the same allowlist as the rest of the CMS
 * translation feature — never a raw Wix collection ID from the client.
 *
 * Admin-only. `proxy.ts` excludes `/api/*` from its route protection, so the
 * admin_session cookie is re-checked here (same pattern as the other admin routes).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminSession } from "@/lib/services/wixCatalogPdf";
import { resolveCollection } from "@/config/wix-translation.config";
import { getWixCollectionFields } from "@/services/wix-translation/wix-cms.service";
import { WixServerClientError } from "@/lib/wix/server-client";

export const runtime = "nodejs";

// Wix Data metadata fields — never a valid translation source/target, so hidden from the picker.
const SYSTEM_FIELD_DENYLIST = new Set(["_id", "_owner", "_createdDate", "_updatedDate", "_updatedDateVersion"]);

const querySchema = z.object({
  collectionKey: z.string().min(1).max(100),
});

function noStore(json: unknown, init?: ResponseInit) {
  const res = NextResponse.json(json, init);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function GET(req: NextRequest) {
  if (!checkAdminSession(req)) {
    return noStore({ error: "Unauthorized: Administrator access required." }, { status: 401 });
  }

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return noStore({ error: "Invalid query parameters.", details: parsed.error.flatten() }, { status: 400 });
  }

  const collection = resolveCollection(parsed.data.collectionKey);
  if (!collection) {
    return noStore(
      { error: `Collection "${parsed.data.collectionKey}" không nằm trong danh sách cho phép.`, code: "COLLECTION_NOT_ALLOWED" },
      { status: 422 }
    );
  }

  try {
    const allFields = await getWixCollectionFields(collection.collectionId);
    const fields = allFields.filter((f) => !SYSTEM_FIELD_DENYLIST.has(f.key));
    return noStore({ fields });
  } catch (err) {
    if (err instanceof WixServerClientError) return noStore({ error: err.message, code: err.code }, { status: err.status });
    console.error("[/api/admin/cms-translate/fields] Unexpected error:", err);
    return noStore({ error: "Internal server error." }, { status: 500 });
  }
}
