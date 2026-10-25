import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/auth/guard";
import { startSyncAll, ManufacturerSyncApiError } from "@/lib/manufacturerSync/api";

export async function POST(request: NextRequest) {
  const denied = await authorizeRequest(request, "admin");
  if (denied) return denied;

  try {
    const result = await startSyncAll();
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    if (error instanceof ManufacturerSyncApiError) {
      return NextResponse.json(error.body, { status: error.status });
    }
    return NextResponse.json({ detail: "Manufacturer sync API is unreachable" }, { status: 502 });
  }
}
