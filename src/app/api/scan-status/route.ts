import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/auth/guard";
import { activeScanLogs, isScanInProgress } from "@/lib/services/discoveryEngine";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await authorizeRequest(request, "viewer");
  if (denied) return denied;

  return NextResponse.json({
    isScanning: isScanInProgress,
    logs: activeScanLogs,
  });
}
