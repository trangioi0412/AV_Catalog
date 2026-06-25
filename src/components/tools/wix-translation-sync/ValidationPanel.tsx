import React, { useMemo } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, AlertCircle, HelpCircle, FileX } from "lucide-react";
import { ValidationError } from "@/types/wix-translation-sync";

interface ValidationPanelProps {
  errors: ValidationError[];
  totalWixRows: number;
  hasProcessed: boolean;
}

export function ValidationPanel({ errors, totalWixRows, hasProcessed }: ValidationPanelProps) {
  const diagnostics = useMemo(() => {
    let parseErrors = 0;
    let missingIds = 0;
    let unsupportedFields = 0;
    let emptyValues = 0;
    let duplicateRecords = 0;

    errors.forEach((err) => {
      switch (err.type) {
        case "INVALID_JSON":
        case "PARSE_ERROR":
        case "PARSE_ERROR" as any:
          parseErrors++;
          break;
        case "MISSING_CONTENT_ID":
        case "MISSING_FIELD_ID":
        case "MISSING_CMS_RECORD":
          missingIds++;
          break;
        case "UNSUPPORTED_FIELD":
          unsupportedFields++;
          break;
        case "EMPTY_CMS_VALUE":
          emptyValues++;
          break;
        case "DUPLICATE_CMS_ID":
        case "DUPLICATE_WIX_RECORD":
        case "DUPLICATE_MAPPING":
          duplicateRecords++;
          break;
        default:
          break;
      }
    });

    const errorCount = parseErrors; // strictly block/critical errors
    const warningCount = missingIds + unsupportedFields + emptyValues + duplicateRecords;
    const validRowsCount = totalWixRows - errorCount - missingIds - unsupportedFields;

    return {
      parseErrors,
      missingIds,
      unsupportedFields,
      emptyValues,
      duplicateRecords,
      validRowsCount: Math.max(0, validRowsCount),
      warningCount,
      errorCount,
    };
  }, [errors, totalWixRows]);

  if (!hasProcessed) return null;

  const {
    parseErrors,
    missingIds,
    unsupportedFields,
    emptyValues,
    duplicateRecords,
    validRowsCount,
  } = diagnostics;

  const hasIssues = errors.length > 0;

  return (
    <Card className="border border-border/60 bg-card/60 backdrop-blur-md shadow-sm rounded-xl">
      <CardHeader className="pb-3 border-b border-border/40">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Báo cáo kiểm định File (Validation Report)
          </CardTitle>
          <Badge
            variant={hasIssues ? "outline" : "default"}
            className={
              hasIssues
                ? "bg-amber-500/10 text-amber-500 border-amber-500/20 text-[10px] px-2"
                : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px] px-2 hover:bg-emerald-500/10"
            }
          >
            {hasIssues ? `${errors.length} cảnh báo/lỗi` : "Hợp lệ"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
          {/* Valid Rows */}
          <div className="p-3 rounded-lg border bg-background/25 flex flex-col justify-between">
            <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Valid Rows</span>
            <div className="flex items-center gap-1.5 mt-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              <span className="text-base font-bold text-foreground">{validRowsCount}</span>
            </div>
          </div>

          {/* Parse Errors */}
          <div className="p-3 rounded-lg border bg-background/25 flex flex-col justify-between">
            <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Parse Errors</span>
            <div className="flex items-center gap-1.5 mt-2">
              <FileX className={parseErrors > 0 ? "w-4 h-4 text-red-500 shrink-0" : "w-4 h-4 text-muted-foreground opacity-40 shrink-0"} />
              <span className={parseErrors > 0 ? "text-base font-bold text-red-500" : "text-base font-bold text-foreground"}>
                {parseErrors}
              </span>
            </div>
          </div>

          {/* Missing IDs */}
          <div className="p-3 rounded-lg border bg-background/25 flex flex-col justify-between">
            <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Missing IDs</span>
            <div className="flex items-center gap-1.5 mt-2">
              <AlertCircle className={missingIds > 0 ? "w-4 h-4 text-amber-500 shrink-0" : "w-4 h-4 text-muted-foreground opacity-40 shrink-0"} />
              <span className={missingIds > 0 ? "text-base font-bold text-amber-500" : "text-base font-bold text-foreground"}>
                {missingIds}
              </span>
            </div>
          </div>

          {/* Unsupported Fields */}
          <div className="p-3 rounded-lg border bg-background/25 flex flex-col justify-between">
            <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Unsupported Fields</span>
            <div className="flex items-center gap-1.5 mt-2">
              <HelpCircle className={unsupportedFields > 0 ? "w-4 h-4 text-amber-500 shrink-0" : "w-4 h-4 text-muted-foreground opacity-40 shrink-0"} />
              <span className={unsupportedFields > 0 ? "text-base font-bold text-amber-500" : "text-base font-bold text-foreground"}>
                {unsupportedFields}
              </span>
            </div>
          </div>

          {/* Empty CMS Values */}
          <div className="p-3 rounded-lg border bg-background/25 flex flex-col justify-between">
            <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Empty CMS Values</span>
            <div className="flex items-center gap-1.5 mt-2">
              <AlertTriangle className={emptyValues > 0 ? "w-4 h-4 text-amber-500 shrink-0" : "w-4 h-4 text-muted-foreground opacity-40 shrink-0"} />
              <span className={emptyValues > 0 ? "text-base font-bold text-amber-500" : "text-base font-bold text-foreground"}>
                {emptyValues}
              </span>
            </div>
          </div>

          {/* Duplicate Records */}
          <div className="p-3 rounded-lg border bg-background/25 flex flex-col justify-between">
            <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">Duplicate Records</span>
            <div className="flex items-center gap-1.5 mt-2">
              <AlertTriangle className={duplicateRecords > 0 ? "w-4 h-4 text-amber-500 shrink-0" : "w-4 h-4 text-muted-foreground opacity-40 shrink-0"} />
              <span className={duplicateRecords > 0 ? "text-base font-bold text-amber-500" : "text-base font-bold text-foreground"}>
                {duplicateRecords}
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
