import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/auth/guard";
import {
  createManufacturerRequest,
  listManufacturerRequests,
  ManufacturerSyncApiError,
} from "@/lib/manufacturerSync/api";

export async function GET(request: NextRequest) {
  const denied = await authorizeRequest(request, "viewer");
  if (denied) return denied;

  try {
    const requests = await listManufacturerRequests();
    return NextResponse.json(requests);
  } catch (error) {
    if (error instanceof ManufacturerSyncApiError) {
      return NextResponse.json(error.body, { status: error.status });
    }
    return NextResponse.json({ detail: "Manufacturer sync API is unreachable" }, { status: 502 });
  }
}

export async function POST(request: NextRequest) {
  const denied = await authorizeRequest(request, "editor");
  if (denied) return denied;

  const payload = await request.json().catch(() => null);
  const name = payload?.name;
  const websiteUrl = payload?.website_url ?? "";

  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ detail: "'name' is required" }, { status: 400 });
  }

  try {
    const result = await createManufacturerRequest(name.trim(), websiteUrl);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ManufacturerSyncApiError) {
      return NextResponse.json(error.body, { status: error.status });
    }
    return NextResponse.json({ detail: "Manufacturer sync API is unreachable" }, { status: 502 });
  }
}
