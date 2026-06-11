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
            <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-foreground to-muted-foreground bg-clip-text text-transparent">
              Discovery Dashboard
            </h1>
            <p className="text-muted-foreground mt-1">
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
          <Card className="border-primary/10 bg-card/40 backdrop-blur-md shadow-sm">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="p-3 bg-amber-500/10 rounded-xl text-amber-500">
                <Clock className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">
                  Last Automated Scan
                </p>
                <p className="text-lg font-bold mt-0.5">{formatDate(stats.lastScan)}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/10 bg-card/40 backdrop-blur-md shadow-sm">
            <CardContent className="flex items-center gap-4 p-5">
              <div className="p-3 bg-green-500/10 rounded-xl text-green-500">
                <RefreshCw className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">
                  Last CMS Sync (Approval)
                </p>
                <p className="text-lg font-bold mt-0.5">{formatDate(stats.lastSync)}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* AI Image Search Toggle */}
        <ImageSearchToggle initialEnabled={!!stats.isImageSearchEnabled} />

        {/* CMS Stats Section */}
        <div>
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-primary" />
            Wix Studio CMS Master Data
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="bg-gradient-to-br from-card to-card/75 border-primary/5 hover:border-primary/20 transition-all duration-300 shadow-md">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                  Total Active Brands
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-extrabold">{stats.totalBrands}</span>
                  <span className="text-sm text-muted-foreground">registered in Wix CMS</span>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-card to-card/75 border-primary/5 hover:border-primary/20 transition-all duration-300 shadow-md flex flex-col justify-between">
              <div>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
                    Total Synced Products
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-baseline gap-2">
                    <span className="text-4xl font-extrabold">{stats.totalProducts}</span>
                    <span className="text-sm text-muted-foreground">stored in Wix Products</span>
                  </div>
                </CardContent>
              </div>
              <CardContent className="pt-0 pb-4 flex justify-end">
                <CmsProductsPopupTrigger products={products} brands={brands} />
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Discovery & Queue Stats Section */}
        <div>
          <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-blue-500" />
            Discovery & Approval Queue
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            
            {/* Pending Approval */}
            <Card className="border-blue-500/10 hover:border-blue-500/30 bg-blue-500/5 transition-all shadow-sm">
              <CardHeader className="pb-2">
                <CardDescription className="text-xs font-semibold text-blue-500 uppercase tracking-wider">
                  Pending Approval
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-extrabold text-blue-600 dark:text-blue-400">
                  {stats.pendingCount}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Products in Product_New sheet
                </p>
              </CardContent>
            </Card>

            {/* Approved */}
            <Card className="border-green-500/10 hover:border-green-500/30 bg-green-500/5 transition-all shadow-sm">
              <CardHeader className="pb-2">
                <CardDescription className="text-xs font-semibold text-green-500 uppercase tracking-wider">
                  Approved Count
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-extrabold text-green-600 dark:text-green-400">
                  {stats.approvedCount}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Successfully synced to Wix CMS
                </p>
              </CardContent>
            </Card>

            {/* Rejected */}
            <Card className="border-red-500/10 hover:border-red-500/30 bg-red-500/5 transition-all shadow-sm">
              <CardHeader className="pb-2">
                <CardDescription className="text-xs font-semibold text-red-500 uppercase tracking-wider">
                  Rejected Count
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-extrabold text-red-600 dark:text-red-400">
                  {stats.rejectedCount}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Moved to Product_Delete list
                </p>
              </CardContent>
            </Card>

            {/* Blacklist Total */}
            <Card className="border-slate-500/10 hover:border-slate-500/30 bg-slate-500/5 transition-all shadow-sm">
              <CardHeader className="pb-2">
                <CardDescription className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Blacklisted Total
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-extrabold text-slate-600 dark:text-slate-400">
                  {stats.deletedProductCount}
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
