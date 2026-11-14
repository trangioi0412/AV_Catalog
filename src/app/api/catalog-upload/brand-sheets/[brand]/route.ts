import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@/lib/auth/guard";
import {
  BrandSheetError,
  deleteBrandRows,
  parseRowTargets,
  readBrandRows,
  updateBrandRow,
} from "@/lib/services/brandSheets";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ brand: string }> };

function errorResponse(error: unknown, action: string) {
  const status = error instanceof BrandSheetError ? error.status : 502;
  if (status >= 500) console.error(`[brand-sheets] ${action} failed:`, error);
  return NextResponse.json({ detail: error instanceof Error ? error.message : String(error) }, { status });
}

/** Every product row of one brand tab. */
export async function GET(request: NextRequest, { params }: Ctx) {
  const denied = await authorizeRequest(request, "editor");
  if (denied) return denied;
  const { brand } = await params;

  try {
    return NextResponse.json(await readBrandRows(decodeURIComponent(brand)));
  } catch (error) {
    return errorResponse(error, "read");
  }
}

/** Body: { rowNumber, key, values: { "<column>": "<new value>" } } */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const denied = await authorizeRequest(request, "editor");
  if (denied) return denied;
  const { brand } = await params;

  const body = await request.json().catch(() => null);
  const rowNumber = Number(body?.rowNumber);
  const key = body?.key;
  const values = body?.values;
  if (!Number.isInteger(rowNumber) || typeof key !== "string" || !values || typeof values !== "object") {
    return NextResponse.json({ detail: "Cần rowNumber, key và values" }, { status: 400 });
  }
  const changes: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) if (typeof v === "string") changes[k] = v;

  try {
    const row = await updateBrandRow(decodeURIComponent(brand), rowNumber, key, changes);
    return NextResponse.json({ row });
  } catch (error) {
    return errorResponse(error, "update");
  }
}

/** Body: { rows: [{ rowNumber, key }] } */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const denied = await authorizeRequest(request, "editor");
  if (denied) return denied;
  const { brand } = await params;

  const body = await request.json().catch(() => null);
  const targets = parseRowTargets(body?.rows);
  if (targets.length === 0) {
    return NextResponse.json({ detail: "Cần danh sách rows" }, { status: 400 });
  }

  try {
    const deleted = await deleteBrandRows(decodeURIComponent(brand), targets);
    return NextResponse.json({ deleted });
  } catch (error) {
    return errorResponse(error, "delete");
  }
}
