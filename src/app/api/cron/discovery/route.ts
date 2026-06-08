import { NextRequest, NextResponse } from "next/server";
import { runProductDiscovery } from "@/lib/services/discoveryEngine";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const secret = searchParams.get("secret");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && secret !== cronSecret) {
    return NextResponse.json(
      { success: false, error: "Unauthorized: Invalid secret" },
      { status: 401 }
    );
  }

  if (!cronSecret) {
    console.warn("CRON_SECRET environment variable is not defined. Skipping authentication check.");
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
