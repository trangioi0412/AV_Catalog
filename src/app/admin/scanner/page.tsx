import React from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Activity } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { ScannerConsole } from "./ScannerConsole";
import { getActiveBrandsAction, getDiscoveryLogsAction } from "@/app/actions/discovery";

export const dynamic = "force-dynamic";

export default async function ScannerPage() {
  const [brands, logs] = await Promise.all([
    getActiveBrandsAction(),
    getDiscoveryLogsAction(100),
  ]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageHeader
          title="Quét thủ công"
          description="Chạy cập nhật catalog thủ công từ sitemap và API endpoint, đồng thời theo dõi log."
          icon={<Activity className="w-5 h-5" />}
        />

        <ScannerConsole brands={brands} initialLogs={logs} />
      </div>
    </DashboardLayout>
  );
}
