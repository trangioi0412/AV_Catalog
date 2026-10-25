"use client";

import React from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { getCmsContentAuditAction, type CmsContentAuditRow } from "@/app/actions/discovery";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CONTENT_FIELDS, missingFromFilled } from "@/lib/utils/productCompleteness";
import { ContentFieldPicker } from "./ContentFieldPicker";
import { useContentFieldSelection } from "./contentFieldSelection";

const PAGE_SIZE = 100;

/**
 * Live Wix CMS products (Import1) that are missing content in any of the
 * selected fields. Only incomplete products are listed.
 */
export function CmsContentAudit() {
  const { selected } = useContentFieldSelection();
  const [rows, setRows] = React.useState<CmsContentAuditRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [query, setQuery] = React.useState("");
  const [fieldFilter, setFieldFilter] = React.useState<string | null>(null);
  const [visible, setVisible] = React.useState(PAGE_SIZE);

  const load = React.useCallback(async (fresh: boolean) => {
    setLoading(true);
    const res = await getCmsContentAuditAction(fresh);
    setLoading(false);
    if (res.success) {
      setRows(res.rows);
      setError(null);
      if (fresh) toast.success(`Đã tải lại ${res.rows.length} sản phẩm từ Wix CMS.`);
    } else {
      setError(res.error);
    }
  }, []);

  React.useEffect(() => {
    let active = true;
    getCmsContentAuditAction(false).then((res) => {
      if (!active) return;
      setLoading(false);
      if (res.success) setRows(res.rows);
      else setError(res.error);
    });
    return () => {
      active = false;
    };
  }, []);

  const selectedFields = React.useMemo(() => CONTENT_FIELDS.filter((f) => selected.includes(f.key)), [selected]);

  // Only products missing at least one selected field.
  const incomplete = React.useMemo(() => {
    if (!rows) return [];
    return rows
      .map((r) => ({ row: r, missing: missingFromFilled(r.filled, selected) }))
      .filter((x) => x.missing.length > 0);
  }, [rows, selected]);

  // How many products miss each selected field.
  const missingCountByField = React.useMemo(() => {
    const counts = new Map<string, number>();
    if (!rows) return counts;
    for (const f of selectedFields) {
      counts.set(f.key, rows.filter((r) => !r.filled.includes(f.key)).length);
    }
    return counts;
  }, [rows, selectedFields]);

  const activeFieldFilter = fieldFilter && selected.includes(fieldFilter) ? fieldFilter : null;

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return incomplete.filter(({ row }) => {
      if (activeFieldFilter && row.filled.includes(activeFieldFilter)) return false;
      if (!q) return true;
      return [row.brandName, row.product, row.title, row.category].some((v) => v.toLowerCase().includes(q));
    });
  }, [incomplete, query, activeFieldFilter]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-card/30 backdrop-blur-md p-4 rounded-xl border border-primary/5">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Tìm theo hãng, danh mục, sản phẩm..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setVisible(PAGE_SIZE);
            }}
            className="pl-10 bg-background/50 focus-visible:ring-primary/20"
          />
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto sm:justify-end">
          {rows && (
            <span className="text-sm text-muted-foreground whitespace-nowrap">
              <strong>{incomplete.length}</strong> / <strong>{rows.length}</strong> sản phẩm CMS thiếu nội dung
            </span>
          )}
          <div className="flex gap-2 w-full sm:w-auto">
            <ContentFieldPicker />
            <Button
              variant="outline"
              size="sm"
              onClick={() => load(true)}
              disabled={loading}
              className="text-xs gap-1.5 flex-1 sm:flex-none"
            >
              <RefreshCw className={loading ? "w-3.5 h-3.5 animate-spin" : "w-3.5 h-3.5"} />
              Tải lại từ CMS
            </Button>
          </div>
        </div>
      </div>

      {/* Per-field summary — click to show only products missing that field */}
      {rows && selectedFields.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedFields.map((f) => {
            const count = missingCountByField.get(f.key) ?? 0;
            const active = activeFieldFilter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => {
                  setFieldFilter(active ? null : f.key);
                  setVisible(PAGE_SIZE);
                }}
                aria-pressed={active}
                disabled={count === 0}
                className={
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-default " +
                  (active
                    ? "bg-amber-500 text-white border-amber-500"
                    : count > 0
                      ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/25 hover:bg-amber-500/20"
                      : "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/25")
                }
              >
                {f.label}: {count === 0 ? "đủ" : `thiếu ${count}`}
              </button>
            );
          })}
        </div>
      )}

      {/* Table */}
      <div className="border border-primary/5 rounded-xl bg-card/25 backdrop-blur-md overflow-hidden shadow-md">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="font-semibold text-xs uppercase tracking-wider">Brand</TableHead>
              <TableHead className="font-semibold text-xs uppercase tracking-wider">Category</TableHead>
              <TableHead className="font-semibold text-xs uppercase tracking-wider">Product</TableHead>
              <TableHead className="font-semibold text-xs uppercase tracking-wider">Title</TableHead>
              <TableHead className="font-semibold text-xs uppercase tracking-wider">Thiếu</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !rows ? (
              <TableRow>
                <TableCell colSpan={6} className="h-40 text-center text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin inline-block mr-2" />
                  Đang đọc sản phẩm từ Wix CMS...
                </TableCell>
              </TableRow>
            ) : error && !rows ? (
              <TableRow>
                <TableCell colSpan={6} className="h-40 text-center text-destructive">
                  Không đọc được Wix CMS: {error}
                </TableCell>
              </TableRow>
            ) : selectedFields.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-40 text-center text-muted-foreground italic">
                  Chưa chọn trường nào để kiểm tra — mở &quot;Trường kiểm tra&quot; để chọn.
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-40 text-center text-green-600 dark:text-green-400">
                  <CheckCircle2 className="w-5 h-5 inline-block mr-2" />
                  Không có sản phẩm nào thiếu nội dung{query || activeFieldFilter ? " khớp bộ lọc" : ""}.
                </TableCell>
              </TableRow>
            ) : (
              filtered.slice(0, visible).map(({ row, missing }) => (
                <TableRow key={row.id || `${row.brandName}-${row.product}`} className="hover:bg-muted/20">
                  <TableCell className="font-bold text-primary/90">{row.brandName || "—"}</TableCell>
                  <TableCell className="max-w-[140px] truncate text-muted-foreground" title={row.category}>
                    {row.category || "—"}
                  </TableCell>
                  <TableCell className="font-semibold">{row.product || "—"}</TableCell>
                  <TableCell className="max-w-[220px] truncate" title={row.title}>
                    {row.title || "—"}
                  </TableCell>
                  <TableCell className="max-w-[300px]">
                    <div className="flex flex-wrap gap-1" title={`Thiếu: ${missing.join(", ")}`}>
                      {missing.map((label) => (
                        <Badge
                          key={label}
                          variant="outline"
                          className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 text-[11px] font-medium px-1.5 py-0"
                        >
                          <AlertTriangle className="w-3 h-3 mr-0.5" />
                          {label}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    {row.slug && (
                      <Link
                        href={`/products/${row.slug}`}
                        target="_blank"
                        className="text-muted-foreground hover:text-foreground"
                        title="Mở trang sản phẩm"
                        aria-label={`Mở trang sản phẩm ${row.product}`}
                      >
                        <ExternalLink className="w-4 h-4" />
                      </Link>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {filtered.length > visible && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
            Xem thêm ({filtered.length - visible} sản phẩm)
          </Button>
        </div>
      )}
    </div>
  );
}
