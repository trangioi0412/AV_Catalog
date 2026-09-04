import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("./wix-cms.service", () => ({
  getWixCmsItemById: vi.fn(),
  getWixCollectionSchema: vi.fn(),
}));

vi.mock("./wix-multilingual.service", () => ({
  getTranslatableFields: vi.fn(),
  isLocaleAvailable: vi.fn(),
  listLocales: vi.fn(),
  queryContentForEntity: vi.fn(),
  bulkCreateContent: vi.fn(),
  bulkUpdateContentByKey: vi.fn(),
  verifyTranslationContent: vi.fn(),
  WixMultilingualError: class extends Error {
    code: string;
    status: number;
    constructor(message: string, status = 500, code = "UPSTREAM_ERROR") {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

vi.mock("./translation-provider.service", () => ({
  getWixTranslationProvider: vi.fn(),
  getTranslationProviderKind: vi.fn(() => "gemini"),
  getSafeConcurrency: vi.fn((requested: number) => requested),
  TranslationProviderError: class extends Error {
    code: string;
    constructor(message: string, code = "UPSTREAM_ERROR") {
      super(message);
      this.code = code;
    }
  },
}));

import { getWixCmsItemById, getWixCollectionSchema } from "./wix-cms.service";
import {
  getTranslatableFields,
  isLocaleAvailable,
  listLocales,
  queryContentForEntity,
  bulkCreateContent,
  bulkUpdateContentByKey,
  verifyTranslationContent,
} from "./wix-multilingual.service";
import { getWixTranslationProvider, getSafeConcurrency } from "./translation-provider.service";
import { TRANSLATION_CONCURRENCY } from "@/config/wix-translation.config";
import { translateAndSyncWixCmsItems } from "./translate-and-sync";
import type { TranslateAndSyncWixCmsItemsInput } from "@/types/wix-translation";
import type { TranslationContent, TranslationSchema, WixLocale } from "./wix-multilingual.service";

const SCHEMA = {
  id: "schema-1",
  key: { appId: "app-1", entityType: "Import1", scope: "SITE" },
  displayName: "products",
  fields: {
    title: { id: "title", type: "LONG_TEXT", displayName: "Title" },
    productOverview: { id: "productOverview", type: "LONG_TEXT", displayName: "Product Overview" },
  },
};

const ALLOWED_FIELDS = [
  { key: "title", displayName: "Title" },
  { key: "productOverview", displayName: "Product Overview" },
];

const LOCALES = [
  { id: "vi", languageCode: "vi", visibility: "VISIBLE", primaryLocale: true },
  { id: "en", languageCode: "en", visibility: "VISIBLE", primaryLocale: false },
];

function baseInput(overrides: Partial<TranslateAndSyncWixCmsItemsInput> = {}): TranslateAndSyncWixCmsItemsInput {
  return {
    collectionKey: "products",
    itemIds: ["item-1"],
    sourceLocale: "vi",
    targetLocale: "en",
    fieldKeys: ["title", "productOverview"],
    mode: "preview",
    overwriteExisting: false,
    ...overrides,
  };
}

describe("translateAndSyncWixCmsItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getWixCollectionSchema).mockResolvedValue(SCHEMA as unknown as TranslationSchema);
    vi.mocked(getTranslatableFields).mockReturnValue(ALLOWED_FIELDS);
    vi.mocked(listLocales).mockResolvedValue(LOCALES as unknown as WixLocale[]);
    vi.mocked(isLocaleAvailable).mockResolvedValue(true);
    vi.mocked(queryContentForEntity).mockResolvedValue(null);
  });

  describe("input validation", () => {
    it("rejects a collection key that isn't in the server allowlist", async () => {
      await expect(translateAndSyncWixCmsItems(baseInput({ collectionKey: "not-allowed" }))).rejects.toMatchObject({
        code: "COLLECTION_NOT_ALLOWED",
      });
      expect(getWixCollectionSchema).not.toHaveBeenCalled();
    });

    it("rejects an empty item list", async () => {
      await expect(translateAndSyncWixCmsItems(baseInput({ itemIds: [] }))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("rejects a batch larger than the max batch size", async () => {
      const many = Array.from({ length: 21 }, (_, i) => `item-${i}`);
      await expect(translateAndSyncWixCmsItems(baseInput({ itemIds: many }))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("rejects an empty field selection", async () => {
      await expect(translateAndSyncWixCmsItems(baseInput({ fieldKeys: [] }))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("rejects identical source and target locales", async () => {
      await expect(translateAndSyncWixCmsItems(baseInput({ sourceLocale: "vi", targetLocale: "vi" }))).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    });

    it("rejects when the collection has no translation schema", async () => {
      vi.mocked(getWixCollectionSchema).mockResolvedValue(null);
      await expect(translateAndSyncWixCmsItems(baseInput())).rejects.toMatchObject({ code: "SCHEMA_NOT_FOUND" });
    });

    it("drops any requested field key that isn't in the translation schema's allowlist", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ title: "Neat Bar", productOverview: "Mo ta" });
      vi.mocked(getWixTranslationProvider).mockReturnValue({
        translate: vi.fn().mockResolvedValue({ fields: { title: "Neat Bar" }, provider: "gemini", translatedAt: "now", warnings: [] }),
      });

      const result = await translateAndSyncWixCmsItems(
        baseInput({ fieldKeys: ["title", "_id", "product"] })
      );
      expect(result.items[0].sourceFields).toEqual({ title: "Neat Bar" });
    });

    it("rejects a target locale that Wix Multilingual doesn't know about at all", async () => {
      await expect(translateAndSyncWixCmsItems(baseInput({ targetLocale: "fr" }))).rejects.toMatchObject({
        code: "LOCALE_NOT_AVAILABLE",
      });
    });

    it("rejects a target locale that exists but isn't visible/enabled", async () => {
      vi.mocked(isLocaleAvailable).mockResolvedValue(false);
      await expect(translateAndSyncWixCmsItems(baseInput())).rejects.toMatchObject({ code: "LOCALE_NOT_AVAILABLE" });
    });
  });

  describe("preview mode", () => {
    it("returns original + translated fields for review and never calls the Wix write APIs", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ title: "Neat Bar BYOD", productOverview: "Mo ta san pham" });
      vi.mocked(getWixTranslationProvider).mockReturnValue({
        translate: vi.fn().mockResolvedValue({
          fields: { title: "Neat Bar BYOD", productOverview: "Product description" },
          provider: "gemini",
          translatedAt: "now",
          warnings: [],
        }),
      });

      const result = await translateAndSyncWixCmsItems(baseInput());

      expect(result.mode).toBe("preview");
      expect(result.items[0]).toMatchObject({
        itemId: "item-1",
        status: "success",
        action: "previewed",
        sourceFields: { title: "Neat Bar BYOD", productOverview: "Mo ta san pham" },
        translatedFields: { title: "Neat Bar BYOD", productOverview: "Product description" },
      });
      expect(result.items[0].sourceHash).toBeTruthy();
      expect(bulkCreateContent).not.toHaveBeenCalled();
      expect(bulkUpdateContentByKey).not.toHaveBeenCalled();
    });

    it("computes AI-call concurrency via getSafeConcurrency, using the request's providerKind override when given, else the auto-resolved kind", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ title: "Neat Bar", productOverview: "Mo ta" });
      vi.mocked(getWixTranslationProvider).mockReturnValue({
        translate: vi.fn().mockResolvedValue({ fields: { title: "Neat Bar" }, provider: "gemini", translatedAt: "now", warnings: [] }),
      });

      await translateAndSyncWixCmsItems(baseInput());
      expect(getSafeConcurrency).toHaveBeenLastCalledWith(TRANSLATION_CONCURRENCY, "gemini");

      await translateAndSyncWixCmsItems(baseInput({ providerKind: "ollama" }));
      expect(getSafeConcurrency).toHaveBeenLastCalledWith(TRANSLATION_CONCURRENCY, "ollama");
    });

    it("does not call the AI provider again for a field that already has a saved translation, unless overwriteExisting is set", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ title: "Neat Bar", productOverview: "Mo ta" });
      vi.mocked(queryContentForEntity).mockResolvedValue({
        id: "c1",
        schemaId: "schema-1",
        entityId: "item-1",
        locale: "en",
        fields: { title: { textValue: "Existing EN title" }, productOverview: { textValue: "Existing EN overview" } },
      } as unknown as TranslationContent);
      const translateMock = vi.fn();
      vi.mocked(getWixTranslationProvider).mockReturnValue({ translate: translateMock });

      const result = await translateAndSyncWixCmsItems(baseInput());

      expect(translateMock).not.toHaveBeenCalled();
      expect(result.items[0].translatedFields).toEqual({ title: "Existing EN title", productOverview: "Existing EN overview" });
    });

    it("re-translates already-translated fields when overwriteExisting is true", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ title: "Neat Bar", productOverview: "Mo ta" });
      vi.mocked(queryContentForEntity).mockResolvedValue({
        id: "c1",
        schemaId: "schema-1",
        entityId: "item-1",
        locale: "en",
        fields: { title: { textValue: "Old EN title" }, productOverview: { textValue: "Old EN overview" } },
      } as unknown as TranslationContent);
      const translateMock = vi.fn().mockResolvedValue({ fields: { title: "New EN title", productOverview: "New EN overview" }, provider: "gemini", translatedAt: "now", warnings: [] });
      vi.mocked(getWixTranslationProvider).mockReturnValue({ translate: translateMock });

      const result = await translateAndSyncWixCmsItems(baseInput({ overwriteExisting: true }));

      expect(translateMock).toHaveBeenCalled();
      expect(result.items[0].translatedFields).toEqual({ title: "New EN title", productOverview: "New EN overview" });
    });

    it("isolates one item's failure from the rest of the batch", async () => {
      vi.mocked(getWixCmsItemById).mockImplementation(async (_collectionId: string, itemId: string) => {
        if (itemId === "broken-item") throw new Error("Wix upstream exploded");
        return { title: "OK", productOverview: "OK" };
      });
      vi.mocked(getWixTranslationProvider).mockReturnValue({
        translate: vi.fn().mockResolvedValue({ fields: { title: "OK EN", productOverview: "OK EN" }, provider: "gemini", translatedAt: "now", warnings: [] }),
      });

      const result = await translateAndSyncWixCmsItems(baseInput({ itemIds: ["good-item", "broken-item"] }));
      const byId = Object.fromEntries(result.items.map((i) => [i.itemId, i]));

      expect(byId["good-item"].status).toBe("success");
      expect(byId["broken-item"].status).toBe("failed");
      expect(byId["broken-item"].message).toMatch(/Wix upstream exploded/);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(1);
    });

    it("still returns the Vietnamese source content when the AI translation call itself fails", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ title: "Neat Bar BYOD", productOverview: "Mo ta san pham" });
      vi.mocked(getWixTranslationProvider).mockReturnValue({
        translate: vi.fn().mockRejectedValue(new Error("Translation provider rate limit reached.")),
      });

      const result = await translateAndSyncWixCmsItems(baseInput());

      expect(result.items[0].status).toBe("failed");
      expect(result.items[0].message).toMatch(/rate limit/i);
      // The CMS read already succeeded before the AI call failed — the review
      // UI must still be able to show the original content, not "(Trống)".
      expect(result.items[0].sourceFields).toEqual({ title: "Neat Bar BYOD", productOverview: "Mo ta san pham" });
      expect(result.items[0].sourceHash).toBeTruthy();
    });
  });

  describe("draft / publish mode", () => {
    function writeInput(mode: "draft" | "publish", overrides: Partial<TranslateAndSyncWixCmsItemsInput> = {}) {
      return baseInput({
        mode,
        itemIds: ["item-1"],
        items: [{ itemId: "item-1", fieldValues: { title: "Neat Bar", productOverview: "Desc" } }],
        ...overrides,
      });
    }

    it("creates new content with published:false for draft mode", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ title: "src", productOverview: "src2" });
      vi.mocked(bulkCreateContent).mockResolvedValue([{ entityId: "item-1", success: true }]);
      vi.mocked(bulkUpdateContentByKey).mockResolvedValue([]);
      vi.mocked(verifyTranslationContent).mockResolvedValue({
        id: "c1", schemaId: "schema-1", entityId: "item-1", locale: "en",
        fields: { title: { published: false }, productOverview: { published: false } },
      } as unknown as TranslationContent);

      const result = await translateAndSyncWixCmsItems(writeInput("draft"));

      expect(bulkCreateContent).toHaveBeenCalledTimes(1);
      const inputArg = vi.mocked(bulkCreateContent).mock.calls[0][0];
      expect(inputArg[0].fields.title.published).toBe(false);
      expect(result.items[0]).toMatchObject({ status: "success", action: "created" });
    });

    it("publishes with published:true for publish mode", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ title: "src", productOverview: "src2" });
      vi.mocked(bulkCreateContent).mockResolvedValue([{ entityId: "item-1", success: true }]);
      vi.mocked(bulkUpdateContentByKey).mockResolvedValue([]);
      vi.mocked(verifyTranslationContent).mockResolvedValue({
        id: "c1", schemaId: "schema-1", entityId: "item-1", locale: "en",
        fields: { title: { published: true }, productOverview: { published: true } },
      } as unknown as TranslationContent);

      const result = await translateAndSyncWixCmsItems(writeInput("publish"));

      const inputArg = vi.mocked(bulkCreateContent).mock.calls[0][0];
      expect(inputArg[0].fields.title.published).toBe(true);
      expect(result.items[0]).toMatchObject({ status: "success", action: "published" });
    });

    it("updates (not creates) when a translation already exists and overwrite is confirmed", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ title: "src", productOverview: "src2" });
      vi.mocked(queryContentForEntity).mockResolvedValue({
        id: "c1", schemaId: "schema-1", entityId: "item-1", locale: "en", fields: {},
      } as unknown as TranslationContent);
      vi.mocked(bulkUpdateContentByKey).mockResolvedValue([{ entityId: "item-1", success: true }]);
      vi.mocked(verifyTranslationContent).mockResolvedValue({
        id: "c1", schemaId: "schema-1", entityId: "item-1", locale: "en",
        fields: { title: { published: false }, productOverview: { published: false } },
      } as unknown as TranslationContent);

      const result = await translateAndSyncWixCmsItems(writeInput("draft", { overwriteExisting: true }));

      expect(bulkUpdateContentByKey).toHaveBeenCalledTimes(1);
      expect(bulkCreateContent).toHaveBeenCalledWith([]);
      expect(result.items[0]).toMatchObject({ status: "success", action: "updated" });
    });

    it("skips (never calls a write API) when a translation exists and overwrite is not confirmed", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ title: "src", productOverview: "src2" });
      vi.mocked(queryContentForEntity).mockResolvedValue({
        id: "c1", schemaId: "schema-1", entityId: "item-1", locale: "en", fields: {},
      } as unknown as TranslationContent);

      const result = await translateAndSyncWixCmsItems(writeInput("draft", { overwriteExisting: false }));

      expect(bulkCreateContent).toHaveBeenCalledWith([]);
      expect(bulkUpdateContentByKey).toHaveBeenCalledWith([]);
      expect(result.items[0].status).toBe("skipped");
      expect(result.items[0].message).toMatch(/ghi đè/i);
    });

    it("flags a conflict instead of writing when the source content changed since preview", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ title: "CHANGED source", productOverview: "CHANGED" });

      const result = await translateAndSyncWixCmsItems(
        writeInput("draft", {
          items: [{ itemId: "item-1", fieldValues: { title: "Neat Bar", productOverview: "Desc" }, sourceHash: "stale-hash-from-preview" }],
        })
      );

      expect(bulkCreateContent).not.toHaveBeenCalled();
      expect(result.items[0].status).toBe("skipped");
      expect(result.items[0].message).toMatch(/thay đổi/i);
    });

    it("marks an item failed (not success) when post-write verification can't confirm the save", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ title: "src", productOverview: "src2" });
      vi.mocked(bulkCreateContent).mockResolvedValue([{ entityId: "item-1", success: true }]);
      vi.mocked(bulkUpdateContentByKey).mockResolvedValue([]);
      vi.mocked(verifyTranslationContent).mockResolvedValue(null);

      const result = await translateAndSyncWixCmsItems(writeInput("draft"));

      expect(result.items[0].status).toBe("failed");
      expect(result.items[0].message).toMatch(/verification/i);
    });

    it("isolates a failed item from a successful one in the same batch (bulk create partial failure)", async () => {
      vi.mocked(getWixCmsItemById).mockImplementation(async (_collectionId: string, itemId: string) => ({
        title: `src-${itemId}`,
        productOverview: `src2-${itemId}`,
      }));
      vi.mocked(bulkCreateContent).mockImplementation(async (inputs) =>
        inputs.map((i) => (i.entityId === "item-2" ? { entityId: i.entityId, success: false, error: "Validation failed" } : { entityId: i.entityId, success: true }))
      );
      vi.mocked(bulkUpdateContentByKey).mockResolvedValue([]);
      vi.mocked(verifyTranslationContent).mockResolvedValue({
        id: "c1", schemaId: "schema-1", entityId: "item-1", locale: "en",
        fields: { title: { published: false }, productOverview: { published: false } },
      } as unknown as TranslationContent);

      const result = await translateAndSyncWixCmsItems(
        writeInput("draft", {
          itemIds: ["item-1", "item-2"],
          items: [
            { itemId: "item-1", fieldValues: { title: "A", productOverview: "A2" } },
            { itemId: "item-2", fieldValues: { title: "B", productOverview: "B2" } },
          ],
        })
      );
      const byId = Object.fromEntries(result.items.map((i) => [i.itemId, i]));

      expect(byId["item-1"].status).toBe("success");
      expect(byId["item-2"].status).toBe("failed");
      expect(byId["item-2"].message).toMatch(/Validation failed/);
    });
  });
});
