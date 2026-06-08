/**
 * GET /api/image-sync/collections
 * ─────────────────────────────────────────────────────────────────────────────
 * List all data collections available in the Wix site.
 * Used by the UI to let the user pick the correct collection ID.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const apiKey = process.env.WIX_API_KEY;
  const siteId = process.env.WIX_SITE_ID;

  if (!apiKey || !siteId) {
    return NextResponse.json(
      { error: "WIX_API_KEY or WIX_SITE_ID not configured." },
      { status: 500 }
    );
  }

  try {
    const res = await fetch("https://www.wixapis.com/wix-data/v2/collections", {
      method: "GET",
      headers: {
        Authorization: apiKey,
        "wix-site-id": siteId,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Wix API error ${res.status}: ${text}` },
        { status: res.status }
      );
    }

    const json = await res.json();

    // Wix returns { collections: [{ id, displayName, ... }] }
    const collections: Array<{ id: string; displayName?: string }> =
      json.collections ?? [];

    return NextResponse.json({
      ok: true,
      collections: collections.map((c) => ({
        id: c.id,
        displayName: c.displayName ?? c.id,
      })),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Failed to fetch collections" },
      { status: 500 }
    );
  }
}
