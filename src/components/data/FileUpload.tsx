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
      toast.error("Định dạng không hợp lệ. Vui lòng upload .xlsx, .xls, hoặc .csv");
      return;
    }

    setLoading(true);
    setUploadProgress(10);

    try {
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
        toast.success(`Đã tải thành công ${sheets.length} sheet từ ${file.name}`);
      }, 500);
    } catch (error) {
      setLoading(false);
      setUploadProgress(0);
      toast.error("Không thể phân tích file. Vui lòng kiểm tra định dạng catalog.");
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
    <div className="w-full space-y-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          "relative border-2 border-dashed rounded-2xl p-8 sm:p-12 flex flex-col items-center justify-center transition-all duration-300 overflow-hidden",
          isDragging ? "border-primary bg-primary/5 scale-[1.01]" : "border-border hover:border-primary/40 hover:bg-muted/20",
          isLoading && "pointer-events-none opacity-60"
        )}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
      >
        {/* Subtle radial glow */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,oklch(0.51_0.22_263/6%)_0%,transparent_70%)] pointer-events-none" />

        {/* Hidden native input covers drop zone */}
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
          aria-label="Upload product catalog file"
        />

        {/* Icon */}
        <motion.div
          animate={isDragging ? { scale: 1.1 } : { scale: 1 }}
          transition={{ type: "spring", stiffness: 300 }}
          className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-5 shadow-inner"
        >
          {isLoading ? (
            <Loader2 className="w-7 h-7 sm:w-9 sm:h-9 text-primary animate-spin" />
          ) : (
            <Upload className={cn("w-7 h-7 sm:w-9 sm:h-9 text-primary transition-transform", isDragging && "translate-y-1")} />
          )}
        </motion.div>

        <h3 className="text-lg sm:text-xl font-semibold mb-2 text-center">
          {isLoading ? "Đang xử lý dữ liệu catalog..." : "Tải lên file catalog sản phẩm"}
        </h3>
        <p className="text-muted-foreground text-sm text-center max-w-sm mb-6">
          Kéo thả file Excel hoặc CSV vào đây. Hệ thống tự động nhận diện thương hiệu và thông số kỹ thuật.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 items-center relative z-20">
          <Button
            variant="default"
            className="gap-2 px-6 shadow-sm shadow-primary/20"
            onClick={(e) => {
              e.stopPropagation();
              fileInputRef.current?.click();
            }}
          >
            <File className="w-4 h-4" />
            Chọn File
          </Button>
          <div className="text-xs text-muted-foreground">
            Hỗ trợ: .xlsx, .xls, .csv
          </div>
        </div>

        {/* Toggle: auto-parse specs */}
        <label
          htmlFor="parse-specs-toggle"
          className="flex items-center gap-2.5 mt-5 relative z-20 px-4 py-2.5 bg-card/60 backdrop-blur border border-primary/10 hover:border-primary/20 rounded-xl transition-all duration-300 cursor-pointer select-none"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            id="parse-specs-toggle"
            checked={shouldParseSpecs}
            onChange={(e) => setShouldParseSpecs(e.target.checked)}
            className="w-4 h-4 rounded border-border text-primary focus:ring-primary accent-primary cursor-pointer"
            onClick={(e) => e.stopPropagation()}
          />
          <span className="text-xs text-muted-foreground font-medium">
            Tự động phân tích thông số kỹ thuật
          </span>
        </label>

        {/* Progress bar */}
        <AnimatePresence>
          {uploadProgress > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="w-full max-w-md mt-8 space-y-1.5 relative z-20"
            >
              <div className="flex justify-between text-sm mb-1">
                <span className="font-medium">Đang tải lên...</span>
                <span className="text-muted-foreground">{uploadProgress}%</span>
              </div>
              <Progress value={uploadProgress} className="h-2" />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Feature cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          {
            icon: <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
            title: "Auto-Detection",
            desc: "Nhãn & giá trị trích xuất bằng AI regex engine.",
            color: "border-l-emerald-400 bg-emerald-500/5",
          },
          {
            icon: <CheckCircle2 className="w-4 h-4 text-primary" />,
            title: "Multi-Sheet",
            desc: "Giữ nguyên cấu trúc thương hiệu gốc tự động.",
            color: "border-l-primary/60 bg-primary/5",
          },
          {
            icon: <AlertCircle className="w-4 h-4 text-primary" />,
            title: "Validation",
            desc: "Phản hồi tức thì về định dạng và dữ liệu thiếu.",
            color: "border-l-primary bg-primary/5",
          },
        ].map((feature, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + i * 0.07 }}
          >
            <div
              className={cn(
                "p-4 rounded-xl border border-l-2 border-border/60 flex gap-3 h-full",
                feature.color
              )}
            >
              <div className="w-8 h-8 rounded-lg bg-background/80 border border-border/60 flex items-center justify-center shrink-0">
                {feature.icon}
              </div>
              <div>
                <h4 className="font-semibold text-sm">{feature.title}</h4>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{feature.desc}</p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
