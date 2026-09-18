/**
 * cmsSyncCompare.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * "Compare a product's natural-language fields (Title / Main Feature /
 * Product Overview) against a CMS-side value, normalizing language first"
 * logic used by cms-sync-check-csv/route.ts. `cmsFields` there comes from a
 * CSV the admin exported from Wix and uploaded — this function itself has no
 * idea where its inputs came from, so it stays reusable if a second CMS Sync
 * source is ever added (a prior version of this dashboard did compare
 * against a live per-product Wix lookup; that was replaced because looking
 * up every product one at a time over the network was the actual bottleneck
 * for any catalog of real size — the CSV path does zero Wix API calls).
 *
 * Server-only: never import this from a Client Component (pulls in the
 * translation provider, which reads server env vars).
 */

import { getTranslationProvider } from "./translationProvider";
import { looksVietnamese } from "../utils/languageUtils";

export const NATURAL_LANGUAGE_FIELD_DEFS = [
  { key: "Title", label: "Title" },
  { key: "MainFeature", label: "Main Feature" },
  { key: "ProductOverview", label: "Product Overview" },
] as const;

export type NaturalLanguageFieldKey = (typeof NATURAL_LANGUAGE_FIELD_DEFS)[number]["key"];

export type NaturalLanguageFields = Partial<Record<NaturalLanguageFieldKey, string>>;

export interface CmsSyncDiff {
  field: string;
  localValue: string;
  cmsValue: string;
  status: "same" | "different" | "missing_in_cms" | "missing_locally";
  wasTranslated?: boolean;
  /** A translation was attempted (text didn't look Vietnamese) but the provider failed — localValue/cmsValue are the untouched originals, so this diff may just be a language mismatch rather than a real content difference. */
  translationFailed?: boolean;
}

/** `success: false` means the provider call itself failed (e.g. Ollama unreachable) — `text` is then just the untouched original, NOT a real translation, so callers must not treat it as one. */
async function translateToVietnamese(text: string): Promise<{ text: string; success: boolean }> {
  try {
    const provider = getTranslationProvider();
    const result = await provider.translate({ fields: { value: text }, sourceLocale: "en", targetLocale: "vi" });
    return { text: result.fields.value || text, success: true };
  } catch (err) {
    console.warn("[cmsSyncCompare] Translation failed, keeping original text:", err);
    return { text, success: false };
  }
}

/**
 * Diffs the three natural-language fields between a local catalog row and
 * its CMS-side counterpart (however `cmsFields` was sourced), normalizing
 * whichever side isn't Vietnamese before comparing — otherwise a field
 * that's substantively identical but stored in English on one side and
 * Vietnamese on the other reads as "different" for no real reason. Returns
 * one diff per field, `status: "same"` included (callers filter those out
 * for display, but the raw diff is still useful for exports/debugging).
 */
export async function computeNaturalLanguageDiffs(
  localFields: NaturalLanguageFields,
  cmsFields: NaturalLanguageFields | null | undefined,
  translationAvailable: boolean
): Promise<CmsSyncDiff[]> {
  if (!cmsFields) return [];

  const diffs: CmsSyncDiff[] = [];
  for (const { key, label } of NATURAL_LANGUAGE_FIELD_DEFS) {
    const localRaw = (localFields[key] || "").trim();
    const cmsRaw = (cmsFields[key] || "").trim();

    let status: CmsSyncDiff["status"];
    if (!cmsRaw && localRaw) status = "missing_in_cms";
    else if (!localRaw && cmsRaw) status = "missing_locally";
    else if (localRaw === cmsRaw) status = "same";
    else status = "different";

    if (status === "same" || !translationAvailable) {
      diffs.push({ field: label, localValue: localRaw, cmsValue: cmsRaw, status });
      continue;
    }

    let localValue = localRaw;
    let cmsValue = cmsRaw;
    let wasTranslated = false;
    let translationFailed = false;

    if (localValue && !looksVietnamese(localValue)) {
      const r = await translateToVietnamese(localValue);
      localValue = r.text;
      if (r.success) wasTranslated = true;
      else translationFailed = true;
    }
    if (cmsValue && !looksVietnamese(cmsValue)) {
      const r = await translateToVietnamese(cmsValue);
      cmsValue = r.text;
      if (r.success) wasTranslated = true;
      else translationFailed = true;
    }

    // Re-derive status from the Vietnamese-normalized values — a field that
    // was only "different" because the two sides were in different
    // languages should now correctly read as the same. Only do this when a
    // translation actually succeeded — if it failed, localValue/cmsValue
    // are just the untouched originals and the original status still holds.
    if (wasTranslated) {
      if (!cmsValue && localValue) status = "missing_in_cms";
      else if (!localValue && cmsValue) status = "missing_locally";
      else if (localValue.trim().toLowerCase() === cmsValue.trim().toLowerCase()) status = "same";
      else status = "different";
    }

    diffs.push({ field: label, localValue, cmsValue, status, wasTranslated, translationFailed });
  }

  return diffs;
}
