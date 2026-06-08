"use client";

import React from "react";
import { 
  Plus, 
  Trash2, 
  GripVertical, 
  RefreshCcw, 
  Check,
  AlertCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Specification } from "@/types";
import { useDataStore } from "@/store/useDataStore";
import { motion, Reorder } from "framer-motion";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface SpecEditorProps {
  sheetIndex: number;
  rowIndex: number;
  specifications: Specification[];
}

export function SpecEditor({ sheetIndex, rowIndex, specifications }: SpecEditorProps) {
  const { 
    updateSpecification, 
    addSpecification, 
    deleteSpecification, 
    reorderSpecifications 
  } = useDataStore();

  const handleUpdate = (specIndex: number, field: keyof Specification, value: string) => {
    updateSpecification(sheetIndex, rowIndex, specIndex, { [field]: value });
  };

  return (
    <div className="space-y-4 p-6 bg-muted/30 rounded-xl border border-dashed">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h4 className="font-semibold text-sm">Specification Editor</h4>
          <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
            JSON Mode
          </span>
        </div>
        <Button 
          size="sm" 
          variant="outline" 
          className="h-8 gap-2 border-primary/20 text-primary hover:bg-primary/5"
          onClick={() => addSpecification(sheetIndex, rowIndex)}
        >
          <Plus className="w-3.5 h-3.5" />
          Add Specification
        </Button>
      </div>

      <Reorder.Group 
        axis="y" 
        values={specifications} 
        onReorder={(newSpecs) => reorderSpecifications(sheetIndex, rowIndex, newSpecs)}
        className="space-y-2"
      >
        {specifications.map((spec, index) => (
          <Reorder.Item 
            key={`${spec.label}-${index}`} 
            value={spec}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.05 }}
          >
            <div className="flex items-center gap-3 bg-card p-3 rounded-lg border shadow-sm group">
              <div className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground">
                <GripVertical className="w-4 h-4" />
              </div>
              
              <div className="grid grid-cols-12 gap-3 flex-1">
                <div className="col-span-4">
                  <Input 
                    value={spec.label} 
                    onChange={(e) => handleUpdate(index, "label", e.target.value)}
                    className="h-8 text-xs font-semibold bg-muted/20 border-none"
                    placeholder="Label (e.g. WiFi)"
                  />
                </div>
                <div className="col-span-8 flex gap-2">
                  <Input 
                    value={spec.value} 
                    onChange={(e) => handleUpdate(index, "value", e.target.value)}
                    className="h-8 text-xs bg-muted/20 border-none flex-1"
                    placeholder="Value (e.g. 802.11ax)"
                  />
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-8 w-8 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => deleteSpecification(sheetIndex, rowIndex, index)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          </Reorder.Item>
        ))}
      </Reorder.Group>

      {specifications.length === 0 && (
        <div className="py-8 flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed rounded-lg bg-card/50">
          <AlertCircle className="w-6 h-6 mb-2 opacity-20" />
          <p className="text-xs">No specifications found. Click "Add Specification" to begin.</p>
        </div>
      )}

      <div className="flex items-center gap-4 text-[10px] text-muted-foreground px-1">
        <div className="flex items-center gap-1">
          <Check className="w-3 h-3 text-green-500" />
          Changes tracked
        </div>
        <div className="flex items-center gap-1">
          <RefreshCcw className="w-3 h-3 text-blue-500" />
          Auto-saved to store
        </div>
      </div>
    </div>
  );
}
