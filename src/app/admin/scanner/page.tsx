import React from "react";
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
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
            Manual Scanner
          </h1>
          <p className="text-muted-foreground mt-1">
            Manually trigger catalog updates from sitemaps and API endpoints, and monitor logs.
          </p>
        </div>

        <ScannerConsole brands={brands} initialLogs={logs} />
      </div>
    </DashboardLayout>
  );
}
