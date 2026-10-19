import React from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { CheckSquare } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { DiscoveryQueueTable } from "./DiscoveryQueueTable";
import { getPendingProductsAction } from "@/app/actions/discovery";

export const dynamic = "force-dynamic";

export default async function DiscoveryQueuePage() {
  const pendingProducts = await getPendingProductsAction();

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageHeader
          title="Hàng đợi Discovery"
          description="Xem xét và duyệt sản phẩm mới phát hiện trước khi đồng bộ vào Wix Studio CMS."
          icon={<CheckSquare className="w-5 h-5" />}
        />

        <DiscoveryQueueTable initialProducts={pendingProducts} />
      </div>
    </DashboardLayout>
  );
}
