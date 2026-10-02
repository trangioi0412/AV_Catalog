"use client";

/**
 * /admin/manufacturer-sync
 * ─────────────────────────────────────────────────────────────────────────
 * UI-only port of the DataCrawler project's manufacturer sync admin page
 * (D:\DataCrawler\frontend\app\admin\sync). This page and everything under
 * src/lib/manufacturerSync/, src/components/manufacturer-sync/, and
 * src/app/api/manufacturer-sync/ talk only to the standalone DataCrawler
 * FastAPI backend (MANUFACTURER_SYNC_API_URL) — no shared code, database,
 * or types with the rest of AV_Catalog. Kept isolated on purpose so the
 * DataCrawler frontend and backend can keep being developed independently
 * of this app.
 */

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ManufacturerSyncPanel } from "@/components/manufacturer-sync/ManufacturerSyncPanel";
import { ManufacturerRequestForm } from "@/components/manufacturer-sync/ManufacturerRequestForm";
import { ImageDownloadPanel } from "@/components/manufacturer-sync/ImageDownloadPanel";
import { RefreshCw } from "lucide-react";

export default function ManufacturerSyncPage() {
  return (
    <DashboardLayout>
      <div className="space-y-8 max-w-4xl">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent flex items-center gap-2">
            <RefreshCw className="w-8 h-8 text-primary" />
            Đồng Bộ Dữ Liệu Nhà Sản Xuất
          </h1>
          <p className="text-muted-foreground mt-1">
            Chức năng từ dự án DataCrawler (av-crawler-api) — crawl catalog nhà sản xuất và đồng bộ vào Google Sheet
            qua một FastAPI backend độc lập.
          </p>
        </div>
        <div className="flex flex-col items-start gap-6">
          <ManufacturerSyncPanel />
          <ImageDownloadPanel />
          <ManufacturerRequestForm />
        </div>
      </div>
    </DashboardLayout>
  );
}
