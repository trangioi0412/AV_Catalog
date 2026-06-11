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
  Loader2
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


export default function DashboardPage() {
  const { 
    fileName, 
    sheets, 
    activeSheetIndex, 
    resetChanges, 
    setFileData 
  } = useDataStore();

  const [isUploadingToWix, setIsUploadingToWix] = React.useState(false);

  const handleUploadToWix = async () => {
    if (!sheets || sheets.length === 0 || !sheets[activeSheetIndex]) {
      toast.error("No product data loaded to upload.");
      return;
    }

    const activeSheet = sheets[activeSheetIndex];
    if (activeSheet.rows.length === 0) {
      toast.error("The active sheet has no products.");
      return;
    }

    setIsUploadingToWix(true);
    const uploadToastId = toast.loading(`Uploading ${activeSheet.rows.length} products to Wix Studio Import2...`);

    try {
      const result = await uploadCatalogToWixAction(activeSheet.rows);
      toast.dismiss(uploadToastId);
      if (result.success) {
        if (result.failedCount === 0) {
          toast.success(`Successfully uploaded all ${result.successCount} products to Wix Studio!`);
        } else {
          toast.warning(`Uploaded ${result.successCount} products successfully, but ${result.failedCount} failed. Check console for details.`);
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
        {/* Top Section */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">
                {fileName ? "Product Catalog Management" : "Welcome back, Admin"}
              </h1>
              <p className="text-muted-foreground mt-2">
                {fileName 
                  ? `Currently managing ${fileName}` 
                  : "Upload a catalog to start transforming product data."}
              </p>
            </div>

            {fileName && (
              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" className="gap-2" onClick={handleReset}>
                  <RefreshCcw className="w-4 h-4" />
                  Reset Changes
                </Button>
                <Button variant="outline" size="sm" className="gap-2 text-destructive border-destructive/20" onClick={handleClear}>
                  <Trash2 className="w-4 h-4" />
                  Clear Data
                </Button>
                
                <Button 
                  variant="default" 
                  size="sm" 
                  className="gap-2 shadow-lg shadow-indigo-500/20 bg-indigo-600 hover:bg-indigo-700 text-white" 
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
                    <Button variant="default" size="sm" className="gap-2 shadow-lg shadow-primary/20">
                      <Download className="w-4 h-4" />
                      Export Data
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

          <AnimatePresence mode="wait">
            {!fileName ? (
              <motion.div
                key="upload"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.4, ease: "circOut" }}
                className="py-12"
              >
                <FileUpload />
              </motion.div>
            ) : (
              <motion.div
                key="dashboard"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                transition={{ duration: 0.5, ease: "circOut" }}
                className="space-y-10"
              >
                <StatisticsDashboard />
                
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                        <FileCheck className="w-4 h-4 text-primary" />
                      </div>
                      <h2 className="text-xl font-bold">Catalog Data</h2>
                    </div>
                    <Button 
                      variant="default" 
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

        {/* Reset Confirmation Dialog */}
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

        {/* Clear Confirmation Dialog */}
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
      </DashboardLayout>
  );
}
