import { google } from "googleapis";

// Cache for sheets client and metadata
let sheetsClient: any = null;

function getAuth() {
  let jsonStr = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!jsonStr) return null;

  // Normalize and clean surrounding single or double quotes
  jsonStr = jsonStr.trim();
  if (
    (jsonStr.startsWith("'") && jsonStr.endsWith("'")) ||
    (jsonStr.startsWith('"') && jsonStr.endsWith('"'))
  ) {
    jsonStr = jsonStr.slice(1, -1).trim();
  }

  // Handle double-escaped or literal-escaped quotes (e.g. \" to ")
  if (jsonStr.includes('\\"')) {
    jsonStr = jsonStr.replace(/\\"/g, '"');
  }

  // Handle double-escaped newlines in private key
  if (jsonStr.includes('\\\\n')) {
    jsonStr = jsonStr.replace(/\\\\n/g, '\\n');
  }

  let credentials;
  try {
    credentials = JSON.parse(jsonStr);
  } catch (err) {
    console.warn("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON:", (err as Error).message);
    return null;
  }

  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

export function getSheets() {
  if (sheetsClient) return sheetsClient;
  const auth = getAuth();
  if (!auth) return null;
  sheetsClient = google.sheets({ version: "v4", auth });
  return sheetsClient;
}

const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;

function getSpreadsheetId() {
  if (!SPREADSHEET_ID) {
    throw new Error("Missing GOOGLE_SPREADSHEET_ID environment variable");
  }
  return SPREADSHEET_ID;
}

// ─────────────────────────────────────────────────────────────────────────────
// CACHING & QUOTA MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

let hasEnsuredSheets = false;
let lastEnsureTimestamp = 0;
const ENSURE_TTL_MS = 15 * 60 * 1000; // 15 minutes

const sheetIdCache = new Map<string, number>();

interface ReadCacheEntry {
  data: any[][];
  timestamp: number;
}
const readCache = new Map<string, ReadCacheEntry>();
const READ_CACHE_TTL_MS = 15 * 1000; // 15 seconds cache

export function invalidateSheetCache(sheetName: string) {
  readCache.delete(sheetName.toLowerCase().trim());
}

/**
 * Ensures that the required sheets exist in the spreadsheet.
 * Cached to only run once per 15 minutes to save Google API quota.
 */
export async function ensureSheetsExist(force = false) {
  const now = Date.now();
  if (!force && hasEnsuredSheets && now - lastEnsureTimestamp < ENSURE_TTL_MS) {
    return;
  }

  const sheets = getSheets();
  if (!sheets) return;
  const spreadsheetId = getSpreadsheetId();
  if (!spreadsheetId) return;

  try {
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const existingSheets = meta.data.sheets || [];
    existingSheets.forEach((s: any) => {
      if (s.properties?.title && s.properties?.sheetId !== undefined) {
        sheetIdCache.set(s.properties.title.toLowerCase().trim(), s.properties.sheetId);
      }
    });

    const existingTitlesLower = Array.from(sheetIdCache.keys());

    const requiredSheets = [
      {
        title: "Product_New",
        headers: [
          "Category",
          "Product",
          "Title",
          "productItem",
          "Series",
          "MainFeature",
          "ProductOverview",
          "TechnicalSpecifications",
          "image",
          "Brand",
          "Datasheet",
        ],
      },
      {
        title: "Product_Delete",
        headers: [
          "Category",
          "Product",
          "Title",
          "productItem",
          "Series",
          "MainFeature",
          "ProductOverview",
          "TechnicalSpecifications",
          "image",
          "Brand",
          "Datasheet",
        ],
      },
      {
        title: "Sync_Logs",
        headers: ["Timestamp", "Level", "Message", "Brand"],
      },
      {
        title: "System_Config",
        headers: ["Key", "Value"],
      },
    ];

    const requests: any[] = [];
    for (const sheet of requiredSheets) {
      if (!existingTitlesLower.includes(sheet.title.toLowerCase().trim())) {
        requests.push({
          addSheet: {
            properties: { title: sheet.title },
          },
        });
      }
    }

    if (requests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests },
      });

      // Populate headers for newly created sheets
      for (const sheet of requiredSheets) {
        if (!existingTitlesLower.includes(sheet.title.toLowerCase().trim())) {
          await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${sheet.title}!A1`,
            valueInputOption: "RAW",
            requestBody: {
              values: [sheet.headers],
            },
          });
        }
      }

      // Initialize System_Config defaults if newly created
      const configSheet = requiredSheets.find((s) => s.title === "System_Config");
      if (configSheet && !existingTitlesLower.includes("system_config")) {
        const defaults = [
          ["LastScan", ""],
          ["LastSync", ""],
          ["ApprovedCount", "0"],
          ["RejectedCount", "0"],
        ];
        await sheets.spreadsheets.values.append({
          spreadsheetId,
          range: "System_Config!A2",
          valueInputOption: "RAW",
          requestBody: {
            values: defaults,
          },
        });
      }
    }

    hasEnsuredSheets = true;
    lastEnsureTimestamp = now;
  } catch (err: any) {
    console.warn("[GoogleSheets] ensureSheetsExist warning:", err.message || err);
    hasEnsuredSheets = true;
    lastEnsureTimestamp = now;
  }
}

/**
 * Returns the numerical sheet ID (gid) for a given sheet title.
 */
async function getSheetId(title: string): Promise<number> {
  const normalizedTitle = title.toLowerCase().trim();
  if (sheetIdCache.has(normalizedTitle)) {
    return sheetIdCache.get(normalizedTitle)!;
  }

  await ensureSheetsExist(true);
  if (sheetIdCache.has(normalizedTitle)) {
    return sheetIdCache.get(normalizedTitle)!;
  }

  throw new Error(`Sheet with title "${title}" not found`);
}

/**
 * Reads all rows from a sheet with 15s in-memory TTL caching & quota fallback.
 */
export async function readSheet(sheetName: string, forceFresh = false): Promise<any[][]> {
  const cacheKey = sheetName.toLowerCase().trim();
  const now = Date.now();

  if (!forceFresh && readCache.has(cacheKey)) {
    const entry = readCache.get(cacheKey)!;
    if (now - entry.timestamp < READ_CACHE_TTL_MS) {
      return entry.data;
    }
  }

  try {
    await ensureSheetsExist();
    const sheets = getSheets();
    if (!sheets) return readCache.get(cacheKey)?.data || [];
    const spreadsheetId = getSpreadsheetId();
    if (!spreadsheetId) return readCache.get(cacheKey)?.data || [];

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:Z`,
    });

    const values = response.data.values || [];
    readCache.set(cacheKey, { data: values, timestamp: now });
    return values;
  } catch (err: any) {
    const isQuota = /quota|rate limit|read requests|429/i.test(err.message || String(err));
    if (isQuota) {
      console.warn(`[GoogleSheets] Quota exceeded reading "${sheetName}". Returning cached data.`);
    } else {
      console.warn(`[GoogleSheets] readSheet "${sheetName}" error:`, err.message || err);
    }

    if (readCache.has(cacheKey)) {
      return readCache.get(cacheKey)!.data;
    }
    return [];
  }
}

/**
 * Appends rows to a sheet.
 */
export async function appendRows(sheetName: string, rows: any[][]): Promise<void> {
  if (rows.length === 0) return;
  invalidateSheetCache(sheetName);

  try {
    await ensureSheetsExist();
    const sheets = getSheets();
    if (!sheets) return;
    const spreadsheetId = getSpreadsheetId();
    if (!spreadsheetId) return;

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${sheetName}!A2`,
      valueInputOption: "RAW",
      requestBody: {
        values: rows,
      },
    });
  } catch (err: any) {
    console.error(`[GoogleSheets] appendRows "${sheetName}" error:`, err.message || err);
  }
}

/**
 * Deletes a row by index (0-based, relative to the DATA rows - i.e. index 0 is row 2).
 */
export async function deleteRowByIndex(sheetName: string, index: number): Promise<void> {
  invalidateSheetCache(sheetName);

  try {
    await ensureSheetsExist();
    const sheets = getSheets();
    const spreadsheetId = getSpreadsheetId();
    const sheetId = await getSheetId(sheetName);

    const startIndex = index + 1; // row 2 corresponds to index = 0, so sheet row index = 1
    const endIndex = index + 2;

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId,
                dimension: "ROWS",
                startIndex,
                endIndex,
              },
            },
          },
        ],
      },
    });
  } catch (err: any) {
    console.error(`[GoogleSheets] deleteRowByIndex "${sheetName}" error:`, err.message || err);
  }
}

/**
 * Clears all rows in a sheet except the header row (row 1).
 */
export async function clearSheet(sheetName: string): Promise<void> {
  invalidateSheetCache(sheetName);

  try {
    await ensureSheetsExist();
    const sheets = getSheets();
    if (!sheets) return;
    const spreadsheetId = getSpreadsheetId();
    if (!spreadsheetId) return;

    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${sheetName}!A2:Z`,
    });
  } catch (err: any) {
    console.error(`[GoogleSheets] clearSheet "${sheetName}" error:`, err.message || err);
  }
}

/**
 * Gets the System Config as a key-value record.
 */
export async function getSystemConfig(): Promise<Record<string, string>> {
  const rows = await readSheet("System_Config");
  const config: Record<string, string> = {};

  // Skip header
  for (let i = 1; i < rows.length; i++) {
    const key = rows[i][0];
    const val = rows[i][1];
    if (key) {
      config[key] = val || "";
    }
  }

  return config;
}

/**
 * Updates a key-value pair in System Config.
 */
export async function updateSystemConfig(key: string, value: string): Promise<void> {
  invalidateSheetCache("System_Config");

  try {
    await ensureSheetsExist();
    const sheets = getSheets();
    if (!sheets) return;
    const spreadsheetId = getSpreadsheetId();
    if (!spreadsheetId) return;

    const rows = await readSheet("System_Config");

    let foundRowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === key) {
        foundRowIndex = i + 1; // 1-based coordinate in Google Sheets
        break;
      }
    }

    if (foundRowIndex !== -1) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `System_Config!B${foundRowIndex}`,
        valueInputOption: "RAW",
        requestBody: {
          values: [[value]],
        },
      });
    } else {
      // Key not found, append a new row
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: "System_Config!A2",
        valueInputOption: "RAW",
        requestBody: {
          values: [[key, value]],
        },
      });
    }
  } catch (err: any) {
    console.error(`[GoogleSheets] updateSystemConfig error:`, err.message || err);
  }
}

/**
 * Adds a log message to the Sync_Logs sheet.
 */
export async function addLog(level: "INFO" | "WARNING" | "ERROR", message: string, brand = ""): Promise<void> {
  const timestamp = new Date().toISOString();
  await appendRows("Sync_Logs", [[timestamp, level, message, brand]]);
}
