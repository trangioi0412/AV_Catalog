import { describe, it, expect } from "vitest";
import {
  technicalSpecsToText,
  textToTechnicalSpecs,
  TechnicalSpecification
} from "./specsTranslator";

describe("AV Catalog Specs Translation Pipeline Tests", () => {
  
  describe("technicalSpecsToText (Array -> Text)", () => {
    it("1. Normal conversion", () => {
      const input: TechnicalSpecification[] = [
        { label: "Memory", value: "1 GB" },
        { label: "Flash", value: "8 GB" }
      ];
      const expected = "Memory: 1 GB\nFlash: 8 GB";
      expect(technicalSpecsToText(input)).toBe(expected);
    });

    it("2. Empty array", () => {
      expect(technicalSpecsToText([])).toBe("");
    });

    it("3. Null/Undefined inputs", () => {
      expect(technicalSpecsToText(null as any)).toBe("");
      expect(technicalSpecsToText(undefined as any)).toBe("");
    });

    it("4. Extra spaces are trimmed", () => {
      const input: TechnicalSpecification[] = [
        { label: "   Memory   ", value: "  1 GB  " },
        { label: "\tFlash\t", value: "8 GB\n" }
      ];
      const expected = "Memory: 1 GB\nFlash: 8 GB";
      expect(technicalSpecsToText(input)).toBe(expected);
    });

    it("5. Values containing colons", () => {
      const input: TechnicalSpecification[] = [
        { label: "Protocol", value: "TCP:8080" },
        { label: "Endpoint", value: "http://localhost:3000/api" }
      ];
      const expected = "Protocol: TCP:8080\nEndpoint: http://localhost:3000/api";
      expect(technicalSpecsToText(input)).toBe(expected);
    });

    it("6. Ignore empty items (empty label or empty value)", () => {
      const input: TechnicalSpecification[] = [
        { label: "Memory", value: "1 GB" },
        { label: "", value: "8 GB" },
        { label: "Flash", value: "   " },
        { label: "  ", value: "   " },
        { label: null as any, value: "10" }
      ];
      const expected = "Memory: 1 GB";
      expect(technicalSpecsToText(input)).toBe(expected);
    });

    it("7. Unicode and special characters", () => {
      const input: TechnicalSpecification[] = [
        { label: "Temp Range", value: "-10°C to +55°C" },
        { label: "Frequency", value: "50-60 Hz ~ 10%" }
      ];
      const expected = "Temp Range: -10°C to +55°C\nFrequency: 50-60 Hz ~ 10%";
      expect(technicalSpecsToText(input)).toBe(expected);
    });

    it("8. Vietnamese translations", () => {
      const input: TechnicalSpecification[] = [
        { label: "Bộ nhớ trong", value: "16 GB eMMC" },
        { label: "Nguồn điện", value: "12V DC, 2A" }
      ];
      const expected = "Bộ nhớ trong: 16 GB eMMC\nNguồn điện: 12V DC, 2A";
      expect(technicalSpecsToText(input)).toBe(expected);
    });
  });

  describe("textToTechnicalSpecs (Text -> Array)", () => {
    it("1. Normal conversion", () => {
      const input = "Memory: 1 GB\nFlash: 8 GB";
      const expected: TechnicalSpecification[] = [
        { label: "Memory", value: "1 GB" },
        { label: "Flash", value: "8 GB" }
      ];
      expect(textToTechnicalSpecs(input)).toEqual(expected);
    });

    it("2. Empty text", () => {
      expect(textToTechnicalSpecs("")).toEqual([]);
      expect(textToTechnicalSpecs("   ")).toEqual([]);
    });

    it("3. Null/Undefined inputs", () => {
      expect(textToTechnicalSpecs(null as any)).toEqual([]);
      expect(textToTechnicalSpecs(undefined as any)).toEqual([]);
    });

    it("4. Extra spaces and empty lines are handled correctly", () => {
      const input = "\n  Memory  :   1 GB   \n\n\tFlash\t: 8 GB \n";
      const expected: TechnicalSpecification[] = [
        { label: "Memory", value: "1 GB" },
        { label: "Flash", value: "8 GB" }
      ];
      expect(textToTechnicalSpecs(input)).toEqual(expected);
    });

    it("5. Values containing additional colons", () => {
      const input = "Protocol: TCP:8080\nEndpoint: http://localhost:3000/api";
      const expected: TechnicalSpecification[] = [
        { label: "Protocol", value: "TCP:8080" },
        { label: "Endpoint", value: "http://localhost:3000/api" }
      ];
      expect(textToTechnicalSpecs(input)).toEqual(expected);
    });

    it("6. Invalid rows (no colon or empty parts) are ignored", () => {
      const input = "Memory: 1 GB\nInvalidLineWithoutColon\n: EmptyLabel\nEmptyValue:\n  \nFlash: 8 GB";
      const expected: TechnicalSpecification[] = [
        { label: "Memory", value: "1 GB" },
        { label: "Flash", value: "8 GB" }
      ];
      expect(textToTechnicalSpecs(input)).toEqual(expected);
    });

    it("7. Unicode and special characters", () => {
      const input = "Temp Range: -10°C to +55°C\nFrequency: 50-60 Hz ~ 10%";
      const expected: TechnicalSpecification[] = [
        { label: "Temp Range", value: "-10°C to +55°C" },
        { label: "Frequency", value: "50-60 Hz ~ 10%" }
      ];
      expect(textToTechnicalSpecs(input)).toEqual(expected);
    });

    it("8. Vietnamese translations", () => {
      const input = "Bộ nhớ trong: 16 GB eMMC\nNguồn điện: 12V DC, 2A";
      const expected: TechnicalSpecification[] = [
        { label: "Bộ nhớ trong", value: "16 GB eMMC" },
        { label: "Nguồn điện", value: "12V DC, 2A" }
      ];
      expect(textToTechnicalSpecs(input)).toEqual(expected);
    });
  });
});
