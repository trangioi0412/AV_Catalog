import React from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { SpecsTranslationTool } from "@/components/data/SpecsTranslationTool";

export default function SpecsTranslatorPage() {
  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-5xl mx-auto pb-10">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Technical Specifications Translation</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Convert specifications between nested JSON arrays and plain text lines for easy localization workflows.
          </p>
        </div>
        
        <SpecsTranslationTool />
      </div>
    </DashboardLayout>
  );
}
