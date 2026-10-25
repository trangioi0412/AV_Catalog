"use client";

import React from "react";
import { CONTENT_FIELDS, DEFAULT_CONTENT_FIELD_KEYS } from "@/lib/utils/productCompleteness";

/**
 * Which content fields count as "required" on the Discovery page. Shared by
 * the queue tab and the CMS tab, remembered per browser (localStorage).
 */
const STORAGE_KEY = "discovery-content-fields";
const VALID_KEYS = new Set(CONTENT_FIELDS.map((f) => f.key));

const listeners = new Set<() => void>();
let cachedRaw: string | null | undefined;
let cachedKeys: string[] = DEFAULT_CONTENT_FIELD_KEYS;

function readRaw(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function getSnapshot(): string[] {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      cachedKeys = Array.isArray(parsed)
        ? parsed.filter((k): k is string => typeof k === "string" && VALID_KEYS.has(k))
        : DEFAULT_CONTENT_FIELD_KEYS;
    } catch {
      cachedKeys = DEFAULT_CONTENT_FIELD_KEYS;
    }
  }
  return cachedKeys;
}

function getServerSnapshot(): string[] {
  return DEFAULT_CONTENT_FIELD_KEYS;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function write(keys: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // Storage unavailable (private mode) — selection simply won't persist.
    cachedRaw = JSON.stringify(keys);
    cachedKeys = keys;
  }
  listeners.forEach((l) => l());
}

export function useContentFieldSelection() {
  const selected = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = React.useCallback(
    (key: string) => {
      const next = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
      // Keep catalog order so badges always list fields the same way.
      write(CONTENT_FIELDS.map((f) => f.key).filter((k) => next.includes(k)));
    },
    [selected]
  );

  const setAll = React.useCallback((keys: string[]) => write(keys), []);
  const reset = React.useCallback(() => write(DEFAULT_CONTENT_FIELD_KEYS), []);

  return { selected, toggle, setAll, reset };
}
