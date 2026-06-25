import React from "react";
import { Progress } from "@/components/ui/progress";
import { Loader2 } from "lucide-react";

interface ProgressBarProps {
  progress: number;
  isProcessing: boolean;
}

export function ProgressBar({ progress, isProcessing }: ProgressBarProps) {
  if (!isProcessing) return null;

  return (
    <div className="space-y-2 p-4 rounded-xl border border-primary/10 bg-primary/5 flex flex-col justify-center animate-pulse">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
          <span className="text-xs font-bold text-foreground">
            Đang xử lý ánh xạ bản dịch...
          </span>
        </div>
        <span className="text-xs font-bold text-primary">{progress}%</span>
      </div>
      <Progress value={progress} className="h-2" />
      <span className="text-[10px] text-muted-foreground/80 leading-none">
        Vui lòng không đóng tab trình duyệt trong lúc hệ thống đang chạy.
      </span>
    </div>
  );
}
