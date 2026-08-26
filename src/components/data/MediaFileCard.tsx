"use client";

import React from "react";
import { FileText, FileArchive, FileVideo, FileAudio, File as FileIcon, Box, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { cn, formatFileSize } from "@/lib/utils";
import type { MediaFileItem } from "@/types/media-manager";

const MEDIA_TYPE_ICON: Record<string, React.ElementType> = {
  DOCUMENT: FileText,
  ARCHIVE: FileArchive,
  VIDEO: FileVideo,
  AUDIO: FileAudio,
  MODEL3D: Box,
};

function formatDate(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("vi-VN", { year: "numeric", month: "2-digit", day: "2-digit" });
  } catch {
    return "—";
  }
}

interface MediaFileCardProps {
  file: MediaFileItem;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onDeleteSingle: (file: MediaFileItem) => void;
}

export function MediaFileCard({ file, selected, onToggleSelect, onDeleteSingle }: MediaFileCardProps) {
  const isImage = file.mediaType === "IMAGE" && file.thumbnailUrl;
  const Icon = MEDIA_TYPE_ICON[file.mediaType] || FileIcon;

  return (
    <div
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border bg-card ring-1 ring-foreground/10 transition-all",
        selected ? "border-primary ring-primary/40" : "border-transparent hover:ring-foreground/20"
      )}
    >
      {/* Checkbox */}
      <div className="absolute top-2 left-2 z-10">
        <Checkbox
          checked={selected}
          onCheckedChange={() => onToggleSelect(file.id)}
          aria-label={`Select ${file.displayName}`}
          className="bg-background/90 shadow-sm"
        />
      </div>

      {/* Per-file delete */}
      <div className="absolute top-2 right-2 z-10 opacity-0 transition-opacity group-hover:opacity-100">
        <Button
          variant="secondary"
          size="icon-sm"
          className="bg-background/90 shadow-sm text-destructive hover:bg-destructive/10"
          onClick={() => onDeleteSingle(file)}
          title="Xóa file này"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Thumbnail / icon */}
      <div className="flex aspect-square w-full items-center justify-center bg-muted/40">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={file.thumbnailUrl}
            alt={file.displayName}
            className="h-full w-full object-contain p-3"
            loading="lazy"
          />
        ) : (
          <Icon className="h-10 w-10 text-muted-foreground/60" />
        )}
      </div>

      {/* Meta */}
      <div className="flex flex-col gap-0.5 p-2.5">
        <p className="truncate text-xs font-medium" title={file.displayName}>
          {file.displayName}
        </p>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{formatFileSize(file.size)}</span>
          <span>{formatDate(file.createdDate)}</span>
        </div>
      </div>
    </div>
  );
}
