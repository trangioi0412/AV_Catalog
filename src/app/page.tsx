import React from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/layout/PageHeader";
import { getDashboardStatsAction, refreshDashboardStatsAction } from "@/app/actions/discovery";
import { 
  Building2, 
  Clock, 
  AlertCircle,
  RefreshCw,
  Languages,
  ChevronRight,
  LayoutDashboard,
  Upload,
  FileText,
  GitCompare,
  Sparkles,
  HardDrive,
  Bot,
} from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CmsProductsPopupTrigger } from "@/components/data/CmsProductsPopupTrigger";
import { ImageSearchToggle } from "@/components/data/ImageSearchToggle";
import { requireUser } from "@/lib/auth/guard";
import { listSheetBrandsVsCms, type SheetBrandStatus } from "@/lib/services/dataCrawlerNewBrands";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const QUICK_LINKS = [
  { href: "/admin/excel-upload", icon: Upload, label: "Tải lên Catalog Excel", desc: "Kiểm tra, sửa và đẩy file catalog lên CMS" },
  { href: "/admin/catalog-upload", icon: FileText, label: "Catalog PDF", desc: "Upload tài liệu PDF & dữ liệu hãng (Excel)" },
  { href: "/admin/manufacturer-sync", icon: RefreshCw, label: "Đồng bộ NSX", desc: "Crawl catalog nhà sản xuất vào Google Sheet" },
  { href: "/admin/discovery", icon: GitCompare, label: "Upload SP mới lên CMS", desc: "Sản phẩm trên Excel chưa có trên web" },
  { href: "/admin/new-brands", icon: Sparkles, label: "Brand mới", desc: "Hãng chưa có trên CMS, tải logo" },
  { href: "/admin/tools/cms-ai-review", icon: Bot, label: "AI Kiểm Tra CMS", desc: "Rà soát chất lượng dữ liệu CMS" },
  { href: "/admin/media", icon: HardDrive, label: "Quản lý Media", desc: "File trên Wix Media Manager" },
];

/** Google Sheet + Wix reads can fail independently of the CMS stats. */
async function loadSheetBrands(): Promise<SheetBrandStatus[] | null> {
  try {
    return await listSheetBrandsVsCms();
  } catch (err) {
    console.error("[Dashboard] brand tabs vs CMS failed:", err);
    return null;
  }
}

export default async function OverviewDashboardPage() {
  await requireUser("viewer");
  // Product/brand lists are not fetched here: the CMS popups load them on
  // demand (getCmsPopupDataAction), keeping them out of the page payload.
  const [stats, sheetBrands] = await Promise.all([getDashboardStatsAction(), loadSheetBrands()]);
  const newBrands = sheetBrands?.filter((b) => !b.inCms) ?? [];
  const sheetProductCount = sheetBrands?.reduce((n, b) => n + b.productCount, 0) ?? 0;

  async function handleRefresh() {
    "use server";
    await refreshDashboardStatsAction();
  }

  // Format date helper
  const formatDate = (isoString: string) => {
    if (!isoString) return "Never";
    try {
      const date = new Date(isoString);
      return date.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return isoString;
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-8">
        {/* Header */}
        <PageHeader
          title="Tổng quan"
          description="Trạng thái Wix CMS, dữ liệu DataCrawler trên Google Sheet và lối tắt tới các chức năng chính."
          icon={<LayoutDashboard className="w-5 h-5" />}
          actions={
            <form action={handleRefresh}>
              <Button type="submit" variant="outline" className="gap-2 shadow-sm">
                <RefreshCw className="w-4 h-4" />
                Làm mới số liệu
              </Button>
            </form>
          }
        />

        {/* Quick access */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {QUICK_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="group flex items-start gap-3 rounded-xl border border-border/60 bg-card p-4 card-hover"
            >
              <div className="p-2.5 bg-primary/10 rounded-lg text-primary shrink-0">
                <l.icon className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold flex items-center gap-1">
                  {l.label}
                  <ChevronRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{l.desc}</p>
              </div>
            </Link>
          ))}
        </div>

        {/* DataCrawler (Google Sheet) vs CMS */}
        <div>
          <h2 className="text-base font-bold mb-4 flex items-center gap-2">
            <GitCompare className="w-4 h-4 text-primary" />
            DataCrawler · Excel so với CMS
          </h2>
          {sheetBrands === null ? (
            <Card className="border-border/60">
              <CardContent className="p-5 text-sm text-muted-foreground">
                Không đọc được Google Sheet hoặc Wix brand. Xem log server.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card className="border-border/60 border-l-4 border-l-primary card-hover">
                <CardHeader className="pb-2">
                  <CardDescription className="text-xs font-bold uppercase tracking-wider">Hãng trên Excel</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-extrabold">{sheetBrands.length.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {sheetProductCount.toLocaleString()} sản phẩm đã crawl
                  </p>
                </CardContent>
              </Card>
              <Card className="border-border/60 border-l-4 border-l-blue-500 card-hover">
                <CardHeader className="pb-2">
                  <CardDescription className="text-xs font-bold text-primary uppercase tracking-wider">
                    Hãng mới (chưa có trên CMS)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-extrabold text-primary">{newBrands.length}</div>
                  <p className="text-xs text-muted-foreground mt-1 truncate" title={newBrands.map((b) => b.brandName).join(", ")}>
                    {newBrands.length ? newBrands.map((b) => b.brandName).join(", ") : "Mọi hãng đã có trên CMS"}
                  </p>
                  <Button size="sm" variant="outline" asChild className="h-7 text-xs gap-1 mt-3">
                    <Link href="/admin/new-brands">
                      Brand mới <ChevronRight className="w-3 h-3" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
              <Card className="border-border/60 border-l-4 border-l-amber-500 card-hover">
                <CardHeader className="pb-2">
                  <CardDescription className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
                    Sản phẩm mới
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Lọc sản phẩm trên Google Sheet chưa có trên Wix CMS theo từng hãng và upload lên web.
                  </p>
                  <Button size="sm" variant="outline" asChild className="h-7 text-xs gap-1 mt-3">
                    <Link href="/admin/discovery">
                      Upload SP mới lên CMS <ChevronRight className="w-3 h-3" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        {/* Timestamps & Actions */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="border-border/60 bg-card card-hover">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="p-3 bg-amber-500/10 rounded-xl text-amber-500 shrink-0">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">
                  Last Automated Scan
                </p>
                <p className="text-base font-bold mt-0.5">{formatDate(stats.lastScan)}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card card-hover">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="p-3 bg-emerald-500/10 rounded-xl text-emerald-500 shrink-0">
                <RefreshCw className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">
                  Last CMS Sync (Approval)
                </p>
                <p className="text-base font-bold mt-0.5">{formatDate(stats.lastSync)}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60 bg-card card-hover flex flex-col justify-between">
            <CardContent className="flex items-center gap-4 p-5 flex-1">
              <div className="p-3 bg-primary/10 rounded-xl text-primary shrink-0">
                <Languages className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase font-bold tracking-wider">
                  Specs Translation Pipeline
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Batch convert product specs for localization.
                </p>
              </div>
            </CardContent>
            <div className="px-5 pb-4 pt-0 flex justify-end">
              <Button size="sm" variant="outline" asChild className="h-7 text-xs gap-1 shadow-sm">
                <Link href="/admin/specs-translator">
                  Open Translator
                  <ChevronRight className="w-3 h-3" />
                </Link>
              </Button>
            </div>
          </Card>
        </div>

        {/* AI Image Search Toggle */}
        <ImageSearchToggle initialEnabled={!!stats.isImageSearchEnabled} />

        {/* CMS Stats Section */}
        <div>
          <h2 className="text-base font-bold mb-4 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-primary" />
            Wix Studio CMS Master Data
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card className="bg-card border-border/60 card-hover border-l-4 border-l-primary flex flex-col justify-between">
              <div>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Total Active Brands
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-extrabold">{stats.totalBrands.toLocaleString()}</span>
                    <span className="text-sm text-muted-foreground">registered in Wix CMS</span>
                  </div>
                </CardContent>
              </div>
              <CardContent className="pt-3 pb-4 border-t border-border/40">
                <span className="text-xs text-muted-foreground">Đồng bộ trực tiếp từ Wix CMS</span>
              </CardContent>
            </Card>

            <Card className="bg-card border-border/60 card-hover border-l-4 border-l-primary flex flex-col justify-between">
              <div>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Total Synced Products
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-extrabold">{stats.totalProducts.toLocaleString()}</span>
                    <span className="text-sm text-muted-foreground">stored in Wix Products</span>
                  </div>
                </CardContent>
              </div>
              <CardContent className="pt-3 pb-4 flex justify-end border-t border-border/40">
                <CmsProductsPopupTrigger />
              </CardContent>
            </Card>

            <Card className="bg-card border-border/60 card-hover border-l-4 border-l-primary flex flex-col justify-between">
              <div>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Products with Images
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-extrabold text-emerald-600 dark:text-emerald-400">
                      {stats.productsWithImagesCount.toLocaleString()}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      / {stats.totalProducts.toLocaleString()} items
                    </span>
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 ml-2">
                      {stats.totalProducts > 0
                        ? Math.round((stats.productsWithImagesCount / stats.totalProducts) * 100)
                        : 0}%
                    </span>
                  </div>
                </CardContent>
              </div>
              <CardContent className="pt-3 pb-4 flex flex-col gap-2 border-t border-border/40">
                <span className="text-xs text-muted-foreground font-medium">
                  Chưa có ảnh: <span className="font-bold text-amber-600 dark:text-amber-400">{(stats.totalProducts - stats.productsWithImagesCount).toLocaleString()}</span>
                </span>
                <div className="flex flex-wrap gap-2">
                  <CmsProductsPopupTrigger
                    showOnlyWithImages={true}
                    triggerLabel="Đã có ảnh"
                  />
                  <CmsProductsPopupTrigger
                    showOnlyNoImages={true}
                    triggerLabel="Thiếu ảnh"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Products with Documents Card */}
            <Card className="bg-card border-border/60 card-hover border-l-4 border-l-blue-500 flex flex-col justify-between">
              <div>
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                    Products with Documents
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-extrabold text-primary">
                      {(stats.productsWithDocumentsCount ?? 0).toLocaleString()}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      / {stats.totalProducts.toLocaleString()} items
                    </span>
                    <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary ml-2">
                      {stats.totalProducts > 0
                        ? Math.round(((stats.productsWithDocumentsCount ?? 0) / stats.totalProducts) * 100)
                        : 0}%
                    </span>
                  </div>
                </CardContent>
              </div>
              <CardContent className="pt-3 pb-4 flex flex-col gap-2 border-t border-border/40">
                <span className="text-xs text-muted-foreground font-medium">
                  Chưa có tài liệu: <span className="font-bold text-amber-600 dark:text-amber-400">{(stats.totalProducts - (stats.productsWithDocumentsCount ?? 0)).toLocaleString()}</span>
                </span>
                <div className="flex flex-wrap gap-2">
                  <CmsProductsPopupTrigger
                    showOnlyWithDocuments={true}
                    triggerLabel="Đã có tài liệu"
                  />
                  <CmsProductsPopupTrigger
                    showOnlyNoDocuments={true}
                    triggerLabel="Thiếu tài liệu"
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Discovery & Queue Stats Section */}
        <div>
          <h2 className="text-base font-bold mb-4 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-primary" />
            Hàng đợi Product_New (quét Discovery)
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

            {/* Pending Approval */}
            <Card className="border-border/60 border-l-4 border-l-blue-500 card-hover">
              <CardHeader className="pb-2">
                <CardDescription className="text-xs font-bold text-primary uppercase tracking-wider">
                  Pending Approval
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-extrabold text-primary">
                  {stats.pendingCount.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Products in Product_New sheet
                </p>
              </CardContent>
            </Card>

            {/* Approved */}
            <Card className="border-border/60 border-l-4 border-l-emerald-500 card-hover">
              <CardHeader className="pb-2">
                <CardDescription className="text-xs font-bold text-emerald-500 uppercase tracking-wider">
                  Approved Count
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">
                  {stats.approvedCount.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Successfully synced to Wix CMS
                </p>
              </CardContent>
            </Card>

            {/* Rejected */}
            <Card className="border-border/60 border-l-4 border-l-red-500 card-hover">
              <CardHeader className="pb-2">
                <CardDescription className="text-xs font-bold text-red-500 uppercase tracking-wider">
                  Rejected Count
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-extrabold text-red-600 dark:text-red-400">
                  {stats.rejectedCount.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Moved to Product_Delete list
                </p>
              </CardContent>
            </Card>

            {/* Blacklist Total */}
            <Card className="border-border/60 border-l-4 border-l-slate-400 card-hover">
              <CardHeader className="pb-2">
                <CardDescription className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Blacklisted Total
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-extrabold text-muted-foreground dark:text-muted-foreground">
                  {stats.deletedProductCount.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Total rows in Product_Delete sheet
                </p>
              </CardContent>
            </Card>

          </div>
        </div>

      </div>
    </DashboardLayout>
  );
}
