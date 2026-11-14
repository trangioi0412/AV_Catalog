import React from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { CloudUpload } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NewProductUpload } from "@/components/datacrawler/NewProductUpload";
import { DiscoveryQueueTable } from "./DiscoveryQueueTable";
import { CmsContentAudit } from "./CmsContentAudit";
import { getPendingProductsAction } from "@/app/actions/discovery";

export const dynamic = "force-dynamic";

/**
 * DataCrawler › Upload sản phẩm mới: sheet rows not on Wix CMS yet are
 * uploaded to Import1. The former "Hàng đợi Discovery"
 * (Product_New approval) stays available as the last tab for products
 * found by the Discovery scanner.
 */
export default async function NewProductUploadPage() {
  const pendingProducts = await getPendingProductsAction();

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageHeader
          title="Upload sản phẩm mới lên CMS"
          description="Sản phẩm DataCrawler đã thêm vào Excel (Google Sheet) nhưng chưa có trên Wix CMS: chọn và upload lên web."
          icon={<CloudUpload className="w-5 h-5" />}
        />

        <Tabs defaultValue="upload" className="space-y-4">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="upload">Upload theo hãng</TabsTrigger>
            <TabsTrigger value="cms-missing">CMS thiếu nội dung</TabsTrigger>
            <TabsTrigger value="queue">Hàng đợi Product_New ({pendingProducts.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="upload">
            <NewProductUpload />
          </TabsContent>
          {/* Mounted only when opened, so the Wix CMS read happens on demand. */}
          <TabsContent value="cms-missing">
            <CmsContentAudit />
          </TabsContent>
          <TabsContent value="queue">
            <DiscoveryQueueTable initialProducts={pendingProducts} />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
