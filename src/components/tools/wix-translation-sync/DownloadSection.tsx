import React from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, FileSpreadsheet, FileWarning, FileCode } from "lucide-react";
import { ValidationError, WixExportRow } from "@/types/wix-translation-sync";

interface DownloadSectionProps {
  completedWixRows: WixExportRow[];
  validationErrors: ValidationError[];
  hasResults: boolean;
  onDownloadCompleted: () => void;
  onDownloadErrors: () => void;
  onDownloadReport: () => void;
}

export function DownloadSection({
  completedWixRows,
  validationErrors,
  hasResults,
  onDownloadCompleted,
  onDownloadErrors,
  onDownloadReport,
}: DownloadSectionProps) {
  if (!hasResults) return null;

  return (
    <Card className="border border-primary/20 bg-primary/5 shadow-md rounded-xl overflow-hidden">
      <CardHeader className="pb-3 border-b border-primary/10">
        <CardTitle className="text-sm font-bold uppercase tracking-wider text-primary">
          Tải xuống kết quả kết xuất (Export Downloads)
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground mt-0.5">
          Tải xuống file CSV bản dịch Wix Multilingual đã đồng bộ và các báo cáo đối soát.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="flex flex-col sm:flex-row gap-4 flex-wrap">
          {/* Completed Wix Translation CSV */}
          <Button
            onClick={onDownloadCompleted}
            disabled={completedWixRows.length === 0}
            className="flex-1 min-w-[200px] text-xs font-bold gap-2 bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20 rounded-lg h-10"
          >
            <FileSpreadsheet className="w-4 h-4 shrink-0" />
            Download Completed Wix CSV
            <Download className="w-3.5 h-3.5 shrink-0 ml-auto" />
          </Button>

          {/* Error Report CSV */}
          <Button
            variant="outline"
            onClick={onDownloadErrors}
            disabled={validationErrors.length === 0}
            className="flex-1 min-w-[200px] text-xs font-bold gap-2 border-amber-500/20 text-amber-500 bg-amber-500/5 hover:bg-amber-500/10 rounded-lg h-10"
          >
            <FileWarning className="w-4 h-4 shrink-0" />
            Download Error Report (CSV)
            <Download className="w-3.5 h-3.5 shrink-0 ml-auto" />
          </Button>

          {/* Detailed Processing Report JSON */}
          <Button
            variant="outline"
            onClick={onDownloadReport}
            className="flex-1 min-w-[200px] text-xs font-bold gap-2 border-blue-500/20 text-blue-500 bg-blue-500/5 hover:bg-blue-500/10 rounded-lg h-10"
          >
            <FileCode className="w-4 h-4 shrink-0" />
            Download Summary Report (JSON)
            <Download className="w-3.5 h-3.5 shrink-0 ml-auto" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
