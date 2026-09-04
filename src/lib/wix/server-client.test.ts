import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("wixDataFetch", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.WIX_API_KEY = "test-api-key";
    process.env.WIX_SITE_ID = "test-site-id";
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it('maps a 429 response to a "RATE_LIMITED" WixServerClientError, distinct from other upstream failures', async () => {
    const { wixDataFetch, WixServerClientError } = await import("./server-client");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "WDE0014: Requests per minute quota exceeded." }));

    let caught: unknown;
    try {
      await wixDataFetch("items/some-id", { foo: "bar" }, "PATCH");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(WixServerClientError);
    expect(caught).toMatchObject({ code: "RATE_LIMITED", status: 429 });
  });

  it('maps a non-429 failure (e.g. 500) to "UPSTREAM_ERROR", unchanged from before', async () => {
    const { wixDataFetch } = await import("./server-client");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "Internal error" }));

    await expect(wixDataFetch("items/some-id")).rejects.toMatchObject({ code: "UPSTREAM_ERROR", status: 500 });
  });

  it("throws NOT_CONFIGURED before ever calling fetch when Wix credentials are missing", async () => {
    delete process.env.WIX_API_KEY;
    delete process.env.WIX_SITE_ID;
    const { wixDataFetch } = await import("./server-client");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(wixDataFetch("items/query")).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
