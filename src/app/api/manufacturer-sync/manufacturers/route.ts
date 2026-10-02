import { NextResponse } from "next/server";
import { listManufacturers, ManufacturerSyncApiError } from "@/lib/manufacturerSync/api";

export async function GET() {
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
