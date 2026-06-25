import React, { useState, useMemo, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ProductRecord } from "@/types/ProductRecord";
import { Search, ChevronLeft, ChevronRight, CheckCircle2, RefreshCw, Minus } from "lucide-react";

interface PreviewTableProps {
  mergedRecords: ProductRecord[];
}

export function PreviewTable({ mergedRecords }: PreviewTableProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // 1. Take top 100 rows for preview
  const previewLimitResults = useMemo(() => {
    return mergedRecords.slice(0, 100);
  }, [mergedRecords]);

  // 2. Filter records based on search query
  const filteredResults = useMemo(() => {
    if (!searchQuery.trim()) {
      return previewLimitResults;
    }
    const query = searchQuery.toLowerCase().trim();
    return previewLimitResults.filter((record) => {
      const id = (record.ID || "").toString().toLowerCase();
      const metaTitle = (record.metaTitle || "").toString().toLowerCase();
      const metaDescription = (record.metaDescription || "").toString().toLowerCase();
      const faq = (record.faq || "").toString().toLowerCase();
      return (
        id.includes(query) ||
        metaTitle.includes(query) ||
        metaDescription.includes(query) ||
        faq.includes(query)
      );
    });
  }, [previewLimitResults, searchQuery]);

  // Reset pagination on search change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  // 3. Paginate results
  const totalPages = Math.max(1, Math.ceil(filteredResults.length / itemsPerPage));
  const paginatedResults = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return filteredResults.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredResults, currentPage]);

  const truncate = (str: string | undefined, maxLen = 60) => {
    if (!str) return <span className="text-muted-foreground/45 italic">(Empty)</span>;
    const cleanStr = str.toString().replace(/[\n\r]+/g, " "); // Flatten multiline just for table view
    if (cleanStr.length <= maxLen) return cleanStr;
    return cleanStr.slice(0, maxLen) + "...";
  };

  if (mergedRecords.length === 0) return null;

  return (
    <Card className="border border-border/60 bg-card/60 backdrop-blur-md shadow-md rounded-xl">
      <CardHeader className="pb-3 border-b border-border/40 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
            Merged Preview Table (Top 100 Rows)
          </CardTitle>
          <CardDescription className="text-xs text-muted-foreground mt-0.5">
            Preview the first 100 rows of your products dataset with SEO and FAQ data merged.
          </CardDescription>
        </div>
        <div className="relative w-full sm:w-[260px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by ID, Title, Description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 text-xs h-9 font-medium bg-background/30"
          />
        </div>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        <div className="border rounded-xl bg-card/40 overflow-hidden shadow-inner">
          <Table className="text-xs">
            <TableHeader className="bg-muted/40">
              <TableRow>
                <TableHead className="w-[120px] font-bold">Product ID</TableHead>
                <TableHead className="font-bold">Meta Title</TableHead>
                <TableHead className="font-bold">Meta Description</TableHead>
                <TableHead className="font-bold">FAQ</TableHead>
                <TableHead className="w-[110px] font-bold text-center">Merge Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedResults.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground font-medium italic">
                    No matching preview records found.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedResults.map((record, index) => {
                  const status = record._status || "Unchanged";
                  return (
                    <TableRow key={index} className="hover:bg-muted/10 transition-colors">
                      <TableCell className="font-mono font-semibold text-foreground truncate max-w-[120px]" title={record.ID}>
                        {record.ID}
                      </TableCell>
                      <TableCell className="font-medium max-w-[200px] truncate" title={record.metaTitle}>
                        {truncate(record.metaTitle)}
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-[240px] truncate" title={record.metaDescription}>
                        {truncate(record.metaDescription)}
                      </TableCell>
                      <TableCell className="text-muted-foreground max-w-[200px] truncate" title={record.faq}>
                        {truncate(record.faq)}
                      </TableCell>
                      <TableCell className="text-center">
                        {status === "Updated" && (
                          <Badge className="bg-orange-500/10 text-orange-500 border-orange-500/20 text-[10px] hover:bg-orange-500/10 gap-1 px-2 py-0.5 rounded-full font-bold">
                            <RefreshCw className="w-2.5 h-2.5 text-orange-500 animate-spin-slow" />
                            Updated
                          </Badge>
                        )}
                        {status === "Matched" && (
                          <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-[10px] hover:bg-emerald-500/10 gap-1 px-2 py-0.5 rounded-full font-bold">
                            <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500" />
                            Matched
                          </Badge>
                        )}
                        {status === "Unchanged" && (
                          <Badge className="bg-muted text-muted-foreground border-border/40 text-[10px] hover:bg-muted/80 gap-1 px-2 py-0.5 rounded-full font-medium" variant="outline">
                            <Minus className="w-2.5 h-2.5 text-muted-foreground/60" />
                            Unchanged
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination Controls */}
        <div className="flex items-center justify-between text-xs pt-1.5 font-medium text-muted-foreground">
          <span>
            Showing rows <b>{(currentPage - 1) * itemsPerPage + 1}</b> to <b>{Math.min(currentPage * itemsPerPage, filteredResults.length)}</b> of <b>{filteredResults.length}</b> result rows (preview limits: top 100).
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
