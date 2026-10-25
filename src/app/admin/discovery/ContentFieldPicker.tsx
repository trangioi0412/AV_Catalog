"use client";

import React from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CONTENT_FIELDS } from "@/lib/utils/productCompleteness";
import { useContentFieldSelection } from "./contentFieldSelection";

interface ContentFieldPickerProps {
  /** Only offer fields queued Product_New rows actually have. */
  queueOnly?: boolean;
}

/** "Trường kiểm tra" dropdown: pick which fields count as required content. */
export function ContentFieldPicker({ queueOnly = false }: ContentFieldPickerProps) {
  const { selected, toggle, setAll, reset } = useContentFieldSelection();
  const fields = queueOnly ? CONTENT_FIELDS.filter((f) => f.inQueue) : CONTENT_FIELDS;
  const activeCount = fields.filter((f) => selected.includes(f.key)).length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="text-xs gap-1.5 flex-1 sm:flex-none">
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Trường kiểm tra ({activeCount}/{fields.length})
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs">Tính là thiếu nội dung khi trống:</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="max-h-72 overflow-y-auto py-1">
          {fields.map((f) => {
            const id = `content-field-${f.key}`;
            return (
              <label
                key={f.key}
                htmlFor={id}
                className="flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm cursor-pointer hover:bg-accent"
              >
                <Checkbox id={id} checked={selected.includes(f.key)} onCheckedChange={() => toggle(f.key)} />
                {f.label}
              </label>
            );
          })}
        </div>
        <DropdownMenuSeparator />
        <div className="flex gap-1 p-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 flex-1 text-xs"
            onClick={() => setAll(Array.from(new Set([...selected, ...fields.map((f) => f.key)])))}
          >
            Chọn hết
          </Button>
          <Button variant="ghost" size="sm" className="h-7 flex-1 text-xs" onClick={reset}>
            Mặc định
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
