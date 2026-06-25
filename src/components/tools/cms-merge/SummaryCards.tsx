import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { MergeSummary } from "@/types/MergeResult";
import {
  FileSpreadsheet,
  CheckCircle2,
  RefreshCw,
  HelpCircle,
  Copy,
  AlertTriangle,
} from "lucide-react";

interface SummaryCardsProps {
  summary: MergeSummary | null;
}

export function SummaryCards({ summary }: SummaryCardsProps) {
  if (!summary) return null;

  const cardItems = [
    {
      title: "Total Products",
      value: summary.totalProducts,
      description: "Total rows in products database",
      icon: FileSpreadsheet,
      colorClass: "text-blue-500 bg-blue-500/10 border-blue-500/20",
      gradient: "from-blue-500/5 to-transparent",
    },
    {
      title: "Matched Records",
      value: summary.matchedCount,
      description: "Found in SEO source file",
      icon: CheckCircle2,
      colorClass: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
      gradient: "from-emerald-500/5 to-transparent",
    },
    {
      title: "Updated Rows",
      value: summary.updatedCount,
      description: "Fields modified with new data",
      icon: RefreshCw,
      colorClass: "text-orange-500 bg-orange-500/10 border-orange-500/20",
      gradient: "from-orange-500/5 to-transparent",
    },
    {
      title: "Missing IDs",
      value: summary.missingCount,
      description: "IDs in SEO missing in products",
      icon: HelpCircle,
      colorClass: "text-purple-500 bg-purple-500/10 border-purple-500/20",
      gradient: "from-purple-500/5 to-transparent",
    },
    {
      title: "Duplicate IDs",
      value: summary.duplicateCount,
      description: "Duplicates in files",
      icon: Copy,
      colorClass: "text-amber-500 bg-amber-500/10 border-amber-500/20",
      gradient: "from-amber-500/5 to-transparent",
    },
    {
      title: "Processing Errors",
      value: summary.errorCount,
      description: "Invalid rows or layout alerts",
      icon: AlertTriangle,
      colorClass:
        summary.errorCount > 0
          ? "text-rose-500 bg-rose-500/10 border-rose-500/20"
          : "text-muted-foreground bg-muted/10 border-border/20",
      gradient: summary.errorCount > 0 ? "from-rose-500/5 to-transparent" : "from-muted/5 to-transparent",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
      {cardItems.map((item, idx) => (
        <Card
          key={idx}
          className="border border-border/60 bg-card/60 backdrop-blur-md shadow-md rounded-xl overflow-hidden hover:shadow-lg transition-all duration-300 relative group"
        >
          <div className={`absolute inset-0 bg-gradient-to-br ${item.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none`} />
          <CardContent className="p-4 flex flex-col justify-between h-full space-y-3 relative z-10">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                {item.title}
              </span>
              <div className={`p-1.5 rounded-lg border shrink-0 ${item.colorClass}`}>
                <item.icon className="w-3.5 h-3.5" />
              </div>
            </div>
            <div>
              <h3 className="text-xl font-extrabold tracking-tight text-foreground">
                {item.value.toLocaleString()}
              </h3>
              <p className="text-[9px] text-muted-foreground mt-0.5 leading-normal">
                {item.description}
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
