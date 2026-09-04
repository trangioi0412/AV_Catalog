/**
 * translate-cms.service.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * `translateCmsEnglishToVietnamese()` — reads a field directly off a Wix CMS
 * item, translates it, and (only once a human has reviewed and approved it)
 * writes the result into a sibling field on the SAME item (config-driven
 * field pairs, e.g. `title_EN` -> `title_VI` — never hard-coded to one
 * field). Despite the function's name, direction isn't fixed to English ->
 * Vietnamese — `sourceLocale`/`targetLocale` on `TranslateCmsOptions` (default
 * "en" -> "vi") pick which language is read and which is written, so the same
 * flow also runs Vietnamese -> English. A mapping's source and target field
 * may also be the SAME field ("in place" translation, for a field with no
 * separate sibling in the other language) — always gated by `overwrite`, see
 * `validateFieldMappings()`.
 *
 * A field mapping's `type` also controls HOW its value is read/written:
 * "text"/"richText" expect a plain string; "json" expects an array or object
 * (e.g. a FAQ list, a spec array of `{key, value}` objects) — every string
 * leaf inside gets translated and the shape is preserved, see
 * `flattenTranslatableLeaves()`/`rebuildWithTranslations()`.
 *
 * Two-step, human-in-the-loop flow — see `CmsTranslationMode`:
 *   - mode "preview": AI-translates the selected fields and returns them;
 *     never writes to Wix.
 *   - mode "write": writes back exactly the admin-approved (possibly
 *     hand-edited) values submitted from that preview — never calls the AI
 *     provider again, so a stray/incorrect AI answer can't reach the CMS
 *     without a person having looked at it first. Records each successfully
 *     WRITTEN field's timestamp (`translation-timestamp-store.ts`) and skips
 *     re-translating it on a later preview run within
 *     `RECENTLY_TRANSLATED_COOLDOWN_MS` — a rerun (e.g. of "Chọn toàn bộ")
 *     shouldn't re-translate fields a prior run already landed in Wix CMS.
 *     Deliberately NOT recorded on a mere preview: a translation the admin
 *     never approved (or that failed to write) must stay eligible for an
 *     immediate retry, not get cooled down as if it had already succeeded.
 *
 * Reuses the project's existing building blocks rather than introducing a
 * parallel stack:
 *   - collection allowlist:      `@/config/wix-translation.config`
 *   - Wix CMS item read/write:   `@/services/wix-translation/wix-cms.service`
 *   - AI translation provider:   `@/lib/services/translationProvider` (Ollama/GPT/Gemini)
 *   - HTML sanitizing:           `@/services/wix-translation/translation-mapper.service`
 *   - bounded concurrency:       `@/lib/utils/concurrencyLimit`
 *   - "just translated" cooldown: `./translation-timestamp-store`
 *
 * One item's failure never aborts the batch — every item gets its own result.
 */

import { resolveCollection } from "@/config/wix-translation.config";
import { getWixCmsItems, getWixCmsItemById, updateWixCmsItemFields } from "@/services/wix-translation/wix-cms.service";
import { sanitizeHtmlForPreview } from "@/services/wix-translation/translation-mapper.service";
import { mapWithConcurrency } from "@/lib/utils/concurrencyLimit";
import { getLastTranslatedAt, recordTranslated } from "./translation-timestamp-store";
import {
  getTranslationProvider,
  getSafeConcurrency,
  getTranslationProviderKind,
  stripCodeFence,
  TranslationProviderError,
  type TranslationProvider,
  type TranslationRequest,
  type TranslationResult,
} from "@/lib/services/translationProvider";
import type {
  CmsFieldContentType,
  FieldMapping,
  TranslateCmsItemInput,
  TranslateCmsItemResult,
  TranslateCmsOptions,
  TranslateCmsResult,
  TranslateCmsSummary,
} from "./cms-translation.types";

const DEFAULT_BATCH_SIZE = 5;
const MAX_BATCH_SIZE = 20;
const MAX_CONCURRENCY = 5;
// Wix's own per-minute write quota (see updateWixCmsItemFields()'s retry) is shared across
// however much else is hitting the site at the same time, so a bulk write run stays modest
// on purpose — retry-with-backoff is the real defense; this just makes hitting it less likely.
const WRITE_CONCURRENCY = 3;
/** Safety cap when no `itemIds` are given, so a huge collection can't run away unbounded. */
const MAX_AUTO_ITEMS = 500;
const RETRY_MAX_ATTEMPTS = 2;
const RETRY_BASE_DELAY_MS = 800;
/** How recently an item must have been AI-translated to skip it again — see translation-timestamp-store.ts. */
const RECENTLY_TRANSLATED_COOLDOWN_MS = 15 * 60 * 1000;

export type TranslateCmsErrorCode = "VALIDATION_ERROR" | "COLLECTION_NOT_ALLOWED";

export class TranslateCmsError extends Error {
  readonly code: TranslateCmsErrorCode;
  readonly status: number;
  constructor(message: string, code: TranslateCmsErrorCode, status: number) {
    super(message);
    this.name = "TranslateCmsError";
    this.code = code;
    this.status = status;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retries a translation call on transient provider errors only — never on NOT_CONFIGURED/INVALID_RESPONSE, and never more than `maxRetries` times. */
async function translateWithRetry(
  provider: TranslationProvider,
  request: TranslationRequest,
  maxRetries = RETRY_MAX_ATTEMPTS,
  baseDelayMs = RETRY_BASE_DELAY_MS
): Promise<TranslationResult> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await provider.translate(request);
    } catch (err) {
      lastErr = err;
      const retryable = err instanceof TranslationProviderError && (err.code === "TIMEOUT" || err.code === "RATE_LIMITED" || err.code === "UPSTREAM_ERROR");
      if (!retryable || attempt === maxRetries) throw err;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastErr;
}

function resolveItemName(rawItem: Record<string, unknown>, fallback: string): string {
  const title = rawItem.title ?? rawItem.Title;
  const name = rawItem.name ?? rawItem.Name;
  const product = rawItem.product ?? rawItem.Product;
  return String(title || name || product || fallback);
}

function isStructuredValue(value: unknown): value is unknown[] | Record<string, unknown> {
  return Array.isArray(value) || (typeof value === "object" && value !== null);
}

function isEmptyStructuredValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (value && typeof value === "object") return Object.keys(value).length === 0;
  return true;
}

/**
 * A `type: "json"` field's value may be stored either as a native Wix Array/Object field
 * (comes back from `getWixCmsItemById` already parsed) OR as a JSON-serialized STRING inside
 * an ordinary Text field (a common workaround when the collection never got a real
 * Array/Object column) — e.g. `"[{\"label\":\"...\",\"value\":\"...\"}]"`. This recognizes the
 * second case so it isn't silently skipped as "not structured", without false-positiving on
 * an unrelated string that merely starts with "[" or "{".
 */
function parseIfJsonString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return value;
  try {
    const parsed = JSON.parse(trimmed);
    return isStructuredValue(parsed) ? parsed : value;
  } catch {
    return value;
  }
}

/**
 * Collects every non-empty string leaf inside `value` (recursing through arrays/objects,
 * e.g. a FAQ list or a spec array of `{key, value}` objects) into `out`, keyed by its JSON
 * path prefixed with `prefix` (e.g. "faq.0.answer"). Numbers/booleans/null and empty
 * strings are left out — only real text goes to the AI.
 */
function flattenTranslatableLeaves(value: unknown, prefix: string, out: Record<string, string>): void {
  if (typeof value === "string") {
    if (value.trim() !== "") out[prefix] = value;
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => flattenTranslatableLeaves(v, `${prefix}.${i}`, out));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flattenTranslatableLeaves(v, `${prefix}.${k}`, out);
    }
  }
}

/**
 * Rebuilds `value`'s exact array/object shape with each string leaf replaced by its
 * translation from `translations` (looked up by the same path `flattenTranslatableLeaves`
 * produced) — falls back to the original string if a path is unexpectedly missing.
 */
function rebuildWithTranslations(value: unknown, prefix: string, translations: Record<string, string>): unknown {
  if (typeof value === "string") {
    if (value.trim() === "") return value;
    return translations[prefix] ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((v, i) => rebuildWithTranslations(v, `${prefix}.${i}`, translations));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, rebuildWithTranslations(v, `${prefix}.${k}`, translations)])
    );
  }
  return value;
}

/** Pages through the whole collection to build an item ID list, when the caller didn't select specific items. Bounded by `MAX_AUTO_ITEMS`. */
async function collectAllItemIds(collectionId: string, pageSize: number): Promise<string[]> {
  const ids: string[] = [];
  let page = 1;
  while (ids.length < MAX_AUTO_ITEMS) {
    const { items, total } = await getWixCmsItems({ collectionId, page, limit: pageSize });
    if (items.length === 0) break;
    ids.push(...items.map((i) => i.itemId));
    if (ids.length >= total) break;
    page++;
  }
  return ids.slice(0, MAX_AUTO_ITEMS);
}

// sourceField === targetField is intentionally allowed — some collection fields have no
// separate EN/VI sibling (e.g. "Main Feature"), so translating "in place" and overwriting
// the same field is the only option for them. `overwrite` (in translateOneItemPreview /
// translateOneItemWrite below) already gates this safely: since source and target read the
// exact same value, `targetHasData` is true whenever there's anything to translate, so the
// field is skipped unless the admin explicitly turns overwrite on — never a silent overwrite.
function validateFieldMappings(fieldMappings: FieldMapping[]): void {
  if (!fieldMappings || fieldMappings.length === 0) {
    throw new TranslateCmsError("fieldMappings phải có ít nhất một mapping.", "VALIDATION_ERROR", 400);
  }
}

function buildSummary(items: TranslateCmsItemResult[]): TranslateCmsSummary {
  return {
    total: items.length,
    translated: items.filter((i) => i.status === "translated").length,
    updated: items.filter((i) => i.status === "updated").length,
    skipped: items.filter((i) => i.status === "skipped").length,
    failed: items.filter((i) => i.status === "failed").length,
  };
}

/** mode "preview" — AI-translates one item's fields. Never writes to Wix. */
async function translateOneItemPreview(
  collectionId: string,
  itemId: string,
  fieldMappings: FieldMapping[],
  overwrite: boolean,
  sourceLocale: string,
  targetLocale: string
): Promise<TranslateCmsItemResult> {
  let name = itemId;
  try {
    const rawItem = await getWixCmsItemById(collectionId, itemId);
    if (!rawItem) {
      return { itemId, name, status: "skipped", reason: "Item not found in Wix CMS." };
    }
    name = resolveItemName(rawItem, itemId);

    // Only the fields that actually need translating are sent to the AI — never
    // the whole item, and never a target field that already has content unless
    // `overwrite` is set. "json" mappings (array/object fields) contribute one flat
    // key per string leaf instead of one key for the whole field — see
    // flattenTranslatableLeaves() — so the AI still just sees a flat string map.
    const fieldsToTranslate: Record<string, string> = {};
    const typeByTargetKey: Record<string, CmsFieldContentType> = {};
    const structuredSourceByTargetKey: Record<string, unknown> = {};
    let anyTargetHadData = false;
    let anyCooldownSkip = false;
    let cooldownMessage: string | undefined;

    for (const mapping of fieldMappings) {
      // Per FIELD, not per item — translating "faq" a moment ago must never block
      // translating an unrelated "technicalSpecifications" on the very same item.
      const lastTranslatedAt = getLastTranslatedAt(collectionId, itemId, mapping.targetField);
      if (lastTranslatedAt && Date.now() - new Date(lastTranslatedAt).getTime() < RECENTLY_TRANSLATED_COOLDOWN_MS) {
        anyCooldownSkip = true;
        cooldownMessage = `Field "${mapping.targetField}" vừa được dịch lúc ${new Date(lastTranslatedAt).toLocaleString("vi-VN")} — bỏ qua để tránh dịch lại.`;
        continue;
      }

      const sourceValue = rawItem[mapping.sourceField];
      const currentTargetValue = rawItem[mapping.targetField];

      if (mapping.type === "json") {
        // The Wix field may be a real Array/Object column (comes back already parsed) or a
        // Text column storing serialized JSON (comes back as a string) — parseIfJsonString()
        // normalizes either into the actual structure so both are recognized the same way.
        const structuredSource = parseIfJsonString(sourceValue);
        if (!isStructuredValue(structuredSource) || isEmptyStructuredValue(structuredSource)) continue;
        const structuredTarget = parseIfJsonString(currentTargetValue);
        const targetHasData = isStructuredValue(structuredTarget) && !isEmptyStructuredValue(structuredTarget);
        if (targetHasData) anyTargetHadData = true;
        if (targetHasData && !overwrite) continue;

        const leaves: Record<string, string> = {};
        flattenTranslatableLeaves(structuredSource, mapping.targetField, leaves);
        if (Object.keys(leaves).length === 0) continue; // no translatable text inside

        Object.assign(fieldsToTranslate, leaves);
        typeByTargetKey[mapping.targetField] = mapping.type;
        structuredSourceByTargetKey[mapping.targetField] = structuredSource;
        continue;
      }

      if (typeof sourceValue !== "string" || sourceValue.trim() === "") continue; // empty/non-string source — skip this field silently

      const targetHasData = typeof currentTargetValue === "string" && currentTargetValue.trim() !== "";
      if (targetHasData) anyTargetHadData = true;
      if (targetHasData && !overwrite) continue;

      fieldsToTranslate[mapping.targetField] = sourceValue;
      typeByTargetKey[mapping.targetField] = mapping.type;
    }

    if (Object.keys(fieldsToTranslate).length === 0) {
      return {
        itemId,
        name,
        status: "skipped",
        reason: anyTargetHadData
          ? "Target field already contains data"
          : anyCooldownSkip
          ? cooldownMessage
          : "No source content to translate",
      };
    }

    const provider = getTranslationProvider();
    const result = await translateWithRetry(provider, {
      fields: fieldsToTranslate,
      sourceLocale,
      targetLocale,
      context: { productName: name },
    });

    const translatedFieldValues: Record<string, string> = {};
    const sourcePreviewByTargetKey: Record<string, string> = {};

    for (const targetKey of Object.keys(typeByTargetKey)) {
      const type = typeByTargetKey[targetKey];

      if (type === "json") {
        const structuredSource = structuredSourceByTargetKey[targetKey];
        const prefixDot = `${targetKey}.`;
        const leafTranslations: Record<string, string> = {};
        for (const [flatKey, rawTranslated] of Object.entries(result.fields)) {
          if (!flatKey.startsWith(prefixDot)) continue;
          const cleaned = stripCodeFence(String(rawTranslated ?? "")).trim();
          if (!cleaned) {
            throw new Error(`Translation provider returned an empty response for field "${flatKey}".`);
          }
          leafTranslations[flatKey] = cleaned;
        }
        const rebuilt = rebuildWithTranslations(structuredSource, targetKey, leafTranslations);
        translatedFieldValues[targetKey] = JSON.stringify(rebuilt, null, 2);
        sourcePreviewByTargetKey[targetKey] = JSON.stringify(structuredSource, null, 2);
        continue;
      }

      const rawTranslated = result.fields[targetKey];
      const cleaned = stripCodeFence(String(rawTranslated ?? "")).trim();
      if (!cleaned) {
        throw new Error(`Translation provider returned an empty response for field "${targetKey}".`);
      }
      translatedFieldValues[targetKey] = type === "richText" ? sanitizeHtmlForPreview(cleaned) : cleaned;
      sourcePreviewByTargetKey[targetKey] = fieldsToTranslate[targetKey];
    }

    // Cooldown is recorded on WRITE (translateOneItemWrite), not here — an AI preview that
    // never gets approved/written (admin rejects it, the write fails, or they just navigate
    // away) must not block a retry preview of the same field, only a field actually written
    // to Wix CMS counts as "just translated".
    const fieldValues = Object.fromEntries(
      Object.entries(translatedFieldValues).map(([key, translated]) => [key, { source: sourcePreviewByTargetKey[key], translated }])
    );
    return { itemId, name, status: "translated", translatedFields: Object.keys(translatedFieldValues), fieldValues };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { itemId, name, status: "failed", error: message };
  }
}

/**
 * mode "write" — writes exactly the admin-approved field values from a prior
 * preview. Never calls the AI provider. Re-checks the item's CURRENT field
 * state at write time (not the state seen at preview time) so a field someone
 * else filled in between preview and approval isn't clobbered unless
 * `overwrite` is set — the same race the preview step itself guards against.
 */
async function translateOneItemWrite(
  collectionId: string,
  item: TranslateCmsItemInput,
  allowedTargetKeys: Set<string>,
  typeByTargetKey: Record<string, CmsFieldContentType>,
  overwrite: boolean
): Promise<TranslateCmsItemResult> {
  let name = item.itemId;
  try {
    const rawItem = await getWixCmsItemById(collectionId, item.itemId);
    if (!rawItem) {
      return { itemId: item.itemId, name, status: "skipped", reason: "Item not found in Wix CMS." };
    }
    name = resolveItemName(rawItem, item.itemId);

    const fieldsToWrite: Record<string, unknown> = {};
    for (const [key, rawValue] of Object.entries(item.fieldValues || {})) {
      if (!allowedTargetKeys.has(key) || typeof rawValue !== "string") continue; // never trust a key outside the declared field mappings

      const cleaned = stripCodeFence(rawValue).trim();
      if (!cleaned) continue; // the admin cleared this field during review — treat as "don't write it"

      const currentTargetValue = rawItem[key];
      const type = typeByTargetKey[key];

      if (type === "json") {
        const structuredCurrentTarget = parseIfJsonString(currentTargetValue);
        const targetHasData = isStructuredValue(structuredCurrentTarget) && !isEmptyStructuredValue(structuredCurrentTarget);
        if (targetHasData && !overwrite) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          throw new Error(`Field "${key}": nội dung đã sửa không phải JSON hợp lệ — không thể ghi vào Wix CMS.`);
        }
        // Match whatever representation this field already used, so a Text-typed column
        // storing serialized JSON keeps getting a string (not a native array that field type
        // may reject), while a real Array/Object-typed column keeps getting the native value.
        // With no prior value to go by (first-time write), default to native — matches a real
        // Wix Array/Object field, the more common case for a genuinely structured collection.
        fieldsToWrite[key] = typeof currentTargetValue === "string" && isStructuredValue(structuredCurrentTarget) ? cleaned : parsed;
        continue;
      }

      const targetHasData = typeof currentTargetValue === "string" && currentTargetValue.trim() !== "";
      if (targetHasData && !overwrite) continue;

      fieldsToWrite[key] = type === "richText" ? sanitizeHtmlForPreview(cleaned) : cleaned;
    }

    if (Object.keys(fieldsToWrite).length === 0) {
      return { itemId: item.itemId, name, status: "skipped", reason: "No approved field values to write." };
    }

    const writeResult = await updateWixCmsItemFields(collectionId, item.itemId, fieldsToWrite);
    if (!writeResult.success) {
      return { itemId: item.itemId, name, status: "failed", error: writeResult.error || "Wix CMS update failed." };
    }

    // Cooldown starts here, per FIELD, only now that it's actually landed in Wix CMS — a
    // preview the admin never approved (or a write that failed) must not count as "just
    // translated" and block a retry preview of the same field.
    for (const key of Object.keys(fieldsToWrite)) {
      recordTranslated(collectionId, item.itemId, key);
    }

    return { itemId: item.itemId, name, status: "updated", translatedFields: Object.keys(fieldsToWrite) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { itemId: item.itemId, name, status: "failed", error: message };
  }
}

/**
 * Translates the configured English field(s) of one or more Wix CMS items
 * into their sibling Vietnamese field(s) (mode "preview"), or writes
 * previously-reviewed values for them (mode "write") — leaving the English
 * source and any unrelated field untouched either way. See module docstring
 * for the reused building blocks and `TranslateCmsOptions` for parameters.
 */
export async function translateCmsEnglishToVietnamese(options: TranslateCmsOptions): Promise<TranslateCmsResult> {
  const { collectionKey, fieldMappings, mode, overwrite = false, sourceLocale = "en", targetLocale = "vi" } = options;
  const batchSize = Math.min(Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE), MAX_BATCH_SIZE);

  validateFieldMappings(fieldMappings);

  const collection = resolveCollection(collectionKey);
  if (!collection) {
    throw new TranslateCmsError(`Collection "${collectionKey}" không nằm trong danh sách cho phép.`, "COLLECTION_NOT_ALLOWED", 422);
  }

  const concurrency = Math.min(batchSize, MAX_CONCURRENCY);
  let items: TranslateCmsItemResult[];

  if (mode === "preview") {
    const itemIds =
      options.itemIds && options.itemIds.length > 0 ? options.itemIds : await collectAllItemIds(collection.collectionId, batchSize);
    if (itemIds.length === 0) {
      return { success: true, mode, summary: buildSummary([]), items: [] };
    }
    // Only this branch calls the AI provider — a local/self-hosted Ollama server can't
    // usefully serve concurrent requests, so it gets serialized (see getSafeConcurrency()).
    // mode "write" below never calls the AI provider (it writes already-approved values) but
    // caps its own concurrency lower — see WRITE_CONCURRENCY — since Wix's write quota is the
    // bottleneck there instead.
    const previewConcurrency = getSafeConcurrency(concurrency, getTranslationProviderKind());
    items = await mapWithConcurrency(itemIds, previewConcurrency, (itemId) =>
      translateOneItemPreview(collection.collectionId, itemId, fieldMappings, overwrite, sourceLocale, targetLocale)
    );
  } else {
    const submitted = options.items || [];
    if (submitted.length === 0) {
      throw new TranslateCmsError('mode "write" cần danh sách items đã được duyệt (từ preview).', "VALIDATION_ERROR", 400);
    }
    const allowedTargetKeys = new Set(fieldMappings.map((m) => m.targetField));
    const typeByTargetKey: Record<string, CmsFieldContentType> = Object.fromEntries(fieldMappings.map((m) => [m.targetField, m.type]));
    const writeConcurrency = Math.min(concurrency, WRITE_CONCURRENCY);
    items = await mapWithConcurrency(submitted, writeConcurrency, (item) =>
      translateOneItemWrite(collection.collectionId, item, allowedTargetKeys, typeByTargetKey, overwrite)
    );
  }

  const summary = buildSummary(items);
  return { success: summary.failed === 0, mode, summary, items };
}

export type {
  FieldMapping,
  TranslateCmsItemInput,
  TranslateCmsOptions,
  TranslateCmsResult,
  TranslateCmsItemResult,
} from "./cms-translation.types";
