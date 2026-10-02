import { describe, it, expect } from "vitest";
import { normalizeName } from "./wixCms";

describe("normalizeName", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeName("  Neat Board Pro  ")).toBe("neat board pro");
  });

  it("treats hyphens and underscores as word separators", () => {
    expect(normalizeName("NEAT-BOARD-PRO")).toBe("neat board pro");
    expect(normalizeName("Neat_Board_Pro")).toBe("neat board pro");
  });

  it("inserts a space at letter→digit and digit→letter boundaries", () => {
    expect(normalizeName("Shure MXA920")).toBe("shure mxa 920");
  });

  it("drops inch marks and other characters a filename can't contain", () => {
    const fileName = "11.6 paperless flush mount multimedia conference unit";
    expect(normalizeName('11.6" Paperless Flush-mount Multimedia Conference Unit')).toBe(normalizeName(fileName));
    expect(normalizeName("11.6” Paperless Flush-mount Multimedia Conference Unit")).toBe(normalizeName(fileName));
    expect(normalizeName("11.6″ Paperless Flush-mount Multimedia Conference Unit")).toBe(normalizeName(fileName));
  });

  it("splits genuine CamelCase word boundaries", () => {
    expect(normalizeName("Logitech RallyBarMini")).toBe("logitech rally bar mini");
  });

  it("keeps parentheses as literal characters", () => {
    expect(normalizeName("Neat Bar (Gen 2)")).toBe("neat bar (gen 2)");
  });

  // Regression: a real CMS product ("4x1 4K60 HDMI™ Switcher (ARC/eARC)")
  // and a plainly-typed image filename for the same product ("...(ARC eARC)")
  // used to normalize to two different keys and silently never match --
  // see the normalizeName() docstring in wixCms.ts for the full story.
  describe("ARC/eARC regression (2026-09-24)", () => {
    it("does not split 'eARC' mid-acronym", () => {
      expect(normalizeName("HDMI™ eARC Audio Extractor")).toBe("hdmi™ earc audio extractor");
    });

    it("treats a slash as a word separator instead of fusing the words", () => {
      expect(normalizeName("4x1 4K60 HDMI™ Switcher (ARC/eARC)")).toBe(
        "4 x 1 4 k 60 hdmi™ switcher (arc earc)"
      );
    });

    it("produces the same key for the CMS name and a naturally-typed filename variant", () => {
      const cmsName = "4x1 4K60 HDMI™ Switcher (ARC/eARC)";
      const typedFilename = "4x1 4K60 HDMI™ Switcher (ARC eARC)";
      expect(normalizeName(cmsName)).toBe(normalizeName(typedFilename));
    });

    it("does not mangle a multi-slash spec list into one fused word", () => {
      // Real catalog example: used to normalize to "...(hdbase t 3.0 usbdante)",
      // silently merging "USB" and "Dante" into "usbdante".
      expect(normalizeName("4x2 4K60 Presentation Switcher (HDBaseT 3.0/USB/Dante)")).toBe(
        "4 x 2 4 k 60 presentation switcher (hdbaset 3.0 usb dante)"
      );
    });
  });

  it("keeps an acronym-like trailing capital intact (e.g. the standard name HDBaseT)", () => {
    expect(normalizeName("HDBaseT Extender (70m)")).toBe("hdbaset extender (70 m)");
  });

  it("strips Vietnamese diacritics and đ/Đ", () => {
    expect(normalizeName("Đầu thu Wifi")).toBe("dau thu wifi");
  });
});
