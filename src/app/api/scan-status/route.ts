import { NextResponse } from "next/server";
import { activeScanLogs, isScanInProgress } from "@/lib/services/discoveryEngine";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    isScanning: isScanInProgress,
    logs: activeScanLogs,
  });
}
