import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/wix-translation/wix-cms.service", () => ({
  getWixCmsItems: vi.fn(),
  getWixCmsItemById: vi.fn(),
  updateWixCmsItemFields: vi.fn(),
}));

vi.mock("@/lib/services/translationProvider", async () => {
  const actual = await vi.importActual<typeof import("@/lib/services/translationProvider")>("@/lib/services/translationProvider");
  return {
    ...actual,
    getTranslationProvider: vi.fn(),
  };
});

import { getWixCmsItems, getWixCmsItemById, updateWixCmsItemFields } from "@/services/wix-translation/wix-cms.service";
import { getTranslationProvider, TranslationProviderError } from "@/lib/services/translationProvider";
import { translateCmsEnglishToVietnamese, TranslateCmsError } from "./translate-cms.service";
import type { FieldMapping, TranslateCmsOptions } from "./cms-translation.types";

const FIELD_MAPPINGS: FieldMapping[] = [
  { sourceField: "title_EN", targetField: "title_VI", type: "text" },
  { sourceField: "description_EN", targetField: "description_VI", type: "richText" },
];

function previewOptions(overrides: Partial<TranslateCmsOptions> = {}): TranslateCmsOptions {
  return {
    collectionKey: "products",
    mode: "preview",
    itemIds: ["item-1"],
    fieldMappings: FIELD_MAPPINGS,
    overwrite: false,
    ...overrides,
  };
}

function writeOptions(overrides: Partial<TranslateCmsOptions> = {}): TranslateCmsOptions {
  return {
    collectionKey: "products",
    mode: "write",
    fieldMappings: FIELD_MAPPINGS,
    overwrite: false,
    items: [{ itemId: "item-1", fieldValues: { title_VI: "Bàn Neat" } }],
    ...overrides,
  };
}

describe("translateCmsEnglishToVietnamese", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("input validation", () => {
    it("rejects an empty fieldMappings array", async () => {
      await expect(translateCmsEnglishToVietnamese(previewOptions({ fieldMappings: [] }))).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    });

    it("rejects a collection key that isn't in the server allowlist", async () => {
      const call = translateCmsEnglishToVietnamese(previewOptions({ collectionKey: "not-allowed" }));
      await expect(call).rejects.toBeInstanceOf(TranslateCmsError);
      await expect(call).rejects.toMatchObject({ code: "COLLECTION_NOT_ALLOWED" });
      expect(getWixCmsItemById).not.toHaveBeenCalled();
    });

    it("rejects mode \"write\" with no items", async () => {
      await expect(translateCmsEnglishToVietnamese(writeOptions({ items: [] }))).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    });
  });

  describe('mode "preview" — translates, never writes', () => {
    it("translates one item and returns source+translated pairs for review, without calling updateWixCmsItemFields", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({
        title_EN: "Neat Bar BYOD",
        description_EN: "<p>High-quality video conferencing.</p>",
        _id: "item-1",
      });
      const translateMock = vi.fn().mockResolvedValue({
        fields: { title_VI: "Neat Bar BYOD", description_VI: "<p>Hội nghị truyền hình chất lượng cao.</p>" },
        warnings: [],
      });
      vi.mocked(getTranslationProvider).mockReturnValue({ translate: translateMock });

      const result = await translateCmsEnglishToVietnamese(previewOptions());

      expect(result.mode).toBe("preview");
      expect(result.success).toBe(true);
      expect(result.summary).toEqual({ total: 1, translated: 1, updated: 0, skipped: 0, failed: 0 });
      expect(result.items[0]).toMatchObject({ itemId: "item-1", status: "translated" });
      expect(result.items[0].fieldValues).toEqual({
        title_VI: { source: "Neat Bar BYOD", translated: "Neat Bar BYOD" },
        description_VI: { source: "<p>High-quality video conferencing.</p>", translated: "<p>Hội nghị truyền hình chất lượng cao.</p>" },
      });
      expect(updateWixCmsItemFields).not.toHaveBeenCalled();
    });

    it("translates multiple items independently", async () => {
      vi.mocked(getWixCmsItemById).mockImplementation(async (_c, itemId) => ({ title_EN: `Product ${itemId}` }));
      vi.mocked(getTranslationProvider).mockReturnValue({
        translate: vi.fn().mockImplementation(async ({ fields }) => ({
          fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, `VI: ${v}`])),
          warnings: [],
        })),
      });

      const result = await translateCmsEnglishToVietnamese(
        previewOptions({ itemIds: ["item-1", "item-2"], fieldMappings: [{ sourceField: "title_EN", targetField: "title_VI", type: "text" }] })
      );

      expect(result.summary.translated).toBe(2);
      expect(result.items.map((i) => i.itemId).sort()).toEqual(["item-1", "item-2"]);
    });

    it("skips a field whose source is empty", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ title_EN: "", description_EN: "Real content" });
      vi.mocked(getTranslationProvider).mockReturnValue({
        translate: vi.fn().mockResolvedValue({ fields: { description_VI: "Nội dung thật" }, warnings: [] }),
      });

      const result = await translateCmsEnglishToVietnamese(previewOptions());

      expect(result.items[0].fieldValues).not.toHaveProperty("title_VI");
      expect(result.items[0].fieldValues).toHaveProperty("description_VI");
    });

    it("skips the whole item when every target field already has data and overwrite is false", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({
        title_EN: "Neat Bar",
        title_VI: "Đã dịch rồi",
        description_EN: "Desc",
        description_VI: "Mô tả rồi",
      });
      const translateMock = vi.fn();
      vi.mocked(getTranslationProvider).mockReturnValue({ translate: translateMock });

      const result = await translateCmsEnglishToVietnamese(previewOptions({ overwrite: false }));

      expect(translateMock).not.toHaveBeenCalled();
      expect(result.items[0]).toMatchObject({ status: "skipped", reason: "Target field already contains data" });
    });

    it("re-translates when overwrite is true", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ title_EN: "Neat Bar", title_VI: "Bản cũ" });
      const translateMock = vi.fn().mockResolvedValue({ fields: { title_VI: "Bản mới" }, warnings: [] });
      vi.mocked(getTranslationProvider).mockReturnValue({ translate: translateMock });

      const result = await translateCmsEnglishToVietnamese(
        previewOptions({ overwrite: true, fieldMappings: [{ sourceField: "title_EN", targetField: "title_VI", type: "text" }] })
      );

      expect(translateMock).toHaveBeenCalled();
      expect(result.items[0].fieldValues?.title_VI.translated).toBe("Bản mới");
    });

    it("allows an in-place mapping (sourceField === targetField, for fields with no separate VI sibling)", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ mainFeature: "AI-powered noise cancellation" });
      const translateMock = vi.fn().mockResolvedValue({ fields: { mainFeature: "Khử tiếng ồn bằng AI" }, warnings: [] });
      vi.mocked(getTranslationProvider).mockReturnValue({ translate: translateMock });

      const result = await translateCmsEnglishToVietnamese(
        previewOptions({ overwrite: true, fieldMappings: [{ sourceField: "mainFeature", targetField: "mainFeature", type: "text" }] })
      );

      expect(translateMock).toHaveBeenCalled();
      expect(result.items[0].status).toBe("translated");
      expect(result.items[0].fieldValues?.mainFeature).toEqual({
        source: "AI-powered noise cancellation",
        translated: "Khử tiếng ồn bằng AI",
      });
    });

    it("skips an in-place mapping when overwrite is false — source and target are the same value, so it always looks \"already filled in\"", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ mainFeature: "AI-powered noise cancellation" });
      const translateMock = vi.fn();
      vi.mocked(getTranslationProvider).mockReturnValue({ translate: translateMock });

      const result = await translateCmsEnglishToVietnamese(
        previewOptions({ overwrite: false, fieldMappings: [{ sourceField: "mainFeature", targetField: "mainFeature", type: "text" }] })
      );

      expect(translateMock).not.toHaveBeenCalled();
      expect(result.items[0]).toMatchObject({ status: "skipped", reason: "Target field already contains data" });
    });

    it("skips a nonexistent item without failing the batch", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue(null);
      const result = await translateCmsEnglishToVietnamese(previewOptions());
      expect(result.items[0]).toMatchObject({ status: "skipped", reason: expect.stringContaining("not found") });
    });

    it("marks the item failed (not the whole batch) when the provider returns an empty response", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ title_EN: "Neat Bar" });
      vi.mocked(getTranslationProvider).mockReturnValue({
        translate: vi.fn().mockResolvedValue({ fields: { title_VI: "   " }, warnings: [] }),
      });

      const result = await translateCmsEnglishToVietnamese(
        previewOptions({ fieldMappings: [{ sourceField: "title_EN", targetField: "title_VI", type: "text" }] })
      );

      expect(result.items[0].status).toBe("failed");
      expect(result.items[0].error).toMatch(/empty response/i);
    });

    it("strips a markdown code fence from the AI response before returning it for review", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ description_EN: "<p>Hello</p>" });
      vi.mocked(getTranslationProvider).mockReturnValue({
        translate: vi.fn().mockResolvedValue({ fields: { description_VI: '```html\n<p>Xin chào</p>\n```' }, warnings: [] }),
      });

      const result = await translateCmsEnglishToVietnamese(
        previewOptions({ fieldMappings: [{ sourceField: "description_EN", targetField: "description_VI", type: "richText" }] })
      );

      expect(result.items[0].status).toBe("translated");
      const translated = result.items[0].fieldValues?.description_VI.translated ?? "";
      expect(translated).not.toContain("```");
      expect(translated).toContain("<p>Xin chào</p>");
    });

    it("retries a transient (rate-limited) provider error and succeeds on the second attempt", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ title_EN: "Neat Bar" });
      const translateMock = vi
        .fn()
        .mockRejectedValueOnce(new TranslationProviderError("Translation provider rate limit reached.", "RATE_LIMITED"))
        .mockResolvedValueOnce({ fields: { title_VI: "Bàn Neat" }, warnings: [] });
      vi.mocked(getTranslationProvider).mockReturnValue({ translate: translateMock });

      const result = await translateCmsEnglishToVietnamese(
        previewOptions({ fieldMappings: [{ sourceField: "title_EN", targetField: "title_VI", type: "text" }] })
      );

      expect(translateMock).toHaveBeenCalledTimes(2);
      expect(result.items[0].status).toBe("translated");
    }, 10000);

    it("does not retry a NOT_CONFIGURED provider error", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ title_EN: "Neat Bar" });
      const translateMock = vi.fn().mockRejectedValue(new TranslationProviderError("No provider configured.", "NOT_CONFIGURED"));
      vi.mocked(getTranslationProvider).mockReturnValue({ translate: translateMock });

      const result = await translateCmsEnglishToVietnamese(
        previewOptions({ fieldMappings: [{ sourceField: "title_EN", targetField: "title_VI", type: "text" }] })
      );

      expect(translateMock).toHaveBeenCalledTimes(1);
      expect(result.items[0].status).toBe("failed");
    });

    it("isolates one item's failure from the rest of the batch", async () => {
      vi.mocked(getWixCmsItemById).mockImplementation(async (_c, itemId) => {
        if (itemId === "broken") throw new Error("Wix upstream exploded");
        return { title_EN: "OK" };
      });
      vi.mocked(getTranslationProvider).mockReturnValue({
        translate: vi.fn().mockResolvedValue({ fields: { title_VI: "OK VI" }, warnings: [] }),
      });

      const result = await translateCmsEnglishToVietnamese(
        previewOptions({ itemIds: ["good", "broken"], fieldMappings: [{ sourceField: "title_EN", targetField: "title_VI", type: "text" }] })
      );
      const byId = Object.fromEntries(result.items.map((i) => [i.itemId, i]));

      expect(byId.good.status).toBe("translated");
      expect(byId.broken.status).toBe("failed");
      expect(byId.broken.error).toMatch(/Wix upstream exploded/);
    });

    it("pages through the whole collection when itemIds is omitted", async () => {
      vi.mocked(getWixCmsItems)
        .mockResolvedValueOnce({ items: [{ itemId: "a", data: {} }, { itemId: "b", data: {} }], total: 3 })
        .mockResolvedValueOnce({ items: [{ itemId: "c", data: {} }], total: 3 });
      vi.mocked(getWixCmsItemById).mockResolvedValue({ title_EN: "X" });
      vi.mocked(getTranslationProvider).mockReturnValue({
        translate: vi.fn().mockResolvedValue({ fields: { title_VI: "Y" }, warnings: [] }),
      });

      const result = await translateCmsEnglishToVietnamese(
        previewOptions({ itemIds: undefined, batchSize: 2, fieldMappings: [{ sourceField: "title_EN", targetField: "title_VI", type: "text" }] })
      );

      expect(getWixCmsItems).toHaveBeenCalledTimes(2);
      expect(result.items.map((i) => i.itemId).sort()).toEqual(["a", "b", "c"]);
    });
  });

  describe('mode "write" — writes exactly the reviewed values, never calls the AI', () => {
    it("writes the admin-approved values and never calls the translation provider", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ title_EN: "Neat Bar", title_VI: "" });
      vi.mocked(updateWixCmsItemFields).mockResolvedValue({ success: true });

      const result = await translateCmsEnglishToVietnamese(writeOptions());

      expect(getTranslationProvider).not.toHaveBeenCalled();
      expect(result.mode).toBe("write");
      expect(result.items[0]).toMatchObject({ itemId: "item-1", status: "updated", translatedFields: ["title_VI"] });
      expect(vi.mocked(updateWixCmsItemFields).mock.calls[0]).toEqual(["Import1", "item-1", { title_VI: "Bàn Neat" }]);
    });

    it("writes exactly the hand-edited text, not whatever a fresh translation would produce", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ title_EN: "Neat Bar", title_VI: "" });
      vi.mocked(updateWixCmsItemFields).mockResolvedValue({ success: true });

      await translateCmsEnglishToVietnamese(
        writeOptions({ items: [{ itemId: "item-1", fieldValues: { title_VI: "Bản do admin tự sửa tay" } }] })
      );

      expect(vi.mocked(updateWixCmsItemFields).mock.calls[0][2]).toEqual({ title_VI: "Bản do admin tự sửa tay" });
    });

    it("ignores a submitted key that isn't one of the declared targetFields", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ title_EN: "Neat Bar", title_VI: "" });
      vi.mocked(updateWixCmsItemFields).mockResolvedValue({ success: true });

      await translateCmsEnglishToVietnamese(
        writeOptions({ items: [{ itemId: "item-1", fieldValues: { title_VI: "Bàn Neat", _id: "hacked", someOtherField: "x" } }] })
      );

      expect(vi.mocked(updateWixCmsItemFields).mock.calls[0][2]).toEqual({ title_VI: "Bàn Neat" });
    });

    it("skips (doesn't write) a field the admin cleared to empty during review", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ title_EN: "Neat Bar", title_VI: "" });

      const result = await translateCmsEnglishToVietnamese(writeOptions({ items: [{ itemId: "item-1", fieldValues: { title_VI: "   " } }] }));

      expect(updateWixCmsItemFields).not.toHaveBeenCalled();
      expect(result.items[0]).toMatchObject({ status: "skipped", reason: "No approved field values to write." });
    });

    it("re-checks the current CMS value at write time and skips if someone else filled it in since preview (overwrite false)", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ title_EN: "Neat Bar", title_VI: "Ai đó vừa điền vào" });

      const result = await translateCmsEnglishToVietnamese(writeOptions({ overwrite: false }));

      expect(updateWixCmsItemFields).not.toHaveBeenCalled();
      expect(result.items[0].status).toBe("skipped");
    });

    it("writes anyway when overwrite is true, even if the field was filled in since preview", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ title_EN: "Neat Bar", title_VI: "Nội dung cũ" });
      vi.mocked(updateWixCmsItemFields).mockResolvedValue({ success: true });

      const result = await translateCmsEnglishToVietnamese(writeOptions({ overwrite: true }));

      expect(result.items[0].status).toBe("updated");
      expect(updateWixCmsItemFields).toHaveBeenCalled();
    });

    it("marks the item failed (not the whole batch) when the Wix CMS write fails", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ title_EN: "Neat Bar", title_VI: "" });
      vi.mocked(updateWixCmsItemFields).mockResolvedValue({ success: false, error: "Wix API 409 conflict" });

      const result = await translateCmsEnglishToVietnamese(writeOptions());

      expect(result.items[0]).toMatchObject({ status: "failed", error: "Wix API 409 conflict" });
    });

    it("isolates one item's write failure from the rest of the batch", async () => {
      vi.mocked(getWixCmsItemById).mockImplementation(async (_c, itemId) => (itemId === "broken" ? null : { title_EN: "OK", title_VI: "" }));
      vi.mocked(updateWixCmsItemFields).mockResolvedValue({ success: true });

      const result = await translateCmsEnglishToVietnamese(
        writeOptions({
          items: [
            { itemId: "good", fieldValues: { title_VI: "OK VI" } },
            { itemId: "broken", fieldValues: { title_VI: "won't be written" } },
          ],
        })
      );
      const byId = Object.fromEntries(result.items.map((i) => [i.itemId, i]));

      expect(byId.good.status).toBe("updated");
      expect(byId.broken.status).toBe("skipped");
    });
  });
});
