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
  Layers,
  Bot,
  RefreshCw,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useDataStore, ALL_SHEETS_INDEX } from "@/store/useDataStore";
import { cn } from "@/lib/utils";
import type { SheetData } from "@/types";
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
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ─── Nav item definitions ──────────────────────────────────────────────────
const navMain = [
  { href: "/", icon: Upload, label: "Tải lên Catalog" },
  { href: "/admin/catalog-upload", icon: FileText, label: "Catalog PDF" },
];

const navDiscovery = [
  { href: "/admin/dashboard",       icon: LayoutDashboard, label: "Tổng quan" },
  { href: "/admin/discovery",       icon: CheckSquare,     label: "Hàng đợi Discovery" },
  { href: "/admin/scanner",         icon: Activity,        label: "Quét thủ công" },
  { href: "/admin/image-sync",      icon: ImageIcon,       label: "Đồng bộ hình ảnh" },
  { href: "/admin/specs-translator", icon: Languages,       label: "Dịch thông số" },
];

const navDataCrawler = [
  { href: "/admin/manufacturer-sync", icon: RefreshCw, label: "Đồng Bộ NSX (DataCrawler)", accent: true },
];

const navTools = [
  { href: "/admin/wix-translations", icon: Languages, label: "Dịch đa ngôn ngữ", accent: true },
  { href: "/admin/tools/cms-translate", icon: Languages, label: "Dịch CMS Anh → Việt" },
  { href: "/admin/tools/wix-translation-sync", icon: Languages, label: "Wix Translation Sync" },
  { href: "/admin/tools/cms-merge", icon: Database, label: "Gộp CMS" },
  { href: "/admin/tools/cms-ai-review", icon: Bot, label: "AI Kiểm Tra CMS", accent: true },
  { href: "/admin/media", icon: HardDrive, label: "Quản lý Media" },
];

const navMobile = [
  { href: "/",                      icon: Upload,          label: "Tải lên" },
  { href: "/admin/dashboard",       icon: LayoutDashboard, label: "Tổng quan" },
  { href: "/admin/discovery",       icon: CheckSquare,     label: "Hàng đợi" },
  { href: "/admin/manufacturer-sync", icon: RefreshCw,     label: "Đồng bộ" },
];

// ─── Breadcrumb map ────────────────────────────────────────────────────────
const breadcrumbMap: Record<string, { label: string; parent?: string }> = {
  "/":                          { label: "Tải lên Catalog" },
  "/admin/catalog-upload":      { label: "Catalog PDF",       parent: "Chính" },
  "/admin/dashboard":           { label: "Tổng quan",         parent: "Khám phá & Đồng bộ" },
  "/admin/discovery":           { label: "Hàng đợi Discovery", parent: "Khám phá & Đồng bộ" },
  "/admin/scanner":             { label: "Quét thủ công",     parent: "Khám phá & Đồng bộ" },
  "/admin/image-sync":          { label: "Đồng bộ hình ảnh",  parent: "Khám phá & Đồng bộ" },
  "/admin/specs-translator":    { label: "Dịch thông số",     parent: "Khám phá & Đồng bộ" },
  "/admin/manufacturer-sync":   { label: "Đồng Bộ NSX (DataCrawler)", parent: "DataCrawler" },
  "/admin/wix-translations":    { label: "Dịch đa ngôn ngữ",  parent: "Công cụ" },
  "/admin/tools/cms-translate": { label: "Dịch CMS Anh → Việt", parent: "Công cụ" },
  "/admin/tools/wix-translation-sync": { label: "Wix Translation Sync", parent: "Công cụ" },
  "/admin/tools/cms-merge":     { label: "Gộp CMS",          parent: "Công cụ" },
  "/admin/tools/cms-ai-review": { label: "AI Kiểm Tra CMS",  parent: "Công cụ" },
  "/admin/media":               { label: "Quản lý Media",    parent: "Công cụ" },
};

function Breadcrumb({ pathname }: { pathname: string }) {
  const entry = breadcrumbMap[pathname];
  const isProduct = pathname.startsWith("/products/");

  if (isProduct) {
    const slug = pathname.split("/products/")[1] || "";
    return (
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span>Sản phẩm</span>
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
          <span className="hidden sm:inline">{entry.parent}</span>
          <ChevronRight className="w-3.5 h-3.5 hidden sm:inline" />
        </>
      )}
      <span className="text-foreground font-medium">{entry.label}</span>
    </div>
  );
}

// ─── NavLink (supports collapsed icon-only mode) ──────────────────────────
function NavLink({
  href,
  icon: Icon,
  label,
  active,
  accent,
  collapsed,
  onNavigate,
}: {
  href: string;
  icon: React.ElementType;
  label: string;
  active: boolean;
  accent?: boolean;
  collapsed?: boolean;
  onNavigate: (dest: string) => void;
}) {
  const inner = (
    <Link
      href={href}
      onClick={() => {
        if (!active) onNavigate(href);
      }}
      className={cn(
        "flex items-center gap-3 w-full rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
        collapsed && "justify-center px-2",
        active
          ? "nav-active"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      )}
      aria-current={active ? "page" : undefined}
    >
      <Icon
        className={cn(
          "w-4 h-4 shrink-0",
          active ? "text-primary" : accent ? "text-primary/70" : "opacity-70"
        )}
      />
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{inner}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    );
  }
  return inner;
}

// ─── NavSection (group of nav items with a label) ─────────────────────────
function NavSection({
  label,
  collapsed,
  children,
}: {
  label: string;
  collapsed: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      {!collapsed && (
        <p className="px-3 mb-1.5 text-xs font-bold tracking-widest text-muted-foreground uppercase">
          {label}
        </p>
      )}
      {collapsed && <div className="h-1" />}
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

// ─── Sidebar inner content (shared between desktop & mobile sheet) ─────────
function SidebarContent({
  collapsed,
  pathname,
  sheets,
  activeSheetIndex,
  fileName,
  isDarkMode,
  onNavigate,
  onToggleDark,
  onSignOut,
  onToggleCollapse,
}: {
  collapsed: boolean;
  pathname: string;
  sheets: SheetData[];
  activeSheetIndex: number;
  fileName: string | null;
  isDarkMode: boolean;
  onNavigate: (dest: string) => void;
  onToggleDark: () => void;
  onSignOut: () => void;
  onToggleCollapse?: () => void;
}) {
  const { setActiveSheet } = useDataStore();
  return (
    <>
      {/* Logo */}
      <div
        className={cn(
          "h-16 flex items-center border-b border-border/60 shrink-0",
          collapsed ? "justify-center px-2" : "gap-3 px-5"
        )}
      >
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--brand-navy)] to-[var(--brand-blue)] flex items-center justify-center shadow-md shadow-primary/30 shrink-0">
          <Zap className="w-4 h-4 text-white" aria-hidden="true" />
        </div>
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <span className="block font-bold text-base tracking-tight leading-none truncate">AVS-TEK</span>
            <span className="block text-xs text-muted-foreground font-medium tracking-wider uppercase mt-0.5">
              Catalog Admin
            </span>
          </div>
        )}
        {onToggleCollapse && (
          <Button
            variant="ghost"
            size="icon"
            className={cn("h-7 w-7 shrink-0 text-muted-foreground", collapsed && "hidden")}
            onClick={onToggleCollapse}
            title="Thu gọn sidebar"
            aria-label="Thu gọn sidebar"
          >
            <PanelLeftClose className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* Nav scroll area */}
      <div className={cn("flex-1 overflow-y-auto py-4 space-y-5", collapsed ? "px-2" : "px-3")}>

        {/* Main */}
        <NavSection label="Chính" collapsed={collapsed}>
          {navMain.map(item => (
            <NavLink
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={item.label}
              active={pathname === item.href}
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
          ))}
        </NavSection>

        {!collapsed && <Separator className="opacity-50" />}

        {/* Discovery & Sync */}
        <NavSection label="Khám phá & Đồng bộ" collapsed={collapsed}>
          {navDiscovery.map(item => (
            <NavLink
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={item.label}
              active={pathname === item.href}
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
          ))}
        </NavSection>

        {!collapsed && <Separator className="opacity-50" />}

        {/* DataCrawler */}
        <NavSection label="DataCrawler" collapsed={collapsed}>
          {navDataCrawler.map(item => (
            <NavLink
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={item.label}
              active={pathname === item.href}
              accent={item.accent}
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
          ))}
        </NavSection>

        {!collapsed && <Separator className="opacity-50" />}

        {/* Tools */}
        <NavSection label="Công cụ" collapsed={collapsed}>
          {navTools.map(item => (
            <NavLink
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={item.label}
              active={pathname === item.href}
              collapsed={collapsed}
              onNavigate={onNavigate}
            />
          ))}
        </NavSection>

        {!collapsed && <Separator className="opacity-50" />}

        {/* Sheets / Brands */}
        {!collapsed && sheets.length > 0 && (
          <div>
            <p className="px-3 mb-1.5 text-xs font-bold tracking-widest text-muted-foreground uppercase">
              Sheets / Brands
            </p>
            <div className="space-y-0.5">
              <button
                onClick={() => setActiveSheet(ALL_SHEETS_INDEX)}
                className={cn(
                  "flex items-center gap-2.5 w-full rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150 text-left",
                  activeSheetIndex === ALL_SHEETS_INDEX
                    ? "nav-active"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
                aria-current={activeSheetIndex === ALL_SHEETS_INDEX ? "true" : undefined}
              >
                <Layers
                  className={cn(
                    "w-3.5 h-3.5 shrink-0",
                    activeSheetIndex === ALL_SHEETS_INDEX && "text-primary"
                  )}
                />
                <span className="truncate flex-1">Tất cả sản phẩm</span>
                <Badge
                  variant="outline"
                  className="ml-auto text-xs px-1.5 py-0 h-4 shrink-0"
                >
                  {sheets.reduce((acc, sheet) => acc + sheet.rows.length, 0)}
                </Badge>
              </button>
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
                  aria-current={activeSheetIndex === index ? "true" : undefined}
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
                    className="ml-auto text-xs px-1.5 py-0 h-4 shrink-0"
                  >
                    {sheet.rows.length}
                  </Badge>
                </button>
              ))}
            </div>
          </div>
        )}

        {!collapsed && sheets.length === 0 && (
          <div className="px-3 py-2 text-xs text-muted-foreground italic">
            Chưa tải file nào
          </div>
        )}
      </div>

      {/* Footer */}
      <div className={cn("border-t border-border/60 p-3 space-y-2 shrink-0", collapsed && "px-2")}>
        {!collapsed ? (
          <>
            {/* User row */}
            <div className="flex items-center gap-3 px-2 py-1.5">
              <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary to-primary/60 flex items-center justify-center text-xs font-bold text-primary-foreground shrink-0 shadow">
                AA
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-none truncate">Quản trị viên</p>
                <p className="text-xs text-muted-foreground mt-0.5">AVS-TEK</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={onToggleDark}
                title={isDarkMode ? "Chế độ sáng" : "Chế độ tối"}
                aria-label={isDarkMode ? "Chuyển sang chế độ sáng" : "Chuyển sang chế độ tối"}
              >
                {isDarkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              </Button>
            </div>

            <Button
              variant="ghost"
              className="w-full justify-start gap-2.5 text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/5 h-8"
              onClick={onSignOut}
            >
              <LogOut className="w-4 h-4" aria-hidden="true" />
              Đăng xuất
            </Button>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={onToggleDark}
                  aria-label={isDarkMode ? "Chuyển sang chế độ sáng" : "Chuyển sang chế độ tối"}
                >
                  {isDarkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{isDarkMode ? "Chế độ sáng" : "Chế độ tối"}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/5"
                  onClick={onSignOut}
                  aria-label="Đăng xuất"
                >
                  <LogOut className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">Đăng xuất</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Persisted UI prefs (localStorage-backed external store) ─────────────
const prefListeners = new Set<() => void>();

function subscribePrefs(listener: () => void) {
  prefListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    prefListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode) — state simply won't persist.
  }
  prefListeners.forEach(l => l());
}

// ─── Main Layout ───────────────────────────────────────────────────────────
export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { fileName, sheets, activeSheetIndex } = useDataStore();
  const pathname = usePathname();
  const { startLoading } = useNavLoading();

  // Persisted UI prefs read via useSyncExternalStore: the server snapshot is
  // the default, the client snapshot comes from localStorage, so hydration
  // never mismatches. The root layout's inline script applies "dark" pre-paint.
  const isDarkMode = React.useSyncExternalStore(
    subscribePrefs,
    () => readPref("av-theme") === "dark",
    () => false
  );
  const sidebarCollapsed = React.useSyncExternalStore(
    subscribePrefs,
    () => readPref("av-sidebar-collapsed") === "true",
    () => false
  );
  const [showSignOutDialog, setShowSignOutDialog] = React.useState(false);
  const [mobileSheetOpen, setMobileSheetOpen] = React.useState(false);

  const toggleDarkMode = () => {
    const next = !isDarkMode;
    document.documentElement.classList.toggle("dark", next);
    writePref("av-theme", next ? "dark" : "light");
  };

  const toggleSidebar = () => {
    writePref("av-sidebar-collapsed", String(!sidebarCollapsed));
  };

  const sidebarProps = {
    pathname,
    sheets,
    activeSheetIndex,
    fileName,
    isDarkMode,
    onNavigate: startLoading,
    onToggleDark: toggleDarkMode,
    onSignOut: () => setShowSignOutDialog(true),
  };

  return (
    <div className="flex h-dvh w-full bg-background overflow-hidden">

      {/* ── Skip to content ───────────────────────────────────────────── */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[200] focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-lg focus:font-medium focus:shadow-lg"
      >
        Bỏ qua điều hướng
      </a>

      {/* ── Sidebar (desktop) ─────────────────────────────────────────── */}
      <aside
        className={cn(
          "flex-col border-r border-border/60 bg-sidebar hidden md:flex shadow-sm transition-all duration-300 ease-in-out",
          sidebarCollapsed ? "w-[60px]" : "w-64"
        )}
        aria-label="Điều hướng chính"
      >
        <SidebarContent
          {...sidebarProps}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
        />
      </aside>

      {/* ── Main Content ──────────────────────────────────────────────── */}
      <main id="main-content" className="flex-1 flex flex-col min-w-0 bg-muted/20 bg-grid">

        {/* Header */}
        <header className="h-16 border-b border-border/60 flex items-center justify-between px-4 sm:px-6 bg-card/70 backdrop-blur-md sticky top-0 z-10 shrink-0">
          
          {/* Left: sidebar expand (collapsed desktop) + mobile menu + breadcrumb */}
          <div className="flex items-center gap-3">
            {/* Desktop: re-expand collapsed sidebar */}
            {sidebarCollapsed && (
              <Button
                variant="ghost"
                size="icon"
                className="hidden md:flex h-8 w-8 text-muted-foreground"
                onClick={toggleSidebar}
                title="Mở rộng sidebar"
                aria-label="Mở rộng sidebar"
              >
                <PanelLeftOpen className="w-4 h-4" />
              </Button>
            )}

            {/* Mobile: sheet trigger */}
            <Sheet open={mobileSheetOpen} onOpenChange={setMobileSheetOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="touch-target md:hidden h-10 w-10"
                  aria-label="Mở menu điều hướng"
                >
                  <Menu className="w-5 h-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0 flex flex-col bg-sidebar">
                <SidebarContent
                  {...sidebarProps}
                  collapsed={false}
                  onNavigate={(dest) => { setMobileSheetOpen(false); startLoading(dest); }}
                  onSignOut={() => { setMobileSheetOpen(false); setShowSignOutDialog(true); }}
                />
              </SheetContent>
            </Sheet>

            <Breadcrumb pathname={pathname} />
          </div>

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
            <div
              className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary to-primary/60 flex items-center justify-center text-xs font-bold text-primary-foreground shadow"
              title="Quản trị viên"
              role="img"
              aria-label="Quản trị viên"
            >
              AA
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-4 sm:p-6 md:p-8 pb-bottom-nav md:pb-8 max-w-[1600px] mx-auto space-y-8">
            {children}
          </div>
        </div>
      </main>

      {/* ── Mobile Bottom Navigation ───────────────────────────────────── */}
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-lg border-t border-border/60 flex items-stretch h-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom,0px))] pb-safe shadow-2xl shadow-black/20"
        aria-label="Điều hướng nhanh"
      >
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
                "touch-target flex-1 flex flex-col items-center justify-center gap-1 transition-colors text-xs font-medium relative cursor-pointer",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
              aria-current={active ? "page" : undefined}
            >
              <item.icon className={cn("w-5 h-5", active && "text-primary")} />
              <span>{item.label}</span>
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-b-full" />
              )}
            </Link>
          );
        })}
        {/* Extra: Mobile menu for full nav access */}
        <button
          className="touch-target flex-1 flex flex-col items-center justify-center gap-1 transition-colors text-xs font-medium text-muted-foreground hover:text-foreground cursor-pointer"
          onClick={() => setMobileSheetOpen(true)}
          aria-label="Tất cả menu"
        >
          <Menu className="w-5 h-5" />
          <span>Thêm</span>
        </button>
      </nav>

      {/* ── Sign Out Confirmation ──────────────────────────────────────── */}
      <AlertDialog open={showSignOutDialog} onOpenChange={setShowSignOutDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Đăng xuất?</AlertDialogTitle>
            <AlertDialogDescription>
              Bạn có chắc muốn đăng xuất khỏi AVS-TEK Catalog Manager?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setShowSignOutDialog(false);
                await logoutAction();
              }}
            >
              Đăng xuất
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
