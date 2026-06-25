import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { TranslationSummary } from "@/types/wix-translation-sync";
import { FileSpreadsheet, CheckSquare, RefreshCcw, FileWarning, HelpCircle, Ban, Target } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProcessingSummaryProps {
  summary: TranslationSummary | null;
}

export function ProcessingSummary({ summary }: ProcessingSummaryProps) {
  if (!summary) return null;

  const cards = [
    {
      title: "Tổng số dòng (Wix)",
      value: summary.totalRows,
      icon: FileSpreadsheet,
      colorClass: "text-blue-500 bg-blue-500/10 border-blue-500/20",
    },
    {
      title: "Dòng khớp CMS",
      value: summary.matchedRows,
      icon: CheckSquare,
      colorClass: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
    },
    {
      title: "Cập nhật thành công",
      value: summary.updatedRows,
      icon: RefreshCcw,
      colorClass: "text-indigo-500 bg-indigo-500/10 border-indigo-500/20",
    },
    {
      title: "Thiếu bản ghi CMS",
      value: summary.missingCmsRecords,
      icon: FileWarning,
      colorClass: cn(
        summary.missingCmsRecords > 0 ? "text-amber-500 bg-amber-500/10 border-amber-500/20" : "text-muted-foreground bg-muted/10 border-border"
      ),
    },
    {
      title: "Trường không hỗ trợ",
      value: summary.unsupportedFields,
      icon: HelpCircle,
      colorClass: cn(
        summary.unsupportedFields > 0 ? "text-amber-500 bg-amber-500/10 border-amber-500/20" : "text-muted-foreground bg-muted/10 border-border"
      ),
    },
    {
      title: "Lỗi cấu trúc/Parse",
      value: summary.errorsCount,
      icon: Ban,
      colorClass: cn(
        summary.errorsCount > 0 ? "text-red-500 bg-red-500/10 border-red-500/20" : "text-muted-foreground bg-muted/10 border-border"
      ),
    },
    {
      title: "Tỷ lệ chính xác",
      value: `${summary.successRate}%`,
      icon: Target,
      colorClass: "text-primary bg-primary/10 border-primary/20",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4">
      {cards.map((card, idx) => (
        <Card key={idx} className="border border-border/60 bg-card/60 backdrop-blur-md shadow-sm rounded-xl">
          <CardContent className="p-4 flex flex-col justify-between h-full min-h-[100px]">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider leading-tight">
                {card.title}
              </span>
              <div className={cn("w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 shadow-inner", card.colorClass)}>
                <card.icon className="w-3.5 h-3.5" />
              </div>
            </div>
            <div className="mt-3">
              <span className="text-xl font-bold text-foreground tracking-tight">{card.value}</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
