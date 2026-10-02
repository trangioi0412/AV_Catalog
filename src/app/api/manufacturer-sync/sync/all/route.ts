import { NextResponse } from "next/server";
import { startSyncAll, ManufacturerSyncApiError } from "@/lib/manufacturerSync/api";

export async function POST() {
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
