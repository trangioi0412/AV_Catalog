import React from "react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { getDashboardStatsAction } from "@/app/actions/discovery";
import { 
  Building2, 
  Package, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  FileMinus,
  RefreshCw
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { revalidatePath } from "next/cache";
import { getAllProducts, getActiveBrands } from "@/lib/services/wixCms";
import { CmsProductsPopupTrigger } from "@/components/data/CmsProductsPopupTrigger";
import { ImageSearchToggle } from "@/components/data/ImageSearchToggle";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const [stats, products, brands] = await Promise.all([
    getDashboardStatsAction(),
    getAllProducts(),
    getActiveBrands()
  ]);
  
  // Log dashboard stats to server terminal for administrative visibility
  console.log("[Admin Dashboard] Stats loaded from Wix CMS and Sheets:", stats);

  async function handleRefresh() {
    "use server";
    revalidatePath("/admin/dashboard");
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
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gradient-brand">
              Discovery Dashboard
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Overview of product discovery queues, Wix CMS status, and automated runs.
            </p>
          </div>

          <form action={handleRefresh}>
            <Button type="submit" variant="outline" className="gap-2 shadow-sm">
              <RefreshCw className="w-4 h-4" />
              Refresh Stats
            </Button>
          </form>
        </div>

        {/* Timestamps */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
        </div>

        {/* AI Image Search Toggle */}
        <ImageSearchToggle initialEnabled={!!stats.isImageSearchEnabled} />

        {/* CMS Stats Section */}
        <div>
          <h2 className="text-base font-bold mb-4 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-primary" />
            Wix Studio CMS Master Data
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="bg-card border-border/60 card-hover border-l-4 border-l-primary">
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
              <CardContent className="pt-0 pb-4 flex justify-end">
                <CmsProductsPopupTrigger products={products} brands={brands} />
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
              <CardContent className="pt-0 pb-4 flex justify-between items-center">
                <span className="text-xs text-muted-foreground font-medium">
                  Chưa có ảnh: <span className="font-bold text-amber-600 dark:text-amber-400">{(stats.totalProducts - stats.productsWithImagesCount).toLocaleString()}</span>
                </span>
                <CmsProductsPopupTrigger 
                  products={products} 
                  brands={brands} 
                  showOnlyNoImages={true} 
                  triggerLabel="Xem sản phẩm thiếu ảnh" 
                />
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Discovery & Queue Stats Section */}
        <div>
          <h2 className="text-base font-bold mb-4 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-primary" />
            Discovery & Approval Queue
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">

            {/* Pending Approval */}
            <Card className="border-border/60 border-l-4 border-l-blue-500 card-hover">
              <CardHeader className="pb-2">
                <CardDescription className="text-xs font-bold text-blue-500 uppercase tracking-wider">
                  Pending Approval
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-extrabold text-blue-600 dark:text-blue-400">
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
                <CardDescription className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Blacklisted Total
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-extrabold text-slate-600 dark:text-slate-400">
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
