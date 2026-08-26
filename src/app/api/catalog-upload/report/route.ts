/**
 * POST /api/catalog-upload/report
 * ─────────────────────────────────────────────────────────────────────────────
 * Accepts a completed CatalogUploadReport and returns it as a CSV download.
 * Uses PapaParse (already in project dependencies) for CSV generation.
 */

import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { checkAdminSession } from "@/lib/services/wixCatalogPdf";
import type { CatalogUploadReport } from "@/types/catalog-upload";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    if (!checkAdminSession(req)) {
      return NextResponse.json(
        { error: "Unauthorized: Administrator access required." },
        { status: 401 }
      );
    }

    const body = await req.json();
    const report: CatalogUploadReport = body?.report;

    if (!report) {
      return NextResponse.json(
        { error: "report field is required." },
        { status: 400 }
      );
    }

    // ── Build flat rows for CSV ───────────────────────────────────────────────
    const rows: Record<string, string>[] = [];

    // Success items
    for (const item of report.successItems ?? []) {
      rows.push({
        "Trạng thái": "Thành công",
        "Hãng": item.entry.brandName,
        "Danh mục": item.entry.categoryName,
        "Sản phẩm": item.entry.productName,
        "Tên file": item.entry.fileName,
        "Dung lượng (KB)": Math.round(item.entry.sizeBytes / 1024).toString(),
        "CMS ID": item.cmsItemId ?? "",
        "Wix File ID": item.wixFileId ?? "",
        "Wix URL": item.wixUrl ?? "",
        "Lỗi": "",
      });
    }

    // Failed items
    for (const item of report.failedItems ?? []) {
      rows.push({
        "Trạng thái": "Thất bại",
        "Hãng": item.entry.brandName,
        "Danh mục": item.entry.categoryName,
        "Sản phẩm": item.entry.productName,
        "Tên file": item.entry.fileName,
        "Dung lượng (KB)": Math.round(item.entry.sizeBytes / 1024).toString(),
        "CMS ID": item.cmsItemId ?? "",
        "Wix File ID": item.wixFileId ?? "",
        "Wix URL": item.wixUrl ?? "",
        "Lỗi": item.error ?? "",
      });
    }

    // Skipped items
    for (const item of report.skippedItems ?? []) {
      rows.push({
        "Trạng thái": "Bỏ qua",
        "Hãng": item.entry.brandName,
        "Danh mục": item.entry.categoryName,
        "Sản phẩm": item.entry.productName,
        "Tên file": item.entry.fileName,
        "Dung lượng (KB)": Math.round(item.entry.sizeBytes / 1024).toString(),
        "CMS ID": item.cmsItemId ?? "",
        "Wix File ID": "",
        "Wix URL": "",
        "Lỗi": item.warning ?? "",
      });
    }

    // No-match items
    for (const item of report.noMatchItems ?? []) {
      rows.push({
        "Trạng thái": "Không tìm thấy CMS",
        "Hãng": item.entry.brandName,
        "Danh mục": item.entry.categoryName,
        "Sản phẩm": item.entry.productName,
        "Tên file": item.entry.fileName,
        "Dung lượng (KB)": Math.round(item.entry.sizeBytes / 1024).toString(),
        "CMS ID": "",
        "Wix File ID": "",
        "Wix URL": "",
        "Lỗi": item.warning ?? "Không tìm thấy sản phẩm trong CMS",
      });
    }

    // Multiple-match items
    for (const item of report.multipleMatchItems ?? []) {
      rows.push({
        "Trạng thái": "Trùng nhiều CMS",
        "Hãng": item.entry.brandName,
        "Danh mục": item.entry.categoryName,
        "Sản phẩm": item.entry.productName,
        "Tên file": item.entry.fileName,
        "Dung lượng (KB)": Math.round(item.entry.sizeBytes / 1024).toString(),
        "CMS ID": "",
        "Wix File ID": "",
        "Wix URL": "",
        "Lỗi": item.warning ?? "Nhiều sản phẩm CMS trùng khớp",
      });
    }

    // ── Convert to CSV ────────────────────────────────────────────────────────
    const csv = Papa.unparse(rows, {
      header: true,
      newline: "\r\n",
    });

    // Add BOM for Excel UTF-8 compatibility
    const bom = "\uFEFF";
    const csvWithBom = bom + csv;

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);

    return new Response(csvWithBom, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="catalog-upload-report-${timestamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("[/api/catalog-upload/report] Error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Internal server error" },
      { status: 500 }
    );
  }
}
