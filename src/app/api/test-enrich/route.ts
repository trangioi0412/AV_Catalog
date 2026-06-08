import { NextRequest, NextResponse } from "next/server";
import { enrichProductDataWithGeminiAgent } from "@/lib/services/geminiEnricher";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const brand = searchParams.get("brand");
  const product = searchParams.get("product");
  const title = searchParams.get("title") || undefined;
  const category = searchParams.get("category") || undefined;

  if (!brand || !product) {
    return NextResponse.json(
      {
        success: false,
        error: "Missing required 'brand' or 'product' query parameters. Example: /api/test-enrich?brand=Shure&product=MXA920",
      },
      { status: 400 }
    );
  }

  try {
    console.log(`[Test Enrich Route] Initiating Gemini enrichment for Brand: ${brand}, Product: ${product}`);
    
    const startTime = Date.now();
    const result = await enrichProductDataWithGeminiAgent({
      Brand: brand,
      Product: product,
      Title: title,
      Category: category,
    });
    const durationMs = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      durationSeconds: (durationMs / 1000).toFixed(2),
      input: { brand, product, title, category },
      enrichedProduct: result,
    });
  } catch (err) {
    console.error("[Test Enrich Route] Enrichment execution error:", err);
    return NextResponse.json(
      {
        success: false,
        error: (err as Error).message,
      },
      { status: 500 }
    );
  }
}
