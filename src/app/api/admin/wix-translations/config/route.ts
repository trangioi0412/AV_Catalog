/**
 * GET /api/admin/wix-translations/config
 * ─────────────────────────────────────────────────────────────────────────────
 * Returns only what the admin UI needs to render its selectors — allowed
 * collections, real Wix Multilingual locales, translatable fields for the
 * default collection, batch limit, and translation-provider readiness.
 * Never returns API keys, tokens, or internal schema plumbing.
 */

import { NextRequest, NextResponse } from "next/server";
import { checkAdminSession } from "@/lib/services/wixCatalogPdf";
import { isWixConfigured } from "@/lib/wix/server-client";
import { ALLOWED_COLLECTIONS, DEFAULT_COLLECTION_KEY, MAX_TRANSLATION_BATCH_SIZE } from "@/config/wix-translation.config";
import { getWixCollectionSchema } from "@/services/wix-translation/wix-cms.service";
import { getTranslatableFields, listLocales } from "@/services/wix-translation/wix-multilingual.service";
import {
  getTranslationProviderName,
  isTranslationProviderConfigured,
  listAvailableTranslationProviders,
  listOllamaModels,
} from "@/services/wix-translation/translation-provider.service";
import type { WixTranslationConfigResponse } from "@/types/wix-translation";

export const runtime = "nodejs";

function noStore(json: unknown, init?: ResponseInit) {
  const res = NextResponse.json(json, init);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function GET(req: NextRequest) {
  if (!checkAdminSession(req)) {
    return noStore({ error: "Unauthorized: Administrator access required." }, { status: 401 });
  }

  const warnings: string[] = [];
  const collections = Object.entries(ALLOWED_COLLECTIONS).map(([key, def]) => ({ key, label: def.label }));
  const wixConfigured = isWixConfigured();

  const requestedCollectionKey = req.nextUrl.searchParams.get("collectionKey");
  const activeCollectionKey =
    requestedCollectionKey && ALLOWED_COLLECTIONS[requestedCollectionKey] ? requestedCollectionKey : DEFAULT_COLLECTION_KEY;

  let locales: WixTranslationConfigResponse["locales"] = [];
  let fields: WixTranslationConfigResponse["fields"] = [];
  let multilingualReady = false;
  let defaultSourceLocale: string | null = null;
  let defaultTargetLocale: string | null = null;

  if (!wixConfigured) {
    warnings.push("Wix chưa được cấu hình (thiếu WIX_API_KEY / WIX_SITE_ID trong biến môi trường).");
  } else {
    try {
      const wixLocales = await listLocales();
      locales = wixLocales.map((l) => ({
        id: l.id,
        languageCode: l.languageCode,
        label: `${l.languageCode.toUpperCase()}${l.primaryLocale ? " (mặc định)" : ""}`,
        isPrimary: l.primaryLocale,
      }));
      defaultSourceLocale = wixLocales.find((l) => l.primaryLocale)?.id || null;
      defaultTargetLocale =
        wixLocales.find((l) => !l.primaryLocale && l.visibility === "VISIBLE" && l.languageCode === "en")?.id ||
        wixLocales.find((l) => !l.primaryLocale && l.visibility === "VISIBLE")?.id ||
        null;
      if (locales.length === 0) {
        warnings.push("Wix Multilingual chưa được cài đặt hoặc chưa có ngôn ngữ nào được cấu hình cho site này.");
      }
    } catch (err) {
      warnings.push(`Không thể tải danh sách ngôn ngữ từ Wix Multilingual: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      const activeCollection = ALLOWED_COLLECTIONS[activeCollectionKey];
      const schema = await getWixCollectionSchema(activeCollection.collectionId);
      if (schema) {
        multilingualReady = true;
        fields = getTranslatableFields(schema).map((f) => ({
          key: f.key,
          displayName: f.displayName,
          type: (schema.fields[f.key]?.type as "SHORT_TEXT" | "LONG_TEXT" | "HTML") || "LONG_TEXT",
        }));
      } else {
        warnings.push(
          `Không tìm thấy translation schema cho collection "${activeCollection.label}". Hãy thêm collection này vào Wix Translation Manager và đánh dấu field có thể dịch.`
        );
      }
    } catch (err) {
      warnings.push(`Không thể tải translation schema từ Wix: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const providerConfigured = isTranslationProviderConfigured();
  if (!providerConfigured) {
    warnings.push("Translation provider chưa được cấu hình (thiếu OLLAMA_BASE_URL, GPT_API_KEY, hoặc GEMINI_API_KEY).");
  }

  const availableProviders = listAvailableTranslationProviders();
  const ollamaModels = availableProviders.some((p) => p.kind === "ollama" && p.configured)
    ? await listOllamaModels()
    : [];

  const response: WixTranslationConfigResponse = {
    collections,
    locales,
    defaultSourceLocale,
    defaultTargetLocale,
    fields,
    maxBatchSize: MAX_TRANSLATION_BATCH_SIZE,
    translationProvider: { name: getTranslationProviderName(), configured: providerConfigured },
    availableProviders,
    ollamaModels,
    wixConfigured,
    multilingualReady,
    warnings,
  };

  return noStore(response);
}
