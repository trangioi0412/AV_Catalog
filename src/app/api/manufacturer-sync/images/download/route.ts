import { NextRequest, NextResponse } from "next/server";
import { downloadManufacturerImages, ManufacturerSyncApiError } from "@/lib/manufacturerSync/api";

export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null);
  const manufacturer = payload?.manufacturer;

  if (!manufacturer || typeof manufacturer !== "string") {
    return NextResponse.json({ detail: "'manufacturer' is required" }, { status: 400 });
  }

  try {
    const result = await downloadManufacturerImages(manufacturer);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ManufacturerSyncApiError) {
      return NextResponse.json(error.body, { status: error.status });
    }
    return NextResponse.json({ detail: "Manufacturer sync API is unreachable" }, { status: 502 });
  }
}
