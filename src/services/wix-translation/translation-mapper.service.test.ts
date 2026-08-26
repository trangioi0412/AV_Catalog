import { describe, it, expect } from "vitest";
import { computeSourceHash, sanitizeFieldKeys, sanitizeHtmlForPreview, stableStringify } from "./translation-mapper.service";

describe("stableStringify / computeSourceHash", () => {
  it("produces the same hash regardless of key order", () => {
    const a = computeSourceHash({ title: "Neat Bar", overview: "Mo ta" });
    const b = computeSourceHash({ overview: "Mo ta", title: "Neat Bar" });
    expect(a).toBe(b);
  });

  it("produces a different hash when a value changes", () => {
    const a = computeSourceHash({ title: "Neat Bar" });
    const b = computeSourceHash({ title: "Neat Bar 2" });
    expect(a).not.toBe(b);
  });

  it("stableStringify sorts keys", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});

describe("sanitizeFieldKeys", () => {
  it("keeps only keys present in the allowlist, dropping everything else", () => {
    expect(sanitizeFieldKeys(["title", "product", "_id"], ["title", "productOverview"])).toEqual(["title"]);
  });

  it("returns an empty array when nothing requested is allowed", () => {
    expect(sanitizeFieldKeys(["product", "_id"], ["title"])).toEqual([]);
  });
});

describe("sanitizeHtmlForPreview", () => {
  it("removes <script> blocks", () => {
    const out = sanitizeHtmlForPreview('<p>Hello</p><script>alert(1)</script>');
    expect(out).not.toContain("<script>");
    expect(out).toContain("<p>Hello</p>");
  });

  it("removes inline event handler attributes", () => {
    const out = sanitizeHtmlForPreview('<div onclick="alert(1)">Hi</div>');
    expect(out).not.toContain("onclick");
  });

  it("neutralizes javascript: URLs while preserving normal links", () => {
    const out = sanitizeHtmlForPreview('<a href="javascript:alert(1)">bad</a><a href="https://example.com">good</a>');
    expect(out).not.toContain("javascript:");
    expect(out).toContain("https://example.com");
  });
});
