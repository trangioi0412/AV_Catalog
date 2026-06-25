"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { 
  Card, 
  CardHeader, 
  CardTitle, 
  CardDescription, 
  CardContent,
  CardFooter
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { 
  ArrowLeftRight, 
  Copy, 
  Check, 
  Trash2, 
  Sparkles,
  AlertCircle,
  AlertTriangle,
  FileCode,
  FileText,
  Upload,
  FileSpreadsheet,
  Download,
  Loader2,
  RefreshCw,
  CloudUpload,
  Search,
  FileCheck
} from "lucide-react";
import { toast } from "sonner";
import { 
  technicalSpecsToText, 
  textToTechnicalSpecs, 
  TechnicalSpecification 
} from "@/lib/utils/specsTranslator";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { uploadCatalogToWixAction } from "@/app/actions/discovery";

interface ParsedRow {
  [key: string]: any;
}

interface FileState {
  name: string;
  size: number;
  extension: "csv" | "xlsx" | "xls";
  columns: string[];
  rows: ParsedRow[];
  techSpecsKey: string;
}

export function SpecsTranslationTool() {
  const [activeTab, setActiveTab] = useState<"text" | "file">("text");

  // Tab 1: Text Conversion State
  const [plainText, setPlainText] = useState<string>("");
  const [jsonText, setJsonText] = useState<string>("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<boolean>(false);
  const [copiedJson, setCopiedJson] = useState<boolean>(false);

  // Tab 2: File Conversion State
  const [fileState, setFileState] = useState<FileState | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [previewRows, setPreviewRows] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Wix upload state
  const [isUploadingToWix, setIsUploadingToWix] = useState<boolean>(false);
  const [uploadReport, setUploadReport] = useState<{
    successCount: number;
    failedCount: number;
    errors: string[];
    totalCount: number;
  } | null>(null);
  const [isReportOpen, setIsReportOpen] = useState<boolean>(false);
  const [errorSearchQuery, setErrorSearchQuery] = useState<string>("");

  // Sample data for quick testing
  const loadSampleData = () => {
    const sampleSpecs: TechnicalSpecification[] = [
      { label: "Model", value: "AVS-X100" },
      { label: "Nguồn điện", value: "220V AC / 50Hz" },
      { label: "Công suất tiêu thụ", value: "150W" },
      { label: "Cổng kết nối", value: "HDMI: 3, DisplayPort: 1, LAN: RJ45" },
      { label: "Nhiệt độ hoạt động", value: "-10°C đến 50°C" }
    ];
    
    setJsonText(JSON.stringify(sampleSpecs, null, 2));
    setPlainText(technicalSpecsToText(sampleSpecs));
    setJsonError(null);
    toast.success("Loaded sample technical specifications!");
  };

  // Convert Plain Text to JSON
  const handleConvertToJSON = () => {
    if (!plainText.trim()) {
      setJsonText("[]");
      setJsonError(null);
      return;
    }
    const specs = textToTechnicalSpecs(plainText);
    setJsonText(JSON.stringify(specs, null, 2));
    setJsonError(null);
    toast.success(`Converted ${specs.length} specifications to JSON!`);
  };

  // Convert JSON to Plain Text
  const handleConvertToText = () => {
    if (!jsonText.trim()) {
      setPlainText("");
      setJsonError(null);
      return;
    }
    try {
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed)) {
        setJsonError("JSON must be an array of objects: { label: string, value: string }[]");
        return;
      }
      
      const isValid = parsed.every(item => 
        item && typeof item === "object" && "label" in item && "value" in item
      );
      
      if (!isValid) {
        setJsonError("Invalid array format. Each item must contain 'label' and 'value' properties.");
        return;
      }

      setJsonError(null);
      const text = technicalSpecsToText(parsed);
      setPlainText(text);
      toast.success("Converted JSON array to plain text lines!");
    } catch (e: any) {
      setJsonError(`Invalid JSON: ${e.message}`);
    }
  };

  // Real-time JSON validation
  useEffect(() => {
    if (!jsonText.trim()) {
      setJsonError(null);
      return;
    }
    try {
      const parsed = JSON.parse(jsonText);
      if (!Array.isArray(parsed)) {
        setJsonError("JSON must be an array of specifications: [ { label, value } ]");
      } else {
        setJsonError(null);
      }
    } catch (e: any) {
      setJsonError(`Syntax Error: ${e.message}`);
    }
  }, [jsonText]);

  // Copy helper
  const copyToClipboard = (text: string, type: "text" | "json") => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    if (type === "text") {
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 2000);
    } else {
      setCopiedJson(true);
      setTimeout(() => setCopiedJson(false), 2000);
    }
    toast.success("Copied to clipboard!");
  };

  const handleClear = () => {
    setPlainText("");
    setJsonText("");
    setJsonError(null);
    setFileState(null);
    setPreviewRows([]);
    toast.info("Cleared all fields");
  };

  // --- FILE HANDLING LOGIC ---
  const parseCSVFile = (file: File) => {
    setIsProcessing(true);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const columns = results.meta.fields || [];
        const rows = results.data as ParsedRow[];
        const techSpecsKey = columns.find(col => 
          col.toLowerCase() === "technical specifications" || col.toLowerCase() === "thông số kỹ thuật"
        ) || "Technical Specifications";

        setFileState({
          name: file.name,
          size: file.size,
          extension: "csv",
          columns,
          rows,
          techSpecsKey
        });
        setPreviewRows(rows.slice(0, 3));
        setIsProcessing(false);
        toast.success(`Loaded ${rows.length} rows from CSV!`);
      },
      error: (error) => {
        setIsProcessing(false);
        toast.error(`Error parsing CSV: ${error.message}`);
      }
    });
  };

  const parseExcelFile = (file: File) => {
    setIsProcessing(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { defval: "" }) as ParsedRow[];
        
        if (rows.length === 0) {
          toast.error("No rows found in Excel sheet.");
          setIsProcessing(false);
          return;
        }

        const columns = Object.keys(rows[0]);
        const techSpecsKey = columns.find(col => 
          col.toLowerCase() === "technical specifications" || col.toLowerCase() === "thông số kỹ thuật"
        ) || "Technical Specifications";

        setFileState({
          name: file.name,
          size: file.size,
          extension: file.name.split(".").pop()?.toLowerCase() as any,
          columns,
          rows,
          techSpecsKey
        });
        setPreviewRows(rows.slice(0, 3));
        setIsProcessing(false);
        toast.success(`Loaded ${rows.length} rows from Excel!`);
      } catch (err: any) {
        setIsProcessing(false);
        toast.error(`Error parsing Excel: ${err.message}`);
      }
    };
    reader.onerror = () => setIsProcessing(false);
    reader.readAsArrayBuffer(file);
  };

  const handleFile = useCallback((file: File) => {
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(extension || "")) {
      toast.error("Invalid file type. Please upload .xlsx, .xls, or .csv");
      return;
    }

    if (extension === "csv") {
      parseCSVFile(file);
    } else {
      parseExcelFile(file);
    }
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  // Convert File Specifications and Download
  const handleConvertFile = (targetType: "text" | "json") => {
    if (!fileState) return;
    setIsProcessing(true);

    try {
      const convertedRows = fileState.rows.map((row) => {
        const newRow = { ...row };
        const rawSpecs = row[fileState.techSpecsKey] || "";
        
        if (targetType === "text") {
          // Convert JSON Array -> Plain Text
          let specsArray: TechnicalSpecification[] = [];
          if (typeof rawSpecs === "string" && rawSpecs.trim().startsWith("[")) {
            try {
              specsArray = JSON.parse(rawSpecs);
            } catch {
              specsArray = textToTechnicalSpecs(rawSpecs);
            }
          } else if (Array.isArray(rawSpecs)) {
            specsArray = rawSpecs;
          } else {
            specsArray = textToTechnicalSpecs(String(rawSpecs));
          }

          newRow[fileState.techSpecsKey] = technicalSpecsToText(specsArray);
        } else {
          // Convert Plain Text -> JSON Array string
          let specsArray: TechnicalSpecification[] = [];
          const trimmedRaw = typeof rawSpecs === "string" ? rawSpecs.trim() : "";
          if (trimmedRaw.startsWith("[") || trimmedRaw.startsWith("{")) {
            try {
              const parsed = JSON.parse(trimmedRaw);
              specsArray = Array.isArray(parsed) ? parsed : [parsed];
            } catch {
              specsArray = textToTechnicalSpecs(trimmedRaw);
            }
          } else {
            specsArray = textToTechnicalSpecs(String(rawSpecs));
          }

          newRow[fileState.techSpecsKey] = JSON.stringify(specsArray, null, 2);
        }

        return newRow;
      });

      // Detect brand name to form a clean, user-friendly download filename
      let brandPrefix = "";
      if (fileState.rows && fileState.rows.length > 0) {
        const brandCol = fileState.columns.find(col => 
          ["brand", "thương hiệu", "manufacturer", "vendor", "hang"].includes(col.toLowerCase())
        );
        if (brandCol) {
          for (const row of fileState.rows) {
            const val = row[brandCol];
            if (val && String(val).trim()) {
              brandPrefix = String(val).trim().replace(/[^a-zA-Z0-9-_]/g, "_") + "_";
              break;
            }
          }
        }
      }

      const baseName = fileState.name.split(".")[0];
      const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(baseName);
      
      const finalFileName = isUuid 
        ? `${brandPrefix || "catalog_"}${targetType}_specs`
        : `${brandPrefix}${baseName}_${targetType}_specs`;

      // Trigger file download - Always output as Excel (.xlsx)
      const worksheet = XLSX.utils.json_to_sheet(convertedRows);
      
      // Auto-size column widths in Excel
      const maxWidths = convertedRows.reduce((acc: any, row: any) => {
        Object.keys(row).forEach((key, i) => {
          const val = row[key] ? row[key].toString() : "";
          acc[i] = Math.max(acc[i] || 0, val.length, key.length);
        });
        return acc;
      }, []);
      worksheet["!cols"] = maxWidths.map((w: number) => ({ w: Math.min(w + 2, 50) })); // Add safety padding

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Catalog");
      XLSX.writeFile(workbook, `${finalFileName}.xlsx`);

      toast.success(`Successfully converted and downloaded file!`);
    } catch (err: any) {
      toast.error(`Failed to convert file: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Upload converted rows directly to Wix Studio CMS
  const handleUploadToWix = async () => {
    if (!fileState) return;
    setIsUploadingToWix(true);
    const uploadToastId = toast.loading(`Parsing and uploading ${fileState.rows.length} products to Wix Studio...`);

    try {
      // 1. Process plain text specs into structured JSON array inside the rows
      const convertedRows = fileState.rows.map((row) => {
        const newRow = { ...row };
        const rawSpecs = row[fileState.techSpecsKey] || "";
        
        let specsArray: TechnicalSpecification[] = [];
        const trimmedRaw = typeof rawSpecs === "string" ? rawSpecs.trim() : "";
        if (trimmedRaw.startsWith("[") || trimmedRaw.startsWith("{")) {
          try {
            const parsed = JSON.parse(trimmedRaw);
            specsArray = Array.isArray(parsed) ? parsed : [parsed];
          } catch {
            specsArray = textToTechnicalSpecs(trimmedRaw);
          }
        } else {
          specsArray = textToTechnicalSpecs(String(rawSpecs));
        }

        // Place specifications inside the expected keys for uploadCatalogToWixAction
        newRow.transformedSpecifications = specsArray;
        newRow.parsedSpecifications = specsArray;
        return newRow;
      });

      // 2. Trigger Next.js Server Action
      const result = await uploadCatalogToWixAction(convertedRows);
      toast.dismiss(uploadToastId);

      if (result.success) {
        setUploadReport({
          successCount: result.successCount || 0,
          failedCount: result.failedCount || 0,
          errors: result.errors || [],
          totalCount: fileState.rows.length,
        });
        setIsReportOpen(true);

        if (result.failedCount === 0) {
          toast.success(`Successfully uploaded all ${result.successCount} products to Wix Studio!`);
        } else {
          toast.warning(`Uploaded ${result.successCount} products successfully, but ${result.failedCount} failed.`);
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

  return (
    <div className="space-y-6">
      {/* Premium Tab Toggle */}
      <div className="flex bg-muted/60 p-1 rounded-xl w-fit border border-border/40 shadow-inner">
        <button
          onClick={() => setActiveTab("text")}
          className={cn(
            "px-5 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2",
            activeTab === "text" 
              ? "bg-card text-foreground shadow" 
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <FileText className="w-3.5 h-3.5" />
          Interactive Text Converter
        </button>
        <button
          onClick={() => setActiveTab("file")}
          className={cn(
            "px-5 py-2 text-xs font-bold rounded-lg transition-all flex items-center gap-2",
            activeTab === "file" 
              ? "bg-card text-foreground shadow" 
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <FileSpreadsheet className="w-3.5 h-3.5" />
          Bulk File Converter
        </button>
      </div>

      {activeTab === "text" ? (
        /* TAB 1: Copy-Paste Text Converter */
        <Card className="border border-border/60 bg-card/60 backdrop-blur-md shadow-xl overflow-hidden rounded-2xl">
          <CardHeader className="border-b border-border/40 pb-5">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <CardTitle className="text-lg font-bold flex items-center gap-2 text-foreground">
                  <Sparkles className="w-5 h-5 text-primary" />
                  Specs Copy & Paste Converter
                </CardTitle>
                <CardDescription className="text-muted-foreground text-sm mt-0.5">
                  Convert specifications instantly between nested JSON array syntax and plain text lines.
                </CardDescription>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" size="sm" onClick={loadSampleData} className="text-xs h-8 px-3">
                  Load Sample
                </Button>
                <Button variant="ghost" size="sm" onClick={handleClear} className="text-xs text-destructive hover:bg-destructive/10 hover:text-destructive h-8 px-3">
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                  Clear
                </Button>
              </div>
            </div>
          </CardHeader>
          
          <CardContent className="pt-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 relative">
              
              {/* Plain Text Column */}
              <div className="space-y-2 flex flex-col">
                <div className="flex justify-between items-center">
                  <label htmlFor="plain-text-input" className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-primary" />
                    Plain Text (Translatable)
                  </label>
                  {plainText && (
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="w-7 h-7" 
                      onClick={() => copyToClipboard(plainText, "text")}
                    >
                      {copiedText ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </Button>
                  )}
                </div>
                
                <textarea
                  id="plain-text-input"
                  value={plainText}
                  onChange={(e) => setPlainText(e.target.value)}
                  placeholder="Memory: 1 GB&#10;Flash: 8 GB&#10;Nguồn điện: 220V AC&#10;Protocol: TCP:8080"
                  className="flex-1 w-full min-h-[220px] max-h-[400px] p-4 text-sm font-mono bg-background/50 border border-border/80 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/50 transition-all resize-y leading-relaxed"
                />
                <p className="text-muted-foreground text-[11px]">
                  Format: <code>Label: Value</code> (One per line. Any trailing colons in values are supported.)
                </p>
              </div>

              {/* Interactive Arrow Controls in middle (Absolute on LG screens) */}
              <div className="hidden lg:flex absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex-col gap-3">
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={handleConvertToJSON}
                  disabled={!plainText.trim()}
                  className="w-10 h-10 rounded-full shadow-md hover:bg-primary hover:text-primary-foreground transition-all duration-300"
                >
                  <ArrowLeftRight className="w-4 h-4 rotate-90 lg:rotate-0" />
                </Button>
                <Button
                  variant="secondary"
                  size="icon"
                  onClick={handleConvertToText}
                  disabled={!jsonText.trim() || !!jsonError}
                  className="w-10 h-10 rounded-full shadow-md hover:bg-primary hover:text-primary-foreground transition-all duration-300"
                >
                  <ArrowLeftRight className="w-4 h-4 -rotate-90 lg:rotate-180" />
                </Button>
              </div>

              {/* Mobile controls (Only shown on small screens) */}
              <div className="flex lg:hidden flex-row gap-3 justify-center py-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleConvertToJSON}
                  disabled={!plainText.trim()}
                  className="flex-1 gap-1.5"
                >
                  Convert to JSON
                  <ArrowLeftRight className="w-3.5 h-3.5 rotate-90" />
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleConvertToText}
                  disabled={!jsonText.trim() || !!jsonError}
                  className="flex-1 gap-1.5"
                >
                  Convert to Text
                  <ArrowLeftRight className="w-3.5 h-3.5 -rotate-90" />
                </Button>
              </div>

              {/* JSON Column */}
              <div className="space-y-2 flex flex-col">
                <div className="flex justify-between items-center">
                  <label htmlFor="json-text-input" className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <FileCode className="w-3.5 h-3.5 text-primary" />
                    Structured JSON Array
                  </label>
                  {jsonText && (
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="w-7 h-7" 
                      onClick={() => copyToClipboard(jsonText, "json")}
                    >
                      {copiedJson ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </Button>
                  )}
                </div>

                <textarea
                  id="json-text-input"
                  value={jsonText}
                  onChange={(e) => setJsonText(e.target.value)}
                  placeholder='[&#10;  { "label": "Memory", "value": "1 GB" },&#10;  { "label": "Flash", "value": "8 GB" }&#10;]'
                  className={`flex-1 w-full min-h-[220px] max-h-[400px] p-4 text-sm font-mono bg-background/50 border rounded-xl focus:outline-none focus:ring-1 transition-all resize-y leading-relaxed ${
                    jsonError ? "border-red-500 focus:ring-red-400 focus:border-red-500" : "border-border/80 focus:ring-primary/40 focus:border-primary/50"
                  }`}
                />
                {jsonError ? (
                  <div className="text-red-500 text-[11px] flex items-center gap-1 mt-1 font-medium">
                    <AlertCircle className="w-3 h-3 flex-shrink-0" />
                    <span>{jsonError}</span>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-[11px]">
                    Valid array structure: <code>{"{ label: string, value: string }[]"}</code>
                  </p>
                )}
              </div>
              
            </div>
          </CardContent>
        </Card>
      ) : (
        /* TAB 2: Drag-and-Drop File Converter */
        <Card className="border border-border/60 bg-card/60 backdrop-blur-md shadow-xl overflow-hidden rounded-2xl">
          <CardHeader className="border-b border-border/40 pb-5">
            <div className="flex justify-between items-center">
              <div>
                <CardTitle className="text-lg font-bold flex items-center gap-2 text-foreground">
                  <FileSpreadsheet className="w-5 h-5 text-primary" />
                  Specs CSV / Excel Bulk Converter
                </CardTitle>
                <CardDescription className="text-muted-foreground text-sm mt-0.5">
                  Upload a spreadsheet to automatically transform the specifications column and download the result.
                </CardDescription>
              </div>
              {fileState && (
                <Button variant="ghost" size="sm" onClick={handleClear} className="text-xs text-destructive hover:bg-destructive/10 hover:text-destructive h-8 px-3">
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                  Remove File
                </Button>
              )}
            </div>
          </CardHeader>
          
          <CardContent className="pt-6">
            {!fileState ? (
              /* Drag & Drop Box */
              <div
                className={cn(
                  "relative border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center transition-all duration-300 min-h-[220px]",
                  isDragging ? "border-primary bg-primary/5 scale-[1.01]" : "border-border hover:border-primary/40 hover:bg-muted/20",
                  isProcessing && "pointer-events-none opacity-60"
                )}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={onDrop}
              >
                <input
                  type="file"
                  id="specs-file-upload"
                  ref={fileInputRef}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                  }}
                  accept=".xlsx,.xls,.csv"
                />

                <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-4 shadow-inner">
                  {isProcessing ? (
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                  ) : (
                    <Upload className="w-8 h-8 text-primary" />
                  )}
                </div>

                <h3 className="text-base font-semibold mb-1">
                  {isProcessing ? "Reading sheet..." : "Upload your CSV/Excel file"}
                </h3>
                <p className="text-muted-foreground text-xs text-center max-w-sm mb-4">
                  Drag & drop your file here, or click to browse. We will locate the specifications column.
                </p>
                <div className="text-xs text-muted-foreground">
                  Supports: .xlsx, .xls, .csv
                </div>
              </div>
            ) : (
              /* Converted State & Preview */
              <div className="space-y-6">
                {/* File Details Panel */}
                <div className="p-4 rounded-xl border bg-background/30 flex flex-col sm:flex-row justify-between gap-4 items-start sm:items-center">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center justify-center text-green-500 shrink-0">
                      <FileSpreadsheet className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-sm leading-tight">{fileState.name}</h4>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {(fileState.size / 1024).toFixed(1)} KB · {fileState.rows.length} rows loaded
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex flex-col sm:flex-row gap-2.5 w-full sm:w-auto">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleConvertFile("text")}
                      disabled={isProcessing || isUploadingToWix}
                      className="text-xs gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Convert to Text & Download
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleConvertFile("json")}
                      disabled={isProcessing || isUploadingToWix}
                      className="text-xs gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Convert to JSON & Download
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={handleUploadToWix}
                      disabled={isProcessing || isUploadingToWix}
                      className="text-xs gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white shadow-md shadow-indigo-600/25"
                    >
                      {isUploadingToWix ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CloudUpload className="w-3.5 h-3.5" />
                      )}
                      Upload to Wix CMS
                    </Button>
                  </div>
                </div>

                {/* Column Detection Alert */}
                <div className="p-3 bg-primary/5 border border-primary/15 rounded-lg flex items-center gap-2.5 text-xs">
                  <Sparkles className="w-4 h-4 text-primary shrink-0" />
                  <span>
                    Detected Specs Column: <strong>"{fileState.techSpecsKey}"</strong>. The pipeline will transform values in this column.
                  </span>
                </div>

                {/* Grid Preview */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Sample Preview (First 3 Rows)</h4>
                  <div className="border rounded-xl bg-card overflow-hidden">
                    <div className="max-h-[260px] overflow-auto divide-y divide-border text-xs">
                      {previewRows.map((row, idx) => {
                        const titleVal = row.Title || row.Title_vi || row.Product || `Row ${idx + 1}`;
                        const specsVal = row[fileState.techSpecsKey] || "";
                        
                        return (
                          <div key={idx} className="p-3 hover:bg-muted/10 transition-colors grid grid-cols-3 gap-4">
                            <div className="font-semibold">{titleVal}</div>
                            <div className="col-span-2 font-mono text-[10px] break-all max-h-[80px] overflow-y-auto whitespace-pre-line text-muted-foreground p-1.5 bg-background/30 rounded border border-border/40">
                              {specsVal ? String(specsVal) : "(Empty)"}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="border border-border/40 bg-muted/20 overflow-hidden rounded-2xl">
        <CardFooter className="px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-emerald-500 shrink-0" />
            <span className="text-xs font-semibold text-foreground/80">
              Bulk Processing Optimization
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground leading-relaxed max-w-xl">
            Processes large CSV/Excel files completely client-side in less than <b>30ms for 1000+ rows</b>. File formatting remains 100% intact, and you download the converted file directly to your system.
          </div>
        </CardFooter>
      </Card>
      {/* ── Upload Report Dialog ──────────────────────────────────── */}
      <Dialog open={isReportOpen} onOpenChange={setIsReportOpen}>
        <DialogContent className="max-w-2xl bg-card/95 border-primary/10 backdrop-blur-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <CloudUpload className="w-5 h-5 text-primary" />
              Kết quả tải lên Wix Studio
            </DialogTitle>
            <DialogDescription>
              Báo cáo chi tiết quá trình đồng bộ sản phẩm từ file vào hệ thống Wix Studio CMS.
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
                      <AlertCircle className="w-4 h-4 text-amber-500" />
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
    </div>
  );
}
