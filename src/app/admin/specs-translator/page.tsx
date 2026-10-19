import React from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Languages } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { SpecsTranslationTool } from "@/components/data/SpecsTranslationTool";

export default function SpecsTranslatorPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-5xl mx-auto pb-10">
        <PageHeader
          title="Dịch thông số kỹ thuật"
          description="Chuyển đổi thông số giữa dạng mảng JSON lồng nhau và văn bản thuần để dịch thuật dễ dàng."
          icon={<Languages className="w-5 h-5" />}
        />
        
        <SpecsTranslationTool />
      </div>
    </DashboardLayout>
  );
}
