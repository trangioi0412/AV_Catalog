import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { GenerateTranslationsResponse } from "@/types/translation";

vi.mock("@/lib/services/wixCatalogPdf", () => ({
  checkAdminSession: vi.fn(),
}));

vi.mock("@/lib/services/wixMultilingual", async () => {
  const actual = await vi.importActual<typeof import("@/lib/services/wixMultilingual")>(
    "@/lib/services/wixMultilingual"
  );
  return {
    ...actual,
    findCollectionSchema: vi.fn(),
    getRawCmsItem: vi.fn(),
    isLocaleAvailable: vi.fn(),
    queryContentForEntity: vi.fn(),
  };
});

vi.mock("@/lib/services/translationProvider", () => ({
  getTranslationProvider: vi.fn(),
  TranslationProviderError: class extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
}));

import { checkAdminSession } from "@/lib/services/wixCatalogPdf";
import { findCollectionSchema, getRawCmsItem, isLocaleAvailable, queryContentForEntity } from "@/lib/services/wixMultilingual";
import { getTranslationProvider } from "@/lib/services/translationProvider";
import { POST } from "./route";

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/admin/translations/generate", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "admin_session=true" },
    body: JSON.stringify(body),
  });
}

const SCHEMA = {
  id: "schema-1",
  key: { appId: "app-1", entityType: "Import1", scope: "SITE" },
  displayName: "products",
  fields: {
    title: { id: "title", type: "LONG_TEXT", displayName: "Title" },
    productOverview: { id: "productOverview", type: "LONG_TEXT", displayName: "Product Overview" },
  },
};

describe("POST /api/admin/translations/generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated requests without ever calling Wix or the translation provider", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(false);

    const res = await POST(makeRequest({ itemIds: ["item-1"] }));

    expect(res.status).toBe(401);
    expect(findCollectionSchema).not.toHaveBeenCalled();
  });

  it("rejects a batch larger than the max batch size before touching Wix", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    const tooMany = Array.from({ length: 25 }, (_, i) => `item-${i}`);

    const res = await POST(makeRequest({ itemIds: tooMany }));

    expect(res.status).toBe(400);
    expect(findCollectionSchema).not.toHaveBeenCalled();
  });

  it("reports a clear blocker when no translation schema exists for the collection", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    vi.mocked(findCollectionSchema).mockResolvedValue(null);

    const res = await POST(makeRequest({ itemIds: ["item-1"] }));
    const json = await res.json();

    expect(res.status).toBe(422);
    expect(json.code).toBe("SCHEMA_NOT_FOUND");
  });

  it("blocks generation when the English locale is not enabled/visible in Wix Multilingual", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    vi.mocked(findCollectionSchema).mockResolvedValue(SCHEMA);
    vi.mocked(isLocaleAvailable).mockResolvedValue(false);

    const res = await POST(makeRequest({ itemIds: ["item-1"] }));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe("LOCALE_NOT_AVAILABLE");
  });

  it("translates only the fields the item doesn't already have a translation for, per item, isolating one item's failure from the rest", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    vi.mocked(findCollectionSchema).mockResolvedValue(SCHEMA);
    vi.mocked(isLocaleAvailable).mockResolvedValue(true);
    vi.mocked(queryContentForEntity).mockResolvedValue(null);

    vi.mocked(getRawCmsItem).mockImplementation(async (_collectionId, itemId) => {
      if (itemId === "missing-item") return null;
      if (itemId === "broken-item") throw new Error("Wix upstream exploded");
      return { title: "Neat Bar BYOD", productOverview: "Mo ta san pham" };
    });

    vi.mocked(getTranslationProvider).mockReturnValue({
      translate: vi.fn().mockResolvedValue({
        fields: { title: "Neat Bar BYOD", productOverview: "Product description" },
        warnings: [],
      }),
    });

    const res = await POST(makeRequest({ itemIds: ["good-item", "missing-item", "broken-item"] }));
    const json = (await res.json()) as GenerateTranslationsResponse;

    expect(res.status).toBe(200);
    const byId = Object.fromEntries(json.items.map((it) => [it.entityId, it]));

    expect(byId["good-item"].status).toBe("success");
    expect(byId["good-item"].fields?.find((f) => f.key === "title")?.translated).toBe("Neat Bar BYOD");
    expect(byId["missing-item"].status).toBe("failed");
    expect(byId["missing-item"].message).toMatch(/not found/i);
    expect(byId["broken-item"].status).toBe("failed");
    expect(byId["broken-item"].message).toMatch(/Wix upstream exploded/);
  });

  it("does not call the AI translator again for an item that already has a translation, unless forced", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(true);
    vi.mocked(findCollectionSchema).mockResolvedValue(SCHEMA);
    vi.mocked(isLocaleAvailable).mockResolvedValue(true);
    vi.mocked(getRawCmsItem).mockResolvedValue({ title: "Neat Bar BYOD", productOverview: "Mo ta" });
    vi.mocked(queryContentForEntity).mockResolvedValue({
      id: "c1",
      schemaId: "schema-1",
      entityId: "existing-item",
      locale: "en",
      fields: { title: { textValue: "Existing EN title" }, productOverview: { textValue: "Existing EN overview" } },
    });

    const translateMock = vi.fn().mockResolvedValue({ fields: {}, warnings: [] });
    vi.mocked(getTranslationProvider).mockReturnValue({ translate: translateMock });

    const res = await POST(makeRequest({ itemIds: ["existing-item"] }));
    const json = (await res.json()) as GenerateTranslationsResponse;

    expect(res.status).toBe(200);
    expect(translateMock).not.toHaveBeenCalled();
    expect(json.items[0].hasExistingTranslation).toBe(true);
    expect(json.items[0].fields?.find((f) => f.key === "title")?.translated).toBe("Existing EN title");
  });
});
