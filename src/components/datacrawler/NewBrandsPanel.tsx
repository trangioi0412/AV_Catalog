"use client";

/**
 * "Brand mới" (DataCrawler). Lists every brand tab of the shared Google Sheet
 * (the first 8 tabs are work tabs and are skipped) against the Wix `brand`
 * collection, and uploads a logo — from a URL or a local file — to Media
 * Manager folder "Brand/Logo". Optionally creates the brand on CMS and sets
 * its `logo` field (never overwrites an existing logo).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { CheckCircle2, ImageUp, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { wixImageThumbUrl } from "@/lib/utils";

interface SheetBrand {
  tab: string;
  brandName: string;
  productCount: number;
  inCms: boolean;
  cmsBrand: { _id: string; title: string; logo: string } | null;
}

interface LogoResult {
  wixUrl: string;
  fileName: string;
  folder: string;
  cms?: { brandId: string; brandCreated: boolean; logoAttached: boolean; note?: string };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON from our own routes
async function readJson(res: Response): Promise<any> {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.detail || data?.error || `HTTP ${res.status}`);
  return data;
}

export function NewBrandsPanel() {
  const [brands, setBrands] = useState<SheetBrand[]>([]);
  const [loading, setLoading] = useState(true);
  const [onlyNew, setOnlyNew] = useState(true);

  const fetchBrands = useCallback(async () => {
    try {
      const data = await readJson(await fetch("/api/datacrawler/new-brands", { cache: "no-store" }));
      setBrands(data.brands || []);
    } catch (err) {
      toast.error(`Không tải được danh sách hãng: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  /** Manual reload (button, after creating a brand). */
  const load = useCallback(() => {
    setLoading(true);
    void fetchBrands();
  }, [fetchBrands]);

  useEffect(() => {
    // Initial load: `loading` starts true, so no synchronous setState here.
    const t = setTimeout(() => void fetchBrands(), 0);
    return () => clearTimeout(t);
  }, [fetchBrands]);

  const newCount = brands.filter((b) => !b.inCms).length;
  const visible = useMemo(() => (onlyNew ? brands.filter((b) => !b.inCms) : brands), [brands, onlyNew]);

  return (
    <div className="space-y-4">
      <Card className="border-border/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            Hãng trên Excel so với CMS
          </CardTitle>
          <CardDescription>
            So sánh các tab hãng trên Google Sheet (bỏ qua 8 tab đầu không phải hãng) với collection brand trên Wix.
            Logo được tải lên Media Manager, folder <b>Brand/Logo</b>.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Badge variant="outline" className="h-7 px-3">
            {loading ? "…" : `${newCount} hãng mới / ${brands.length} hãng`}
          </Badge>
          <div className="flex items-center gap-2">
            <Checkbox id="only-new" checked={onlyNew} onCheckedChange={(v) => setOnlyNew(v === true)} />
            <Label htmlFor="only-new" className="text-sm">
              Chỉ hiện hãng mới
            </Label>
          </div>
          <Button variant="outline" size="sm" className="gap-2 ml-auto" onClick={load} disabled={loading}>
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Tải lại
          </Button>
        </CardContent>
      </Card>

      {!loading && visible.length === 0 && (
        <p className="text-sm text-muted-foreground px-1">
          {onlyNew ? "Mọi hãng trên Excel đều đã có trên CMS." : "Không có tab hãng nào."}
        </p>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        {visible.map((b) => (
          <BrandLogoCard key={b.tab} brand={b} onDone={load} />
        ))}
      </div>
    </div>
  );
}

function BrandLogoCard({ brand, onDone }: { brand: SheetBrand; onDone: () => void }) {
  const [name, setName] = useState(brand.brandName);
  const [imageUrl, setImageUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const currentLogo = brand.cmsBrand?.logo || "";
  const [attach, setAttach] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LogoResult | null>(null);

  const filePreview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(
    () => () => {
      if (filePreview) URL.revokeObjectURL(filePreview);
    },
    [filePreview]
  );
  const preview = filePreview || (/^https?:\/\//i.test(imageUrl.trim()) ? imageUrl.trim() : null);

  const submit = async () => {
    if (!file && !imageUrl.trim()) {
      toast.error("Nhập URL ảnh hoặc chọn file logo");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("tab", brand.tab);
      form.set("brandName", name.trim() || brand.tab);
      form.set("attachToCms", String(attach));
      form.set("replaceLogo", String(attach && !!currentLogo));
      if (file) form.set("file", file);
      else form.set("imageUrl", imageUrl.trim());
      const data: LogoResult = await readJson(await fetch("/api/datacrawler/new-brands", { method: "POST", body: form }));
      setResult(data);
      toast.success(`Đã tải logo ${name} lên ${data.folder}`);
      if (data.cms?.note) toast.warning(data.cms.note);
      if (data.cms) onDone();
    } catch (err) {
      toast.error(`Tải logo lỗi: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="border-border/60">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold truncate">{brand.brandName}</p>
            <p className="text-xs text-muted-foreground">
              Tab <span className="font-mono">{brand.tab}</span> · {brand.productCount} sản phẩm
            </p>
          </div>
          {brand.inCms ? (
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 shrink-0">
              Đã có trên CMS{brand.cmsBrand?.logo ? "" : " · chưa có logo"}
            </Badge>
          ) : (
            <Badge variant="outline" className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30 shrink-0">
              Hãng mới
            </Badge>
          )}
        </div>

        {brand.inCms && (
          <div className="grid gap-1">
            <p className="text-xs text-muted-foreground">Logo hiện tại trên CMS</p>
            <div className="rounded-md border border-border/50 bg-white p-3 flex items-center justify-center h-24">
              {currentLogo ? (
                // eslint-disable-next-line @next/next/no-img-element -- Wix static media
                <img
                  src={wixImageThumbUrl(currentLogo, 320, 160)}
                  alt={`Logo hiện tại ${brand.brandName}`}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <span className="text-xs text-muted-foreground">Chưa có logo</span>
              )}
            </div>
          </div>
        )}

        <div className="grid gap-2">
          <Label className="text-xs" htmlFor={`name-${brand.tab}`}>
            Tên hiển thị (tên file: logo_&lt;tên&gt;)
          </Label>
          <Input id={`name-${brand.tab}`} value={name} onChange={(e) => setName(e.target.value)} />
          <Label className="text-xs" htmlFor={`url-${brand.tab}`}>
            URL ảnh logo
          </Label>
          <Input
            id={`url-${brand.tab}`}
            placeholder="https://…/logo.png"
            value={imageUrl}
            disabled={!!file}
            onChange={(e) => setImageUrl(e.target.value)}
          />
          <Label className="text-xs" htmlFor={`file-${brand.tab}`}>
            hoặc chọn file từ máy (PNG, JPG, WEBP, GIF, AVIF)
          </Label>
          <Input
            id={`file-${brand.tab}`}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>

        {preview && (
          <p className="text-xs text-muted-foreground -mb-2">Logo mới</p>
        )}
        {preview && (
          <div className="rounded-md border border-border/50 bg-white p-3 flex items-center justify-center h-24">
            {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary external preview */}
            <img src={preview} alt={`Logo ${name}`} className="max-h-full max-w-full object-contain" />
          </div>
        )}

        <div className="flex items-center gap-2">
          <Checkbox id={`attach-${brand.tab}`} checked={attach} onCheckedChange={(v) => setAttach(v === true)} />
          <Label htmlFor={`attach-${brand.tab}`} className="text-sm">
            {!brand.inCms
              ? "Tạo brand trên CMS và gắn logo"
              : currentLogo
                ? "Thay logo hiện tại trên CMS bằng logo mới"
                : "Gắn logo vào brand trên CMS"}
          </Label>
        </div>

        <Button className="w-full gap-2" onClick={submit} disabled={busy}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageUp className="w-4 h-4" />}
          {attach && currentLogo ? "Tải lên Brand/Logo và thay logo" : "Tải logo lên Brand/Logo"}
        </Button>

        {result && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-xs space-y-1">
            <p className="flex items-center gap-1.5 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> {result.folder}/{result.fileName}
            </p>
            {result.cms && (
              <p className="text-muted-foreground">
                {result.cms.brandCreated ? "Đã tạo brand trên CMS. " : ""}
                {result.cms.logoAttached ? "Đã gắn logo vào brand." : result.cms.note}
              </p>
            )}
            <p className="text-muted-foreground">
              Xem trong{" "}
              <Link href="/admin/media" className="underline text-primary">
                Quản lý Media
              </Link>
              .
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
