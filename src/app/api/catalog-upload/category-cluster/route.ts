/**
 * POST /api/catalog-upload/category-cluster
 * ─────────────────────────────────────────────────────────────────────────────
 * Groups a catalog's distinct Category values into canonical clusters (see
 * categoryConsolidation.ts) — e.g. "Camera A" / "Camera B" / "Camera hội
 * nghị" all collapsing into one canonical "Camera" — so the CMS AI Review
 * tool (/admin/tools/cms-ai-review) can offer a "merge these into one
 * Category" review step across the whole pulled catalog at once.
 *
 * Admin-only. `proxy.ts` excludes /api/* from its own route protection, so
 * the admin_session cookie is re-checked here (same pattern as every other
 * catalog-upload AI route).
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkAdminSession } from "@/lib/services/wixCatalogPdf";
import {
  clusterCategories,
  clusterCategoriesWithWebVerification,
  isCategoryClusterConfigured,
  isWebVerifiedClusteringConfigured,
  CategoryClusterError,
} from "@/lib/services/categoryConsolidation";

export const runtime = "nodejs";
export const maxDuration = 300;

const sampleSchema = z.object({
  brand: z.string().max(200).optional(),
  product: z.string().max(200).optional(),
  title: z.string().max(300).optional(),
  mainFeature: z.string().max(2000).optional(),
  productOverview: z.string().max(2000).optional(),
});

const entrySchema = z.object({
  category: z.string().min(1).max(200),
  samples: z.array(sampleSchema).max(5).optional().default([]),
});

const requestSchema = z.object({
  mode: z.enum(["local", "web"]).optional().default("local"),
  entries: z.array(entrySchema).min(1).max(500),
});

function noStore(json: unknown, init?: ResponseInit) {
  const res = NextResponse.json(json, init);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function POST(req: NextRequest) {
  if (!(await checkAdminSession(req, "editor"))) {
    return noStore({ error: "Unauthorized: Administrator access required." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return noStore({ error: "Invalid JSON body." }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return noStore({ error: "Invalid request.", details: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.mode === "web") {
    if (!isWebVerifiedClusteringConfigured()) {
      return noStore(
        { error: "Phân nhóm Category chưa được cấu hình (thiếu OLLAMA_BASE_URL).", code: "NOT_CONFIGURED" },
        { status: 503 }
      );
    }
    try {
      const { clusters, sources } = await clusterCategoriesWithWebVerification(parsed.data.entries);
      return noStore({ clusters, sources });
    } catch (err) {
      if (err instanceof CategoryClusterError) {
        const status = err.code === "NOT_CONFIGURED" ? 503 : err.code === "TIMEOUT" ? 504 : 502;
        return noStore({ error: err.message, code: err.code }, { status });
      }
      console.error("[/api/catalog-upload/category-cluster] Unexpected error (web mode):", err);
      return noStore({ error: "Internal server error." }, { status: 500 });
    }
  }

  if (!isCategoryClusterConfigured()) {
    return noStore({ error: "Category clustering is not configured (OLLAMA_BASE_URL is missing).", code: "NOT_CONFIGURED" }, { status: 503 });
  }

  try {
    const clusters = await clusterCategories(parsed.data.entries);
    return noStore({ clusters, sources: [] });
  } catch (err) {
    if (err instanceof CategoryClusterError) {
      const status = err.code === "NOT_CONFIGURED" ? 503 : err.code === "TIMEOUT" ? 504 : 502;
      return noStore({ error: err.message, code: err.code }, { status });
    }
    console.error("[/api/catalog-upload/category-cluster] Unexpected error:", err);
    return noStore({ error: "Internal server error." }, { status: 500 });
  }
}
