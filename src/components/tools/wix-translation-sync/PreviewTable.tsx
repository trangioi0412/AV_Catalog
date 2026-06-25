import React, { useState, useMemo } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MappingResult } from "@/types/wix-translation-sync";
import { Search, ChevronLeft, ChevronRight, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";

interface PreviewTableProps {
  mappingResults: MappingResult[];
}

export function PreviewTable({ mappingResults }: PreviewTableProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // 1. Show only first 100 rows in preview mode
  const previewLimitResults = useMemo(() => {
    return mappingResults.slice(0, 100);
  }, [mappingResults]);

  // 2. Apply search filter
  const filteredResults = useMemo(() => {
    if (!searchQuery.trim()) {
      return previewLimitResults;
    }
    const query = searchQuery.toLowerCase().trim();
    return previewLimitResults.filter(
      (item) =>
        item.contentId.toLowerCase().includes(query) ||
        item.fieldId.toLowerCase().includes(query) ||
        item.newValue.toLowerCase().includes(query) ||
        item.originalValue.toLowerCase().includes(query)
    );
  }, [previewLimitResults, searchQuery]);

  // Reset page when search changes
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  // 3. Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredResults.length / itemsPerPage));
  const paginatedResults = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredResults.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredResults, currentPage]);

  const truncate = (str: string, maxLen = 80) => {
    if (!str) return "(Empty)";
    if (str.length <= maxLen) return str;
    return str.slice(0, maxLen) + "...";
  };

  if (mappingResults.length === 0) return null;

  return (
    <Card className="border border-border/60 bg-card/60 backdrop-blur-md shadow-sm rounded-xl">
      <CardHeader className="pb-3 border-b border-border/40 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Bản xem trước dữ liệu (Preview Table - Top 100 Rows)
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground mt-0.5">
            Xem trước 100 dòng Wix Export đầu tiên sau khi đồng bộ với dữ liệu CMS.
          </CardDescription>
        </div>
        <div className="relative w-full sm:w-[260px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Tìm theo ID hoặc Tên Trường..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 text-xs h-9 font-medium"
          />
        </div>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        <div className="border rounded-xl bg-card overflow-hidden">
          <Table className="text-xs">
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="w-[80px] font-bold">Dòng</TableHead>
                <TableHead className="w-[180px] font-bold">Content ID</TableHead>
                <TableHead className="w-[180px] font-bold">Field ID</TableHead>
                <TableHead className="w-[100px] font-bold text-center">CMS Match</TableHead>
                <TableHead className="font-bold">Original Wix Value</TableHead>
                <TableHead className="font-bold">New Translation Value</TableHead>
                <TableHead className="w-[100px] font-bold text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedResults.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground font-medium italic">
                    Không tìm thấy bản ghi phù hợp.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedResults.map((item, idx) => (
                  <TableRow key={idx} className="hover:bg-muted/10">
                    <TableCell className="font-mono text-muted-foreground font-medium">
                      {item.rowNumber}
                    </TableCell>
                    <TableCell className="font-mono font-medium truncate max-w-[170px]" title={item.contentId}>
                      {item.contentId}
                    </TableCell>
                    <TableCell className="font-mono text-primary font-medium">
                      {item.fieldId}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        variant="outline"
                        className={
                          item.cmsMatch
                            ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px] px-1.5 py-0"
                            : "bg-red-500/10 text-red-500 border-red-500/20 text-[10px] px-1.5 py-0"
                        }
                      >
                        {item.cmsMatch ? "YES" : "NO"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground italic font-medium" title={item.originalValue}>
                      {truncate(item.originalValue)}
                    </TableCell>
                    <TableCell className="font-medium" title={item.newValue}>
                      {truncate(item.newValue)}
                    </TableCell>
                    <TableCell className="text-center">
                      {item.status === "success" && (
                        <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px] hover:bg-emerald-500/10 gap-1 px-1.5 py-0">
                          <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                          Success
                        </Badge>
                      )}
                      {item.status === "warning" && (
                        <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-[10px] gap-1 px-1.5 py-0">
                          <AlertTriangle className="w-3 h-3 text-amber-500" />
                          Warn
                        </Badge>
                      )}
                      {item.status === "error" && (
                        <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20 text-[10px] gap-1 px-1.5 py-0">
                          <XCircle className="w-3 h-3 text-red-500" />
                          Error
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination Controls */}
        <div className="flex items-center justify-between text-xs pt-1.5">
          <span className="text-muted-foreground font-medium">
            Hiển thị dòng <b>{(currentPage - 1) * itemsPerPage + 1}</b> đến <b>{Math.min(currentPage * itemsPerPage, filteredResults.length)}</b> trong số <b>{filteredResults.length}</b> dòng kết quả (giới hạn 100 dòng xem trước).
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="icon"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => p - 1)}
              className="w-8 h-8 rounded-lg"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="font-bold px-2 text-foreground">
              {currentPage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((p) => p + 1)}
              className="w-8 h-8 rounded-lg"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
