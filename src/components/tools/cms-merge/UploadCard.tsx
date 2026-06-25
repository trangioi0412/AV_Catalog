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
    <Card className="border border-border/60 bg-card/60 backdrop-blur-md shadow-md hover:shadow-lg transition-all duration-300 rounded-xl flex flex-col h-full overflow-hidden">
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-bold text-foreground tracking-tight">{title}</CardTitle>
        <CardDescription className="text-xs text-muted-foreground leading-normal">{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-center p-5">
        {!file ? (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleCardClick}
            className={cn(
              "border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-300 min-h-[160px]",
              isDragging
                ? "border-primary bg-primary/5 scale-[1.01]"
                : "border-border/80 hover:border-primary/50 hover:bg-muted/10"
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
              <Loader2 className="w-9 h-9 text-primary animate-spin mb-3" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary/80 mb-3 group-hover:scale-110 transition-transform duration-300">
                <Upload className="w-5 h-5" />
              </div>
            )}
            <p className="text-xs font-semibold mb-1">
              {isLoading ? "Reading data file..." : "Drag & drop or click to upload CSV"}
            </p>
            <p className="text-[10px] text-muted-foreground/80 max-w-[200px] leading-relaxed">
              {helpText}
            </p>
          </div>
        ) : (
          <div className="border border-border/60 bg-background/30 rounded-xl p-4 flex flex-col justify-between h-full min-h-[160px] shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0 shadow-inner">
                  <FileSpreadsheet className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold text-foreground truncate max-w-[160px]" title={file.name}>
                    {file.name}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 font-medium">
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
                className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg shrink-0 transition-colors"
                title="Remove file"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>

            <div className="mt-4 pt-3 border-t border-border/40 flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-emerald-500">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Loaded {rowsCount.toLocaleString()} rows</span>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-3 p-3 rounded-lg bg-destructive/5 border border-destructive/15 flex items-start gap-2.5 text-[11px] text-destructive font-semibold leading-normal">
            <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
