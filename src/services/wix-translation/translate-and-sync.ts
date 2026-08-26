/**
 * translate-and-sync.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * `translateAndSyncWixCmsItems()` — the single entry point behind the Wix
 * Multilingual Translator admin page (/admin/wix-translations) and its API
 * routes. Given a server-side-allowlisted collection, a batch of item IDs,
 * and a mode, it:
 *
 *   1. Validates collection / locale / field-key input against server-side
 *      allowlists (never trusts a raw collection ID or field key from the client).
 *   2. Reads the live Vietnamese CMS content for each item.
 *   3. Resolves the item's real Wix Multilingual translation schema.
 *   4. Checks for an existing "en" (or other target locale) translation.
 *   5. Translates only the fields that need it (skips already-translated
 *      fields unless `overwriteExisting` is set).
 *   6. In "preview" mode, returns original + translated content — writes nothing.
 *   7. In "draft"/"publish" mode, writes the (user-reviewed) translation via
 *      the Translation Content API (never the plain Data Items API — see
 *      `wix-multilingual.service.ts`), then re-queries to verify the write.
 *
 * One item's failure never aborts the batch — every item gets its own result.
 */

import { revalidatePath } from "next/cache";
import {
  resolveCollection,
  MAX_TRANSLATION_BATCH_SIZE,
  TRANSLATION_CONCURRENCY,
} from "@/config/wix-translation.config";
import { mapWithConcurrency } from "@/lib/utils/concurrencyLimit";
import { getWixCmsItemById, getWixCollectionSchema } from "./wix-cms.service";
import {
  getTranslatableFields,
  isLocaleAvailable,
  listLocales,
  queryContentForEntity,
  bulkCreateContent,
  bulkUpdateContentByKey,
  verifyTranslationContent,
  WixMultilingualError,
  type BulkContentInput,
} from "./wix-multilingual.service";
import { getWixTranslationProvider, TranslationProviderError } from "./translation-provider.service";
import { computeSourceHash, sanitizeFieldKeys } from "./translation-mapper.service";
import type {
  TranslateAndSyncWixCmsItemsInput,
  TranslateAndSyncWixCmsItemsResult,
  TranslateAndSyncItemInput,
  TranslationItemResult,
} from "@/types/wix-translation";

export type TranslateAndSyncErrorCode =
  | "VALIDATION_ERROR"
  | "COLLECTION_NOT_ALLOWED"
  | "SCHEMA_NOT_FOUND"
  | "LOCALE_NOT_AVAILABLE";

export class TranslateAndSyncError extends Error {
  readonly code: TranslateAndSyncErrorCode;
  readonly status: number;
  constructor(message: string, code: TranslateAndSyncErrorCode, status: number) {
    super(message);
    this.name = "TranslateAndSyncError";
    this.code = code;
    this.status = status;
  }
}

function extractSourceFields(rawItem: Record<string, unknown>, fieldKeys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of fieldKeys) {
    const val = rawItem[key];
    out[key] = val != null ? String(val) : "";
  }
  return out;
}

function resolveItemName(rawItem: Record<string, unknown>, fallback: string): string {
  const title = rawItem.title ?? rawItem.Title;
  const product = rawItem.product ?? rawItem.Product;
  return String(title || product || fallback);
}

async function assertBatch(input: TranslateAndSyncWixCmsItemsInput) {
  const ids =
    input.mode === "preview" ? input.itemIds : (input.items || []).map((i) => i.itemId);
  if (!ids || ids.length === 0) {
    throw new TranslateAndSyncError("Chưa chọn sản phẩm nào để xử lý.", "VALIDATION_ERROR", 400);
  }
  if (ids.length > MAX_TRANSLATION_BATCH_SIZE) {
    throw new TranslateAndSyncError(
      `Chỉ được xử lý tối đa ${MAX_TRANSLATION_BATCH_SIZE} sản phẩm mỗi lần.`,
      "VALIDATION_ERROR",
      400
    );
  }
  if (!input.fieldKeys || input.fieldKeys.length === 0) {
    throw new TranslateAndSyncError("Chưa chọn field nào để dịch.", "VALIDATION_ERROR", 400);
  }
  if (!input.sourceLocale || !input.targetLocale) {
    throw new TranslateAndSyncError("Thiếu ngôn ngữ nguồn hoặc ngôn ngữ đích.", "VALIDATION_ERROR", 400);
  }
  if (input.sourceLocale === input.targetLocale) {
    throw new TranslateAndSyncError("Ngôn ngữ nguồn và ngôn ngữ đích phải khác nhau.", "VALIDATION_ERROR", 400);
  }
  return ids;
}

export async function translateAndSyncWixCmsItems(
  input: TranslateAndSyncWixCmsItemsInput
): Promise<TranslateAndSyncWixCmsItemsResult> {
  await assertBatch(input);

  // 1-2. Collection allowlist — the client's collectionKey never becomes a raw collection ID directly.
  const collection = resolveCollection(input.collectionKey);
  if (!collection) {
    throw new TranslateAndSyncError(
      `Collection "${input.collectionKey}" không nằm trong danh sách cho phép.`,
      "COLLECTION_NOT_ALLOWED",
      422
    );
  }
  const collectionId = collection.collectionId;

  // 3. Real translation schema for the collection (never fabricated).
  const schema = await getWixCollectionSchema(collectionId);
  if (!schema) {
    throw new TranslateAndSyncError(
      `Không tìm thấy Wix Multilingual translation schema cho collection "${input.collectionKey}". Hãy đánh dấu các field có thể dịch trong Wix Studio CMS trước.`,
      "SCHEMA_NOT_FOUND",
      422
    );
  }

  // 4. Field allowlist = translation schema ∩ server denylist ∩ client selection.
  const allowedFields = getTranslatableFields(schema);
  const allowedKeys = allowedFields.map((f) => f.key);
  const fieldKeys = sanitizeFieldKeys(input.fieldKeys, allowedKeys);
  if (fieldKeys.length === 0) {
    throw new TranslateAndSyncError(
      "Không có field hợp lệ nào trong lựa chọn (field phải nằm trong translation schema của Wix).",
      "VALIDATION_ERROR",
      422
    );
  }

  // 5. Locale allowlist — verified against Wix, never assumed.
  const [locales, targetOk] = await Promise.all([listLocales(), isLocaleAvailable(input.targetLocale)]);
  const targetKnown = locales.some((l) => l.id === input.targetLocale);
  if (!targetKnown) {
    throw new TranslateAndSyncError(
      `Ngôn ngữ đích "${input.targetLocale}" không tồn tại trong Wix Multilingual của site này.`,
      "LOCALE_NOT_AVAILABLE",
      422
    );
  }
  if (!targetOk) {
    throw new TranslateAndSyncError(
      `Ngôn ngữ đích "${input.targetLocale}" chưa được bật (visible) trong Wix Multilingual.`,
      "LOCALE_NOT_AVAILABLE",
      409
    );
  }

  const overwriteExisting = Boolean(input.overwriteExisting);

  const items: TranslationItemResult[] =
    input.mode === "preview"
      ? await runPreview(collectionId, schema.id, input, fieldKeys, overwriteExisting)
      : await runWrite(collectionId, schema.id, input, fieldKeys, overwriteExisting);

  const succeeded = items.filter((i) => i.status === "success").length;
  const failed = items.filter((i) => i.status === "failed").length;
  const skipped = items.filter((i) => i.status === "skipped").length;

  if (input.mode === "publish" && succeeded > 0) {
    revalidatePath("/admin/wix-translations");
    revalidatePath("/admin/dashboard");
  }

  return {
    success: failed === 0,
    mode: input.mode,
    sourceLocale: input.sourceLocale,
    targetLocale: input.targetLocale,
    total: items.length,
    succeeded,
    failed,
    skipped,
    items,
  };
}

async function runPreview(
  collectionId: string,
  schemaId: string,
  input: TranslateAndSyncWixCmsItemsInput,
  fieldKeys: string[],
  overwriteExisting: boolean
): Promise<TranslationItemResult[]> {
  return mapWithConcurrency(input.itemIds, TRANSLATION_CONCURRENCY, async (itemId): Promise<TranslationItemResult> => {
    try {
      const rawItem = await getWixCmsItemById(collectionId, itemId);
      if (!rawItem) {
        return { itemId, status: "failed", action: "skipped", message: "Không tìm thấy item trong Wix CMS." };
      }
      const itemName = resolveItemName(rawItem, itemId);
      const sourceFields = extractSourceFields(rawItem, fieldKeys);
      const sourceHash = computeSourceHash(sourceFields);

      const existing = await queryContentForEntity(schemaId, itemId, input.targetLocale);

      const keysNeedingTranslation = fieldKeys.filter((key) => {
        if (overwriteExisting || !existing) return true;
        const existingVal = existing.fields[key]?.textValue;
        return !existingVal;
      });

      const translatedFields: Record<string, string> = {};
      for (const key of fieldKeys) {
        if (!keysNeedingTranslation.includes(key) && existing) {
          translatedFields[key] = existing.fields[key]?.textValue || "";
        }
      }

      if (keysNeedingTranslation.length > 0) {
        const provider = getWixTranslationProvider();
        const toTranslate: Record<string, string> = {};
        for (const key of keysNeedingTranslation) toTranslate[key] = sourceFields[key];

        const result = await provider.translate({
          sourceLocale: input.sourceLocale,
          targetLocale: input.targetLocale,
          fields: toTranslate,
          context: {
            itemName,
            brand: rawItem.brand != null ? String(rawItem.brand) : undefined,
            category: rawItem.category != null ? String(rawItem.category) : undefined,
          },
        });
        Object.assign(translatedFields, result.fields);
      }

      return {
        itemId,
        itemName,
        status: "success",
        action: "previewed",
        sourceFields,
        translatedFields,
        sourceHash,
      };
    } catch (err) {
      return { itemId, status: "failed", action: "skipped", message: describeError(err) };
    }
  });
}

async function runWrite(
  collectionId: string,
  schemaId: string,
  input: TranslateAndSyncWixCmsItemsInput,
  fieldKeys: string[],
  overwriteExisting: boolean
): Promise<TranslationItemResult[]> {
  const published = input.mode === "publish";
  const submittedItems = input.items || [];

  type Plan =
    | { kind: "create"; itemId: string; itemName: string; sanitizedFields: Record<string, string> }
    | { kind: "update"; itemId: string; itemName: string; sanitizedFields: Record<string, string> }
    | { kind: "skip"; itemId: string; itemName: string; message: string };

  const plans: Plan[] = await mapWithConcurrency(submittedItems, TRANSLATION_CONCURRENCY, async (item: TranslateAndSyncItemInput): Promise<Plan> => {
    try {
      const rawItem = await getWixCmsItemById(collectionId, item.itemId);
      if (!rawItem) {
        return { kind: "skip", itemId: item.itemId, itemName: item.itemId, message: "Không tìm thấy item trong Wix CMS." };
      }
      const itemName = resolveItemName(rawItem, item.itemId);

      if (item.sourceHash) {
        const currentSourceFields = extractSourceFields(rawItem, fieldKeys);
        const currentHash = computeSourceHash(currentSourceFields);
        if (currentHash !== item.sourceHash) {
          return {
            kind: "skip",
            itemId: item.itemId,
            itemName,
            message: "Dữ liệu nguồn (tiếng Việt) đã thay đổi kể từ khi xem trước. Vui lòng dịch lại trước khi lưu.",
          };
        }
      }

      const sanitizedFields: Record<string, string> = {};
      for (const key of fieldKeys) {
        const val = item.fieldValues?.[key];
        if (val !== undefined) sanitizedFields[key] = val;
      }
      if (Object.keys(sanitizedFields).length === 0) {
        return { kind: "skip", itemId: item.itemId, itemName, message: "Không có nội dung bản dịch nào được gửi lên." };
      }

      const existing = await queryContentForEntity(schemaId, item.itemId, input.targetLocale);
      if (existing && !overwriteExisting) {
        return {
          kind: "skip",
          itemId: item.itemId,
          itemName,
          message: "Bản dịch đã tồn tại cho item này — chưa xác nhận ghi đè.",
        };
      }

      if (existing) return { kind: "update", itemId: item.itemId, itemName, sanitizedFields };
      return { kind: "create", itemId: item.itemId, itemName, sanitizedFields };
    } catch (err) {
      return { kind: "skip", itemId: item.itemId, itemName: item.itemId, message: describeError(err) };
    }
  });

  const nameByItemId = new Map(plans.map((p) => [p.itemId, p.itemName]));
  const toCreate = plans.filter((p): p is Extract<Plan, { kind: "create" }> => p.kind === "create");
  const toUpdate = plans.filter((p): p is Extract<Plan, { kind: "update" }> => p.kind === "update");
  const skipped = plans.filter((p): p is Extract<Plan, { kind: "skip" }> => p.kind === "skip");

  const toBulkInput = (p: Extract<Plan, { kind: "create" | "update" }>): BulkContentInput => ({
    schemaId,
    entityId: p.itemId,
    locale: input.targetLocale,
    fields: Object.fromEntries(Object.entries(p.sanitizedFields).map(([key, value]) => [key, { textValue: value, published }])),
  });

  const [createResults, updateResults] = await Promise.all([
    bulkCreateContent(toCreate.map(toBulkInput)),
    bulkUpdateContentByKey(toUpdate.map(toBulkInput)),
  ]);
  const writeResultByItemId = new Map([...createResults, ...updateResults].map((r) => [r.entityId, r]));

  const writtenPlans = [...toCreate, ...toUpdate];
  const verifiedByItemId = new Map(
    await mapWithConcurrency(
      writtenPlans.filter((p) => writeResultByItemId.get(p.itemId)?.success),
      TRANSLATION_CONCURRENCY,
      async (p) => {
        const content = await verifyTranslationContent(schemaId, p.itemId, input.targetLocale);
        const publishedOk = !content || fieldKeys.every((k) => !(k in p.sanitizedFields) || (content.fields[k]?.published ?? false) === published);
        return [p.itemId, Boolean(content) && publishedOk] as const;
      }
    )
  );

  const items: TranslationItemResult[] = [
    ...skipped.map(
      (p): TranslationItemResult => ({
        itemId: p.itemId,
        itemName: nameByItemId.get(p.itemId),
        status: "skipped",
        action: "skipped",
        message: p.message,
      })
    ),
    ...writtenPlans.map((p): TranslationItemResult => {
      const writeResult = writeResultByItemId.get(p.itemId);
      const itemName = nameByItemId.get(p.itemId);
      if (!writeResult?.success) {
        return {
          itemId: p.itemId,
          itemName,
          status: "failed",
          action: "skipped",
          message: writeResult?.error || "Ghi vào Wix Multilingual thất bại.",
        };
      }
      if (!verifiedByItemId.get(p.itemId)) {
        return {
          itemId: p.itemId,
          itemName,
          status: "failed",
          action: "skipped",
          message: "Lưu thành công nhưng bước xác minh (verification) chưa xác nhận được dữ liệu đã lưu.",
        };
      }
      return {
        itemId: p.itemId,
        itemName,
        status: "success",
        action: published ? "published" : p.kind === "update" ? "updated" : "created",
        translatedFields: p.sanitizedFields,
      };
    }),
  ];

  return items;
}

function describeError(err: unknown): string {
  if (err instanceof WixMultilingualError || err instanceof TranslationProviderError || err instanceof TranslateAndSyncError) {
    return err.message;
  }
  return `Lỗi không xác định: ${err instanceof Error ? err.message : String(err)}`;
}

export type {
  TranslateAndSyncWixCmsItemsInput,
  TranslateAndSyncWixCmsItemsResult,
  TranslationMode,
  TranslationItemResult,
} from "@/types/wix-translation";
