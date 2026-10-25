import { describe, expect, it } from "vitest";
import {
  countFilledSpecs,
  getFilledFieldKeys,
  getMissingContent,
  hasContent,
  missingFromFilled,
} from "./productCompleteness";

describe("hasContent", () => {
  it.each([
    [undefined, false],
    [null, false],
    ["", false],
    ["   ", false],
    ["—", false],
    ["N/A", false],
    ["[]", false],
    ["{}", false],
    ['["", "  "]', false],
    ['[{"label":"Weight","value":""}]', false],
    ['[{"label":"Weight","value":"  "},{"label":"Size","value":"-"}]', false],
    ['{"Weight":""}', false],
    [[], false],
    [["", " "], false],
    [[{ label: "Weight", value: "" }], false],
    ["Camera PTZ 4K", true],
    ['["Zoom 20x"]', true],
    ['[{"label":"Weight","value":"1.2 kg"}]', true],
    ['{"Weight":"1.2 kg"}', true],
    ['[{"label":"Ports","value":["HDMI"]}]', true],
    ["[Beta] new model", true],
    [[{ label: "Weight", value: "1.2 kg" }], true],
    [["wix:image://v1/a.jpg"], true],
  ])("%j -> %s", (raw, expected) => {
    expect(hasContent(raw)).toBe(expected);
  });
});

describe("countFilledSpecs", () => {
  it("counts only rows with a value", () => {
    expect(
      countFilledSpecs('[{"label":"A","value":"1"},{"label":"B","value":""},{"label":"C","value":"3"}]')
    ).toEqual({ filled: 2, total: 3 });
    expect(countFilledSpecs([{ label: "A", value: "1" }, { label: "B", value: "" }])).toEqual({ filled: 1, total: 2 });
  });

  it("handles empty and non-JSON input", () => {
    expect(countFilledSpecs("[]")).toEqual({ filled: 0, total: 0 });
    expect(countFilledSpecs("")).toEqual({ filled: 0, total: 0 });
    expect(countFilledSpecs(undefined)).toEqual({ filled: 0, total: 0 });
    expect(countFilledSpecs("Weight: 1kg")).toEqual({ filled: 1, total: 1 });
  });
});

describe("getMissingContent", () => {
  const product = {
    Category: "Camera",
    Title: "PTZ Camera",
    MainFeature: "[]",
    ProductOverview: "Overview",
    TechnicalSpecifications: '[{"label":"Zoom","value":""}]',
    image: "https://example.com/a.png",
    Datasheet: "",
  };

  it("uses the default field set", () => {
    expect(getMissingContent(product)).toEqual(["Main Feature", "Thông số kỹ thuật", "Datasheet"]);
  });

  it("only checks the selected fields", () => {
    expect(getMissingContent(product, ["Title", "MainFeature", "Series"])).toEqual(["Series", "Main Feature"]);
  });

  it("accepts the CMS document column as the datasheet", () => {
    expect(getMissingContent({ ...product, document: "wix:document://v1/abc/x.pdf" }, ["Datasheet"])).toEqual([]);
  });

  it("agrees with missingFromFilled", () => {
    const keys = ["Category", "MainFeature", "Datasheet"];
    expect(missingFromFilled(getFilledFieldKeys(product), keys)).toEqual(getMissingContent(product, keys));
  });
});
