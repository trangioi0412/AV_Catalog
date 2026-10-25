import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/auth/guard";
import { approveManufacturerRequest, ManufacturerSyncApiError } from "@/lib/manufacturerSync/api";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await authorizeRequest(request, "admin");
  if (denied) return denied;

  const { id } = await params;
  if (!id) {
    return NextResponse.json({ detail: "Invalid request id" }, { status: 400 });
  }

  try {
    const result = await approveManufacturerRequest(id);
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    if (error instanceof ManufacturerSyncApiError) {
      return NextResponse.json(error.body, { status: error.status });
    }
    return NextResponse.json({ detail: "Manufacturer sync API is unreachable" }, { status: 502 });
  }
}
