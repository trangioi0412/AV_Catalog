import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/auth/guard";
import { listManufacturers, ManufacturerSyncApiError } from "@/lib/manufacturerSync/api";

export async function GET(request: NextRequest) {
  const denied = await authorizeRequest(request, "viewer");
  if (denied) return denied;

  try {
    const manufacturers = await listManufacturers();
    return NextResponse.json(manufacturers);
  } catch (error) {
    if (error instanceof ManufacturerSyncApiError) {
      return NextResponse.json(error.body, { status: error.status });
    }
    return NextResponse.json({ detail: "Manufacturer sync API is unreachable" }, { status: 502 });
  }
}
