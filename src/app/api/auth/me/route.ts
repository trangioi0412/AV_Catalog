/**
 * GET /api/auth/me — the signed-in user for client components (sidebar user
 * row). 401 without a valid session. Lives under /api/auth/* so it is
 * excluded from src/proxy.ts and does its own check.
 */
import { NextResponse } from "next/server";
import { getCatalogUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCatalogUser();
  return NextResponse.json(user ? { user } : { error: "Unauthorized" }, {
    status: user ? 200 : 401,
    headers: { "Cache-Control": "no-store" },
  });
}
