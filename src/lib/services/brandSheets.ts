/**
 * Per-brand product tabs written by the DataCrawler (av-crawler-api) into the
 * shared Google Spreadsheet: one tab per manufacturer key (e.g. "rocware"),
 * header row = BRAND_SHEET_HEADERS (see av-crawler-api/services/google_sheets.py).
 *
 * Used by the "Dữ liệu hãng" tab of /admin/catalog-upload to review, fix and
 * delete crawled products before they are pushed to Wix.
 *
 * Unlike `googleSheets.ts` helpers, every function here THROWS on failure:
 * a silently-swallowed write would tell the admin a fix was saved when it
 * was not.
 *
 * Rows are addressed by sheet row number (1-based, row 1 = header), but the
 * crawler can insert/delete rows at any time (sync, approve). Every write
 * therefore re-reads the target row and checks its natural key (the same
 * key the crawler upserts by) before touching it.
 */
import { getSheets } from "./googleSheets";

export const BRAND_SHEET_HEADERS = [
  "Category",
  "Product",
  "Title",
  "product (item)",
  "Series",
  "Main Feature",
  "Product Overview",
  "Technical Specifications",
  "image",
  "Brand",
  "Datasheet",
] as const;

const SYNC_LOGS_TAB = "DataCrawler_Sync_logs";

export interface BrandSheetRow {
  /** 1-based sheet row number (row 1 is the header). */
  rowNumber: number;
  /** Natural key the crawler upserts by; sent back on edit/delete. */
  key: string;
  values: Record<string, string>;
}

export interface BrandTabSummary {
  tab: string;
  productCount: number;
  brandName: string;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
}

export class BrandSheetError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function spreadsheetId(): string {
  const id = process.env.GOOGLE_SPREADSHEET_ID;
  if (!id) throw new BrandSheetError(500, "Missing GOOGLE_SPREADSHEET_ID environment variable");
  return id;
}

function sheetsClient() {
  const sheets = getSheets();
  if (!sheets) throw new BrandSheetError(500, "GOOGLE_SERVICE_ACCOUNT_JSON is not configured");
  return sheets;
}

/** A1-notation tab reference; quotes are doubled per Sheets rules. */
function tabRef(tab: string): string {
  return `'${tab.replace(/'/g, "''")}'`;
}

/** Same rule as av-crawler-api `_natural_key`. */
export function naturalKey(values: Record<string, string>): string {
  const item = (values["product (item)"] || "").trim().toLowerCase();
  if (item) return `item:${item}`;
  return `title:${(values["Title"] || "").trim().toLowerCase()}`;
}

function toRecord(header: string[], row: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  header.forEach((h, i) => {
    out[h] = row[i] ?? "";
  });
  return out;
}

export function columnLetter(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Older (pre-crawler) tabs store the Wix brand reference in "Brand"
 * ("aaebfcdf-5376-...", "lg-260526-ebbace-016") instead of a display name.
 */
export function looksLikeBrandId(value: string): boolean {
  const v = value.trim();
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12,}$/i.test(v) ||
    /^[a-z0-9_]+(?:-[a-z0-9]+)*-[0-9a-f]{6}-\d{3}$/i.test(v)
  );
}

function isBrandHeader(header: string[]): boolean {
  return header.includes("product (item)") && header.includes("Title");
}

async function getTabMeta(): Promise<{ title: string; sheetId: number }[]> {
  const res = await sheetsClient().spreadsheets.get({
    spreadsheetId: spreadsheetId(),
    fields: "sheets.properties(title,sheetId)",
  });
  type SheetMeta = { properties?: { title?: string; sheetId?: number } };
  return ((res.data.sheets || []) as SheetMeta[]).map((s) => ({
    title: s.properties?.title ?? "",
    sheetId: s.properties?.sheetId ?? 0,
  }));
}

/** Tab titles in spreadsheet order (left to right). */
export async function listSheetTabTitles(): Promise<string[]> {
  return (await getTabMeta()).map((m) => m.title);
}

async function readTab(tab: string): Promise<string[][]> {
  const res = await sheetsClient().spreadsheets.values.get({
    spreadsheetId: spreadsheetId(),
    range: `${tabRef(tab)}!A:Z`,
  });
  return (res.data.values as string[][]) || [];
}

/** Brand tabs = tabs whose header row looks like the crawler's product header. */
export async function listBrandTabs(): Promise<BrandTabSummary[]> {
  const meta = await getTabMeta();
  const titles = new Set(meta.map((m) => m.title));
  const candidates = meta.map((m) => m.title).filter((t) => !t.startsWith("DataCrawler_"));
  if (candidates.length === 0) return [];

  // One call for every tab instead of one per tab: the read quota is
  // ~60 requests/minute.
  const ranges = candidates.map((t) => `${tabRef(t)}!A:K`);
  if (titles.has(SYNC_LOGS_TAB)) ranges.push(`${tabRef(SYNC_LOGS_TAB)}!A:N`);
  const batch = await sheetsClient().spreadsheets.values.batchGet({ spreadsheetId: spreadsheetId(), ranges });
  const valueRanges = batch.data.valueRanges || [];
  const logs = titles.has(SYNC_LOGS_TAB) ? (valueRanges[candidates.length]?.values as string[][]) || [] : [];
  const lastSync = latestSyncByBrand(logs);

  const out: BrandTabSummary[] = [];
  candidates.forEach((tab, i) => {
    const values = (valueRanges[i]?.values as string[][] | undefined) || [];
    if (values.length === 0 || !isBrandHeader(values[0])) return;
    const header = values[0];
    const brandCol = header.indexOf("Brand");
    const body = values.slice(1).filter((r) => r.some((c) => (c || "").trim()));
    const sync = lastSync.get(tab.toLowerCase());
    // Empty tabs never synced by the crawler are AV_Catalog's own work tabs
    // (product_new, product_delete), not brands.
    if (body.length === 0 && !sync) return;
    const brandCell = (brandCol >= 0 && body.find((r) => r[brandCol])?.[brandCol]) || "";
    out.push({
      tab,
      productCount: body.length,
      brandName: brandCell && !looksLikeBrandId(brandCell) ? brandCell : tab,
      lastSyncedAt: sync?.at ?? null,
      lastSyncStatus: sync?.status ?? null,
    });
  });

  // Most recently synced first: those are the brands the admin needs to review.
  return out.sort(
    (a, b) => (b.lastSyncedAt || "").localeCompare(a.lastSyncedAt || "") || a.tab.localeCompare(b.tab)
  );
}

function latestSyncByBrand(logs: string[][]): Map<string, { at: string; status: string }> {
  const map = new Map<string, { at: string; status: string }>();
  if (logs.length < 2) return map;
  const h = logs[0];
  const brandIdx = h.indexOf("Hãng");
  const statusIdx = h.indexOf("Trạng thái");
  const doneIdx = h.indexOf("Hoàn tất lúc");
  if (brandIdx < 0 || doneIdx < 0) return map;
  for (const row of logs.slice(1)) {
    const brand = (row[brandIdx] || "").trim().toLowerCase();
    const at = (row[doneIdx] || "").trim();
    if (!brand || !at) continue;
    const prev = map.get(brand);
    if (!prev || at > prev.at) map.set(brand, { at, status: (row[statusIdx] || "").trim() });
  }
  return map;
}

async function requireBrandTab(tab: string): Promise<{ sheetId: number; values: string[][] }> {
  if (tab.startsWith("DataCrawler_")) throw new BrandSheetError(404, `Không tìm thấy tab hãng "${tab}"`);
  const found = (await getTabMeta()).find((m) => m.title === tab);
  if (!found) throw new BrandSheetError(404, `Không tìm thấy tab hãng "${tab}"`);
  const values = await readTab(tab);
  if (values.length === 0 || !isBrandHeader(values[0])) {
    throw new BrandSheetError(400, `Tab "${tab}" không phải tab sản phẩm của DataCrawler`);
  }
  return { sheetId: found.sheetId, values };
}

function toBrandRows(values: string[][]): BrandSheetRow[] {
  const header = values[0];
  const rows: BrandSheetRow[] = [];
  values.slice(1).forEach((raw, i) => {
    if (!raw.some((c) => (c || "").trim())) return;
    const rec = toRecord(header, raw);
    rows.push({ rowNumber: i + 2, key: naturalKey(rec), values: rec });
  });
  return rows;
}

export async function readBrandRows(tab: string): Promise<{ header: string[]; rows: BrandSheetRow[] }> {
  const { values } = await requireBrandTab(tab);
  return { header: values[0], rows: toBrandRows(values) };
}

/**
 * Rows of every product tab among `tabs`, in one batchGet (read quota is
 * ~60 requests/minute). Tabs without the crawler header or rows are skipped.
 */
export async function readRowsOfTabs(tabs: string[]): Promise<{ tab: string; rows: BrandSheetRow[] }[]> {
  const candidates = tabs.filter((t) => t && !t.startsWith("DataCrawler_"));
  if (candidates.length === 0) return [];
  const batch = await sheetsClient().spreadsheets.values.batchGet({
    spreadsheetId: spreadsheetId(),
    ranges: candidates.map((t) => `${tabRef(t)}!A:Z`),
  });
  const valueRanges = batch.data.valueRanges || [];
  const out: { tab: string; rows: BrandSheetRow[] }[] = [];
  candidates.forEach((tab, i) => {
    const values = (valueRanges[i]?.values as string[][] | undefined) || [];
    if (values.length === 0 || !isBrandHeader(values[0])) return;
    const rows = toBrandRows(values);
    if (rows.length > 0) out.push({ tab, rows });
  });
  return out;
}

function assertRowMatches(values: string[][], rowNumber: number, expectedKey: string) {
  const raw = values[rowNumber - 1];
  if (!raw || naturalKey(toRecord(values[0], raw)) !== expectedKey) {
    throw new BrandSheetError(
      409,
      `Dòng ${rowNumber} đã thay đổi trên Sheet (có thể crawler vừa đồng bộ). Tải lại danh sách rồi thử lại.`
    );
  }
}

/** Overwrites one row; columns not in `changes` keep their value. */
export async function updateBrandRow(
  tab: string,
  rowNumber: number,
  expectedKey: string,
  changes: Record<string, string>
): Promise<BrandSheetRow> {
  if (!Number.isInteger(rowNumber) || rowNumber < 2) throw new BrandSheetError(400, "rowNumber không hợp lệ");
  const { values } = await requireBrandTab(tab);
  assertRowMatches(values, rowNumber, expectedKey);

  const header = values[0];
  const next = toRecord(header, values[rowNumber - 1]);
  for (const [k, v] of Object.entries(changes)) {
    if (header.includes(k) && typeof v === "string") next[k] = v;
  }
  if (!naturalKey(next).replace(/^(item|title):/, "")) {
    throw new BrandSheetError(400, "Cần có 'Title' hoặc 'product (item)'");
  }

  await sheetsClient().spreadsheets.values.update({
    spreadsheetId: spreadsheetId(),
    range: `${tabRef(tab)}!A${rowNumber}:${columnLetter(header.length - 1)}${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [header.map((h) => next[h] ?? "")] },
  });

  return { rowNumber, key: naturalKey(next), values: next };
}

/** Deletes rows after checking each one still holds the expected product. */
export async function deleteBrandRows(
  tab: string,
  targets: { rowNumber: number; key: string }[]
): Promise<number> {
  if (targets.length === 0) return 0;
  const { sheetId, values } = await requireBrandTab(tab);
  for (const t of targets) {
    if (!Number.isInteger(t.rowNumber) || t.rowNumber < 2) throw new BrandSheetError(400, "rowNumber không hợp lệ");
    assertRowMatches(values, t.rowNumber, t.key);
  }

  // Bottom-up, so deleting one row doesn't shift the ones still to delete.
  const rowNumbers = [...new Set(targets.map((t) => t.rowNumber))].sort((a, b) => b - a);
  await sheetsClient().spreadsheets.batchUpdate({
    spreadsheetId: spreadsheetId(),
    requestBody: {
      requests: rowNumbers.map((n) => ({
        deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: n - 1, endIndex: n } },
      })),
    },
  });
  return rowNumbers.length;
}

/** Parses a request body's `[{ rowNumber, key }]` list. */
export function parseRowTargets(raw: unknown): { rowNumber: number; key: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => {
    const o = (r ?? {}) as { rowNumber?: unknown; key?: unknown };
    return { rowNumber: Number(o.rowNumber), key: String(o.key ?? "") };
  });
}

/** Rows by row number, verified against their keys (used by the Wix image upload). */
export async function getBrandRowsByNumber(
  tab: string,
  targets: { rowNumber: number; key: string }[]
): Promise<BrandSheetRow[]> {
  const { values } = await requireBrandTab(tab);
  return targets.map((t) => {
    assertRowMatches(values, t.rowNumber, t.key);
    const rec = toRecord(values[0], values[t.rowNumber - 1]);
    return { rowNumber: t.rowNumber, key: t.key, values: rec };
  });
}
