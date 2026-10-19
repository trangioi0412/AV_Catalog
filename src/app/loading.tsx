import React from "react";
import { Zap } from "lucide-react";

export default function Loading() {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-md"
      aria-live="polite"
      aria-busy="true"
      aria-label="Đang tải trang..."
    >
      {/* CSS-only animations: server-rendered HTML is visible immediately,
          without waiting for JS to hydrate. */}
      <div className="flex flex-col items-center gap-5 p-8 rounded-2xl bg-card border border-border/60 shadow-2xl shadow-black/10 max-w-xs w-full mx-4 animate-in fade-in-0 zoom-in-95 duration-200">
        {/* Animated logo icon */}
        <div className="relative w-16 h-16 flex items-center justify-center">
          {/* Outer pulsing ring */}
          <div className="absolute inset-0 rounded-full border-2 border-primary/30 animate-ping [animation-duration:2s]" />
          {/* Spinning arc */}
          <div className="absolute inset-0 border-4 border-t-primary border-r-primary/20 border-b-transparent border-l-transparent rounded-full animate-spin [animation-duration:0.9s]" />
          {/* Inner icon */}
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Zap className="w-4 h-4 text-primary" />
          </div>
        </div>

        <div className="text-center space-y-1.5">
          <h3 className="font-bold text-lg tracking-tight">AVS-TEK Catalog</h3>
          <p className="text-sm text-muted-foreground">
            Đang tải dữ liệu từ catalog và services...
          </p>
        </div>

        {/* Shimmer loading bar */}
        <div className="w-full h-1 bg-muted rounded-full overflow-hidden relative">
          <div className="nav-shimmer absolute top-0 bottom-0 left-0 w-[40%] bg-gradient-to-r from-transparent via-primary to-transparent rounded-full" />
        </div>

        {/* Skeleton lines */}
        <div className="w-full space-y-2">
          <div className="skeleton h-2 w-full rounded-full" />
          <div className="skeleton h-2 w-4/5 rounded-full" />
        </div>
      </div>
    </div>
  );
}
