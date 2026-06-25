import React from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, FileSpreadsheet, FileWarning, FileJson } from "lucide-react";

interface DownloadSectionProps {
  hasResults: boolean;
  hasMissing: boolean;
  onDownloadResult: () => void;
  onDownloadMissing: () => void;
  onDownloadReport: () => void;
  outputFormat: "csv" | "xlsx";
}

export function DownloadSection({
  hasResults,
  hasMissing,
  onDownloadResult,
  onDownloadMissing,
  onDownloadReport,
  outputFormat,
}: DownloadSectionProps) {


  return (
    <Card className="border border-border/60 bg-card/60 backdrop-blur-md shadow-md rounded-xl">
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-bold text-foreground flex items-center gap-2 tracking-tight">
          <Download className="w-4 h-4 text-primary" />
          Export Datasets
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          Download the merged product information files, missing IDs report, or diagnostic logs.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* 1. Download Merged File */}
          <Button
            size="lg"
            disabled={!hasResults}
            onClick={onDownloadResult}
            className="h-14 flex items-center justify-start gap-3.5 bg-gradient-to-r from-primary to-primary/90 text-primary-foreground hover:from-primary/95 hover:to-primary text-xs font-bold rounded-xl border border-primary/15 shadow-md shadow-primary/20 hover:scale-[1.01] transition-all duration-200 disabled:opacity-40 disabled:hover:scale-100 disabled:from-primary/50 disabled:to-primary/50"
          >
            <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <div className="text-left leading-normal">
              <p className="font-bold">Merged Dataset</p>
              <p className="text-[10px] text-white/70 font-medium">
                Save as .{outputFormat.toUpperCase()}
              </p>
            </div>
          </Button>

          {/* 2. Download Missing IDs */}
          <Button
            variant="outline"
            size="lg"
            disabled={!hasResults || !hasMissing}
            onClick={onDownloadMissing}
            className="h-14 flex items-center justify-start gap-3.5 border-border/60 hover:border-amber-500/40 hover:bg-amber-500/5 text-foreground disabled:opacity-40 disabled:hover:bg-transparent text-xs font-bold rounded-xl hover:scale-[1.01] transition-all duration-200"
          >
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-500 flex items-center justify-center shrink-0">
              <FileWarning className="w-4 h-4" />
            </div>
            <div className="text-left leading-normal">
              <p className="font-bold text-foreground">Missing IDs List</p>
              <p className="text-[10px] text-muted-foreground font-medium">
                {!hasResults ? "Awaiting merge..." : hasMissing ? "Download unmatched IDs" : "No missing records"}
              </p>
            </div>
          </Button>

          {/* 3. Download Report */}
          <Button
            variant="outline"
            size="lg"
            disabled={!hasResults}
            onClick={onDownloadReport}
            className="h-14 flex items-center justify-start gap-3.5 border-border/60 hover:border-primary/40 hover:bg-primary/5 text-foreground text-xs font-bold rounded-xl hover:scale-[1.01] transition-all duration-200 disabled:opacity-40 disabled:hover:scale-100"
          >
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0">
              <FileJson className="w-4 h-4" />
            </div>
            <div className="text-left leading-normal">
              <p className="font-bold text-foreground">Merge Log Report</p>
              <p className="text-[10px] text-muted-foreground font-medium">
                Download JSON diagnostic report
              </p>
            </div>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
