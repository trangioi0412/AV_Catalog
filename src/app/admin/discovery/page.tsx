import React from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { DiscoveryQueueTable } from "./DiscoveryQueueTable";
import { getPendingProductsAction } from "@/app/actions/discovery";

export const dynamic = "force-dynamic";

export default async function DiscoveryQueuePage() {
  const pendingProducts = await getPendingProductsAction();

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
            Discovery Queue
          </h1>
          <p className="text-muted-foreground mt-1">
            Review and approve newly discovered products before syncing them into Wix Studio CMS.
          </p>
        </div>

        <DiscoveryQueueTable initialProducts={pendingProducts} />
      </div>
    </DashboardLayout>
  );
}
