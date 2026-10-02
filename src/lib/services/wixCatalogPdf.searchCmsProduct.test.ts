import { describe, it, expect, vi, beforeEach } from "vitest";

// Shapes taken from real Import1 rows: EIZO keeps the model in `title` and the
// series in `product`; other brands keep the model in `product`.
const products = [
  { _id: "eizo-ev2490", Title: "FlexScan EV2490", Product: "Premium", Brand: "b1", Category: "" },
  { _id: "eizo-ux2", Title: "UX2 Sensor", Product: "Quality Control", Brand: "b1", Category: "" },
  { _id: "relacart-ud1", Title: "Relacart UD-1 Wireless Conference Microphone", Product: "UD-1", Brand: "b2", Category: "" },
];

vi.mock("./wixCms", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./wixCms")>();
  return { ...actual, getAllProducts: vi.fn(async () => products) };
});

import { searchCmsProduct, clearCmsProductListCache } from "./wixCatalogPdf";

describe("searchCmsProduct", () => {
  beforeEach(() => clearCmsProductListCache());

  it("matches a filename against the Title column (EIZO-style rows)", async () => {
    const res = await searchCmsProduct("FlexScan EV2490", "EIZO");
    expect(res).toMatchObject({ status: "matched", itemId: "eizo-ev2490", productName: "FlexScan EV2490" });
  });

  it("still matches against the Product column", async () => {
    const res = await searchCmsProduct("UD-1", "Relacart");
    expect(res).toMatchObject({ status: "matched", itemId: "relacart-ud1", productName: "UD-1" });
  });

  it("returns no_match for a product that is not in the CMS", async () => {
    const res = await searchCmsProduct("FlexScan EV2740S", "EIZO");
    expect(res.status).toBe("no_match");
    expect(res.suggestions?.[0]?.itemId).toBe("eizo-ev2490");
  });
});
