"use client";

import React from "react";
import { 
  Building2, 
  Package, 
  Settings2, 
  AlertTriangle, 
  CheckCircle2,
  TrendingUp,
  Download,
  Trash2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDataStore } from "@/store/useDataStore";
import { motion, useSpring, useTransform } from "framer-motion";
import { toast } from "sonner";
import { exportWarningsToExcel, exportValidToExcel } from "@/lib/utils/exportUtils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ─── Count-up animated number ─────────────────────────────────────────────
function AnimatedNumber({ value }: { value: number }) {
  const spring = useSpring(0, { stiffness: 60, damping: 20 });
  const display = useTransform(spring, (v) => Math.round(v).toLocaleString());

  React.useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  return <motion.span>{display}</motion.span>;
}

// ─── Circular progress ring ───────────────────────────────────────────────
function RingProgress({
  value,
  max,
  color,
  size = 40,
  stroke = 4,
}: {
  value: number;
  max: number;
  color: string;
  size?: number;
  stroke?: number;
}) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="-rotate-90"
      aria-hidden
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        className="text-border/40"
        strokeWidth={stroke}
      />
      <motion.circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circ}
        initial={{ strokeDashoffset: circ }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 1, ease: "easeOut", delay: 0.2 }}
      />
    </svg>
  );
}

export function StatisticsDashboard() {
  const { stats, sheets, fileName, deleteRowsWithIssues } = useDataStore();
  const [showDeleteDialog, setShowDeleteDialog] = React.useState(false);

  const items = [
    {
      title: "Total Brands",
      value: stats.totalBrands,
      icon: <Building2 className="w-5 h-5 text-primary" />,
      color: "from-primary/20 to-primary/5",
      trend: "+2 this month",
      ring: null,
    },
    {
      title: "Total Products",
      value: stats.totalProducts,
      icon: <Package className="w-5 h-5 text-highlight" />,
      color: "from-highlight/20 to-highlight/5",
      trend: stats.totalProducts > 0 ? "Active catalog" : "No data",
      ring: null,
    },
    {
      title: "Valid Products",
      value: stats.validProducts,
      icon: <CheckCircle2 className="w-5 h-5 text-emerald-500" />,
      color: "from-emerald-500/20 to-emerald-500/5",
      trend: stats.totalProducts > 0
        ? `${((stats.validProducts / stats.totalProducts) * 100).toFixed(1)}% of total`
        : "No data",
      ring: { value: stats.validProducts, max: stats.totalProducts, color: "#10b981" },
    },
    {
      title: "Parsed Specifications",
      value: stats.totalSpecs,
      icon: <Settings2 className="w-5 h-5 text-primary" />,
      color: "from-primary/20 to-primary/5",
      trend: "98.2% accuracy",
      ring: null,
    },
    {
      title: "Validation Issues",
      value: stats.validationErrors,
      icon: <AlertTriangle className="w-5 h-5 text-amber-500" />,
      color: "from-amber-500/20 to-amber-500/5",
      trend: stats.validationErrors > 0 ? "Requires attention" : "Clean data",
      ring: stats.validationErrors > 0
        ? { value: stats.validationErrors, max: stats.totalProducts, color: "#f59e0b" }
        : null,
    },
  ];

  const handleDeleteIssues = () => {
    sheets.forEach((_, sIdx) => deleteRowsWithIssues(sIdx));
    toast.success("Đã xóa tất cả hàng có lỗi validation");
    setShowDeleteDialog(false);
  };

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        {items.map((item, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, duration: 0.4 }}
            className="h-full card-hover"
          >
            <Card className="relative overflow-hidden border border-border/60 shadow-sm bg-card h-full flex flex-col">
              {/* Background gradient */}
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
                {/* Value + optional ring */}
                <div className="flex items-center justify-between gap-2">
                  <div className="text-3xl font-bold tracking-tight">
                    <AnimatedNumber value={item.value} />
                  </div>
                  {item.ring && (
                    <RingProgress
                      value={item.ring.value}
                      max={item.ring.max}
                      color={item.ring.color}
                      size={44}
                      stroke={5}
                    />
                  )}
                </div>

                <div className="flex items-center justify-between mt-3 flex-wrap gap-2">
                  <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    {item.value > 0 && <TrendingUp className="w-3 h-3 text-emerald-500" />}
                    {item.trend}
                  </div>

                  {/* Valid Products → export button */}
                  {item.title === "Valid Products" && item.value > 0 && (
                    <Button
                      size="xs"
                      variant="outline"
                      className="h-6 text-xs px-2 py-0 border-emerald-500/25 text-emerald-700 hover:bg-emerald-500/5 dark:text-emerald-400 cursor-pointer gap-1 flex items-center"
                      onClick={async (e) => {
                        e.stopPropagation();
                        const success = await exportValidToExcel(sheets, fileName || "catalog");
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

                  {/* Validation Issues → export + delete */}
                  {item.title === "Validation Issues" && item.value > 0 && (
                    <div className="flex items-center gap-1">
                      <Button
                        size="xs"
                        variant="outline"
                        className="h-6 text-xs px-2 py-0 border-amber-500/25 text-amber-700 hover:bg-amber-500/5 dark:text-amber-400 cursor-pointer gap-1 flex items-center"
                        onClick={async (e) => {
                          e.stopPropagation();
                          const success = await exportWarningsToExcel(sheets, fileName || "catalog");
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
                        className="h-6 text-xs px-2 py-0 cursor-pointer gap-1 flex items-center"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowDeleteDialog(true);
                        }}
                      >
                        <Trash2 className="w-2.5 h-2.5" />
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

      {/* AlertDialog — replaces native confirm() */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xóa tất cả hàng có lỗi?</AlertDialogTitle>
            <AlertDialogDescription>
              Thao tác này sẽ xóa tất cả{" "}
              <span className="font-semibold text-foreground">
                {stats.validationErrors}
              </span>{" "}
              hàng có lỗi hoặc cảnh báo validation khỏi tất cả các sheet.
              Không thể hoàn tác.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Hủy</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteIssues}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Xóa tất cả
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
