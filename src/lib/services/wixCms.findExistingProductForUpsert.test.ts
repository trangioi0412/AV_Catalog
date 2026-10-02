import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { findExistingProductForUpsert } from "./wixCms";

// In-memory stand-in for the Import1 collection, answering the $or/$eq
// filters the lookup sends. Shapes follow real rows: EIZO keeps the product
// line in `product` and the model code in `productItem`.
const cms = [
  { id: "ev2490", data: { title: "FlexScan EV2490", product: "New Standard", productItem: "EV2490" } },
  { id: "ud1", data: { title: "Relacart UD-1 Wireless Conference Microphone", product: "UD-1" } },
];

function matches(data: Record<string, any>, filter: any): boolean {
  return filter.$or.some((cond: Record<string, { $eq: string }>) => {
    const [field, { $eq }] = Object.entries(cond)[0];
    return data[field] === $eq;
  });
}

const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
  const { query } = JSON.parse(String(init.body));
  const items = cms.filter((i) => matches(i.data, query.filter)).slice(0, query.paging.limit);
  return new Response(JSON.stringify({ dataItems: items }), { status: 200 });
});

beforeEach(() => {
  process.env.WIX_API_KEY = "test-key";
  process.env.WIX_SITE_ID = "test-site";
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("findExistingProductForUpsert", () => {
  it("does not match a different model that shares the same product line", async () => {
    // EV2740S is a new model in the "New Standard" line — it must be inserted,
    // not overwrite EV2490.
    const found = await findExistingProductForUpsert({ Product: "New Standard", productItem: "EV2740S" });
    expect(found).toBeNull();
  });

  it("matches an existing row by productItem", async () => {
    const found = await findExistingProductForUpsert({ Product: "New Standard", productItem: "EV2490" });
    expect(found?.id).toBe("ev2490");
  });

  it("falls back to a row whose Product holds the model code", async () => {
    const found = await findExistingProductForUpsert({ Product: "Microphones", productItem: "UD-1" });
    expect(found?.id).toBe("ud1");
  });

  it("uses Product when the row has no productItem", async () => {
    const found = await findExistingProductForUpsert({ Product: "UD-1" });
    expect(found?.id).toBe("ud1");
  });

  it("throws instead of reporting 'not found' when the lookup fails", async () => {
    fetchMock.mockResolvedValueOnce(new Response("boom", { status: 500 }));
    await expect(findExistingProductForUpsert({ productItem: "EV2740S" })).rejects.toThrow(/EV2740S/);
  });
});
