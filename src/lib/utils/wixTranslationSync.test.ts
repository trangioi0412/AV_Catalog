import { describe, it, expect } from "vitest";
import { processTranslationSync } from "../services/wix-translation-sync/translationProcessor";
import { LOCALE_CONFIGS } from "../../config/wix-translation-sync/localeMappings";
import { WixExportRow, CMSRow } from "../../types/wix-translation-sync";

describe("Wix Translation Sync Pipeline Tests", () => {
  const localeConfigEN = LOCALE_CONFIGS.EN;

  // 1. JSON Parsing & Field Mapping Tests
  describe("Wix ID JSON Parsing & Matching", () => {
    it("successfully maps a valid wix row with matching CMS data", () => {
      const wixRows: WixExportRow[] = [
        {
          "ID (do not edit)": JSON.stringify({
            contentId: "prod-1",
            fieldId: "productOverview",
            sequencePath: [],
          }),
          "Content type": "Products",
          "Element type": "RichText",
          "Source language (VI)": "Mô tả sản phẩm",
          "Target language (EN)": "",
        },
      ];

      const cmsRows: CMSRow[] = [
        {
          ID: "prod-1",
          productOverview_EN: "<p>English description</p>",
        },
      ];

      const result = processTranslationSync({
        wixRows,
        cmsRows,
        localeConfig: localeConfigEN,
      });

      expect(result.summary.totalRows).toBe(1);
      expect(result.summary.matchedRows).toBe(1);
      expect(result.summary.updatedRows).toBe(1);
      expect(result.summary.errorsCount).toBe(0);
      expect(result.validationErrors.length).toBe(0);
      expect(result.completedWixRows[0]["Target language (EN)"]).toBe("<p>English description</p>");
    });

    it("handles invalid json in Wix ID column gracefully without throwing", () => {
      const wixRows: WixExportRow[] = [
        {
          "ID (do not edit)": "invalid-json-string",
          "Content type": "Products",
          "Element type": "RichText",
          "Source language (VI)": "Mô tả",
          "Target language (EN)": "Original EN",
        },
      ];

      const cmsRows: CMSRow[] = [{ ID: "prod-1" }];

      const result = processTranslationSync({
        wixRows,
        cmsRows,
        localeConfig: localeConfigEN,
      });

      expect(result.summary.totalRows).toBe(1);
      expect(result.summary.matchedRows).toBe(0);
      expect(result.summary.errorsCount).toBe(1);
      expect(result.validationErrors[0].type).toBe("INVALID_JSON");
      expect(result.completedWixRows[0]["Target language (EN)"]).toBe("Original EN"); // remains unchanged
    });

    it("logs error for missing contentId or fieldId in Wix JSON", () => {
      const wixRows: WixExportRow[] = [
        {
          "ID (do not edit)": JSON.stringify({
            fieldId: "productOverview",
          }),
          "Content type": "Products",
          "Element type": "RichText",
          "Source language (VI)": "Mô tả",
          "Target language (EN)": "",
        },
      ];

      const cmsRows: CMSRow[] = [{ ID: "prod-1", productOverview_EN: "Val" }];

      const result = processTranslationSync({
        wixRows,
        cmsRows,
        localeConfig: localeConfigEN,
      });

      expect(result.summary.errorsCount).toBe(1);
      expect(result.validationErrors[0].type).toBe("MISSING_CONTENT_ID");
    });
  });

  // 2. CMS Record Matching Tests
  describe("CMS matching", () => {
    it("records a warning if a Wix contentId is missing in the CMS export", () => {
      const wixRows: WixExportRow[] = [
        {
          "ID (do not edit)": JSON.stringify({
            contentId: "missing-prod-id",
            fieldId: "productOverview",
          }),
          "Content type": "Products",
          "Element type": "RichText",
          "Source language (VI)": "Mô tả",
          "Target language (EN)": "Original EN",
        },
      ];

      const cmsRows: CMSRow[] = [{ ID: "prod-1", productOverview_EN: "Val" }];

      const result = processTranslationSync({
        wixRows,
        cmsRows,
        localeConfig: localeConfigEN,
      });

      expect(result.summary.matchedRows).toBe(0);
      expect(result.summary.missingCmsRecords).toBe(1);
      expect(result.validationErrors[0].type).toBe("MISSING_CMS_RECORD");
      expect(result.completedWixRows[0]["Target language (EN)"]).toBe("Original EN");
    });

    it("warns about empty values in the mapped CMS column", () => {
      const wixRows: WixExportRow[] = [
        {
          "ID (do not edit)": JSON.stringify({
            contentId: "prod-1",
            fieldId: "productOverview",
          }),
          "Content type": "Products",
          "Element type": "RichText",
          "Source language (VI)": "Mô tả",
          "Target language (EN)": "",
        },
      ];

      const cmsRows: CMSRow[] = [{ ID: "prod-1", productOverview_EN: "   " }]; // empty spaces

      const result = processTranslationSync({
        wixRows,
        cmsRows,
        localeConfig: localeConfigEN,
      });

      expect(result.summary.matchedRows).toBe(1);
      expect(result.validationErrors[0].type).toBe("EMPTY_CMS_VALUE");
      expect(result.completedWixRows[0]["Target language (EN)"]).toBe("   ");
    });
  });

  // 3. Unsupported Fields Tests
  describe("Unsupported Wix fields validation", () => {
    it("adds warnings and skips processing for unsupported fields (series, brand, etc.)", () => {
      const wixRows: WixExportRow[] = [
        {
          "ID (do not edit)": JSON.stringify({
            contentId: "prod-1",
            fieldId: "series", // unsupported
          }),
          "Content type": "Products",
          "Element type": "PlainText",
          "Source language (VI)": "Series A",
          "Target language (EN)": "Original Series A EN",
        },
      ];

      const cmsRows: CMSRow[] = [{ ID: "prod-1", series_EN: "CMS Series A EN" }];

      const result = processTranslationSync({
        wixRows,
        cmsRows,
        localeConfig: localeConfigEN,
      });

      expect(result.summary.matchedRows).toBe(0);
      expect(result.summary.unsupportedFields).toBe(1);
      expect(result.validationErrors[0].type).toBe("UNSUPPORTED_FIELD");
      expect(result.completedWixRows[0]["Target language (EN)"]).toBe("Original Series A EN"); // untouched
    });
  });

  // 4. Duplicate Record Warnings Tests
  describe("Duplicate items validation", () => {
    it("warns about duplicate CMS ID records", () => {
      const wixRows: WixExportRow[] = [
        {
          "ID (do not edit)": JSON.stringify({
            contentId: "prod-1",
            fieldId: "title",
          }),
          "Content type": "Products",
          "Element type": "PlainText",
          "Source language (VI)": "Tiêu đề",
          "Target language (EN)": "",
        },
      ];

      const cmsRows: CMSRow[] = [
        { ID: "prod-1", Title_EN: "Title 1" },
        { ID: "prod-1", Title_EN: "Title 2" }, // duplicate CMS ID
      ];

      const result = processTranslationSync({
        wixRows,
        cmsRows,
        localeConfig: localeConfigEN,
      });

      expect(result.validationErrors.some((err) => err.type === "DUPLICATE_CMS_ID")).toBe(true);
    });

    it("warns about duplicate contentId and fieldId combinations in Wix export", () => {
      const wixRows: WixExportRow[] = [
        {
          "ID (do not edit)": JSON.stringify({
            contentId: "prod-1",
            fieldId: "title",
          }),
          "Content type": "Products",
          "Element type": "PlainText",
          "Source language (VI)": "Tiêu đề 1",
          "Target language (EN)": "",
        },
        {
          "ID (do not edit)": JSON.stringify({
            contentId: "prod-1",
            fieldId: "title", // duplicate combination
          }),
          "Content type": "Products",
          "Element type": "PlainText",
          "Source language (VI)": "Tiêu đề 2",
          "Target language (EN)": "",
        },
      ];

      const cmsRows: CMSRow[] = [{ ID: "prod-1", Title_EN: "CMS Title" }];

      const result = processTranslationSync({
        wixRows,
        cmsRows,
        localeConfig: localeConfigEN,
      });

      expect(result.validationErrors.some((err) => err.type === "DUPLICATE_WIX_RECORD")).toBe(true);
    });
  });

  // 5. Preserving formatting, order, HTML, and Multiline content
  describe("Formatting and order preservation", () => {
    it("preserves HTML structure, spacing, multiline content and order", () => {
      const wixRows: WixExportRow[] = [
        {
          "ID (do not edit)": JSON.stringify({
            contentId: "prod-1",
            fieldId: "productOverview",
          }),
          "Content type": "Products",
          "Element type": "RichText",
          "Source language (VI)": "VI 1",
          "Target language (EN)": "",
        },
        {
          "ID (do not edit)": JSON.stringify({
            contentId: "prod-2",
            fieldId: "productOverview",
          }),
          "Content type": "Products",
          "Element type": "RichText",
          "Source language (VI)": "VI 2",
          "Target language (EN)": "",
        },
      ];

      const cmsRows: CMSRow[] = [
        {
          ID: "prod-1",
          productOverview_EN: "Line 1\nLine 2\nLine 3",
        },
        {
          ID: "prod-2",
          productOverview_EN: "<div>\n  <h1>Title</h1>\n  <p>HTML paragraph</p>\n</div>",
        },
      ];

      const result = processTranslationSync({
        wixRows,
        cmsRows,
        localeConfig: localeConfigEN,
      });

      expect(result.completedWixRows.length).toBe(2);
      expect(result.completedWixRows[0]["Target language (EN)"]).toBe("Line 1\nLine 2\nLine 3");
      expect(result.completedWixRows[1]["Target language (EN)"]).toBe("<div>\n  <h1>Title</h1>\n  <p>HTML paragraph</p>\n</div>");
    });
  });
});
