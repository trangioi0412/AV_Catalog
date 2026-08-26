import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { SaveTranslationsResponse } from "@/types/translation";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

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
    isLocaleAvailable: vi.fn(),
    queryContentForEntity: vi.fn(),
    bulkCreateContent: vi.fn(),
    bulkUpdateContentByKey: vi.fn(),
  };
});

import { checkAdminSession } from "@/lib/services/wixCatalogPdf";
import {
  findCollectionSchema,
  isLocaleAvailable,
  queryContentForEntity,
  bulkCreateContent,
  bulkUpdateContentByKey,
} from "@/lib/services/wixMultilingual";
import { POST } from "./route";

function makeRequest(body: unknown) {
  return new NextRequest("http://localhost/api/admin/translations/save", {
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
    product: { id: "product", type: "LONG_TEXT", displayName: "Product" },
  },
};

describe("POST /api/admin/translations/save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkAdminSession).mockReturnValue(true);
    vi.mocked(findCollectionSchema).mockResolvedValue(SCHEMA);
    vi.mocked(isLocaleAvailable).mockResolvedValue(true);
    vi.mocked(bulkCreateContent).mockResolvedValue([]);
    vi.mocked(bulkUpdateContentByKey).mockResolvedValue([]);
  });

  it("rejects unauthenticated requests without writing anything to Wix", async () => {
    vi.mocked(checkAdminSession).mockReturnValue(false);

    const res = await POST(makeRequest({ items: [{ entityId: "a", fields: { title: "Hi" } }] }));

    expect(res.status).toBe(401);
    expect(bulkCreateContent).not.toHaveBeenCalled();
    expect(bulkUpdateContentByKey).not.toHaveBeenCalled();
  });

  it("drops any field key that isn't in the schema's translatable allowlist before writing", async () => {
    vi.mocked(queryContentForEntity).mockResolvedValue(null);
    vi.mocked(bulkCreateContent).mockImplementation(async (inputs) => {
      // The model-code field must never reach Wix Multilingual as a translated value.
      expect(Object.keys(inputs[0].fields)).not.toContain("product");
      expect(Object.keys(inputs[0].fields)).toContain("title");
      return [{ entityId: inputs[0].entityId, success: true }];
    });
    vi.mocked(queryContentForEntity).mockResolvedValueOnce(null).mockResolvedValue({
      id: "c1",
      schemaId: "schema-1",
      entityId: "item-1",
      locale: "en",
      fields: {},
    });

    const res = await POST(
      makeRequest({
        published: false,
        items: [{ entityId: "item-1", fields: { title: "Neat Bar", product: "should-be-dropped" }, overwrite: false }],
      })
    );

    expect(res.status).toBe(200);
    expect(bulkCreateContent).toHaveBeenCalledTimes(1);
  });

  it("creates new content for an item with no existing translation", async () => {
    vi.mocked(queryContentForEntity)
      .mockResolvedValueOnce(null) // existence check
      .mockResolvedValueOnce({ id: "c1", schemaId: "schema-1", entityId: "item-1", locale: "en", fields: {} }); // verification
    vi.mocked(bulkCreateContent).mockResolvedValue([{ entityId: "item-1", success: true }]);

    const res = await POST(
      makeRequest({ published: false, items: [{ entityId: "item-1", fields: { title: "Neat Bar" }, overwrite: false }] })
    );
    const json = await res.json();

    expect(bulkCreateContent).toHaveBeenCalledTimes(1);
    expect(bulkUpdateContentByKey).toHaveBeenCalledWith([]);
    expect(json.items[0]).toMatchObject({ entityId: "item-1", status: "success" });
  });

  it("updates existing content (instead of creating) when overwrite is confirmed", async () => {
    vi.mocked(queryContentForEntity)
      .mockResolvedValueOnce({ id: "c1", schemaId: "schema-1", entityId: "item-1", locale: "en", fields: {} }) // existence check
      .mockResolvedValueOnce({ id: "c1", schemaId: "schema-1", entityId: "item-1", locale: "en", fields: {} }); // verification
    vi.mocked(bulkUpdateContentByKey).mockResolvedValue([{ entityId: "item-1", success: true }]);

    const res = await POST(
      makeRequest({ published: true, items: [{ entityId: "item-1", fields: { title: "Neat Bar" }, overwrite: true }] })
    );
    const json = await res.json();

    expect(bulkUpdateContentByKey).toHaveBeenCalledTimes(1);
    expect(bulkCreateContent).toHaveBeenCalledWith([]);
    expect(json.published).toBe(true);
    expect(json.items[0]).toMatchObject({ entityId: "item-1", status: "success" });
  });

  it("does not overwrite an existing translation without explicit confirmation, and never calls the write APIs for it", async () => {
    vi.mocked(queryContentForEntity).mockResolvedValue({
      id: "c1",
      schemaId: "schema-1",
      entityId: "item-1",
      locale: "en",
      fields: {},
    });

    const res = await POST(
      makeRequest({ published: false, items: [{ entityId: "item-1", fields: { title: "Neat Bar" }, overwrite: false }] })
    );
    const json = await res.json();

    expect(bulkCreateContent).toHaveBeenCalledWith([]);
    expect(bulkUpdateContentByKey).toHaveBeenCalledWith([]);
    expect(json.items[0].status).toBe("skipped");
    expect(json.items[0].message).toMatch(/overwrite/i);
  });

  it("passes published:true through to the write payload only when explicitly requested (draft vs publish)", async () => {
    vi.mocked(queryContentForEntity).mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: "c1",
      schemaId: "schema-1",
      entityId: "item-1",
      locale: "en",
      fields: {},
    });

    let capturedPublished: boolean | undefined;
    vi.mocked(bulkCreateContent).mockImplementation(async (inputs) => {
      capturedPublished = inputs[0].fields.title.published;
      return [{ entityId: inputs[0].entityId, success: true }];
    });

    await POST(makeRequest({ published: true, items: [{ entityId: "item-1", fields: { title: "Neat Bar" }, overwrite: false }] }));

    expect(capturedPublished).toBe(true);
  });

  it("marks an item as failed (not success) when the post-write verification query can't find it", async () => {
    vi.mocked(queryContentForEntity).mockResolvedValueOnce(null).mockResolvedValueOnce(null); // existence check, then failed verification
    vi.mocked(bulkCreateContent).mockResolvedValue([{ entityId: "item-1", success: true }]);

    const res = await POST(
      makeRequest({ published: false, items: [{ entityId: "item-1", fields: { title: "Neat Bar" }, overwrite: false }] })
    );
    const json = await res.json();

    expect(json.items[0].status).toBe("failed");
    expect(json.items[0].message).toMatch(/verification/i);
  });

  it("isolates a failed item from a successful one within the same batch", async () => {
    vi.mocked(queryContentForEntity)
      .mockResolvedValueOnce(null) // item-1 existence check
      .mockResolvedValueOnce(null) // item-2 existence check
      .mockResolvedValueOnce({ id: "c1", schemaId: "schema-1", entityId: "item-1", locale: "en", fields: {} }); // item-1 verification (item-2 failed at write, no verification call)

    vi.mocked(bulkCreateContent).mockImplementation(async (inputs) => {
      return inputs.map((i) =>
        i.entityId === "item-2" ? { entityId: i.entityId, success: false, error: "Field validation failed" } : { entityId: i.entityId, success: true }
      );
    });

    const res = await POST(
      makeRequest({
        published: false,
        items: [
          { entityId: "item-1", fields: { title: "Neat Bar" }, overwrite: false },
          { entityId: "item-2", fields: { title: "Broken" }, overwrite: false },
        ],
      })
    );
    const json = (await res.json()) as SaveTranslationsResponse;
    const byId = Object.fromEntries(json.items.map((it) => [it.entityId, it]));

    expect(byId["item-1"].status).toBe("success");
    expect(byId["item-2"].status).toBe("failed");
    expect(byId["item-2"].message).toMatch(/Field validation failed/);
  });

  it("never leaks Wix credentials or internal stack traces in an error response", async () => {
    vi.mocked(findCollectionSchema).mockRejectedValue(new Error("secret WIX_API_KEY=abc123 leaked in stack trace"));

    const res = await POST(makeRequest({ items: [{ entityId: "item-1", fields: { title: "Neat Bar" }, overwrite: false }] }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(JSON.stringify(json)).not.toContain("WIX_API_KEY");
    expect(json.error).toBe("Internal server error.");
  });
});
