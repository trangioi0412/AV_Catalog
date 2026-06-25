import React, { useState, useMemo } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ValidationError } from "@/types/wix-translation-sync";
import { ChevronLeft, ChevronRight, AlertTriangle, AlertCircle } from "lucide-react";

interface ErrorTableProps {
  errors: ValidationError[];
}

export function ErrorTable({ errors }: ErrorTableProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const totalPages = Math.max(1, Math.ceil(errors.length / itemsPerPage));
  const paginatedErrors = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return errors.slice(startIndex, startIndex + itemsPerPage);
  }, [errors, currentPage]);

  // Reset page when error count changes
  React.useEffect(() => {
    setCurrentPage(1);
  }, [errors.length]);

  if (errors.length === 0) return null;

  return (
    <Card className="border border-border/60 bg-card/60 backdrop-blur-md shadow-sm rounded-xl">
      <CardHeader className="pb-3 border-b border-border/40">
        <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Nhật ký cảnh báo & lỗi (Validation Log & Errors)
        </CardTitle>
        <CardDescription className="text-xs text-muted-foreground mt-0.5">
          Danh sách các dòng Wix bị lỗi phân tích cú pháp, thiếu bản ghi CMS tương ứng hoặc cảnh báo trường trống.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        <div className="border border-destructive/15 rounded-xl bg-card overflow-hidden">
          <Table className="text-xs">
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="w-[80px] font-bold">Dòng Wix</TableHead>
                <TableHead className="w-[180px] font-bold">Content ID</TableHead>
                <TableHead className="w-[180px] font-bold">Field ID</TableHead>
                <TableHead className="w-[100px] font-bold text-center">Mức độ</TableHead>
                <TableHead className="w-[180px] font-bold">Mã lỗi</TableHead>
                <TableHead className="font-bold">Chi tiết lỗi/Cảnh báo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedErrors.map((err, idx) => (
                <TableRow key={idx} className="hover:bg-muted/10">
                  <TableCell className="font-mono text-muted-foreground font-medium">
                    {err.rowNumber}
                  </TableCell>
                  <TableCell className="font-mono font-medium truncate max-w-[170px]" title={err.contentId}>
                    {err.contentId || "(Trống)"}
                  </TableCell>
                  <TableCell className="font-mono text-primary font-medium">
                    {err.fieldId || "(Trống)"}
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge
                      variant="outline"
                      className={
                        err.severity === "error"
                          ? "bg-red-500/10 text-red-500 border-red-500/20 text-[10px] px-1.5 py-0 hover:bg-red-500/10"
                          : "bg-amber-500/10 text-amber-500 border-amber-500/20 text-[10px] px-1.5 py-0 hover:bg-amber-500/10"
                      }
                    >
                      {err.severity === "error" ? "Error" : "Warning"}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono font-bold text-[10px] text-muted-foreground">
                    {err.type}
                  </TableCell>
                  <TableCell className="font-medium text-foreground flex items-center gap-1.5 py-3">
                    {err.severity === "error" ? (
                      <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    )}
                    <span>{err.details}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Pagination Controls */}
        <div className="flex items-center justify-between text-xs pt-1.5">
          <span className="text-muted-foreground font-medium">
            Hiển thị dòng <b>{(currentPage - 1) * itemsPerPage + 1}</b> đến <b>{Math.min(currentPage * itemsPerPage, errors.length)}</b> trong tổng số <b>{errors.length}</b> dòng nhật ký.
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
