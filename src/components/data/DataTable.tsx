"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { 
  Search, 
  Filter, 
  ArrowUpDown, 
  ChevronDown, 
  ChevronUp, 
  Edit3, 
  Trash2, 
  Download,
  Copy,
  Check,
  AlertCircle,
  MoreHorizontal,
  ChevronRight,
  Eye,
  Settings2,
  FileJson,
  Bot,
  Languages,
  GitCompare
} from "lucide-react";
import { exportSelectedToExcel } from "@/lib/utils/exportUtils";
import { AiFixReviewModal } from "./AiFixReviewModal";
import { TranslateMixedLanguageModal } from "./TranslateMixedLanguageModal";
import { CmsCompareModal } from "./CmsCompareModal";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDataStore, ALL_SHEETS_INDEX } from "@/store/useDataStore";
import { ProductRow, SheetData } from "@/types";
import { SpecEditor } from "./SpecEditor";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function isEmptyValue(val: any): boolean {
  if (val === null || val === undefined) return true;
  if (typeof val === "number" && isNaN(val)) return true;
  
  let str = String(val).trim().toLowerCase();
  // Strip surrounding quotes if any
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    str = str.slice(1, -1).trim();
  }

  const emptyStrings = new Set([
    "",
    "n/a",
    "n / a",
    "na",
    "null",
    "undefined",
    "-",
    "nan",
    "none",
    "nil",
    "#n/a",
    "#value!",
    "#ref!",
    "#num!",
    "#name?",
    "#div/0!",
    "#null!",
    "(blank)",
    "blank"
  ]);

  return emptyStrings.has(str);
}

function getColumnValue(row: any, col: string): any {
  const lowerCol = col.toLowerCase();
  if (lowerCol === "technical specifications" || lowerCol === "thông số kỹ thuật") {
    if (Array.isArray(row.transformedSpecifications)) {
      if (row.transformedSpecifications.length === 0) return "";
      return row.transformedSpecifications.map((s: any) => `${s.label}: ${s.value}`).join("\n");
    }
  }
  return row[col];
}

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
/** Sentinel page size meaning "show every filtered row on one page" — see the pageSize state below. */
const SHOW_ALL = -1;

export function DataTable() {
  const { sheets, activeSheetIndex, setActiveSheet, deleteProductRows, deleteRowsWithIssues, applyAiFix } = useDataStore();
  const isAllSheets = activeSheetIndex === ALL_SHEETS_INDEX;

  // When "All Products" is selected, present every sheet's rows combined so users
  // aren't limited to browsing one brand sheet (~30-40 rows) at a time out of the
  // full catalog (which can span hundreds of rows across many brand sheets).
  const activeSheet = useMemo<SheetData | undefined>(() => {
    if (!isAllSheets) return sheets[activeSheetIndex];
    if (sheets.length === 0) return undefined;
    return {
      sheetName: "All Products",
      brandName: "All Products",
      columns: Array.from(new Set(sheets.flatMap((s) => s.columns))),
      rows: sheets.flatMap((s) => s.rows),
    };
  }, [sheets, activeSheetIndex, isAllSheets]);

  // Row mutation actions (delete/edit spec) require the row's real (sheetIndex, rowIndex)
  // within its owning sheet — not its position in a filtered/sorted/paginated/combined
  // view. This map resolves that regardless of which mode is active.
  const rowLocationById = useMemo(() => {
    const map = new Map<string, { sheetIndex: number; rowIndex: number }>();
    sheets.forEach((sheet, sIdx) => {
      sheet.rows.forEach((row, rIdx) => {
        map.set(row.id, { sheetIndex: sIdx, rowIndex: rIdx });
      });
    });
    return map;
  }, [sheets]);

  const getRowById = (id: string): ProductRow | null => {
    const location = rowLocationById.get(id);
    if (!location) return null;
    return sheets[location.sheetIndex]?.rows[location.rowIndex] ?? null;
  };

  const [searchTerm, setSearchTerm] = useState("");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: "single" | "bulk" | "validationIssues" | "filtered"; rowId?: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "valid" | "warning" | "error" | "issues">("all");
  const [filterColumn, setFilterColumn] = useState<string>("all");
  const [dataTypeFilter, setDataTypeFilter] = useState<"all" | "number" | "text" | "empty">("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);
  const [aiFixTargetId, setAiFixTargetId] = useState<string | null>(null);
  const [translateTargetId, setTranslateTargetId] = useState<string | null>(null);
  const [cmsCompareTargetId, setCmsCompareTargetId] = useState<string | null>(null);

  const hasValidationIssues = useMemo(() => {
    if (!activeSheet) return false;
    return activeSheet.rows.some(
      row => row.validationState !== "valid" || row.parsingErrors.length > 0
    );
  }, [activeSheet]);

  const isFiltered = statusFilter !== "all" || searchTerm.trim() !== "" || filterColumn !== "all" || dataTypeFilter !== "all";

  const warningRowsCount = useMemo(() => {
    if (!activeSheet) return 0;
    return activeSheet.rows.filter(r => r.validationState === "warning").length;
  }, [activeSheet]);

  // Memoized filtered and sorted data
  const processedData = useMemo(() => {
    if (!activeSheet) return [];
    
    let filtered = [...activeSheet.rows];

    // 1. Apply status filter
    if (statusFilter === "valid") {
      filtered = filtered.filter(row => row.validationState === "valid" && (!row.parsingErrors || row.parsingErrors.length === 0));
    } else if (statusFilter === "warning") {
      filtered = filtered.filter(row => row.validationState === "warning");
    } else if (statusFilter === "error") {
      filtered = filtered.filter(row => row.validationState === "error");
    } else if (statusFilter === "issues") {
      filtered = filtered.filter(row => row.validationState === "error" || row.validationState === "warning" || (Array.isArray(row.parsingErrors) && row.parsingErrors.length > 0));
    }

    // 2. Apply Column & Data Type Filter
    if (dataTypeFilter !== "all") {
      filtered = filtered.filter(row => {
        if (filterColumn === "all") {
          // Check only visible columns to prevent optional/metadata columns from triggering false matches
          const visibleCols = activeSheet.columns.slice(0, 4);
          return visibleCols.some(col => {
            const val = getColumnValue(row, col);
            const isEmp = isEmptyValue(val);
            if (dataTypeFilter === "empty") {
              return isEmp;
            }
            if (isEmp) return false;

            const isNum = typeof val === "number" || (!isNaN(Number(val)) && String(val).trim() !== "");
            if (dataTypeFilter === "number") {
              return isNum;
            } else if (dataTypeFilter === "text") {
              return !isNum;
            }
            return true;
          });
        } else {
          const val = getColumnValue(row, filterColumn);
          const isEmp = isEmptyValue(val);
          if (dataTypeFilter === "empty") {
            return isEmp;
          }
          if (isEmp) return false;

          const isNum = typeof val === "number" || (!isNaN(Number(val)) && String(val).trim() !== "");
          if (dataTypeFilter === "number") {
            return isNum;
          } else if (dataTypeFilter === "text") {
            return !isNum;
          }
        }
        return true;
      });
    }

    // 3. Apply search term filter (scoped by column if selected)
    if (searchTerm) {
      const searchStr = searchTerm.toLowerCase();
      filtered = filtered.filter(row => {
        if (filterColumn === "all") {
          return activeSheet.columns.some(col => 
            String(getColumnValue(row, col) || "").toLowerCase().includes(searchStr)
          );
        } else {
          const val = getColumnValue(row, filterColumn);
          return String(val || "").toLowerCase().includes(searchStr);
        }
      });
    }

    if (sortConfig) {
      filtered.sort((a, b) => {
        const aVal = a[sortConfig.key];
        const bVal = b[sortConfig.key];
        if (aVal < bVal) return sortConfig.direction === "asc" ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === "asc" ? 1 : -1;
        return 0;
      });
    }

    return filtered;
  }, [activeSheet, searchTerm, statusFilter, filterColumn, dataTypeFilter, sortConfig]);

  // Reset to page 1 whenever filters (or the page size itself) change.
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter, filterColumn, dataTypeFilter, pageSize]);

  const isShowingAll = pageSize === SHOW_ALL;
  const totalPages = isShowingAll ? 1 : Math.max(1, Math.ceil(processedData.length / pageSize));
  const paginatedData = useMemo(() => {
    if (isShowingAll) return processedData;
    const start = (currentPage - 1) * pageSize;
    return processedData.slice(start, start + pageSize);
  }, [processedData, currentPage, pageSize, isShowingAll]);

  const toggleExpand = (id: string) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) newExpanded.delete(id);
    else newExpanded.add(id);
    setExpandedRows(newExpanded);
  };

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedRows);
    if (newSelected.has(id)) newSelected.delete(id);
    else newSelected.add(id);
    setSelectedRows(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedRows.size === processedData.length) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(processedData.map(r => r.id)));
    }
  };

  // Groups row ids by their owning sheet before deleting, since ids selected while
  // browsing "All Products" can span multiple sheets but deleteProductRows only
  // accepts a single sheetIndex at a time.
  const deleteRowIdsAcrossSheets = (ids: string[]) => {
    const idsBySheet = new Map<number, string[]>();
    ids.forEach((id) => {
      const sheetIndex = rowLocationById.get(id)?.sheetIndex ?? activeSheetIndex;
      if (!idsBySheet.has(sheetIndex)) idsBySheet.set(sheetIndex, []);
      idsBySheet.get(sheetIndex)!.push(id);
    });
    idsBySheet.forEach((sheetIds, sheetIndex) => deleteProductRows(sheetIndex, sheetIds));
  };

  const copyAsJson = (row: ProductRow) => {
    navigator.clipboard.writeText(JSON.stringify(row.transformedSpecifications, null, 2));
    toast.success("Copied specifications as JSON");
  };

  if (!activeSheet) return null;

  return (
    <div className="space-y-4">
      {/* Sheet / Brand switcher — always visible here regardless of sidebar/viewport,
          since the sidebar list is hidden below the md breakpoint. */}
      {sheets.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 p-1.5 rounded-xl border bg-muted/30">
          <button
            onClick={() => setActiveSheet(ALL_SHEETS_INDEX)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
              isAllSheets ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground"
            )}
          >
            All Products
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] px-1.5 py-0 h-4",
                isAllSheets ? "border-primary-foreground/30 text-primary-foreground" : ""
              )}
            >
              {sheets.reduce((acc, s) => acc + s.rows.length, 0)}
            </Badge>
          </button>
          {sheets.map((sheet, index) => (
            <button
              key={index}
              onClick={() => setActiveSheet(index)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                activeSheetIndex === index ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-background hover:text-foreground"
              )}
            >
              {sheet.brandName}
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] px-1.5 py-0 h-4",
                  activeSheetIndex === index ? "border-primary-foreground/30 text-primary-foreground" : ""
                )}
              >
                {sheet.rows.length}
              </Badge>
            </button>
          ))}
        </div>
      )}

      {/* Table Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
          <div className="relative w-full sm:w-72 shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Search products..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select 
            value={statusFilter} 
            onValueChange={(val: any) => setStatusFilter(val)}
          >
            <SelectTrigger size="sm" className="gap-2 border-border/80 h-8 shrink-0">
              <Filter className="w-3.5 h-3.5" />
              <SelectValue placeholder="Filter Status" />
            </SelectTrigger>
            <SelectContent position="popper" className="min-w-[160px]">
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="valid">Valid Only</SelectItem>
              <SelectItem value="warning">Warnings Only</SelectItem>
              <SelectItem value="error">Errors Only</SelectItem>
              <SelectItem value="issues">All Issues</SelectItem>
            </SelectContent>
          </Select>

          <Select 
            value={filterColumn} 
            onValueChange={(val: string) => setFilterColumn(val)}
          >
            <SelectTrigger size="sm" className="gap-2 border-border/80 h-8 max-w-[180px] shrink-0">
              <Settings2 className="w-3.5 h-3.5" />
              <SelectValue placeholder="Select Column" />
            </SelectTrigger>
            <SelectContent position="popper" className="min-w-[180px] max-h-[300px]">
              <SelectItem value="all">All Columns</SelectItem>
              {activeSheet.columns.map((col) => (
                <SelectItem key={col} value={col}>
                  {col}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select 
            value={dataTypeFilter} 
            onValueChange={(val: any) => setDataTypeFilter(val)}
          >
            <SelectTrigger size="sm" className="gap-2 border-border/80 h-8 shrink-0">
              <FileJson className="w-3.5 h-3.5" />
              <SelectValue placeholder="Data Type" />
            </SelectTrigger>
            <SelectContent position="popper" className="min-w-[140px]">
              <SelectItem value="all">Any Data Type</SelectItem>
              <SelectItem value="number">Numeric (Number)</SelectItem>
              <SelectItem value="text">Text (String)</SelectItem>
              <SelectItem value="empty">Empty / Blank</SelectItem>
            </SelectContent>
          </Select>

          {isFiltered && processedData.length > 0 && (
            <Button
              variant="destructive"
              size="sm"
              className="gap-2 h-8 shrink-0"
              onClick={() => setDeleteTarget({ type: "filtered" })}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete {processedData.length} Filtered Rows
            </Button>
          )}

          {!isFiltered && hasValidationIssues && (
            <Button
              variant="destructive"
              size="sm"
              className="gap-2 h-8 shrink-0"
              onClick={() => setDeleteTarget({ type: "validationIssues" })}
            >
              <AlertCircle className="w-4 h-4" />
              Clean Invalid Rows
            </Button>
          )}
          {selectedRows.size > 0 && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-1.5 bg-primary/5 pl-2.5 pr-1.5 py-0.5 rounded-lg border border-primary/20 h-8 shrink-0 shadow-sm"
            >
              <span className="text-[11px] font-semibold text-primary px-1">
                {selectedRows.size} selected
              </span>
              <Button 
                size="sm" 
                variant="destructive" 
                className="h-7 gap-1 text-[11px] px-2.5"
                onClick={() => setDeleteTarget({ type: "bulk" })}
              >
                <Trash2 className="w-3 h-3" />
                Delete
              </Button>
              <Button 
                size="sm" 
                variant="secondary" 
                className="h-7 gap-1 text-[11px] px-2.5"
                onClick={() => toast.info("Bulk edit feature coming soon")}
              >
                <Settings2 className="w-3 h-3" />
                Bulk Edit
              </Button>
            </motion.div>
          )}
        </div>
        
        <div className="flex flex-wrap items-center gap-2 shrink-0 justify-start lg:justify-end">
          {warningRowsCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-amber-500/20 text-amber-600 hover:bg-amber-500/5 dark:text-amber-500 dark:hover:bg-amber-500/10 h-8"
              onClick={() => {
                const warningData = activeSheet.rows.filter(r => r.validationState === "warning");
                exportSelectedToExcel(
                  warningData, 
                  `${activeSheet.brandName}_warnings`, 
                  `${useDataStore.getState().fileName?.split(".")[0] || "catalog"}_warnings`,
                  true
                );
                toast.success(`Exporting ${warningData.length} warning rows...`);
              }}
            >
              <AlertCircle className="w-4 h-4 text-amber-500" />
              Export Warnings ({warningRowsCount})
            </Button>
          )}

          <Button 
            variant="outline" 
            size="sm" 
            className="gap-2"
            onClick={() => {
              navigator.clipboard.writeText(JSON.stringify(processedData, null, 2));
              toast.success("Copied all table data to clipboard");
            }}
          >
            <Copy className="w-4 h-4" />
            Copy All
          </Button>
          <Button 
            variant="default" 
            size="sm" 
            className="gap-2"
            onClick={() => {
              if (selectedRows.size === 0) {
                toast.error("Please select rows to export");
                return;
              }
              const selectedData = activeSheet.rows.filter(r => selectedRows.has(r.id));
              exportSelectedToExcel(selectedData, activeSheet.brandName, useDataStore.getState().fileName || "catalog");
              toast.success(`Exporting ${selectedRows.size} rows...`);
            }}
          >
            <Download className="w-4 h-4" />
            Export Selected
          </Button>
        </div>
      </div>

      {/* Main Table */}
      <div className="border rounded-xl bg-card overflow-hidden shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50 border-b">
              <TableHead className="w-12 px-4">
                <Checkbox 
                  checked={selectedRows.size === processedData.length && processedData.length > 0}
                  onCheckedChange={toggleSelectAll}
                />
              </TableHead>
              <TableHead className="w-10"></TableHead>
              {/* Dynamically show first few columns */}
              {activeSheet.columns.slice(0, 4).map((col) => (
                <TableHead key={col} className="font-semibold text-xs uppercase tracking-wider">
                  <div className="flex items-center gap-2 group cursor-pointer" onClick={() => {
                    setSortConfig({ 
                      key: col, 
                      direction: sortConfig?.key === col && sortConfig.direction === "asc" ? "desc" : "asc" 
                    });
                  }}>
                    {col}
                    <ArrowUpDown className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </TableHead>
              ))}
              <TableHead className="font-semibold text-xs uppercase tracking-wider">Status</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <AnimatePresence>
              {paginatedData.map((row, index) => {
                const location = rowLocationById.get(row.id) ?? { sheetIndex: activeSheetIndex, rowIndex: index };
                return (
                <React.Fragment key={row.id}>
                  <TableRow 
                    className={cn(
                      "group transition-colors",
                      expandedRows.has(row.id) ? "bg-muted/30" : "hover:bg-muted/10",
                      row.isEdited && "bg-primary/[0.02]"
                    )}
                  >
                    <TableCell className="px-4">
                      <Checkbox 
                        checked={selectedRows.has(row.id)}
                        onCheckedChange={() => toggleSelect(row.id)}
                      />
                    </TableCell>
                    <TableCell>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8" 
                        onClick={() => toggleExpand(row.id)}
                      >
                        <ChevronRight className={cn("w-4 h-4 transition-transform duration-200", expandedRows.has(row.id) && "rotate-90")} />
                      </Button>
                    </TableCell>
                    
                    {/* Data Cells */}
                    {activeSheet.columns.slice(0, 4).map((col) => {
                      const isBrandCol = ["brand", "thương hiệu", "hang", "manufacturer", "vendor"].includes(col.toLowerCase());
                      const isModified = isBrandCol && row.originalValues && row[col] !== row.originalValues[col];

                      return (
                        <TableCell key={col} className="text-sm font-medium">
                          <div 
                            className={cn(
                              "truncate max-w-[200px] flex items-center gap-2",
                              isModified && "text-primary font-bold"
                            )} 
                            title={String(row[col])}
                          >
                            {isEmptyValue(row[col]) ? (
                              <span className="text-muted-foreground italic">N/A</span>
                            ) : (
                              String(row[col])
                            )}
                            {isModified && (
                              <Badge variant="outline" className="text-[8px] h-3.5 px-1 bg-primary/5 text-primary border-primary/20">
                                Mapped
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                      );
                    })}

                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px] px-1.5 py-0 h-5 capitalize font-medium",
                            row.validationState === "valid" && "status-valid",
                            row.validationState === "warning" && "status-warning",
                            row.validationState === "error" && "status-error"
                          )}
                        >
                          {row.validationState}
                        </Badge>
                        {row.isEdited && (
                          <Badge variant="outline" className="status-edited text-[10px] px-1.5 py-0 h-5">
                            Edited
                          </Badge>
                        )}
                        {(row.aiAppliedFixes?.length ?? 0) > 0 && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 border-violet-500/30 text-violet-600 dark:text-violet-400">
                            AI đã sửa ({row.aiAppliedFixes!.length})
                          </Badge>
                        )}
                      </div>
                    </TableCell>

                    <TableCell>
                      <div className="flex items-center gap-1">
                        {(() => {
                          const modelCode = row.Product || row.product || row.Title || "";
                          const slug = row.slug || String(modelCode).toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-_]/g, "");
                          return (
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 text-muted-foreground hover:text-primary transition-colors"
                              asChild
                              title="View Detail"
                            >
                              <Link href={`/products/${slug}`} target="_blank">
                                <Eye className="w-4 h-4" />
                              </Link>
                            </Button>
                          );
                        })()}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8">
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            {(() => {
                              const modelCode = row.Product || row.product || row.Title || "";
                              const slug = row.slug || String(modelCode).toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9-_]/g, "");
                              return (
                                <DropdownMenuItem asChild>
                                  <Link href={`/products/${slug}`} target="_blank" className="flex items-center">
                                    <Eye className="w-4 h-4 mr-2 text-primary" />
                                    View Product Detail
                                  </Link>
                                </DropdownMenuItem>
                              );
                            })()}
                            <DropdownMenuItem onClick={() => toggleExpand(row.id)}>
                              <Settings2 className="w-4 h-4 mr-2" />
                              View Specifications
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => copyAsJson(row)}>
                              <FileJson className="w-4 h-4 mr-2" />
                              Copy as JSON
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setAiFixTargetId(row.id)} className="text-violet-600 dark:text-violet-400">
                              <Bot className="w-4 h-4 mr-2" />
                              AI Sửa (tra cứu theo hãng)
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setTranslateTargetId(row.id)} className="text-cyan-600 dark:text-cyan-400">
                              <Languages className="w-4 h-4 mr-2" />
                              Dịch đồng nhất (lẫn Anh/Việt)
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setCmsCompareTargetId(row.id)} className="text-blue-600 dark:text-blue-400">
                              <GitCompare className="w-4 h-4 mr-2" />
                              So sánh với CMS
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setDeleteTarget({ type: "single", rowId: row.id })}
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Remove Row
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  </TableRow>

                  {/* Expandable Section */}
                  {expandedRows.has(row.id) && (
                    <TableRow className="bg-muted/20 border-b">
                      <TableCell colSpan={activeSheet.columns.slice(0, 4).length + 4} className="p-0">
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3, ease: "easeInOut" }}
                          className="overflow-hidden"
                        >
                          <div className="p-8 space-y-6">
                            <div className="flex items-center justify-between">
                              <h3 className="text-lg font-bold">Data Transformation</h3>
                              <div className="flex gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="gap-2 border-violet-500/30 text-violet-600 hover:bg-violet-500/10 dark:text-violet-400"
                                  onClick={() => setAiFixTargetId(row.id)}
                                >
                                  <Bot className="w-3.5 h-3.5" />
                                  AI Sửa
                                </Button>
                                <Button variant="outline" size="sm" className="gap-2" onClick={() => copyAsJson(row)}>
                                  <Copy className="w-3.5 h-3.5" />
                                  Copy JSON
                                </Button>
                              </div>
                            </div>
                            
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                              {/* Left side: Original raw data preview */}
                              <div className="space-y-4">
                                <Label className="text-xs uppercase tracking-widest text-muted-foreground font-bold">Raw Product Data</Label>
                                <div className="p-4 rounded-xl border bg-background/50 font-mono text-[11px] space-y-2 max-h-[400px] overflow-auto">
                                  {Object.entries(row).map(([key, val]) => {
                                    if (["id", "parsedSpecifications", "transformedSpecifications", "validationState", "parsingErrors", "isEdited", "originalValues", "lastModified", "aiReviewFindings", "aiFixSuggestion", "aiAppliedFixes"].includes(key)) return null;
                                    return (
                                      <div key={key} className="flex gap-4 border-b border-border/50 pb-1 last:border-0">
                                        <span className="text-primary/70 min-w-[120px] shrink-0">{key}:</span>
                                        <span className="text-foreground break-all">{String(val)}</span>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>

                              {/* Right side: Interactive Spec Editor */}
                              <div className="space-y-4">
                                <Label className="text-xs uppercase tracking-widest text-muted-foreground font-bold">Structured Specifications</Label>
                                <SpecEditor
                                  sheetIndex={location.sheetIndex}
                                  rowIndex={location.rowIndex}
                                  specifications={row.transformedSpecifications}
                                />
                                {row.parsingErrors.length > 0 && (
                                  <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-800 dark:text-amber-200 text-xs">
                                    <div className="flex items-center gap-2 font-bold mb-2">
                                      <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                                      Validation Warnings ({row.parsingErrors.length})
                                    </div>
                                    <div className="max-h-[160px] overflow-y-auto pr-1">
                                      <ul className="list-disc pl-5 space-y-1.5 break-all md:break-words">
                                        {row.parsingErrors.map((err, i) => (
                                          <li key={i}>
                                            <span className="font-semibold">{err.field}:</span> {err.message}
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  </div>
                                )}
                                {(row.aiAppliedFixes?.length ?? 0) > 0 && (
                                  <div className="p-4 rounded-lg bg-violet-50 dark:bg-violet-500/10 border border-violet-200 dark:border-violet-500/20 text-violet-800 dark:text-violet-200 text-xs">
                                    <div className="flex items-center gap-2 font-bold mb-2">
                                      <Bot className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                                      AI đã sửa ({row.aiAppliedFixes!.length} trường)
                                    </div>
                                    <div className="max-h-[200px] overflow-y-auto pr-1 space-y-2">
                                      {row.aiAppliedFixes!.map((fix, i) => (
                                        <div key={i} className="border-b border-violet-200/50 dark:border-violet-500/20 pb-1.5 last:border-0">
                                          <div className="font-semibold flex items-center gap-1.5">
                                            {fix.field}
                                            <span className="text-[9px] px-1 rounded bg-violet-500/15 font-normal">
                                              {fix.engine === "gemini" ? "Gemini" : fix.engine === "translation" ? "Dịch AI" : "qwen3.5:9b"}
                                            </span>
                                          </div>
                                          <div className="text-[10px] opacity-80 break-words">
                                            <span className="line-through opacity-60">{fix.oldValue || "(trống)"}</span>
                                            {" → "}
                                            <span>{fix.newValue || "(trống)"}</span>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
                );
              })}
            </AnimatePresence>
          </TableBody>
        </Table>
        
        {processedData.length === 0 && (
          <div className="py-20 flex flex-col items-center justify-center text-muted-foreground border-t border-dashed border-border">
            <div className="w-16 h-16 rounded-2xl bg-muted/50 border border-border/60 flex items-center justify-center mb-4">
              <Search className="w-7 h-7 opacity-30" />
            </div>
            <p className="text-base font-semibold">No results found</p>
            <p className="text-sm mt-1">Try adjusting your search or filters.</p>
          </div>
        )}
      </div>

      {/* Pagination */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-1">
        <p className="text-xs text-muted-foreground order-2 sm:order-1">
          {isShowingAll ? (
            <>Showing all <strong>{processedData.length}</strong> products</>
          ) : (
            <>
              Showing{" "}
              <strong>{Math.min((currentPage - 1) * pageSize + 1, processedData.length)}–{Math.min(currentPage * pageSize, processedData.length)}</strong>{" "}
              of <strong>{processedData.length}</strong> products
            </>
          )}
          {processedData.length !== activeSheet.rows.length && (
            <span className="ml-1 text-primary">(filtered from {activeSheet.rows.length})</span>
          )}
        </p>
        <div className="flex items-center gap-3 order-1 sm:order-2">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Hiển thị</span>
            <Select
              value={String(pageSize)}
              onValueChange={(val) => setPageSize(val === "all" ? SHOW_ALL : Number(val))}
            >
              <SelectTrigger size="sm" className="h-8 w-[90px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                ))}
                <SelectItem value="all">Tất cả</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {!isShowingAll && (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                  // Show pages around current page
                  let page: number;
                  if (totalPages <= 7) {
                    page = i + 1;
                  } else if (currentPage <= 4) {
                    page = i + 1;
                    if (i === 6) page = totalPages;
                  } else if (currentPage >= totalPages - 3) {
                    page = totalPages - 6 + i;
                  } else {
                    const offsets = [-3, -2, -1, 0, 1, 2, 3];
                    page = currentPage + offsets[i];
                  }
                  return (
                    <Button
                      key={page}
                      variant={currentPage === page ? "default" : "outline"}
                      size="sm"
                      className="h-8 w-8 p-0 text-xs"
                      onClick={() => setCurrentPage(page)}
                    >
                      {page}
                    </Button>
                  );
                })}
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              >
                Next
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget?.type === "validationIssues" 
                ? "Delete all invalid rows?" 
                : deleteTarget?.type === "filtered"
                ? `Delete all ${processedData.length} filtered rows?`
                : "Are you sure you want to delete?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.type === "single"
                ? "This action will permanently delete this row."
                : deleteTarget?.type === "validationIssues"
                ? `This action will permanently delete all rows containing validation errors or warnings${isAllSheets ? " across every sheet" : " from the active sheet"}.`
                : deleteTarget?.type === "filtered"
                ? `This action will permanently delete all ${processedData.length} rows currently matching your filters and search term${isAllSheets ? " across every sheet" : " from the active sheet"}.`
                : `This action will permanently delete ${selectedRows.size} selected rows${isAllSheets ? " across every sheet" : " from the active sheet"}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteTarget(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              variant="destructive"
              onClick={() => {
                if (deleteTarget?.type === "single" && deleteTarget.rowId) {
                  deleteRowIdsAcrossSheets([deleteTarget.rowId]);
                  toast.success("Row removed successfully");
                  const newSelected = new Set(selectedRows);
                  newSelected.delete(deleteTarget.rowId);
                  setSelectedRows(newSelected);
                } else if (deleteTarget?.type === "bulk") {
                  deleteRowIdsAcrossSheets(Array.from(selectedRows));
                  toast.success(`Deleted ${selectedRows.size} rows successfully`);
                  setSelectedRows(new Set());
                } else if (deleteTarget?.type === "validationIssues") {
                  if (isAllSheets) {
                    sheets.forEach((_, sIdx) => deleteRowsWithIssues(sIdx));
                  } else {
                    deleteRowsWithIssues(activeSheetIndex);
                  }
                  toast.success("Deleted all rows with validation issues");
                } else if (deleteTarget?.type === "filtered") {
                  deleteRowIdsAcrossSheets(processedData.map(row => row.id));
                  toast.success(`Deleted ${processedData.length} filtered rows successfully`);
                  setSelectedRows(new Set());
                }
                setDeleteTarget(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AI Fix Review — the row is re-read live from `sheets` (not a stashed copy) so
          the comparison always reflects the current data, even if it changed elsewhere. */}
      <AiFixReviewModal
        open={aiFixTargetId !== null}
        row={aiFixTargetId ? getRowById(aiFixTargetId) : null}
        columns={activeSheet.columns}
        onClose={() => setAiFixTargetId(null)}
        onApply={(updates, fieldChanges, engine) => {
          const location = aiFixTargetId ? rowLocationById.get(aiFixTargetId) : undefined;
          if (!location) return;
          applyAiFix(location.sheetIndex, location.rowIndex, updates, fieldChanges, engine);
        }}
      />

      <TranslateMixedLanguageModal
        open={translateTargetId !== null}
        row={translateTargetId ? getRowById(translateTargetId) : null}
        columns={activeSheet.columns}
        onClose={() => setTranslateTargetId(null)}
        onApply={(updates, fieldChanges) => {
          const location = translateTargetId ? rowLocationById.get(translateTargetId) : undefined;
          if (!location) return;
          applyAiFix(location.sheetIndex, location.rowIndex, updates, fieldChanges, "translation");
        }}
      />

      <CmsCompareModal
        open={cmsCompareTargetId !== null}
        row={cmsCompareTargetId ? getRowById(cmsCompareTargetId) : null}
        onClose={() => setCmsCompareTargetId(null)}
      />
    </div>
  );
}
