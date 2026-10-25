/**
 * Machine-to-machine auth for /api/cron/*: `Authorization: Bearer <CRON_SECRET>`
 * (the header Vercel Cron sends when CRON_SECRET is set). The secret is never
 * accepted from the query string, where it would end up in access logs.
 * Fail-closed: without CRON_SECRET configured every cron request is rejected.
 */
import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export function hasValidCronSecret(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!expected || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice("Bearer ".length));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
