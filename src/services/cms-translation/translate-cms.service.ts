/**
 * translate-cms.service.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * `translateCmsEnglishToVietnamese()` — reads an English field directly off a
 * Wix CMS item, translates it, and (only once a human has reviewed and
 * approved it) writes the result into a sibling Vietnamese field on the SAME
 * item (config-driven field pairs, e.g. `title_EN` -> `title_VI` — never
 * hard-coded to one field). A mapping's source and target field may also be
 * the SAME field ("in place" translation, for fields with no separate VI
 * sibling) — always gated by `overwrite`, see `validateFieldMappings()`.
 *
 * Two-step, human-in-the-loop flow — see `CmsTranslationMode`:
 *   - mode "preview": AI-translates the selected fields and returns them;
 *     never writes to Wix.
 *   - mode "write": writes back exactly the admin-approved (possibly
 *     hand-edited) values submitted from that preview — never calls the AI
 *     provider again, so a stray/incorrect AI answer can't reach the CMS
 *     without a person having looked at it first.
 *
 * Reuses the project's existing building blocks rather than introducing a
 * parallel stack:
 *   - collection allowlist:      `@/config/wix-translation.config`
 *   - Wix CMS item read/write:   `@/services/wix-translation/wix-cms.service`
 *   - AI translation provider:   `@/lib/services/translationProvider` (Ollama/GPT/Gemini)
 *   - HTML sanitizing:           `@/services/wix-translation/translation-mapper.service`
 *   - bounded concurrency:       `@/lib/utils/concurrencyLimit`
 *
 * One item's failure never aborts the batch — every item gets its own result.
 */

import { resolveCollection } from "@/config/wix-translation.config";
import { getWixCmsItems, getWixCmsItemById, updateWixCmsItemFields } from "@/services/wix-translation/wix-cms.service";
import { sanitizeHtmlForPreview } from "@/services/wix-translation/translation-mapper.service";
import { mapWithConcurrency } from "@/lib/utils/concurrencyLimit";
import {
  getTranslationProvider,
  stripCodeFence,
  TranslationProviderError,
  type TranslationProvider,
  type TranslationRequest,
  type TranslationResult,
} from "@/lib/services/translationProvider";
import type {
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
/** Safety cap when no `itemIds` are given, so a huge collection can't run away unbounded. */
const MAX_AUTO_ITEMS = 500;
const RETRY_MAX_ATTEMPTS = 2;
const RETRY_BASE_DELAY_MS = 800;

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
  overwrite: boolean
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
    // `overwrite` is set.
    const fieldsToTranslate: Record<string, string> = {};
    const typeByTargetKey: Record<string, FieldMapping["type"]> = {};
    let anyTargetHadData = false;

    for (const mapping of fieldMappings) {
      const sourceValue = rawItem[mapping.sourceField];
      if (typeof sourceValue !== "string" || sourceValue.trim() === "") continue; // empty/non-string source — skip this field silently

      const currentTargetValue = rawItem[mapping.targetField];
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
        reason: anyTargetHadData ? "Target field already contains data" : "No source content to translate",
      };
    }

    const provider = getTranslationProvider();
    const result = await translateWithRetry(provider, {
      fields: fieldsToTranslate,
      sourceLocale: "en",
      targetLocale: "vi",
      context: { productName: name },
    });

    const translatedFieldValues: Record<string, string> = {};
    for (const [targetKey, rawTranslated] of Object.entries(result.fields)) {
      const cleaned = stripCodeFence(String(rawTranslated ?? "")).trim();
      if (!cleaned) {
        throw new Error(`Translation provider returned an empty response for field "${targetKey}".`);
      }
      translatedFieldValues[targetKey] = typeByTargetKey[targetKey] === "richText" ? sanitizeHtmlForPreview(cleaned) : cleaned;
    }

    const fieldValues = Object.fromEntries(
      Object.entries(translatedFieldValues).map(([key, translated]) => [key, { source: fieldsToTranslate[key], translated }])
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
  typeByTargetKey: Record<string, FieldMapping["type"]>,
  overwrite: boolean
): Promise<TranslateCmsItemResult> {
  let name = item.itemId;
  try {
    const rawItem = await getWixCmsItemById(collectionId, item.itemId);
    if (!rawItem) {
      return { itemId: item.itemId, name, status: "skipped", reason: "Item not found in Wix CMS." };
    }
    name = resolveItemName(rawItem, item.itemId);

    const fieldsToWrite: Record<string, string> = {};
    for (const [key, rawValue] of Object.entries(item.fieldValues || {})) {
      if (!allowedTargetKeys.has(key) || typeof rawValue !== "string") continue; // never trust a key outside the declared field mappings

      const cleaned = stripCodeFence(rawValue).trim();
      if (!cleaned) continue; // the admin cleared this field during review — treat as "don't write it"

      const currentTargetValue = rawItem[key];
      const targetHasData = typeof currentTargetValue === "string" && currentTargetValue.trim() !== "";
      if (targetHasData && !overwrite) continue;

      fieldsToWrite[key] = typeByTargetKey[key] === "richText" ? sanitizeHtmlForPreview(cleaned) : cleaned;
    }

    if (Object.keys(fieldsToWrite).length === 0) {
      return { itemId: item.itemId, name, status: "skipped", reason: "No approved field values to write." };
    }

    const writeResult = await updateWixCmsItemFields(collectionId, item.itemId, fieldsToWrite);
    if (!writeResult.success) {
      return { itemId: item.itemId, name, status: "failed", error: writeResult.error || "Wix CMS update failed." };
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
  const { collectionKey, fieldMappings, mode, overwrite = false } = options;
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
    items = await mapWithConcurrency(itemIds, concurrency, (itemId) =>
      translateOneItemPreview(collection.collectionId, itemId, fieldMappings, overwrite)
    );
  } else {
    const submitted = options.items || [];
    if (submitted.length === 0) {
      throw new TranslateCmsError('mode "write" cần danh sách items đã được duyệt (từ preview).', "VALIDATION_ERROR", 400);
    }
    const allowedTargetKeys = new Set(fieldMappings.map((m) => m.targetField));
    const typeByTargetKey = Object.fromEntries(fieldMappings.map((m) => [m.targetField, m.type]));
    items = await mapWithConcurrency(submitted, concurrency, (item) =>
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
