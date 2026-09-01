import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("getWixCollectionFields (mocked fetch)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.WIX_API_KEY = "test-key";
    process.env.WIX_SITE_ID = "test-site";
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("returns the fields of the matching collection, using the field key as a fallback display name", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        collections: [
          { id: "brand", fields: [{ key: "name", displayName: "Name", type: "TEXT" }] },
          {
            id: "Import1",
            fields: [
              { key: "title_EN", displayName: "Title (EN)", type: "TEXT" },
              { key: "title_VI", type: "TEXT" },
            ],
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const mod = await import("./wix-cms.service");
    const fields = await mod.getWixCollectionFields("Import1");

    expect(fields).toEqual([
      { key: "title_EN", displayName: "Title (EN)", type: "TEXT" },
      { key: "title_VI", displayName: "title_VI", type: "TEXT" },
    ]);
    // Called the "GET" list-collections endpoint, not a POST query.
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("returns an empty list when the collection isn't found in the response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ collections: [] }) }));
    const mod = await import("./wix-cms.service");
    expect(await mod.getWixCollectionFields("does-not-exist")).toEqual([]);
  });
});
