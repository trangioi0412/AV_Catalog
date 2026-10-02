import { describe, it, expect } from "vitest";
import { buildScanPreview } from "./imageSyncService";
import { normalizeName, type ProductImageItem } from "./wixCms";

// Same shape getAllProductsForImageSync() returns: normalizeName(productName) → item
function productMapOf(...names: string[]): Map<string, ProductImageItem> {
  return new Map(names.map((productName, i) => [normalizeName(productName), { _id: `id-${i}`, productName }]));
}

describe("buildScanPreview matching", () => {
  it("matches a lowercase filename to a CamelCase CMS name ('WiFi' vs 'wifi')", () => {
    const preview = buildScanPreview(
      ["5 g wifi wireless access point.jpg", "5 g wifi wireless access point-2.jpg"],
      productMapOf("5G WiFi Wireless access point")
    );
    expect(preview.unmatched).toEqual([]);
    expect(preview.matched).toHaveLength(1);
    expect(preview.matched[0]).toMatchObject({
      cmsId: "id-0",
      mainFileName: "5 g wifi wireless access point.jpg",
      galleryFileNames: ["5 g wifi wireless access point-2.jpg"],
    });
  });

  it("matches a CMS name with an inch mark to a filename without it", () => {
    const preview = buildScanPreview(
      ["11.6 paperless flush mount multimedia conference unit.png"],
      productMapOf('11.6" Paperless Flush-mount Multimedia Conference Unit')
    );
    expect(preview.matched.map((m) => m.cmsId)).toEqual(["id-0"]);
  });

  it("puts differently-spaced files of the same product into one group", () => {
    const preview = buildScanPreview(
      ["Logitech RallyBarMini.jpg", "logitech rally bar mini-2.jpg"],
      productMapOf("Logitech Rally Bar Mini")
    );
    expect(preview.matched).toHaveLength(1);
    expect(preview.matched[0].galleryFileNames).toEqual(["logitech rally bar mini-2.jpg"]);
  });
});
