"use client";

import React from "react";
import { Bot, ScanSearch, ShieldCheck, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDataStore } from "@/store/useDataStore";
import { motion } from "framer-motion";
import type { AiReviewCategory } from "@/types";

const CATEGORY_META: Record<AiReviewCategory, { label: string; color: string }> = {
  category_mismatch: { label: "Category không khớp", color: "bg-rose-500" },
  series_mismatch: { label: "Series không khớp", color: "bg-pink-500" },
  missing_specs: { label: "Thông số thiếu/sơ sài", color: "bg-amber-500" },
  invalid_name: { label: "Tên sản phẩm lỗi", color: "bg-orange-500" },
  placeholder_data: { label: "Còn sót placeholder", color: "bg-yellow-500" },
  duplicate_content: { label: "Nội dung trùng lặp", color: "bg-highlight" },
  mixed_language: { label: "Lẫn Anh/Việt", color: "bg-cyan-500" },
  other: { label: "Khác", color: "bg-slate-500" },
};

const CATEGORY_ORDER: AiReviewCategory[] = [
  "category_mismatch",
  "series_mismatch",
  "missing_specs",
  "invalid_name",
  "placeholder_data",
  "duplicate_content",
  "mixed_language",
  "other",
];

export function AiReviewDashboard() {
  const { sheets } = useDataStore();

  const stats = React.useMemo(() => {
    let totalProducts = 0;
    let scannedCount = 0;
    let flaggedCount = 0;
    const categoryCounts: Record<AiReviewCategory, number> = {
      category_mismatch: 0,
      series_mismatch: 0,
      missing_specs: 0,
      invalid_name: 0,
      placeholder_data: 0,
      duplicate_content: 0,
      mixed_language: 0,
      other: 0,
    };

    sheets.forEach((sheet) => {
      sheet.rows.forEach((row) => {
        totalProducts++;
        if (row.aiReviewFindings === undefined) return;
        scannedCount++;
        if (row.aiReviewFindings.length === 0) return;
        flaggedCount++;
        // Count each category once per product, even if it appears in multiple
        // findings on the same row — this breakdown answers "how many products
        // have this kind of problem", not "how many times was it mentioned".
        const categoriesOnRow = new Set(row.aiReviewFindings.map((f) => f.category));
        categoriesOnRow.forEach((c) => categoryCounts[c]++);
      });
    });

    return { totalProducts, scannedCount, flaggedCount, cleanCount: scannedCount - flaggedCount, categoryCounts };
  }, [sheets]);

  if (stats.totalProducts === 0) return null;

  if (stats.scannedCount === 0) {
    return (
      <Card className="border-dashed border-highlight/30 bg-highlight/5">
        <CardContent className="py-6 flex items-center gap-3 text-sm text-muted-foreground">
          <Bot className="w-5 h-5 text-highlight shrink-0" />
          Chưa chạy AI Review — nhấn <span className="font-semibold text-foreground">&quot;Kiểm tra AI&quot;</span> ở trên để rà soát chất lượng dữ liệu cho {stats.totalProducts.toLocaleString()} sản phẩm.
        </CardContent>
      </Card>
    );
  }

  const scannedPct = ((stats.scannedCount / stats.totalProducts) * 100).toFixed(1);
  const flaggedPct = stats.scannedCount > 0 ? ((stats.flaggedCount / stats.scannedCount) * 100).toFixed(1) : "0";
  const cleanPct = stats.scannedCount > 0 ? ((stats.cleanCount / stats.scannedCount) * 100).toFixed(1) : "0";

  const cards = [
    {
      title: "Đã quét bằng AI",
      value: stats.scannedCount,
      icon: <ScanSearch className="w-5 h-5 text-highlight" />,
      color: "from-highlight/20 to-highlight/5",
      note: `${scannedPct}% trong ${stats.totalProducts.toLocaleString()} sản phẩm`,
    },
    {
      title: "Bị AI gắn cờ",
      value: stats.flaggedCount,
      icon: <AlertTriangle className="w-5 h-5 text-amber-500" />,
      color: "from-amber-500/20 to-amber-500/5",
      note: `${flaggedPct}% số đã quét`,
    },
    {
      title: "Sạch (không lỗi)",
      value: stats.cleanCount,
      icon: <ShieldCheck className="w-5 h-5 text-emerald-500" />,
      color: "from-emerald-500/20 to-emerald-500/5",
      note: `${cleanPct}% số đã quét`,
    },
  ];

  const activeCategories = CATEGORY_ORDER.filter((c) => stats.categoryCounts[c] > 0);
  const maxCategoryCount = Math.max(1, ...activeCategories.map((c) => stats.categoryCounts[c]));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {cards.map((item, i) => (
          <motion.div
            key={item.title}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="h-full card-hover"
          >
            <Card className="relative overflow-hidden border border-border/60 shadow-sm bg-card h-full flex flex-col">
              <div className={`absolute inset-0 bg-gradient-to-br ${item.color} opacity-60`} />
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
                <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {item.title}
                </CardTitle>
                <div className="p-1.5 bg-background/60 backdrop-blur-sm rounded-lg border border-border/40">
                  {item.icon}
                </div>
              </CardHeader>
              <CardContent className="relative z-10">
                <div className="text-3xl font-bold tracking-tight">{item.value.toLocaleString()}</div>
                <p className="text-xs font-medium text-muted-foreground mt-2">{item.note}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {activeCategories.length > 0 && (
        <Card className="border border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Phân loại vấn đề
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {activeCategories.map((category) => {
              const count = stats.categoryCounts[category];
              const meta = CATEGORY_META[category];
              const widthPct = (count / maxCategoryCount) * 100;
              return (
                <div key={category} className="flex items-center gap-3">
                  <span className="text-xs font-medium w-44 shrink-0 truncate">{meta.label}</span>
                  <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                    <div className={`h-full rounded-full ${meta.color}`} style={{ width: `${widthPct}%` }} />
                  </div>
                  <span className="text-xs font-semibold w-10 text-right shrink-0">{count}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
