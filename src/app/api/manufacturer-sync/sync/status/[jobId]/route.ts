import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/auth/guard";
import { getSyncStatus, ManufacturerSyncApiError } from "@/lib/manufacturerSync/api";

export async function GET(request: NextRequest, { params }: { params: Promise<{ jobId: string }> }) {
  const denied = await authorizeRequest(request, "viewer");
  if (denied) return denied;

  const { jobId } = await params;

  try {
    const status = await getSyncStatus(jobId);
    return NextResponse.json(status);
  } catch (error) {
    if (error instanceof ManufacturerSyncApiError) {
      return NextResponse.json(error.body, { status: error.status });
    }
    return NextResponse.json({ detail: "Manufacturer sync API is unreachable" }, { status: 502 });
  }
}
