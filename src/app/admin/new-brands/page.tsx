import { PageHeader } from "@/components/layout/PageHeader";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { NewBrandsPanel } from "@/components/datacrawler/NewBrandsPanel";
import { Sparkles } from "lucide-react";

export default function NewBrandsPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageHeader
          title="Brand mới"
          description="Hãng có trên Excel (Google Sheet của DataCrawler) nhưng chưa có trên Wix CMS. Tải logo về và đẩy lên Media Manager › Brand/Logo."
          icon={<Sparkles className="w-5 h-5" />}
        />
        <NewBrandsPanel />
      </div>
    </DashboardLayout>
  );
}
