"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  LayoutDashboard, 
  FileText, 
  Settings, 
  Search, 
  Bell, 
  Moon, 
  Sun,
  Database,
  BarChart3,
  LogOut,
  ChevronRight,
  Menu,
  CheckSquare,
  Activity,
  Upload,
  ImageIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { useDataStore } from "@/store/useDataStore";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { BrandMappingUpload } from "@/components/data/BrandMappingUpload";

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { fileName, sheets, activeSheetIndex, setActiveSheet, stats } = useDataStore();
  const [isDarkMode, setIsDarkMode] = React.useState(false);
  const pathname = usePathname();

  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
    document.documentElement.classList.toggle("dark");
  };

  return (
    <div className={cn("flex h-screen w-full bg-background overflow-hidden", isDarkMode && "dark")}>
      {/* Sidebar */}
      <aside className="w-64 flex-col border-r bg-card/50 backdrop-blur-xl hidden md:flex">
        <div className="p-6 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center shadow-lg shadow-primary/20">
            <Database className="w-6 h-6 text-primary-foreground" />
          </div>
          <span className="font-bold text-xl tracking-tight">AV Catalog</span>
        </div>

        <div className="flex-1 overflow-y-auto px-3 custom-scrollbar">
          <div className="space-y-4 py-4">
            <div className="px-3 py-2">
              <h2 className="mb-2 px-4 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Main
              </h2>
              <div className="space-y-1">
                <Link
                  href="/"
                  className={cn(
                    "flex items-center gap-3 w-full rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    pathname === "/"
                      ? "bg-secondary text-secondary-foreground"
                      : "hover:bg-accent hover:text-accent-foreground text-foreground/70"
                  )}
                >
                  <Upload className="w-4 h-4" />
                  Catalog Upload
                </Link>
              </div>
            </div>

            <Separator className="mx-4" />

            <div className="px-3 py-2">
              <h2 className="mb-2 px-4 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Discovery & Sync
              </h2>
              <div className="space-y-1">
                <Link
                  href="/admin/dashboard"
                  className={cn(
                    "flex items-center gap-3 w-full rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    pathname === "/admin/dashboard"
                      ? "bg-secondary text-secondary-foreground"
                      : "hover:bg-accent hover:text-accent-foreground text-foreground/70"
                  )}
                >
                  <LayoutDashboard className="w-4 h-4" />
                  Dashboard
                </Link>
                <Link
                  href="/admin/discovery"
                  className={cn(
                    "flex items-center gap-3 w-full rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    pathname === "/admin/discovery"
                      ? "bg-secondary text-secondary-foreground"
                      : "hover:bg-accent hover:text-accent-foreground text-foreground/70"
                  )}
                >
                  <CheckSquare className="w-4 h-4" />
                  Discovery Queue
                </Link>
                <Link
                  href="/admin/scanner"
                  className={cn(
                    "flex items-center gap-3 w-full rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    pathname === "/admin/scanner"
                      ? "bg-secondary text-secondary-foreground"
                      : "hover:bg-accent hover:text-accent-foreground text-foreground/70"
                  )}
                >
                  <Activity className="w-4 h-4" />
                  Manual Scanner
                </Link>
                <Link
                  href="/admin/image-sync"
                  className={cn(
                    "flex items-center gap-3 w-full rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    pathname === "/admin/image-sync"
                      ? "bg-secondary text-secondary-foreground"
                      : "hover:bg-accent hover:text-accent-foreground text-foreground/70"
                  )}
                >
                  <ImageIcon className="w-4 h-4" />
                  Image Sync
                </Link>
              </div>
            </div>

            <Separator className="mx-4" />

            <div className="px-3 py-2">
              <BrandMappingUpload />
            </div>

            <Separator className="mx-4" />


            <div className="px-3 py-2">
              <h2 className="mb-2 px-4 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
                Sheets / Brands
              </h2>
              <div className="space-y-1">
                {sheets.length > 0 ? (
                  sheets.map((sheet, index) => (
                    <Button
                      key={index}
                      variant={activeSheetIndex === index ? "secondary" : "ghost"}
                      className={cn(
                        "w-full justify-start gap-3",
                        activeSheetIndex === index && "bg-secondary"
                      )}
                      onClick={() => setActiveSheet(index)}
                    >
                      <ChevronRight className={cn("w-3 h-3 transition-transform", activeSheetIndex === index && "rotate-90")} />
                      <span className="truncate">{sheet.brandName}</span>
                      <Badge variant="outline" className="ml-auto text-[10px] px-1.5 py-0">
                        {sheet.rows.length}
                      </Badge>
                    </Button>
                  ))
                ) : (
                  <div className="px-4 py-2 text-sm text-muted-foreground italic">
                    No file uploaded
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 border-t space-y-4">
          <div className="flex items-center justify-between px-2">
            <span className="text-xs text-muted-foreground">Version 1.0.0</span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleDarkMode}>
              {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
          </div>
          <Button 
            variant="outline" 
            className="w-full justify-start gap-3 text-destructive border-destructive/20 hover:bg-destructive/10"
            onClick={() => {
              if (confirm("Are you sure you want to sign out?")) {
                toast.success("Signed out successfully");
              }
            }}
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-muted/20">
        {/* Header */}
        <header className="h-16 border-b flex items-center justify-between px-8 bg-card/30 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center gap-4 flex-1">
            <div className="relative w-96 max-w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                placeholder="Search products, brands, specs..." 
                className="pl-10 bg-muted/50 border-none focus-visible:ring-1 focus-visible:ring-primary/20"
              />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="w-5 h-5" />
              <span className="absolute top-2 right-2 w-2 h-2 bg-destructive rounded-full border-2 border-background" />
            </Button>
            <div className="h-8 w-[1px] bg-border mx-2" />
            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium leading-none">Admin User</p>
                <p className="text-xs text-muted-foreground mt-1">Enterprise Plan</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-primary to-primary/60 border-2 border-background shadow-md" />
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="p-8 max-w-[1600px] mx-auto space-y-8">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
