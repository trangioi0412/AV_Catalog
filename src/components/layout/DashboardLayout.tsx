"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  LayoutDashboard, 
  Moon, 
  Sun,
  Database,
  ChevronRight,
  CheckSquare,
  Activity,
  Upload,
  ImageIcon,
  LogOut,
  Zap,
  Languages,
  FileText,
  HardDrive,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useDataStore } from "@/store/useDataStore";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useNavLoading } from "@/components/layout/NavigationLoadingProvider";
import { logoutAction } from "@/app/actions/auth";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ─── Nav item definitions ──────────────────────────────────────────────────
const navMain = [
  { href: "/", icon: Upload, label: "Catalog Upload" },
  { href: "/admin/catalog-upload", icon: FileText, label: "Catalog PDF" },
];

const navDiscovery = [
  { href: "/admin/dashboard",       icon: LayoutDashboard, label: "Dashboard" },
  { href: "/admin/discovery",       icon: CheckSquare,     label: "Discovery Queue" },
  { href: "/admin/scanner",         icon: Activity,        label: "Manual Scanner" },
  { href: "/admin/image-discovery", icon: ImageIcon,       label: "AI Image Discovery", accent: true },
  { href: "/admin/image-sync",      icon: ImageIcon,       label: "Image Sync" },
  { href: "/admin/specs-translator", icon: Languages,       label: "Specs Translator" },
];

const navTools = [
  { href: "/admin/wix-translations", icon: Languages, label: "Dịch đa ngôn ngữ", accent: true },
  { href: "/admin/tools/wix-translation-sync", icon: Languages, label: "Wix Translation Sync" },
  { href: "/admin/tools/cms-merge", icon: Database, label: "CMS Merge Tool" },
  { href: "/admin/media", icon: HardDrive, label: "Media Manager" },
];

// Mobile bottom bar (top 4 routes only)
const navMobile = [
  { href: "/",                      icon: Upload,          label: "Upload" },
  { href: "/admin/dashboard",       icon: LayoutDashboard, label: "Dashboard" },
  { href: "/admin/discovery",       icon: CheckSquare,     label: "Queue" },
  { href: "/admin/image-discovery", icon: ImageIcon,       label: "AI Images" },
];

// ─── Breadcrumb map ────────────────────────────────────────────────────────
const breadcrumbMap: Record<string, { label: string; parent?: string }> = {
  "/":                          { label: "Catalog Upload" },
  "/admin/catalog-upload":      { label: "Catalog PDF",       parent: "Main" },
  "/admin/dashboard":           { label: "Dashboard",         parent: "Discovery" },
  "/admin/discovery":           { label: "Discovery Queue",   parent: "Discovery" },
  "/admin/scanner":             { label: "Manual Scanner",    parent: "Discovery" },
  "/admin/image-discovery":     { label: "AI Image Discovery", parent: "Discovery" },
  "/admin/image-sync":          { label: "Image Sync",        parent: "Discovery" },
  "/admin/specs-translator":    { label: "Specs Translator",  parent: "Discovery" },
  "/admin/wix-translations":    { label: "Dịch đa ngôn ngữ",  parent: "Tools" },
  "/admin/tools/wix-translation-sync": { label: "Wix Translation Sync", parent: "Tools" },
  "/admin/tools/cms-merge":     { label: "CMS Merge Tool",   parent: "Tools" },
  "/admin/media":               { label: "Media Manager",    parent: "Tools" },
};

function Breadcrumb({ pathname }: { pathname: string }) {
  const entry = breadcrumbMap[pathname];
  const isProduct = pathname.startsWith("/products/");

  if (isProduct) {
    const slug = pathname.split("/products/")[1] || "";
    return (
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span>Products</span>
        <ChevronRight className="w-3.5 h-3.5" />
        <span className="text-foreground font-medium capitalize">{slug.replace(/-/g, " ")}</span>
      </div>
    );
  }

  if (!entry) return null;

  return (
    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
      {entry.parent && (
        <>
          <span>{entry.parent}</span>
          <ChevronRight className="w-3.5 h-3.5" />
        </>
      )}
      <span className="text-foreground font-medium">{entry.label}</span>
    </div>
  );
}

// ─── NavLink (triggers loading overlay on click) ───────────────────────────
function NavLink({
  href,
  icon: Icon,
  label,
  active,
  accent,
  onNavigate,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  active: boolean;
  accent?: boolean;
  onNavigate: (dest: string) => void;
}) {
  return (
    <Link
      href={href}
      onClick={() => {
        if (!active) onNavigate(href);
      }}
      className={cn(
        "flex items-center gap-3 w-full rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
        active
          ? "nav-active"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      )}
    >
      <Icon
        className={cn(
          "w-4 h-4 shrink-0",
          active ? "text-primary" : accent ? "text-primary/70" : "opacity-70"
        )}
      />
      <span className="truncate">{label}</span>
    </Link>
  );
}

// ─── Main Layout ───────────────────────────────────────────────────────────
export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { fileName, sheets, activeSheetIndex, setActiveSheet } = useDataStore();
  const [isDarkMode, setIsDarkMode] = React.useState(false);
  const [showSignOutDialog, setShowSignOutDialog] = React.useState(false);
  const pathname = usePathname();
  const { startLoading } = useNavLoading();

  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
    document.documentElement.classList.toggle("dark");
  };

  return (
    <div className={cn("flex h-screen w-full bg-background overflow-hidden", isDarkMode && "dark")}>

      {/* ── Sidebar (desktop) ────────────────────────────────────────── */}
      <aside className="w-64 flex-col border-r border-border/60 bg-sidebar hidden md:flex shadow-sm">

        {/* Logo */}
        <div className="h-16 px-5 flex items-center gap-3 border-b border-border/60">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-md shadow-primary/30 shrink-0">
            <Zap className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <span className="font-bold text-base tracking-tight leading-none">AV Catalog</span>
            <span className="block text-[10px] text-muted-foreground font-medium tracking-wider uppercase mt-0.5">
              Admin
            </span>
          </div>
        </div>

        {/* Nav scroll area */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-5">

          {/* Main */}
          <div>
            <p className="px-3 mb-1.5 text-[10px] font-bold tracking-widest text-muted-foreground/60 uppercase">
              Main
            </p>
            <div className="space-y-0.5">
              {navMain.map(item => (
                <NavLink
                  key={item.href}
                  href={item.href}
                  icon={item.icon}
                  label={item.label}
                  active={pathname === item.href}
                  onNavigate={startLoading}
                />
              ))}
            </div>
          </div>

          <Separator className="opacity-50" />

          {/* Discovery & Sync */}
          <div>
            <p className="px-3 mb-1.5 text-[10px] font-bold tracking-widest text-muted-foreground/60 uppercase">
              Discovery & Sync
            </p>
            <div className="space-y-0.5">
              {navDiscovery.map(item => (
                <NavLink
                  key={item.href}
                  href={item.href}
                  icon={item.icon}
                  label={item.label}
                  active={pathname === item.href}
                  accent={item.accent}
                  onNavigate={startLoading}
                />
              ))}
            </div>
          </div>

          <Separator className="opacity-50" />

          {/* Tools */}
          <div>
            <p className="px-3 mb-1.5 text-[10px] font-bold tracking-widest text-muted-foreground/60 uppercase">
              Tools
            </p>
            <div className="space-y-0.5">
              {navTools.map(item => (
                <NavLink
                  key={item.href}
                  href={item.href}
                  icon={item.icon}
                  label={item.label}
                  active={pathname === item.href}
                  onNavigate={startLoading}
                />
              ))}
            </div>
          </div>

          <Separator className="opacity-50" />

          {/* Sheets / Brands */}
          {sheets.length > 0 && (
            <div>
              <p className="px-3 mb-1.5 text-[10px] font-bold tracking-widest text-muted-foreground/60 uppercase">
                Sheets / Brands
              </p>
              <div className="space-y-0.5">
                {sheets.map((sheet, index) => (
                  <button
                    key={index}
                    onClick={() => setActiveSheet(index)}
                    className={cn(
                      "flex items-center gap-2.5 w-full rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150 text-left",
                      activeSheetIndex === index
                        ? "nav-active"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    )}
                  >
                    <ChevronRight
                      className={cn(
                        "w-3 h-3 shrink-0 transition-transform",
                        activeSheetIndex === index && "rotate-90 text-primary"
                      )}
                    />
                    <span className="truncate flex-1">{sheet.brandName}</span>
                    <Badge
                      variant="outline"
                      className="ml-auto text-[10px] px-1.5 py-0 h-4 shrink-0"
                    >
                      {sheet.rows.length}
                    </Badge>
                  </button>
                ))}
              </div>
            </div>
          )}

          {sheets.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground/60 italic">
              No file uploaded
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border/60 p-3 space-y-2">
          {/* User row */}
          <div className="flex items-center gap-3 px-2 py-1.5">
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary to-primary/60 flex items-center justify-center text-xs font-bold text-primary-foreground shrink-0 shadow">
              AA
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium leading-none truncate">Admin User</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Enterprise Plan</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={toggleDarkMode}
              title={isDarkMode ? "Light mode" : "Dark mode"}
            >
              {isDarkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            </Button>
          </div>

          <Button
            variant="ghost"
            className="w-full justify-start gap-2.5 text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/5 h-8"
            onClick={() => setShowSignOutDialog(true)}
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </Button>

          <p className="text-center text-[10px] text-muted-foreground/40 pt-1">
            v1.0.0
          </p>
        </div>
      </aside>

      {/* ── Main Content ─────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0 bg-muted/20 bg-grid">

        {/* Header */}
        <header className="h-16 border-b border-border/60 flex items-center justify-between px-6 bg-card/70 backdrop-blur-md sticky top-0 z-10 shrink-0">
          {/* Breadcrumb */}
          <Breadcrumb pathname={pathname} />

          {/* Right section */}
          <div className="flex items-center gap-3">
            {fileName && (
              <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground bg-primary/5 border border-primary/15 px-3 py-1.5 rounded-lg">
                <Database className="w-3 h-3 text-primary" />
                <span className="font-medium truncate max-w-[180px]">{fileName}</span>
              </div>
            )}
            <div className="h-6 w-px bg-border/60" />
            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary to-primary/60 flex items-center justify-center text-xs font-bold text-primary-foreground shadow">
              AA
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6 md:p-8 max-w-[1600px] mx-auto space-y-8">
            {children}
          </div>
        </div>
      </main>

      {/* ── Mobile Bottom Navigation ──────────────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-lg border-t border-border/60 flex items-stretch h-16 safe-area-inset-bottom shadow-2xl shadow-black/20">
        {navMobile.map(item => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => {
                if (!active) startLoading(item.href);
              }}
              className={cn(
                "flex-1 flex flex-col items-center justify-center gap-1 transition-colors text-[10px] font-medium relative",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <item.icon className={cn("w-5 h-5", active && "text-primary")} />
              <span>{item.label}</span>
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-b-full" />
              )}
            </Link>
          );
        })}
      </nav>

      {/* ── Sign Out Confirmation ─────────────────────────────────────── */}
      <AlertDialog open={showSignOutDialog} onOpenChange={setShowSignOutDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to sign out of AV Catalog Manager?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setShowSignOutDialog(false);
                await logoutAction();
              }}
            >
              Sign Out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
