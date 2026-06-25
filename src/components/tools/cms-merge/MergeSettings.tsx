import React from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Settings, HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface MergeSettingsProps {
  overwriteExisting: boolean;
  onOverwriteChange: (checked: boolean) => void;
  exportMissingIds: boolean;
  onExportMissingChange: (checked: boolean) => void;
  outputFormat: "csv" | "xlsx";
  onFormatChange: (value: "csv" | "xlsx") => void;
  disabled?: boolean;
}

export function MergeSettings({
  overwriteExisting,
  onOverwriteChange,
  exportMissingIds,
  onExportMissingChange,
  outputFormat,
  onFormatChange,
  disabled = false,
}: MergeSettingsProps) {
  return (
    <Card className="border border-border/60 bg-card/60 backdrop-blur-md shadow-md rounded-xl">
      <CardHeader className="pb-4">
        <CardTitle className="text-base font-bold text-foreground flex items-center gap-2 tracking-tight">
          <Settings className="w-4 h-4 text-primary" />
          Merge Settings
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground">
          Configure how conflicting records and missing IDs are handled.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <TooltipProvider>
          {/* Overwrite Checkbox */}
          <div className="flex items-start space-x-3 rounded-lg border border-border/40 bg-background/20 p-3">
            <Checkbox
              id="overwriteExisting"
              checked={overwriteExisting}
              onCheckedChange={(checked) => onOverwriteChange(!!checked)}
              disabled={disabled}
              className="mt-0.5"
            />
            <div className="grid gap-1.5 leading-none">
              <div className="flex items-center gap-1.5">
                <Label
                  htmlFor="overwriteExisting"
                  className="text-xs font-bold leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                >
                  Overwrite Existing Values
                </Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="w-3.5 h-3.5 text-muted-foreground opacity-60 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="text-[10px] max-w-[200px]">
                    If enabled, values from the SEO file will replace existing data in the Products file. If disabled, only empty fields in Products are filled.
                  </TooltipContent>
                </Tooltip>
              </div>
              <p className="text-[10px] text-muted-foreground leading-normal">
                {overwriteExisting
                  ? "Always replace product values with SEO values."
                  : "Only fill in empty cells; do not replace existing values."}
              </p>
            </div>
          </div>

          {/* Export Missing IDs Checkbox */}
          <div className="flex items-start space-x-3 rounded-lg border border-border/40 bg-background/20 p-3">
            <Checkbox
              id="exportMissingIds"
              checked={exportMissingIds}
              onCheckedChange={(checked) => onExportMissingChange(!!checked)}
              disabled={disabled}
              className="mt-0.5"
            />
            <div className="grid gap-1.5 leading-none">
              <div className="flex items-center gap-1.5">
                <Label
                  htmlFor="exportMissingIds"
                  className="text-xs font-bold leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                >
                  Export Missing IDs List
                </Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="w-3.5 h-3.5 text-muted-foreground opacity-60 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="text-[10px] max-w-[200px]">
                    If enabled, a separate list of SEO IDs that were not found in the Products file will be made available for download.
                  </TooltipContent>
                </Tooltip>
              </div>
              <p className="text-[10px] text-muted-foreground leading-normal">
                Identify source records that don't match target rows.
              </p>
            </div>
          </div>

          {/* Output Format Select */}
          <div className="space-y-2">
            <Label className="text-xs font-bold flex items-center gap-1.5">
              Output Format
            </Label>
            <Select
              value={outputFormat}
              onValueChange={(val) => onFormatChange(val as "csv" | "xlsx")}
              disabled={disabled}
            >
              <SelectTrigger className="w-full text-xs h-9 bg-background/30 border-border/60">
                <SelectValue placeholder="Select output format" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="csv" className="text-xs">CSV (Comma-Separated Values)</SelectItem>
                <SelectItem value="xlsx" className="text-xs">Excel XLSX (Spreadsheet)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
}
