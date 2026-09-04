/**
 * translation-timestamp-store.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Records when each (item, target field) pair was last AI-translated by
 * `translateOneItemPreview()`, so a follow-up run can skip re-translating that
 * exact field instead of burning another AI call on it — e.g. re-running "Chọn
 * toàn bộ" shortly after a prior batch. Keyed per FIELD, not just per item —
 * translating one field on an item must never block translating a DIFFERENT,
 * unrelated field on that same item a moment later.
 * Same on-disk JSON key-value pattern as `productDiscovery/index.ts`'s search cache —
 * no DB in this project, and this doesn't warrant introducing one.
 *
 * Best-effort only: a failed read/write is logged and swallowed, never thrown — losing
 * a timestamp just means that one field's cooldown doesn't apply, not a correctness bug.
 */

import fs from "fs";
import path from "path";

const STORE_FILE = path.join(process.cwd(), "logs", "cms-translate-timestamps.json");

type TimestampStore = Record<string, string>;

function readStore(): TimestampStore {
  try {
    if (fs.existsSync(STORE_FILE)) {
      return JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    }
  } catch (err) {
    console.error("[CmsTranslateTimestamps] Failed to read store:", err);
  }
  return {};
}

function writeStore(store: TimestampStore): void {
  try {
    const dir = path.dirname(STORE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch (err) {
    console.error("[CmsTranslateTimestamps] Failed to write store:", err);
  }
}

function storeKey(collectionId: string, itemId: string, targetField: string): string {
  return `${collectionId}::${itemId}::${targetField}`;
}

/** ISO timestamp of the last time this (item, target field) pair was AI-translated (mode "preview"), or null if never recorded. */
export function getLastTranslatedAt(collectionId: string, itemId: string, targetField: string): string | null {
  return readStore()[storeKey(collectionId, itemId, targetField)] ?? null;
}

/** Records "translated just now" for this (item, target field) pair. */
export function recordTranslated(collectionId: string, itemId: string, targetField: string): void {
  const store = readStore();
  store[storeKey(collectionId, itemId, targetField)] = new Date().toISOString();
  writeStore(store);
}
