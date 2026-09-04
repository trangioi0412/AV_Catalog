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

describe("updateWixCmsItemFields (mocked fetch)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.WIX_API_KEY = "test-key";
    process.env.WIX_SITE_ID = "test-site";
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("retries a 429 (Wix's per-minute quota) with backoff and succeeds once the quota clears", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => "WDE0014: Requests per minute quota exceeded." })
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => "WDE0014: Requests per minute quota exceeded." })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    const mod = await import("./wix-cms.service");
    const resultPromise = mod.updateWixCmsItemFields("Import1", "item-1", { title_VI: "Bàn Neat" });

    // Let both backoff delays (3s, then 6s) elapse without a real 9s test wait.
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after exhausting retries on a sustained 429 and reports it as a failure, not a thrown error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "WDE0014: Requests per minute quota exceeded." })
    );

    const mod = await import("./wix-cms.service");
    const resultPromise = mod.updateWixCmsItemFields("Import1", "item-1", { title_VI: "Bàn Neat" });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/429/);
  });

  it("does not retry a non-429 failure (e.g. a validation error) — fails immediately", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "Invalid field value." });
    vi.stubGlobal("fetch", fetchMock);

    const mod = await import("./wix-cms.service");
    const result = await mod.updateWixCmsItemFields("Import1", "item-1", { title_VI: "Bàn Neat" });

    expect(result.success).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("skips the request entirely (and never touches fetch) when there are no fields to write", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const mod = await import("./wix-cms.service");
    const result = await mod.updateWixCmsItemFields("Import1", "item-1", {});

    expect(result).toEqual({ success: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("paces back-to-back writes apart instead of firing them all at once, to avoid causing a 429 in the first place", async () => {
    process.env.WIX_MIN_WRITE_INTERVAL_MS = "300";
    const callTimes: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        callTimes.push(Date.now());
        return { ok: true, status: 200, json: async () => ({}) };
      })
    );

    const mod = await import("./wix-cms.service");
    const p1 = mod.updateWixCmsItemFields("Import1", "item-1", { title_VI: "A" });
    const p2 = mod.updateWixCmsItemFields("Import1", "item-2", { title_VI: "B" });
    await vi.runAllTimersAsync();
    await Promise.all([p1, p2]);

    expect(callTimes).toHaveLength(2);
    expect(callTimes[1] - callTimes[0]).toBeGreaterThanOrEqual(300);
  });
});
