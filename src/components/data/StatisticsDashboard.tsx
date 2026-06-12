"use client";

import React from "react";
import { 
  Building2, 
  Package, 
  Settings2, 
  AlertTriangle, 
  CheckCircle2,
  TrendingUp,
  Download
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDataStore } from "@/store/useDataStore";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { exportWarningsToExcel, exportValidToExcel } from "@/lib/utils/exportUtils";

export function StatisticsDashboard() {
  const { stats, sheets, fileName, activeSheetIndex, deleteRowsWithIssues } = useDataStore();

  const items = [
    {
      title: "Total Brands",
      value: stats.totalBrands,
      icon: <Building2 className="w-5 h-5 text-blue-500" />,
      color: "from-blue-500/20 to-blue-500/5",
      trend: "+2 this month"
    },
    {
      title: "Total Products",
      value: stats.totalProducts,
      icon: <Package className="w-5 h-5 text-purple-500" />,
      color: "from-purple-500/20 to-purple-500/5",
      trend: `${stats.totalProducts > 0 ? "Active catalog" : "No data"}`
    },
    {
      title: "Valid Products",
      value: stats.validProducts,
      icon: <CheckCircle2 className="w-5 h-5 text-green-500" />,
      color: "from-green-500/20 to-green-500/5",
      trend: stats.totalProducts > 0 
        ? `${((stats.validProducts / stats.totalProducts) * 100).toFixed(1)}% of total` 
        : "No data"
    },
    {
      title: "Parsed Specifications",
      value: stats.totalSpecs,
      icon: <Settings2 className="w-5 h-5 text-primary" />,
      color: "from-primary/20 to-primary/5",
      trend: "98.2% accuracy"
    },
    {
      title: "Validation Issues",
      value: stats.validationErrors,
      icon: <AlertTriangle className="w-5 h-5 text-amber-500" />,
      color: "from-amber-500/20 to-amber-500/5",
      trend: stats.validationErrors > 0 ? "Requires attention" : "Clean data"
    }
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
      {items.map((item, i) => (
        <motion.div
          key={i}
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
            <CardContent className="relative z-10 flex-grow flex flex-col justify-between pb-5">
              <div className="text-3xl font-bold tracking-tight">{item.value.toLocaleString()}</div>
              <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
                <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  {item.value > 0 && <TrendingUp className="w-3 h-3 text-emerald-500" />}
                  {item.trend}
                </div>
                {item.title === "Valid Products" && item.value > 0 && (
                  <Button
                    size="xs"
                    variant="outline"
                    className="h-6 text-[10px] px-2 py-0 border-emerald-500/25 text-emerald-700 hover:bg-emerald-500/5 dark:text-emerald-400 cursor-pointer gap-1 flex items-center"
                    onClick={(e) => {
                      e.stopPropagation();
                      const success = exportValidToExcel(sheets, fileName || "catalog");
                      if (success) {
                        toast.success("Exported all valid rows across all sheets!");
                      } else {
                        toast.error("No valid rows found to export.");
                      }
                    }}
                  >
                    <Download className="w-2.5 h-2.5" />
                    Download Valid
                  </Button>
                )}
                {item.title === "Validation Issues" && item.value > 0 && (
                  <div className="flex items-center gap-1">
                    <Button
                      size="xs"
                      variant="outline"
                      className="h-6 text-[10px] px-2 py-0 border-amber-500/25 text-amber-700 hover:bg-amber-500/5 dark:text-amber-400 cursor-pointer gap-1 flex items-center"
                      onClick={(e) => {
                        e.stopPropagation();
                        const success = exportWarningsToExcel(sheets, fileName || "catalog");
                        if (success) {
                          toast.success("Exported all warning rows across all sheets!");
                        } else {
                          toast.error("No warning rows found to export.");
                        }
                      }}
                    >
                      <Download className="w-2.5 h-2.5" />
                      Warnings
                    </Button>
                    <Button
                      size="xs"
                      variant="destructive"
                      className="h-6 text-[10px] px-2 py-0 cursor-pointer"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`Delete all rows containing validation errors or warnings from the active sheet?`)) {
                          deleteRowsWithIssues(activeSheetIndex);
                          toast.success("Deleted all rows with validation issues");
                        }
                      }}
                    >
                      Clean All
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}
