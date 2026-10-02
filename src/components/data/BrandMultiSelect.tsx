"use client";

import React, { useEffect, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { getActiveBrandsAction } from "@/app/actions/discovery";

interface BrandOption {
  _id: string;
  name: string;
}

/**
 * Multi-brand filter for product lists: a checkbox dropdown plus a row of
 * removable chips for the brands currently selected. An empty `value` means
 * "all brands".
 *
 * Without `options`, loads the CMS brand list itself and `value` holds brand
 * collection `_id`s (what products store in their `brand` reference field).
 * Pass `options` to filter data already in memory instead (e.g. by brand name,
 * with a product count in the label).
 */
export function BrandMultiSelect({
  value,
  onChange,
  options,
  className,
}: {
  value: string[];
  onChange: (brandIds: string[]) => void;
  options?: { value: string; label: string }[];
  className?: string;
}) {
  const [fetchedBrands, setBrands] = useState<BrandOption[]>([]);
  const hasOptions = Boolean(options);
  const brands: BrandOption[] = options ? options.map((o) => ({ _id: o.value, name: o.label })) : fetchedBrands;

  useEffect(() => {
    if (hasOptions) return;
    void getActiveBrandsAction().then((list) =>
      setBrands(
        list
          .map((b) => ({ _id: b._id, name: b.name }))
          .filter((b) => b._id && b.name)
          .sort((a, b) => a.name.localeCompare(b.name))
      )
    );
  }, [hasOptions]);

  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((b) => b !== id) : [...value, id]);
  const selected = brands.filter((b) => value.includes(b._id));
  const label = value.length === 0 ? "Lọc theo hãng (chọn nhiều)" : `Hãng: ${value.length} đã chọn`;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="w-full sm:w-56 justify-between font-normal">
            <span className="truncate">{label}</span>
            <ChevronDown className="w-4 h-4 opacity-50 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56 max-h-80 overflow-y-auto">
          <DropdownMenuItem disabled={value.length === 0} onSelect={() => onChange([])}>
            Bỏ chọn tất cả (hiện mọi hãng)
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {brands.map((b) => (
            <DropdownMenuCheckboxItem
              key={b._id}
              checked={value.includes(b._id)}
              onCheckedChange={() => toggle(b._id)}
              // Keep the menu open so several brands can be ticked in one go
              onSelect={(e) => e.preventDefault()}
            >
              {b.name}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {selected.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Đang lọc theo:</span>
          {selected.map((b) => (
            <Badge key={b._id} variant="secondary" className="gap-1 pr-1">
              {b.name}
              <button
                type="button"
                onClick={() => toggle(b._id)}
                className="rounded-sm opacity-60 hover:opacity-100"
                aria-label={`Bỏ lọc hãng ${b.name}`}
              >
                <X className="w-3 h-3" />
              </button>
            </Badge>
          ))}
          <button type="button" onClick={() => onChange([])} className="text-xs text-muted-foreground underline hover:text-foreground">
            Xoá bộ lọc hãng
          </button>
        </div>
      )}
    </div>
  );
}
