/**
 * POST /api/catalog-upload/translate-fields
 * ─────────────────────────────────────────────────────────────────────────────
 * Translates a set of ad-hoc text fields from one Catalog Upload row to a
 * single target language, using the same provider-agnostic
 * translationProvider.ts (Ollama/GPT/Gemini) the "Dịch CMS" and "Dịch đa
 * ngôn ngữ" admin tools use — but WITHOUT requiring the row to already exist
 * as a Wix CMS item (both of those tools are keyed to a Wix itemId/entityId,
 * which a Catalog Upload row generally doesn't have yet).
 *
 * Intended for the "mixed_language" AI Review finding — a field whose text
 * inconsistently mixes English and Vietnamese — but works on any text fields.
 * Defaults to en->vi since that's the mixed-content direction AI Review
 * flags in practice for this catalog; sourceLocale/targetLocale are
 * overridable if a caller needs the other direction.
 *
 * Admin-only. `proxy.ts` excludes `/api/*` from its route protection, so the
 * admin_session cookie is re-checked here (same pattern as
 * /api/catalog-upload/ai-review).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminSession } from "@/lib/services/wixCatalogPdf";
import { getTranslationProvider, TranslationProviderError, isTranslationProviderConfigured } from "@/lib/services/translationProvider";

export const runtime = "nodejs";
export const maxDuration = 120;

const requestSchema = z.object({
  fields: z.record(z.string(), z.string()).refine((f) => Object.keys(f).length > 0 && Object.keys(f).length <= 10, {
    message: "fields must have between 1 and 10 entries",
  }),
  brand: z.string().max(200).optional(),
  category: z.string().max(200).optional(),
  productName: z.string().max(300).optional(),
  sourceLocale: z.string().min(2).max(10).optional(),
  targetLocale: z.string().min(2).max(10).optional(),
});

function noStore(json: unknown, init?: ResponseInit) {
  const res = NextResponse.json(json, init);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function POST(req: NextRequest) {
  if (!(await checkAdminSession(req, "editor"))) {
    return noStore({ error: "Unauthorized: Administrator access required." }, { status: 401 });
  }

  if (!isTranslationProviderConfigured()) {
    return noStore(
      { error: "No translation provider configured (OLLAMA_BASE_URL, GPT_API_KEY, or GEMINI_API_KEY).", code: "NOT_CONFIGURED" },
      { status: 503 }
    );
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
    const provider = getTranslationProvider();
    const result = await provider.translate({
      fields: parsed.data.fields,
      context: {
        brand: parsed.data.brand,
        category: parsed.data.category,
        productName: parsed.data.productName,
      },
      sourceLocale: parsed.data.sourceLocale || "en",
      targetLocale: parsed.data.targetLocale || "vi",
    });
    return noStore({ fields: result.fields, warnings: result.warnings });
  } catch (err) {
    if (err instanceof TranslationProviderError) {
      const status = err.code === "NOT_CONFIGURED" ? 503 : err.code === "RATE_LIMITED" ? 429 : 502;
      return noStore({ error: err.message, code: err.code }, { status });
    }
    console.error("[/api/catalog-upload/translate-fields] Unexpected error:", err);
    return noStore({ error: "Internal server error." }, { status: 500 });
  }
}
