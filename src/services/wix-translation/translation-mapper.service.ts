/**
 * translation-mapper.service.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Field-level helpers shared by `translate-and-sync.ts`:
 *  - stable source-content hashing, to detect a source that changed between
 *    preview and save (see AGENTS.md §19);
 *  - a server-side field-key allowlist filter (never trust client field keys);
 *  - a conservative HTML sanitizer for rendering rich-text/HTML fields in the
 *    preview UI without executing any of it.
 */

import { createHash } from "crypto";

/** Deterministic JSON stringify (sorted keys) so the same field values always hash the same way. */
export function stableStringify(value: Record<string, unknown>): string {
  const sortedKeys = Object.keys(value).sort();
  const sorted: Record<string, unknown> = {};
  for (const key of sortedKeys) sorted[key] = value[key];
  return JSON.stringify(sorted);
}

/** sha256 hex digest of the source fields, used to detect a source that changed since preview. */
export function computeSourceHash(fields: Record<string, unknown>): string {
  return createHash("sha256").update(stableStringify(fields)).digest("hex");
}

/** Keeps only requested keys that are present in the server-derived allowlist. Client-supplied keys are never trusted on their own. */
export function sanitizeFieldKeys(requestedKeys: string[], allowedKeys: string[]): string[] {
  const allowed = new Set(allowedKeys);
  return requestedKeys.filter((k) => allowed.has(k));
}

/**
 * Strips executable content from an HTML/rich-text field value before it is
 * ever rendered in the review UI. Not a full sanitizer library — removes
 * `<script>`/`<style>` blocks, inline event handlers, and `javascript:` URLs,
 * while preserving structural tags (headings, lists, tables, links).
 */
export function sanitizeHtmlForPreview(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1="#"');
}
