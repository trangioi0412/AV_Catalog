import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getTranslatableFields,
  correlateResults,
  type TranslationSchema,
  type BulkContentInput,
} from "./wixMultilingual";

function makeSchema(overrides?: Partial<TranslationSchema["fields"]>): TranslationSchema {
  return {
    id: "schema-1",
    key: { appId: "app-1", entityType: "Import1", scope: "SITE" },
    displayName: "products",
    fields: {
      title: { id: "title", type: "LONG_TEXT", displayName: "Title" },
      mainFeature: { id: "mainFeature", type: "LONG_TEXT", displayName: "Main Feature" },
      productOverview: { id: "productOverview", type: "LONG_TEXT", displayName: "Product Overview" },
      product: { id: "product", type: "LONG_TEXT", displayName: "Product" },
      datasheet: { id: "datasheet", type: "LONG_TEXT", displayName: "Datasheet" },
      specEN: { id: "specEN", type: "LONG_TEXT", displayName: "Technical Specifications (EN)" },
      faqEN: { id: "faqEN", type: "LONG_TEXT", displayName: "FAQ (EN)" },
      image: { id: "image", type: "IMAGE", displayName: "image" },
      _id: { id: "_id", type: "LONG_TEXT", displayName: "ID", hidden: true },
      ...overrides,
    },
  };
}

describe("getTranslatableFields", () => {
  it("returns only real text fields, excluding media, hidden, and the AV business denylist", () => {
    const fields = getTranslatableFields(makeSchema());
    const keys = fields.map((f) => f.key).sort();

    expect(keys).toEqual(["mainFeature", "productOverview", "title"].sort());
  });

  it("excludes model code, document URL, and manually-curated EN shadow fields even though Wix marks them translatable", () => {
    const fields = getTranslatableFields(makeSchema());
    const keys = fields.map((f) => f.key);

    expect(keys).not.toContain("product");
    expect(keys).not.toContain("datasheet");
    expect(keys).not.toContain("specEN");
    expect(keys).not.toContain("faqEN");
  });

  it("excludes non-text field types (e.g. IMAGE) and hidden system fields (e.g. _id)", () => {
    const fields = getTranslatableFields(makeSchema());
    const keys = fields.map((f) => f.key);

    expect(keys).not.toContain("image");
    expect(keys).not.toContain("_id");
  });

  it("returns an empty list when the schema has no eligible text fields", () => {
    const schema = makeSchema();
    const onlyMedia: TranslationSchema = {
      ...schema,
      fields: { image: schema.fields.image, _id: schema.fields._id },
    };
    expect(getTranslatableFields(onlyMedia)).toEqual([]);
  });
});

describe("correlateResults", () => {
  const inputs: BulkContentInput[] = [
    { schemaId: "s1", entityId: "item-a", locale: "en", fields: {} },
    { schemaId: "s1", entityId: "item-b", locale: "en", fields: {} },
    { schemaId: "s1", entityId: "item-c", locale: "en", fields: {} },
  ];

  it("maps a mixed success/failure bulk response back to the right entityId by originalIndex", () => {
    const results = correlateResults(inputs, [
      { itemMetadata: { originalIndex: 0, success: true } },
      { itemMetadata: { originalIndex: 1, success: false, error: { description: "Validation failed" } } },
      { itemMetadata: { originalIndex: 2, success: true } },
    ]);

    expect(results).toEqual([
      { entityId: "item-a", success: true, error: undefined },
      { entityId: "item-b", success: false, error: "Validation failed" },
      { entityId: "item-c", success: true, error: undefined },
    ]);
  });

  it("does not let one failed item affect the success status of the others", () => {
    const results = correlateResults(inputs.slice(0, 2), [
      { itemMetadata: { originalIndex: 0, success: false, error: { description: "boom" } } },
      { itemMetadata: { originalIndex: 1, success: true } },
    ]);

    expect(results.find((r) => r.entityId === "item-a")?.success).toBe(false);
    expect(results.find((r) => r.entityId === "item-b")?.success).toBe(true);
  });
});

describe("Wix Multilingual network calls (mocked fetch)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.WIX_API_KEY = "test-key";
    process.env.WIX_SITE_ID = "test-site";
    delete process.env.WIX_TRANSLATION_SCHEMA_ID;
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("findCollectionSchema auto-discovers the SITE-scope schema matching the collection ID, without needing WIX_TRANSLATION_SCHEMA_ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        schemas: [
          { id: "other", key: { appId: "a", entityType: "brand", scope: "SITE" }, fields: {} },
          { id: "match", key: { appId: "a", entityType: "Import1", scope: "SITE" }, fields: {} },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const mod = await import("./wixMultilingual");
    const schema = await mod.findCollectionSchema("Import1");

    expect(schema?.id).toBe("match");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("isLocaleAvailable reflects the site's actual VISIBLE locales", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        locales: [
          { id: "vi", languageCode: "vi", visibility: "VISIBLE", primaryLocale: true },
          { id: "en", languageCode: "en", visibility: "VISIBLE", primaryLocale: false },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const mod = await import("./wixMultilingual");
    expect(await mod.isLocaleAvailable("en")).toBe(true);
    expect(await mod.isLocaleAvailable("fr")).toBe(false);
  });

  it("queryContentForEntity returns null when no translation exists yet", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ contents: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const mod = await import("./wixMultilingual");
    const content = await mod.queryContentForEntity("schema-1", "item-1", "en");
    expect(content).toBeNull();
  });

  it("never logs or throws the raw WIX_API_KEY value when a request fails", async () => {
    process.env.WIX_API_KEY = "SECRET_KEY_VALUE";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "upstream failure",
    });
    vi.stubGlobal("fetch", fetchMock);

    const mod = await import("./wixMultilingual");
    await expect(mod.listSiteSchemas(true)).rejects.toThrow();
    try {
      await mod.listSiteSchemas(true);
    } catch (err) {
      expect((err as Error).message).not.toContain("SECRET_KEY_VALUE");
    }
  });

  it("throws a clear NOT_CONFIGURED error instead of an opaque network error when credentials are missing", async () => {
    delete process.env.WIX_API_KEY;
    delete process.env.WIX_SITE_ID;

    const mod = await import("./wixMultilingual");
    await expect(mod.listSiteSchemas(true)).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
  });
});
