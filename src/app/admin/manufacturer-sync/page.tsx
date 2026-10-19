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

import { PageHeader } from "@/components/layout/PageHeader";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ManufacturerSyncPanel } from "@/components/manufacturer-sync/ManufacturerSyncPanel";
import { ManufacturerRequestForm } from "@/components/manufacturer-sync/ManufacturerRequestForm";
import { ImageDownloadPanel } from "@/components/manufacturer-sync/ImageDownloadPanel";
import { RefreshCw } from "lucide-react";

export default function ManufacturerSyncPage() {
  return (
    <DashboardLayout>
      <div className="space-y-8 max-w-4xl">
        <PageHeader
          title="Đồng Bộ Dữ Liệu Nhà Sản Xuất"
          description="Chức năng từ dự án DataCrawler (av-crawler-api) — crawl catalog nhà sản xuất và đồng bộ vào Google Sheet qua một FastAPI backend độc lập."
          icon={<RefreshCw className="w-5 h-5" />}
        />
        <div className="flex flex-col items-start gap-6">
          <ManufacturerSyncPanel />
          <ImageDownloadPanel />
          <ManufacturerRequestForm />
        </div>
      </div>
    </DashboardLayout>
  );
}
