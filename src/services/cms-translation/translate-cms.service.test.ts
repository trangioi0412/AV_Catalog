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

// Never touch the real logs/cms-translate-timestamps.json file from tests — every item
// starts each test with no recorded translation, so the cooldown skip never fires
// unintentionally. The dedicated "cooldown" tests below override getLastTranslatedAt per-case.
vi.mock("./translation-timestamp-store", () => ({
  getLastTranslatedAt: vi.fn(() => null),
  recordTranslated: vi.fn(),
}));

import { getWixCmsItems, getWixCmsItemById, updateWixCmsItemFields } from "@/services/wix-translation/wix-cms.service";
import { getTranslationProvider, TranslationProviderError } from "@/lib/services/translationProvider";
import { getLastTranslatedAt, recordTranslated } from "./translation-timestamp-store";
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
    // clearAllMocks() only resets call history, not mockImplementation/mockReturnValue —
    // restore the "never cooled down" default so per-test overrides don't leak forward.
    vi.mocked(getLastTranslatedAt).mockReturnValue(null);
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

    it("skips a field that was AI-translated within the cooldown window, without calling the provider again", async () => {
      // Cooldown is per (item, targetField) — same recent timestamp for every field this
      // item's mappings ask about, so the whole item ends up with nothing left to translate.
      vi.mocked(getLastTranslatedAt).mockReturnValue(new Date().toISOString());
      vi.mocked(getWixCmsItemById).mockResolvedValue({ title_EN: "Neat Bar", description_EN: "Desc" });
      const translateMock = vi.fn();
      vi.mocked(getTranslationProvider).mockReturnValue({ translate: translateMock });

      const result = await translateCmsEnglishToVietnamese(previewOptions());

      expect(translateMock).not.toHaveBeenCalled();
      expect(result.items[0]).toMatchObject({ status: "skipped" });
      expect(result.items[0].reason).toMatch(/vừa được dịch/i);
    });

    it("translating one field does not cool down a DIFFERENT field on the same item", async () => {
      vi.mocked(getLastTranslatedAt).mockImplementation((_collectionId, _itemId, targetField) =>
        targetField === "title_VI" ? new Date().toISOString() : null
      );
      vi.mocked(getWixCmsItemById).mockResolvedValue({ title_EN: "Neat Bar", description_EN: "Mo ta" });
      const translateMock = vi.fn().mockResolvedValue({ fields: { description_VI: "Mô tả" }, warnings: [] });
      vi.mocked(getTranslationProvider).mockReturnValue({ translate: translateMock });

      const result = await translateCmsEnglishToVietnamese(previewOptions());

      expect(result.items[0].status).toBe("translated");
      expect(result.items[0].fieldValues).toHaveProperty("description_VI");
      expect(result.items[0].fieldValues).not.toHaveProperty("title_VI"); // cooled down, excluded
    });

    it("does not skip an item whose recorded translation is older than the cooldown window", async () => {
      const longAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
      vi.mocked(getLastTranslatedAt).mockReturnValueOnce(longAgo);
      vi.mocked(getWixCmsItemById).mockResolvedValue({ title_EN: "Neat Bar" });
      vi.mocked(getTranslationProvider).mockReturnValue({
        translate: vi.fn().mockResolvedValue({ fields: { title_VI: "Bàn Neat" }, warnings: [] }),
      });

      const result = await translateCmsEnglishToVietnamese(
        previewOptions({ fieldMappings: [{ sourceField: "title_EN", targetField: "title_VI", type: "text" }] })
      );

      expect(result.items[0].status).toBe("translated");
    });

    it("records the translation timestamp only after a successful translation, not for a skipped/failed item", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ title_EN: "Neat Bar" });
      vi.mocked(getTranslationProvider).mockReturnValue({
        translate: vi.fn().mockResolvedValue({ fields: { title_VI: "Bàn Neat" }, warnings: [] }),
      });

      await translateCmsEnglishToVietnamese(
        previewOptions({ fieldMappings: [{ sourceField: "title_EN", targetField: "title_VI", type: "text" }] })
      );

      expect(recordTranslated).toHaveBeenCalledWith("Import1", "item-1", "title_VI");
    });

    it("does not record a timestamp for an item with nothing to translate", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({}); // no source content at all

      await translateCmsEnglishToVietnamese(previewOptions());

      expect(recordTranslated).not.toHaveBeenCalled();
    });

    it("passes the requested sourceLocale/targetLocale through to the AI provider (default en -> vi)", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ title_EN: "Neat Bar" });
      const translateMock = vi.fn().mockResolvedValue({ fields: { title_VI: "Bàn Neat" }, warnings: [] });
      vi.mocked(getTranslationProvider).mockReturnValue({ translate: translateMock });

      await translateCmsEnglishToVietnamese(
        previewOptions({ fieldMappings: [{ sourceField: "title_EN", targetField: "title_VI", type: "text" }] })
      );

      expect(translateMock).toHaveBeenCalledWith(expect.objectContaining({ sourceLocale: "en", targetLocale: "vi" }));
    });

    it("translates Vietnamese -> English when sourceLocale/targetLocale are set that way", async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ title_VI: "Bàn Neat" });
      const translateMock = vi.fn().mockResolvedValue({ fields: { title_EN: "Neat Bar" }, warnings: [] });
      vi.mocked(getTranslationProvider).mockReturnValue({ translate: translateMock });

      const result = await translateCmsEnglishToVietnamese(
        previewOptions({
          fieldMappings: [{ sourceField: "title_VI", targetField: "title_EN", type: "text" }],
          sourceLocale: "vi",
          targetLocale: "en",
        })
      );

      expect(translateMock).toHaveBeenCalledWith(expect.objectContaining({ sourceLocale: "vi", targetLocale: "en" }));
      expect(result.items[0].fieldValues?.title_EN.translated).toBe("Neat Bar");
    });

    it('type "json": translates every string leaf inside an array field and rebuilds the same shape', async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({
        faq_EN: [
          { question: "What is it?", answer: "A speakerphone." },
          { question: "How loud?", answer: "Very loud." },
        ],
      });
      const translateMock = vi.fn().mockResolvedValue({
        fields: {
          "faq_VI.0.question": "Đây là gì?",
          "faq_VI.0.answer": "Một loa hội nghị.",
          "faq_VI.1.question": "To đến mức nào?",
          "faq_VI.1.answer": "Rất to.",
        },
        warnings: [],
      });
      vi.mocked(getTranslationProvider).mockReturnValue({ translate: translateMock });

      const result = await translateCmsEnglishToVietnamese(
        previewOptions({ fieldMappings: [{ sourceField: "faq_EN", targetField: "faq_VI", type: "json" }] })
      );

      expect(result.items[0].status).toBe("translated");
      const translatedJson = JSON.parse(result.items[0].fieldValues?.faq_VI.translated ?? "null");
      expect(translatedJson).toEqual([
        { question: "Đây là gì?", answer: "Một loa hội nghị." },
        { question: "To đến mức nào?", answer: "Rất to." },
      ]);
      const sourceJson = JSON.parse(result.items[0].fieldValues?.faq_VI.source ?? "null");
      expect(sourceJson[0].question).toBe("What is it?");
    });

    it('type "json": translates a real-world spec-table array of {label, value} objects', async () => {
      // The exact shape reported live: a Technical Specifications-style array, label already
      // partly Vietnamese/partly English, value mostly English with a little Vietnamese mixed in.
      const specs = [
        { label: "Loại sản phẩm", value: "Workspace booking module trong Zoom platform." },
        { label: "Booking types", value: "meeting rooms, hot desks, parking, lockers." },
        { label: "Integration", value: "Microsoft 365 Calendar, Google Calendar, Zoom Rooms hardware." },
        { label: "Check-in", value: "QR code, NFC, kiosk display." },
        { label: "Wayfinding", value: "floor maps, kiosks." },
        { label: "Analytics", value: "utilization reports." },
        { label: "Pricing", value: "per-user/month, tùy tier." },
      ];
      vi.mocked(getWixCmsItemById).mockResolvedValue({ specs_EN: specs });
      const translateMock = vi.fn().mockImplementation(async ({ fields }: { fields: Record<string, string> }) => ({
        fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, `VI: ${v}`])),
        warnings: [],
      }));
      vi.mocked(getTranslationProvider).mockReturnValue({ translate: translateMock });

      const result = await translateCmsEnglishToVietnamese(
        previewOptions({ fieldMappings: [{ sourceField: "specs_EN", targetField: "specs_VI", type: "json" }] })
      );

      expect(result.items[0].status).toBe("translated");
      const translated = JSON.parse(result.items[0].fieldValues?.specs_VI.translated ?? "null");
      expect(translated).toHaveLength(7);
      // Both "label" and "value" leaves got sent through translation, not just "value".
      expect(translated[1]).toEqual({ label: "VI: Booking types", value: "VI: meeting rooms, hot desks, parking, lockers." });
      expect(translated[6].value).toBe("VI: per-user/month, tùy tier.");
    });

    it('type "json": auto-detects and translates a source field stored as a JSON-encoded STRING (a Text column, not a real Array/Object column)', async () => {
      const specsAsString = JSON.stringify([{ label: "Pricing", value: "per-user/month" }]);
      vi.mocked(getWixCmsItemById).mockResolvedValue({ specs_EN: specsAsString });
      const translateMock = vi.fn().mockResolvedValue({
        fields: { "specs_VI.0.label": "Giá", "specs_VI.0.value": "theo người dùng/tháng" },
        warnings: [],
      });
      vi.mocked(getTranslationProvider).mockReturnValue({ translate: translateMock });

      const result = await translateCmsEnglishToVietnamese(
        previewOptions({ fieldMappings: [{ sourceField: "specs_EN", targetField: "specs_VI", type: "json" }] })
      );

      expect(result.items[0].status).toBe("translated");
      expect(translateMock).toHaveBeenCalled();
      const translated = JSON.parse(result.items[0].fieldValues?.specs_VI.translated ?? "null");
      expect(translated).toEqual([{ label: "Giá", value: "theo người dùng/tháng" }]);
    });

    it('type "json": does NOT mistake an ordinary string (that happens to start with "[") for JSON', async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ specs_EN: "[not actually json, just a note]" });
      const translateMock = vi.fn();
      vi.mocked(getTranslationProvider).mockReturnValue({ translate: translateMock });

      const result = await translateCmsEnglishToVietnamese(
        previewOptions({ fieldMappings: [{ sourceField: "specs_EN", targetField: "specs_VI", type: "json" }] })
      );

      expect(translateMock).not.toHaveBeenCalled();
      expect(result.items[0]).toMatchObject({ status: "skipped", reason: "No source content to translate" });
    });

    it('type "json": skips a plain object field whose target already has data, unless overwrite is set', async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({
        specs_EN: { power: "50W", weight: "2kg" },
        specs_VI: { power: "50W", weight: "2kg" },
      });
      const translateMock = vi.fn();
      vi.mocked(getTranslationProvider).mockReturnValue({ translate: translateMock });

      const result = await translateCmsEnglishToVietnamese(
        previewOptions({ overwrite: false, fieldMappings: [{ sourceField: "specs_EN", targetField: "specs_VI", type: "json" }] })
      );

      expect(translateMock).not.toHaveBeenCalled();
      expect(result.items[0]).toMatchObject({ status: "skipped", reason: "Target field already contains data" });
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

    it('type "json": parses the reviewed JSON text back into a real array/object before writing', async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ faq_EN: [{ q: "a" }], faq_VI: null });
      vi.mocked(updateWixCmsItemFields).mockResolvedValue({ success: true });

      const jsonText = JSON.stringify([{ q: "cau hoi" }], null, 2);
      await translateCmsEnglishToVietnamese(
        writeOptions({
          fieldMappings: [{ sourceField: "faq_EN", targetField: "faq_VI", type: "json" }],
          items: [{ itemId: "item-1", fieldValues: { faq_VI: jsonText } }],
        })
      );

      expect(vi.mocked(updateWixCmsItemFields).mock.calls[0][2]).toEqual({ faq_VI: [{ q: "cau hoi" }] });
    });

    it('type "json": writes a native array/object when the target field had no prior value (default — matches a real Wix Array/Object column)', async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ specs_EN: [{ label: "a", value: "b" }], specs_VI: null });
      vi.mocked(updateWixCmsItemFields).mockResolvedValue({ success: true });

      const jsonText = JSON.stringify([{ label: "a", value: "b dịch" }]);
      await translateCmsEnglishToVietnamese(
        writeOptions({
          fieldMappings: [{ sourceField: "specs_EN", targetField: "specs_VI", type: "json" }],
          items: [{ itemId: "item-1", fieldValues: { specs_VI: jsonText } }],
        })
      );

      const written = vi.mocked(updateWixCmsItemFields).mock.calls[0][2].specs_VI;
      expect(Array.isArray(written)).toBe(true);
      expect(written).toEqual([{ label: "a", value: "b dịch" }]);
    });

    it('type "json": writes back a JSON-encoded STRING when the target field already stored one that way (a Text column, overwrite on)', async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({
        specs_EN: [{ label: "a", value: "b" }],
        specs_VI: JSON.stringify([{ label: "a", value: "cũ" }]), // existing value is a JSON string, not a native array
      });
      vi.mocked(updateWixCmsItemFields).mockResolvedValue({ success: true });

      const jsonText = JSON.stringify([{ label: "a", value: "b dịch" }]);
      await translateCmsEnglishToVietnamese(
        writeOptions({
          overwrite: true,
          fieldMappings: [{ sourceField: "specs_EN", targetField: "specs_VI", type: "json" }],
          items: [{ itemId: "item-1", fieldValues: { specs_VI: jsonText } }],
        })
      );

      const written = vi.mocked(updateWixCmsItemFields).mock.calls[0][2].specs_VI;
      expect(typeof written).toBe("string");
      expect(JSON.parse(written as string)).toEqual([{ label: "a", value: "b dịch" }]);
    });

    it('type "json": fails the item with a clear error when the hand-edited text is not valid JSON', async () => {
      vi.mocked(getWixCmsItemById).mockResolvedValue({ faq_EN: [{ q: "a" }], faq_VI: null });

      const result = await translateCmsEnglishToVietnamese(
        writeOptions({
          fieldMappings: [{ sourceField: "faq_EN", targetField: "faq_VI", type: "json" }],
          items: [{ itemId: "item-1", fieldValues: { faq_VI: "{ not valid json" } }],
        })
      );

      expect(updateWixCmsItemFields).not.toHaveBeenCalled();
      expect(result.items[0]).toMatchObject({ status: "failed" });
      expect(result.items[0].error).toMatch(/JSON hợp lệ/);
    });
  });
});
