import { NextResponse } from "next/server";
import { previewManufacturerRequest, ManufacturerSyncApiError } from "@/lib/manufacturerSync/api";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ detail: "Invalid request id" }, { status: 400 });
  }

  try {
    const result = await previewManufacturerRequest(id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ManufacturerSyncApiError) {
      return NextResponse.json(error.body, { status: error.status });
    }
    return NextResponse.json({ detail: "Manufacturer sync API is unreachable" }, { status: 502 });
  }
}
