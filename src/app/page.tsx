"use client";

import React from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { FileUpload } from "@/components/data/FileUpload";
import { DataTable } from "@/components/data/DataTable";
import { StatisticsDashboard } from "@/components/data/StatisticsDashboard";
import { useDataStore } from "@/store/useDataStore";
import { Button } from "@/components/ui/button";
import { 
  Download, 
  Trash2, 
  RefreshCcw, 
  FileCheck,
  PlusCircle,
  FileSpreadsheet,
  FileJson,
  FileCode,
  AlertTriangle,
  CloudUpload,
  Loader2,
  Search,
  Sparkles
} from "lucide-react";
import { uploadCatalogToWixAction } from "@/app/actions/discovery";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel
} from "@/components/ui/dropdown-menu";
import { exportToExcel, exportToCSV, exportToJSON, exportWarningsToExcel, exportValidToExcel } from "@/lib/utils/exportUtils";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";


export default function DashboardPage() {
  const { 
    fileName, 
    sheets, 
    activeSheetIndex, 
    resetChanges, 
    setFileData,
    convertSpecs
  } = useDataStore();

  const handleConvertSpecs = () => {
    convertSpecs();
    toast.success("Đã chuyển đổi thành công tất cả thông số kỹ thuật thô sang dạng cấu trúc mảng!");
  };

  const [isUploadingToWix, setIsUploadingToWix] = React.useState(false);
  const [uploadReport, setUploadReport] = React.useState<{
    successCount: number;
    failedCount: number;
    errors: string[];
    totalCount: number;
  } | null>(null);
  const [isReportOpen, setIsReportOpen] = React.useState(false);
  const [errorSearchQuery, setErrorSearchQuery] = React.useState("");

  const handleUploadToWix = async () => {
    if (!sheets || sheets.length === 0) {
      toast.error("No product data loaded to upload.");
      return;
    }

    const allProducts = sheets.flatMap((sheet) => sheet.rows);
    if (allProducts.length === 0) {
      toast.error("No products found across any sheet.");
      return;
    }

    setIsUploadingToWix(true);
    const uploadToastId = toast.loading(`Uploading all ${allProducts.length} products to Wix Studio Import1...`);

    try {
      const result = await uploadCatalogToWixAction(allProducts);
      toast.dismiss(uploadToastId);
      if (result.success) {
        setUploadReport({
          successCount: result.successCount || 0,
          failedCount: result.failedCount || 0,
          errors: result.errors || [],
          totalCount: allProducts.length,
        });
        setIsReportOpen(true);

        if (result.failedCount === 0) {
          toast.success(`Successfully uploaded all ${result.successCount} products to Wix Studio!`);
        } else {
          toast.warning(`Uploaded ${result.successCount} products successfully, but ${result.failedCount} failed.`);
          console.warn("Wix upload errors:", result.errors);
        }
      } else {
        toast.error(`Wix upload failed: ${result.error}`);
      }
    } catch (err: any) {
      toast.dismiss(uploadToastId);
      toast.error(`Error uploading to Wix: ${err.message || err}`);
    } finally {
      setIsUploadingToWix(false);
    }
  };

  // Log loaded product catalog and device data for admin inspection
  React.useEffect(() => {
    if (sheets && sheets.length > 0) {
      console.log("[Dashboard] Loaded sheets data:", sheets);
      console.log("[Dashboard] Active sheet rows (devices):", sheets[activeSheetIndex]?.rows || []);
    }
  }, [sheets, activeSheetIndex]);

  const [showResetDialog, setShowResetDialog] = React.useState(false);
  const [showClearDialog, setShowClearDialog] = React.useState(false);

  const totalWarningsCount = React.useMemo(() => {
    return sheets.reduce((acc, sheet) => {
      return acc + sheet.rows.filter(r => r.validationState === "warning").length;
    }, 0);
  }, [sheets]);

  const totalValidCount = React.useMemo(() => {
    return sheets.reduce((acc, sheet) => {
      return acc + sheet.rows.filter(r => r.validationState === "valid").length;
    }, 0);
  }, [sheets]);

  const handleExport = (type: "xlsx" | "csv" | "json" | "warnings" | "valid") => {
    if (!fileName) return;
    
    if (type === "xlsx") {
      exportToExcel(sheets, fileName);
    } else if (type === "csv") {
      exportToCSV(sheets[activeSheetIndex], fileName);
    } else if (type === "json") {
      exportToJSON(sheets, fileName);
    } else if (type === "warnings") {
      const success = exportWarningsToExcel(sheets, fileName);
      if (success) {
        toast.success("Exported all warning rows across all sheets!");
      } else {
        toast.error("No warning rows found to export.");
      }
    } else if (type === "valid") {
      const success = exportValidToExcel(sheets, fileName);
      if (success) {
        toast.success("Exported all valid rows across all sheets!");
      } else {
        toast.error("No valid rows found to export.");
      }
    }
  };

  const handleReset = () => {
    setShowResetDialog(true);
  };

  const handleClear = () => {
    setShowClearDialog(true);
  };

  return (
    <DashboardLayout>
      <div className="space-y-8 pb-20">

        {/* ── Top Section ─────────────────────────────────────────── */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {fileName ? "Product Catalog Management" : "Welcome, Admin"}
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                {fileName
                  ? `Managing · ${fileName}`
                  : "Upload a catalog file to start transforming and syncing product data."}
              </p>
            </div>

            {fileName && (
              <div className="flex flex-wrap items-center gap-2">
                {/* ── Secondary / utility actions ── */}
                <div className="flex items-center gap-1 p-1 bg-muted/60 rounded-lg border border-border/60">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-primary hover:bg-primary/10 hover:text-primary h-7 px-2.5"
                    onClick={handleConvertSpecs}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    Convert Specs
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 h-7 px-2.5"
                    onClick={handleReset}
                  >
                    <RefreshCcw className="w-3.5 h-3.5" />
                    Reset
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive h-7 px-2.5"
                    onClick={handleClear}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Clear
                  </Button>
                </div>

                {/* ── Primary actions ── */}
                <Button
                  variant="default"
                  size="sm"
                  className="gap-2 shadow-md shadow-primary/25"
                  onClick={handleUploadToWix}
                  disabled={isUploadingToWix}
                >
                  {isUploadingToWix ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CloudUpload className="w-4 h-4" />
                  )}
                  Upload to Wix
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-2">
                      <Download className="w-4 h-4" />
                      Export
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel>Export Formats</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => handleExport("xlsx")} className="gap-2">
                      <FileSpreadsheet className="w-4 h-4 text-green-600" />
                      Excel Workbook (.xlsx)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleExport("csv")} className="gap-2">
                      <FileCode className="w-4 h-4 text-blue-600" />
                      Comma Separated (.csv)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleExport("json")} className="gap-2">
                      <FileJson className="w-4 h-4 text-amber-600" />
                      JSON Data Structure (.json)
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => handleExport("warnings")}
                      className="gap-2"
                      disabled={totalWarningsCount === 0}
                    >
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                      All Warnings ({totalWarningsCount})
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleExport("valid")}
                      className="gap-2"
                      disabled={totalValidCount === 0}
                    >
                      <FileCheck className="w-4 h-4 text-green-600" />
                      All Valid Rows ({totalValidCount})
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
        </div>

        {/* ── Main Content ─────────────────────────────────────────── */}
        <AnimatePresence mode="wait">
          {!fileName ? (
            <motion.div
              key="upload"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.35, ease: "circOut" }}
              className="py-8"
            >
              <FileUpload />
            </motion.div>
          ) : (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.4, ease: "circOut" }}
              className="space-y-8"
            >
              <StatisticsDashboard />

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                      <FileCheck className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <h2 className="text-lg font-bold">Catalog Data</h2>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => toast.info("Add Product feature coming soon")}
                  >
                    <PlusCircle className="w-4 h-4" />
                    Add Product
                  </Button>
                </div>

                <DataTable />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Reset Confirmation Dialog ─────────────────────────────── */}
      <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset all changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to reset all changes? This will restore the catalog to its original uploaded state. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                resetChanges();
                setShowResetDialog(false);
                toast.success("All changes have been successfully reset!");
              }}
            >
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Clear Confirmation Dialog ─────────────────────────────── */}
      <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear catalog data?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to clear the current file and start over? All uploaded data and modifications will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setFileData("", "xlsx", []);
                setShowClearDialog(false);
                toast.success("Catalog data cleared successfully");
              }}
            >
              Clear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Upload Report Dialog ──────────────────────────────────── */}
      <Dialog open={isReportOpen} onOpenChange={setIsReportOpen}>
        <DialogContent className="max-w-2xl bg-card/95 border-primary/10 backdrop-blur-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <CloudUpload className="w-5 h-5 text-primary" />
              Kết quả tải lên Wix Studio
            </DialogTitle>
            <DialogDescription>
              Báo cáo chi tiết quá trình đồng bộ sản phẩm vào hệ thống Wix Studio CMS.
            </DialogDescription>
          </DialogHeader>

          {uploadReport && (
            <div className="space-y-6 mt-4">
              {/* Stats Grid */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 text-center">
                  <span className="text-xs text-primary/80 font-medium block mb-1">Tổng sản phẩm</span>
                  <strong className="text-2xl font-extrabold text-primary">
                    {uploadReport.totalCount}
                  </strong>
                </div>
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 text-center">
                  <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium block mb-1">Thành công</span>
                  <strong className="text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">
                    {uploadReport.successCount}
                  </strong>
                </div>
                <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-center">
                  <span className="text-xs text-red-500 font-medium block mb-1">Thất bại</span>
                  <strong className="text-2xl font-extrabold text-red-600 dark:text-red-400">
                    {uploadReport.failedCount}
                  </strong>
                </div>
              </div>

              {/* Success Alert */}
              {uploadReport.failedCount === 0 && (
                <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 rounded-xl p-4 flex items-center gap-3">
                  <FileCheck className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                  <span className="text-sm font-medium">
                    Tất cả sản phẩm đã được tải lên Wix Studio CMS thành công và không gặp lỗi nào!
                  </span>
                </div>
              )}

              {/* Errors List Section */}
              {uploadReport.failedCount > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                      Chi tiết sản phẩm bị lỗi ({uploadReport.failedCount})
                    </h3>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        navigator.clipboard.writeText(uploadReport.errors.join("\n"));
                        toast.success("Đã sao chép tất cả lỗi vào bộ nhớ tạm!");
                      }}
                      className="text-xs py-1 h-7"
                    >
                      Sao chép tất cả lỗi
                    </Button>
                  </div>

                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Tìm kiếm theo tên sản phẩm hoặc nội dung lỗi..."
                      value={errorSearchQuery}
                      onChange={(e) => setErrorSearchQuery(e.target.value)}
                      className="pl-10 bg-background/50 focus-visible:ring-primary/20 text-sm"
                    />
                  </div>

                  <div className="max-h-[280px] overflow-y-auto border border-red-500/10 rounded-xl bg-card text-xs divide-y divide-border">
                    {uploadReport.errors
                      .filter((err) =>
                        err.toLowerCase().includes(errorSearchQuery.toLowerCase())
                      )
                      .map((err, i) => {
                        const parts = err.split(" - ");
                        const productInfo = parts[0] || "Sản phẩm không xác định";
                        const errorMsg = parts.slice(1).join(" - ") || err;

                        return (
                          <div key={i} className="p-3 hover:bg-muted/10 transition-colors flex gap-3 items-start">
                            <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                            <div className="space-y-1">
                              <span className="font-bold text-foreground block">
                                {productInfo}
                              </span>
                              <span className="text-muted-foreground leading-relaxed">
                                {errorMsg}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    {uploadReport.errors.filter((err) =>
                      err.toLowerCase().includes(errorSearchQuery.toLowerCase())
                    ).length === 0 && (
                      <div className="p-4 text-center text-muted-foreground italic">
                        Không tìm thấy lỗi nào khớp với tìm kiếm.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="mt-6 border-t pt-4">
            <Button
              variant="default"
              onClick={() => setIsReportOpen(false)}
              className="w-full sm:w-auto"
            >
              Đóng báo cáo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
