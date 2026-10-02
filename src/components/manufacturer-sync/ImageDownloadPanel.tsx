"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ImageDown, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";

interface Manufacturer {
  key: string;
  display_name: string;
  base_url: string;
}

interface ImageDownloadResult {
  success: boolean;
  manufacturer: string;
  products_with_images: number;
  downloaded: number;
  skipped_existing: number;
  skipped_no_title: number;
  failed: string[];
}

export function ImageDownloadPanel() {
  const [manufacturers, setManufacturers] = useState<Manufacturer[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [isDownloading, setIsDownloading] = useState(false);
  const [result, setResult] = useState<ImageDownloadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/manufacturer-sync/manufacturers")
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok || !Array.isArray(data)) {
          throw new Error((data as { detail?: string } | null)?.detail ?? "Không thể tải danh sách nhà sản xuất từ dịch vụ sync.");
        }
        return data as Manufacturer[];
      })
      .then((data) => {
        setManufacturers(data);
        if (data.length > 0) setSelected(data[0].key);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Không thể tải danh sách nhà sản xuất từ dịch vụ sync."));
  }, []);

  async function handleDownload() {
    if (!selected) return;
    setError(null);
    setResult(null);
    setIsDownloading(true);
    try {
      const res = await fetch("/api/manufacturer-sync/images/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manufacturer: selected }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.detail ?? "Không thể tải ảnh về");
      setResult(body as ImageDownloadResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tải ảnh về");
    } finally {
      setIsDownloading(false);
    }
  }

  return (
    <Card className="max-w-2xl w-full border-primary/10 bg-card/40 backdrop-blur-md shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <ImageDown className="w-4 h-4 text-primary" />
          Tải Ảnh Sản Phẩm Về
        </CardTitle>
        <CardDescription>
          Tải toàn bộ ảnh trong cột &quot;image&quot; của sheet một hãng về thư mục Data/&lt;hãng&gt; trên backend
          (av-crawler-api).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <label className="text-xs text-muted-foreground">Nhà sản xuất</label>
            <Select value={selected} onValueChange={setSelected} disabled={isDownloading}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Chọn nhà sản xuất..." />
              </SelectTrigger>
              <SelectContent>
                {manufacturers.map((m) => (
                  <SelectItem key={m.key} value={m.key}>
                    {m.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleDownload} disabled={!selected || isDownloading} className="gap-1.5">
            {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageDown className="w-4 h-4" />}
            {isDownloading ? "Đang tải..." : "Tải ảnh về"}
          </Button>
        </div>

        {error && (
          <p className="flex items-center gap-1.5 text-sm text-destructive">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            {error}
          </p>
        )}

        {result && (
          <div className="space-y-3 rounded-lg border border-primary/5 bg-muted/30 p-3">
            <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              Hoàn tất cho &quot;{result.manufacturer}&quot;
            </div>
            <div className="grid grid-cols-4 gap-2 text-center text-sm">
              <Stat label="SP có ảnh" value={result.products_with_images} />
              <Stat label="Đã tải" value={result.downloaded} />
              <Stat label="Đã có sẵn" value={result.skipped_existing} />
              <Stat label="Lỗi" value={result.failed.length} />
            </div>
            {result.skipped_no_title > 0 && (
              <p className="text-xs text-amber-600">
                Bỏ qua {result.skipped_no_title} ảnh vì sản phẩm không có Title để đặt tên file.
              </p>
            )}
            {result.failed.length > 0 && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">{result.failed.length} ảnh tải lỗi</summary>
                <ul className="mt-1 space-y-1 max-h-40 overflow-auto">
                  {result.failed.slice(0, 20).map((f, i) => (
                    <li key={i} className="truncate">
                      {f}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-background/60 py-2">
      <div className="text-base font-semibold">{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
