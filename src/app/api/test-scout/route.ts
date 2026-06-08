import { NextRequest, NextResponse } from "next/server";
import { runNetworkScout, mapToTargetSchema } from "@/lib/services/networkScout";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const url = searchParams.get("url");
  const brand = searchParams.get("brand") || "TestBrand";

  if (!url) {
    return NextResponse.json(
      { success: false, error: "Missing required 'url' query parameter" },
      { status: 400 }
    );
  }

  try {
    console.log(`[Test Route] Initiating Playwright Scout for URL: ${url}, Brand: ${brand}`);
    const results = await runNetworkScout(url, brand);
    
    // Map output to the user's requested target DB schema
    const mappedResults = results.map((p) => mapToTargetSchema(p, brand));

    return NextResponse.json({
      success: true,
      totalCaptured: results.length,
      brand,
      sourceUrl: url,
      targetSchemaProducts: mappedResults,
      systemSchemaProducts: results,
    });
  } catch (err) {
    console.error("[Test Route] Scout execution error:", err);
    return NextResponse.json(
      { success: false, error: (err as Error).message },
      { status: 500 }
    );
  }
}
