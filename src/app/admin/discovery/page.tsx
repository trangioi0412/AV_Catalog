import React from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { CheckSquare } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DiscoveryQueueTable } from "./DiscoveryQueueTable";
import { CmsContentAudit } from "./CmsContentAudit";
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

        <Tabs defaultValue="queue" className="space-y-4">
          <TabsList>
            <TabsTrigger value="queue">Hàng đợi duyệt ({pendingProducts.length})</TabsTrigger>
            <TabsTrigger value="cms-missing">CMS thiếu nội dung</TabsTrigger>
          </TabsList>
          <TabsContent value="queue">
            <DiscoveryQueueTable initialProducts={pendingProducts} />
          </TabsContent>
          {/* Mounted only when opened, so the Wix CMS read happens on demand. */}
          <TabsContent value="cms-missing">
            <CmsContentAudit />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
