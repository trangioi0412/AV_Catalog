import { describe, expect, it } from "vitest";
import type { BrandSheetRow } from "./brandSheets";
import { buildAvPrompt, parseAvResponse } from "./avRelevanceCheck";

const row = (rowNumber: number, title: string, extra: Record<string, string> = {}): BrandSheetRow => ({
  rowNumber,
  key: `k${rowNumber}`,
  values: { Title: title, ...extra },
});

describe("parseAvResponse", () => {
  const rows = [row(2, "PTZ Camera X1"), row(3, "Logo T-Shirt"), row(5, "Mystery item")];

  it("maps ids back to rows by position", () => {
    const raw = JSON.stringify([
      { id: 1, verdict: "av", reason: "Camera PTZ" },
      { id: 2, verdict: "not_av", reason: "Quần áo" },
      { id: 3, verdict: "unsure", reason: "Thiếu thông tin" },
    ]);
    expect(parseAvResponse(raw, rows)).toEqual([
      { rowNumber: 2, key: "k2", verdict: "av", reason: "Camera PTZ", checked: true },
      { rowNumber: 3, key: "k3", verdict: "not_av", reason: "Quần áo", checked: true },
      { rowNumber: 5, key: "k5", verdict: "unsure", reason: "Thiếu thông tin", checked: true },
    ]);
  });

  it("treats missing or invalid entries as unsure, never as not_av", () => {
    const raw =
      "```json\n" +
      JSON.stringify({ items: [{ id: 2, verdict: "not_av", reason: "x" }, { id: 1, verdict: "maybe" }] }) +
      "\n```";
    const out = parseAvResponse(raw, rows);
    expect(out.map((r) => r.verdict)).toEqual(["unsure", "not_av", "unsure"]);
    expect(out.map((r) => r.checked)).toEqual([false, true, false]);
  });

  it("throws on non-JSON", () => {
    expect(() => parseAvResponse("not json", rows)).toThrow();
  });
});

describe("buildAvPrompt", () => {
  it("strips HTML and lists every row", () => {
    const prompt = buildAvPrompt("Acme", [row(2, "Amp", { "Main Feature": "<p>500W <b>class D</b></p>" }), row(3, "Mic")]);
    expect(prompt).toContain("1. Title: Amp");
    expect(prompt).toContain("Main Feature: 500W class D");
    expect(prompt).toContain("2. Title: Mic");
    expect(prompt).toContain("id 1..2");
  });
});
