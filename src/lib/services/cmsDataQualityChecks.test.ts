import { describe, it, expect } from "vitest";
import { runRuleChecks, RULE_CHECKS, type QualityCheckProduct } from "./cmsDataQualityChecks";

const ALL = RULE_CHECKS.map((r) => r.key);

function product(over: Partial<QualityCheckProduct> & { id: string }): QualityCheckProduct {
  return {
    brand: "Eizo",
    title: `Product ${over.id}`,
    product: "",
    category: "Monitor",
    series: "",
    mainFeature: `Feature text unique to ${over.id}`,
    productOverview: `Overview text unique to ${over.id}`,
    specs: [{ label: "Size", value: "27 inch" }],
    image: "wix:image://v1/abc/x.jpg",
    datasheet: "https://example.com/a.pdf",
    ...over,
  };
}

const categoriesOf = (res: Map<string, { category: string }[]>, id: string) => (res.get(id) || []).map((f) => f.category);

describe("runRuleChecks", () => {
  it("reports nothing for a complete, clean product", () => {
    expect(runRuleChecks([product({ id: "a" })], ALL).size).toBe(0);
  });

  it("lists every empty required field", () => {
    const res = runRuleChecks([product({ id: "a", mainFeature: "", specs: [], image: "", brand: "Chưa gắn nhãn hãng" })], ["missing_fields"]);
    expect(res.get("a")![0].message).toBe("Đang trống: Main Feature, Technical Specifications, ảnh (image), hãng (Brand).");
  });

  it("flags a double import (same name, same or no model code)", () => {
    const res = runRuleChecks([product({ id: "a", title: "FlexScan EV2490" }), product({ id: "b", title: "FlexScan-EV2490" })], ["duplicate_product"]);
    expect(res.get("a")![0].message).toContain("có thể bị import 2 lần");
    expect(res.get("b")).toBeDefined();
  });

  it("explains same-name products that have different model codes", () => {
    const res = runRuleChecks(
      [product({ id: "a", title: "Extension Unit", productItem: "VIS-A" }), product({ id: "b", title: "Extension Unit", productItem: "VIS-B" })],
      ["duplicate_product"]
    );
    expect(res.get("a")![0].message).toContain("khác mã model (VIS-A, VIS-B)");
  });

  it("flags a description copied onto a differently-named product, but not short generic text", () => {
    const text = "Advanced color management with built-in calibration sensor and 4K HDR support.";
    const res = runRuleChecks(
      [
        product({ id: "a", title: "CG2700X", mainFeature: text }),
        product({ id: "b", title: "CS2740", mainFeature: text }),
        product({ id: "c", productOverview: "HDMI 2.0" }),
        product({ id: "d", productOverview: "HDMI 2.0" }),
      ],
      ["copied_content"]
    );
    expect(categoriesOf(res, "a")).toEqual(["copied_content"]);
    expect(res.has("c")).toBe(false);
  });

  it("catches placeholders, mojibake, and conflicting specs", () => {
    const res = runRuleChecks(
      [
        product({ id: "a", productOverview: "Tính năng: CẦN VERIFY" }),
        product({ id: "b", title: "Mô tả sáº£n pháº©m" }),
        product({ id: "d", title: "ÂM THANH HỘI NGHỊ NGÃ BA" }),
        product({
          id: "c",
          specs: [
            { label: "Trục xoay.", value: "35°" },
            { label: "Trục xoay.", value: "90°" },
          ],
        }),
      ],
      ["placeholder_text", "broken_encoding", "spec_conflict"]
    );
    expect(categoriesOf(res, "a")).toEqual(["placeholder_text"]);
    expect(categoriesOf(res, "b")).toEqual(["broken_encoding"]);
    expect(res.has("d")).toBe(false);
    expect(res.get("c")![0].message).toContain('"Trục xoay." (2 giá trị)');
  });

  it("flags a Datasheet URL containing a space", () => {
    const res = runRuleChecks([product({ id: "a", datasheet: "https://x.com/Fully_Digital_ V1.0.pdf" })], ["invalid_link"]);
    expect(res.get("a")![0].message).toContain("chứa khoảng trắng");
  });

  it("only reports in-scope products but compares against the whole catalog", () => {
    const eizo = product({ id: "a", title: "Same Name" });
    const other = product({ id: "b", brand: "Vissonic", title: "Same Name" });
    const res = runRuleChecks([eizo], ["duplicate_product"], [eizo, other]);
    expect([...res.keys()]).toEqual(["a"]);
    expect(res.get("a")![0].message).toContain("Vissonic Same Name");
  });

  it("only runs the selected checks", () => {
    expect(runRuleChecks([product({ id: "a", mainFeature: "" })], ["placeholder_text"]).size).toBe(0);
  });
});
