import { NextRequest, NextResponse } from "next/server";
import { hasValidCronSecret } from "@/lib/auth/cron";
import { runProductDiscovery } from "@/lib/services/discoveryEngine";

export const dynamic = "force-dynamic";

/** Called by the scheduler with `Authorization: Bearer <CRON_SECRET>` (src/lib/auth/cron.ts). */
export async function GET(request: NextRequest) {
  if (!hasValidCronSecret(request)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized: invalid or missing cron credentials" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const result = await runProductDiscovery();
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      scanned: result.totalScanned,
      newProductsCount: result.totalNew,
      logs: result.logs,
    });
  } catch (err) {
    console.error("Cron discovery scan failed:", err);
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
