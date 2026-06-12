"use client";

import React, { useCallback, useState, useRef } from "react";
import { Upload, File, X, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { parseFile } from "@/lib/utils/fileUtils";
import { useDataStore } from "@/store/useDataStore";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function FileUpload() {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [shouldParseSpecs, setShouldParseSpecs] = useState(true);
  const { setFileData, isLoading, setLoading } = useDataStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(extension || "")) {
      toast.error("Invalid file type. Please upload .xlsx, .xls, or .csv");
      return;
    }

    setLoading(true);
    setUploadProgress(10);

    try {
      // Simulate progress for large files
      const interval = setInterval(() => {
        setUploadProgress((prev) => (prev < 90 ? prev + 10 : prev));
      }, 200);

      const sheets = await parseFile(file, shouldParseSpecs);
      
      clearInterval(interval);
      setUploadProgress(100);

      setTimeout(() => {
        setFileData(file.name, extension as any, sheets);
        setLoading(false);
        setUploadProgress(0);
        toast.success(`Successfully loaded ${sheets.length} sheets from ${file.name}`);
      }, 500);

    } catch (error) {
      setLoading(false);
      setUploadProgress(0);
      toast.error("Failed to parse file. Please ensure it's a valid catalog.");
      console.error(error);
    }
  }, [setFileData, setLoading, shouldParseSpecs]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  return (
    <div className="w-full">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          "relative border-2 border-dashed rounded-2xl p-12 flex flex-col items-center justify-center transition-all duration-300 overflow-hidden",
          isDragging ? "border-primary bg-primary/5 scale-[1.01]" : "border-border hover:border-primary/40 hover:bg-muted/20",
          isLoading && "pointer-events-none opacity-60"
        )}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
      >
        {/* Subtle radial glow */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,oklch(0.51_0.22_263/6%)_0%,transparent_70%)] pointer-events-none" />
        <input
          type="file"
          id="file-upload"
          ref={fileInputRef}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
          accept=".xlsx,.xls,.csv"
        />

        <div className="w-20 h-20 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-6 shadow-inner">
          {isLoading ? (
            <Loader2 className="w-9 h-9 text-primary animate-spin" />
          ) : (
            <Upload className="w-9 h-9 text-primary" />
          )}
        </div>

        <h3 className="text-xl font-semibold mb-2">
          {isLoading ? "Processing catalog data..." : "Upload your product catalog"}
        </h3>
        <p className="text-muted-foreground text-center max-w-sm mb-8">
          Drag and drop your Excel or CSV file here. We'll automatically detect brands and technical specifications.
        </p>

        <div className="flex gap-4 items-center">
          <Button 
            variant="secondary" 
            className="gap-2 px-6 relative z-0"
            onClick={(e) => {
              e.stopPropagation();
              fileInputRef.current?.click();
            }}
          >
            <File className="w-4 h-4" />
            Browse Files
          </Button>
          <div className="text-xs text-muted-foreground">
            Supports: .xlsx, .xls, .csv
          </div>
        </div>

        {/* Toggle options */}
        <div className="flex items-center gap-2 mt-6 relative z-20 p-2.5 bg-card/60 backdrop-blur border border-primary/5 hover:border-primary/10 rounded-xl transition-all duration-300">
          <input
            type="checkbox"
            id="parse-specs-toggle"
            checked={shouldParseSpecs}
            onChange={(e) => setShouldParseSpecs(e.target.checked)}
            className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 accent-indigo-600 cursor-pointer"
            onClick={(e) => e.stopPropagation()} // Prevent triggering file browser input click on click label
          />
          <label 
            htmlFor="parse-specs-toggle" 
            className="text-xs text-muted-foreground select-none cursor-pointer font-medium"
            onClick={(e) => e.stopPropagation()} // Prevent triggering file browser input click on click label
          >
            Tự động phân tích thông số kỹ thuật (Auto-parse specs)
          </label>
        </div>

        <AnimatePresence>
          {uploadProgress > 0 && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="w-full max-w-md mt-10 space-y-2"
            >
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium">Uploading...</span>
                <span>{uploadProgress}%</span>
              </div>
              <Progress value={uploadProgress} className="h-2" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
        {[
          { icon: <CheckCircle2 className="w-4 h-4 text-emerald-500" />, title: "Auto-Detection", desc: "Labels & values extracted using AI-powered regex.", color: "border-l-emerald-400 bg-emerald-500/5" },
          { icon: <CheckCircle2 className="w-4 h-4 text-blue-500" />, title: "Multi-Sheet", desc: "Preserve original brand structures automatically.", color: "border-l-blue-400 bg-blue-500/5" },
          { icon: <AlertCircle className="w-4 h-4 text-primary" />, title: "Validation", desc: "Instant feedback on formatting and missing data.", color: "border-l-primary bg-primary/5" },
        ].map((feature, i) => (
          <div key={i} className={cn("p-4 rounded-xl border border-l-2 border-border/60 flex gap-3", feature.color)}>
            <div className="w-8 h-8 rounded-lg bg-background/80 border border-border/60 flex items-center justify-center shrink-0">
              {feature.icon}
            </div>
            <div>
              <h4 className="font-semibold text-sm">{feature.title}</h4>
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{feature.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
