import React, { useRef, useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, Trash2, FileSpreadsheet, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface UploadCardProps {
  title: string;
  description: string;
  helpText: string;
  file: File | null;
  isLoading: boolean;
  error: string | null;
  rowsCount: number;
  onUpload: (file: File) => void;
  onRemove: () => void;
}

export function UploadCard({
  title,
  description,
  helpText,
  file,
  isLoading,
  error,
  rowsCount,
  onUpload,
  onRemove,
}: UploadCardProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      onUpload(droppedFile);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      onUpload(selectedFile);
    }
  };

  const handleCardClick = () => {
    if (!file && !isLoading) {
      fileInputRef.current?.click();
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const dm = 1;
    const sizes = ["Bytes", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
  };

  return (
    <Card className="border border-border/60 bg-card/60 backdrop-blur-md shadow-md transition-all hover:shadow-lg rounded-xl flex flex-col h-full">
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-bold text-foreground">{title}</CardTitle>
        <CardDescription className="text-xs text-muted-foreground">{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-center">
        {!file ? (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleCardClick}
            className={cn(
              "border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-all min-h-[160px]",
              isDragging
                ? "border-primary bg-primary/5 scale-[1.01]"
                : "border-border hover:border-primary/40 hover:bg-muted/10"
            )}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              accept=".csv"
              className="hidden"
            />
            {isLoading ? (
              <Loader2 className="w-8 h-8 text-primary animate-spin mb-3" />
            ) : (
              <Upload className="w-8 h-8 text-muted-foreground opacity-70 mb-3 group-hover:text-primary transition-colors" />
            )}
            <p className="text-xs font-semibold mb-1">
              {isLoading ? "Đang xử lý file..." : "Kéo & thả file hoặc click để tải lên"}
            </p>
            <p className="text-[10px] text-muted-foreground/80 max-w-[200px] leading-relaxed">
              {helpText}
            </p>
          </div>
        ) : (
          <div className="border border-border/60 bg-background/25 rounded-lg p-4 flex flex-col justify-between h-full min-h-[160px]">
            <div className="flex items-start justify-between gap-2.5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0 shadow-inner">
                  <FileSpreadsheet className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold truncate max-w-[170px]" title={file.name}>
                    {file.name}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {formatSize(file.size)}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
                className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md shrink-0"
                title="Xóa file"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>

            <div className="mt-4 pt-3 border-t border-border/40 flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 font-medium text-emerald-500">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Đã nạp {rowsCount} dòng</span>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-3 p-2.5 rounded-lg bg-destructive/5 border border-destructive/15 flex items-start gap-2 text-[11px] text-destructive font-medium leading-relaxed">
            <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
