"use client";

import React, { useRef } from "react";
import { Link, Hash, Info, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDataStore } from "@/store/useDataStore";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import { cn } from "@/lib/utils";

export function BrandMappingUpload() {
  const { setBrandMapping, applyBrandMapping, brandMapping, fileName } = useDataStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    const extension = file.name.split(".").pop()?.toLowerCase();

    reader.onload = (event) => {
      try {
        let data: any[] = [];
        
        if (extension === "xlsx" || extension === "xls") {
          const workbook = XLSX.read(event.target?.result, { type: "binary" });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          data = XLSX.utils.sheet_to_json(firstSheet);
        } else if (extension === "csv") {
          const results = Papa.parse(event.target?.result as string, { header: true });
          data = results.data;
        }

        if (data.length === 0) {
          toast.error("File is empty or invalid format");
          return;
        }

        // Detect columns: Look for something like "Name" and "ID"
        const columns = Object.keys(data[0]);
        const nameCol = columns.find(c => ["name", "tên", "brand name", "brand"].includes(c.toLowerCase()));
        const idCol = columns.find(c => ["id", "ID", "mã", "brand id", "brand_id"].includes(c)); // Explicitly check ID

        if (!nameCol || !idCol) {
          toast.error(`Could not find 'Name' and 'ID' columns. Found: ${columns.join(", ")}`);
          return;
        }

        const mapping: Record<string, string> = {};
        data.forEach(row => {
          if (row[nameCol] && row[idCol]) {
            // Store as lowercase for case-insensitive lookup
            mapping[String(row[nameCol]).trim().toLowerCase()] = String(row[idCol]).trim();
          }
        });

        setBrandMapping(mapping);
        toast.success(`Successfully loaded ${Object.keys(mapping).length} brand mappings`);
      } catch (err) {
        console.error(err);
        toast.error("Error parsing brand file");
      }
    };

    if (extension === "csv") {
      reader.readAsText(file);
    } else {
      reader.readAsBinaryString(file);
    }
  };

  return (
    <div className="p-4 rounded-2xl border border-white/10 bg-card/40 backdrop-blur-xl space-y-5 shadow-xl relative overflow-hidden group">
      {/* Background Glow */}
      <div className="absolute -right-4 -top-4 w-16 h-16 bg-primary/5 blur-2xl rounded-full group-hover:bg-primary/10 transition-colors" />
      
      <div className="flex items-center justify-between relative z-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/10 flex items-center justify-center border border-blue-500/20 shadow-inner">
            <Link className="w-4 h-4 text-blue-500" />
          </div>
          <div>
            <h3 className="text-[13px] font-bold tracking-tight">Brand ID Mapping</h3>
            <p className="text-[10px] text-muted-foreground/80 font-medium">Auto-replace names with IDs</p>
          </div>
        </div>
        
        {brandMapping ? (
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-emerald-500 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20 animate-in-fade">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            {Object.keys(brandMapping).length} IDs
          </div>
        ) : (
          <div className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-widest bg-muted/30 px-2 py-0.5 rounded-md">
            Ready
          </div>
        )}
      </div>

      <input 
        type="file" 
        ref={fileInputRef} 
        className="hidden" 
        accept=".xlsx,.xls,.csv"
        onChange={handleFileUpload}
      />

      <div className="grid grid-cols-1 gap-2.5 relative z-10">
        <Button 
          variant="outline" 
          size="sm" 
          className="w-full text-xs h-9 bg-background/50 border-white/5 hover:bg-white/5 hover:border-white/10 transition-all gap-2"
          onClick={() => fileInputRef.current?.click()}
        >
          <Hash className="w-3.5 h-3.5 text-blue-400" />
          Upload Brand Database
        </Button>
        
        <Button 
          variant="default" 
          size="sm" 
          className={cn(
            "w-full text-xs h-9 transition-all duration-500 shadow-lg shadow-primary/10",
            (!brandMapping || !fileName) ? "opacity-50 grayscale" : "hover:scale-[1.02] active:scale-[0.98]"
          )}
          disabled={!brandMapping || !fileName}
          onClick={() => {
            applyBrandMapping();
            toast.success("All Brand Names successfully replaced with IDs");
          }}
        >
          <Check className="w-3.5 h-3.5 mr-2" />
          Apply IDs to Catalog
        </Button>
      </div>

      {!fileName && (
        <p className="text-[9px] text-center text-muted-foreground/60 font-medium">
          Upload a catalog first to apply mappings
        </p>
      )}
    </div>
  );
}
