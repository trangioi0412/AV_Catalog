import { describe, it, expect } from "vitest";
import { stripCodeFence, parseTranslationResponse, TranslationProviderError } from "./translationProvider";

describe("stripCodeFence", () => {
  it("removes a ```json ... ``` markdown fence around the JSON payload", () => {
    const raw = '```json\n{"title": "Hello"}\n```';
    expect(stripCodeFence(raw)).toBe('{"title": "Hello"}');
  });

  it("removes a plain ``` fence without a language tag", () => {
    const raw = '```\n{"title": "Hello"}\n```';
    expect(stripCodeFence(raw)).toBe('{"title": "Hello"}');
  });

  it("returns the text unchanged when there is no fence", () => {
    const raw = '{"title": "Hello"}';
    expect(stripCodeFence(raw)).toBe(raw);
  });
});

describe("parseTranslationResponse", () => {
  it("parses a well-formed JSON object matching the requested keys", () => {
    const result = parseTranslationResponse('{"title": "Neat Bar", "series": "BYOD"}', ["title", "series"]);
    expect(result.fields).toEqual({ title: "Neat Bar", series: "BYOD" });
    expect(result.warnings).toEqual([]);
  });

  it("unwraps a JSON object inside a markdown code fence", () => {
    const result = parseTranslationResponse('```json\n{"title": "Neat Bar"}\n```', ["title"]);
    expect(result.fields.title).toBe("Neat Bar");
  });

  it("throws INVALID_RESPONSE for malformed JSON", () => {
    expect(() => parseTranslationResponse("not json at all", ["title"])).toThrow(TranslationProviderError);
    try {
      parseTranslationResponse("not json at all", ["title"]);
    } catch (err) {
      expect((err as TranslationProviderError).code).toBe("INVALID_RESPONSE");
    }
  });

  it("throws INVALID_RESPONSE when the JSON is an array instead of an object", () => {
    expect(() => parseTranslationResponse("[1,2,3]", ["title"])).toThrow(TranslationProviderError);
  });

  it("fills missing fields with an empty string and records a warning", () => {
    const result = parseTranslationResponse('{"title": "Neat Bar"}', ["title", "series"]);
    expect(result.fields).toEqual({ title: "Neat Bar", series: "" });
    expect(result.warnings.some((w) => w.includes("series"))).toBe(true);
  });

  it("drops unexpected extra fields and records a warning instead of including them", () => {
    const result = parseTranslationResponse('{"title": "Neat Bar", "hallucinated": "oops"}', ["title"]);
    expect(result.fields).toEqual({ title: "Neat Bar" });
    expect(result.warnings.some((w) => w.includes("hallucinated"))).toBe(true);
  });

  it("preserves empty string source values as empty string translations", () => {
    const result = parseTranslationResponse('{"title": ""}', ["title"]);
    expect(result.fields.title).toBe("");
  });

  it("coerces a non-string field value to a string and records a warning", () => {
    const result = parseTranslationResponse('{"title": 123}', ["title"]);
    expect(result.fields.title).toBe("123");
    expect(result.warnings.some((w) => w.includes("title"))).toBe(true);
  });
});
