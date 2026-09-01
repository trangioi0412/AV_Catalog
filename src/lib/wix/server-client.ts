/**
 * server-client.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Minimal, server-only authenticated fetch wrapper for the Wix Data (CMS)
 * REST API. Credentials (WIX_API_KEY / WIX_SITE_ID) never leave this module —
 * callers get typed JSON back, never the headers or raw response.
 *
 * Never import this from a Client Component.
 */

const WIX_DATA_API = "https://www.wixapis.com/wix-data/v2";
const FETCH_TIMEOUT_MS = 15000;

export type WixServerClientErrorCode = "NOT_CONFIGURED" | "TIMEOUT" | "NETWORK_ERROR" | "UPSTREAM_ERROR";

export class WixServerClientError extends Error {
  readonly status: number;
  readonly code: WixServerClientErrorCode;
  constructor(message: string, status: number, code: WixServerClientErrorCode) {
    super(message);
    this.name = "WixServerClientError";
    this.status = status;
    this.code = code;
  }
}

export function isWixConfigured(): boolean {
  return Boolean(process.env.WIX_API_KEY && process.env.WIX_SITE_ID);
}

function getHeaders(): Record<string, string> {
  const apiKey = process.env.WIX_API_KEY;
  const siteId = process.env.WIX_SITE_ID;
  if (!apiKey || !siteId) {
    throw new WixServerClientError(
      "Wix credentials (WIX_API_KEY, WIX_SITE_ID) are not configured.",
      503,
      "NOT_CONFIGURED"
    );
  }
  return {
    "Content-Type": "application/json",
    Authorization: apiKey,
    "wix-site-id": siteId,
  };
}

/** GETs, POSTs, or PATCHes a `wix-data/v2` sub-path (e.g. "items/query", "items/{id}", "collections") with server-side auth. `body` is omitted from the request for GET. */
export async function wixDataFetch(subPath: string, body?: unknown, method: "GET" | "POST" | "PATCH" = "POST"): Promise<unknown> {
  const headers = getHeaders();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${WIX_DATA_API}/${subPath}`, {
      method,
      headers,
      ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new WixServerClientError(`Wix Data API request timed out: ${subPath}`, 504, "TIMEOUT");
    }
    throw new WixServerClientError(
      `Wix Data API network error: ${err instanceof Error ? err.message : String(err)}`,
      502,
      "NETWORK_ERROR"
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new WixServerClientError(`Wix Data API error ${res.status} for ${subPath}: ${text}`, res.status, "UPSTREAM_ERROR");
  }
  return res.json();
}
