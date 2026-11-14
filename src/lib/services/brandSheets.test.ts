import { beforeEach, describe, expect, it, vi } from "vitest";

const sheetsApi = {
  get: vi.fn(),
  batchUpdate: vi.fn(),
  values: { get: vi.fn(), batchGet: vi.fn(), update: vi.fn() },
};

vi.mock("./googleSheets", () => ({ getSheets: () => ({ spreadsheets: sheetsApi }) }));

import {
  BrandSheetError,
  columnLetter,
  deleteBrandRows,
  listBrandTabs,
  looksLikeBrandId,
  naturalKey,
  parseRowTargets,
  readBrandRows,
  updateBrandRow,
} from "./brandSheets";

const HEADER = ["Category", "Product", "Title", "product (item)", "image", "Brand"];
const TAB_VALUES = [
  HEADER,
  ["Cameras", "", "RC08 Soundbar", "RC08", "https://x/a.jpg", "Rocware"],
  ["", "", "", "", "", ""],
  ["Speakers", "", "A10 Speakerphone", "A10", "", "Rocware"],
];

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GOOGLE_SPREADSHEET_ID = "sheet-id";
  sheetsApi.get.mockResolvedValue({
    data: {
      sheets: [
        { properties: { title: "rocware", sheetId: 11 } },
        { properties: { title: "DataCrawler_Sync_logs", sheetId: 12 } },
        { properties: { title: "Logs", sheetId: 13 } },
      ],
    },
  });
  sheetsApi.values.get.mockResolvedValue({ data: { values: TAB_VALUES } });
  sheetsApi.values.update.mockResolvedValue({});
  sheetsApi.batchUpdate.mockResolvedValue({});
});

describe("helpers", () => {
  it("naturalKey matches the crawler (model first, then title)", () => {
    expect(naturalKey({ "product (item)": " RC08 ", Title: "x" })).toBe("item:rc08");
    expect(naturalKey({ "product (item)": "", Title: "Mini Bar" })).toBe("title:mini bar");
  });

  it("columnLetter", () => {
    expect([0, 10, 25, 26].map(columnLetter)).toEqual(["A", "K", "Z", "AA"]);
  });

  it("looksLikeBrandId spots Wix brand references, not names", () => {
    expect(looksLikeBrandId("aaebfcdf-5376-41dc-9ec1-0749c4c00c2d")).toBe(true);
    expect(looksLikeBrandId("lg-260526-ebbace-016")).toBe(true);
    expect(looksLikeBrandId("dten-2026v2-fad8aa-014")).toBe(true);
    expect(looksLikeBrandId("Hyn@net")).toBe(false);
    expect(looksLikeBrandId("hyn-net")).toBe(false);
    expect(looksLikeBrandId("Netgear")).toBe(false);
  });

  it("parseRowTargets ignores non-arrays", () => {
    expect(parseRowTargets(null)).toEqual([]);
    expect(parseRowTargets([{ rowNumber: "4", key: "item:a10" }])).toEqual([{ rowNumber: 4, key: "item:a10" }]);
  });
});

describe("listBrandTabs", () => {
  it("keeps only crawler product tabs and attaches the last sync time", async () => {
    sheetsApi.values.batchGet.mockResolvedValue({
      data: {
        valueRanges: [
          { values: TAB_VALUES },
          { values: [["Time", "Level"]] },
          {
            values: [
              ["Job ID", "Hãng", "Trạng thái", "Hoàn tất lúc"],
              ["1", "rocware", "completed", "2026-11-01T00:00:00+00:00"],
              ["2", "rocware", "completed_with_warnings", "2026-11-06T00:00:00+00:00"],
            ],
          },
        ],
      },
    });

    const brands = await listBrandTabs();

    expect(brands).toEqual([
      {
        tab: "rocware",
        productCount: 2,
        brandName: "Rocware",
        lastSyncedAt: "2026-11-06T00:00:00+00:00",
        lastSyncStatus: "completed_with_warnings",
      },
    ]);
  });
});

describe("readBrandRows", () => {
  it("skips blank rows and keeps real sheet row numbers", async () => {
    const { rows } = await readBrandRows("rocware");
    expect(rows.map((r) => [r.rowNumber, r.key])).toEqual([
      [2, "item:rc08"],
      [4, "item:a10"],
    ]);
  });

  it("refuses DataCrawler_ admin tabs", async () => {
    await expect(readBrandRows("DataCrawler_Sync_logs")).rejects.toMatchObject({ status: 404 });
  });
});

describe("updateBrandRow", () => {
  it("writes the full row, keeping columns not edited", async () => {
    const row = await updateBrandRow("rocware", 4, "item:a10", { Category: "Audio", Unknown: "ignored" });

    expect(row.values.Category).toBe("Audio");
    expect(sheetsApi.values.update).toHaveBeenCalledWith(
      expect.objectContaining({
        range: "'rocware'!A4:F4",
        requestBody: { values: [["Audio", "", "A10 Speakerphone", "A10", "", "Rocware"]] },
      })
    );
  });

  it("rejects with 409 when the row now holds another product", async () => {
    const err = await updateBrandRow("rocware", 2, "item:a10", { Category: "x" }).catch((e) => e);
    expect(err).toBeInstanceOf(BrandSheetError);
    expect(err.status).toBe(409);
    expect(sheetsApi.values.update).not.toHaveBeenCalled();
  });
});

describe("deleteBrandRows", () => {
  it("deletes bottom-up in one batch", async () => {
    const n = await deleteBrandRows("rocware", [
      { rowNumber: 2, key: "item:rc08" },
      { rowNumber: 4, key: "item:a10" },
    ]);

    expect(n).toBe(2);
    const requests = sheetsApi.batchUpdate.mock.calls[0][0].requestBody.requests;
    expect(
      requests.map((r: { deleteDimension: { range: { startIndex: number } } }) => r.deleteDimension.range.startIndex)
    ).toEqual([3, 1]);
    expect(requests[0].deleteDimension.range.sheetId).toBe(11);
  });

  it("deletes nothing if any target row changed", async () => {
    await expect(
      deleteBrandRows("rocware", [
        { rowNumber: 2, key: "item:rc08" },
        { rowNumber: 4, key: "item:other" },
      ])
    ).rejects.toMatchObject({ status: 409 });
    expect(sheetsApi.batchUpdate).not.toHaveBeenCalled();
  });
});
