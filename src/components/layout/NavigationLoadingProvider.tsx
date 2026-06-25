"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Zap } from "lucide-react";

// ─── Route labels ─────────────────────────────────────────────────────────────
const routeLabels: Record<string, string> = {
  "/":                       "Catalog Upload",
  "/admin/dashboard":        "Discovery Dashboard",
  "/admin/discovery":        "Discovery Queue",
  "/admin/scanner":          "Manual Scanner",
  "/admin/image-discovery":  "AI Image Discovery",
  "/admin/image-sync":       "Image Sync",
  "/admin/tools/wix-translation-sync": "Wix Translation Sync",
};

function getRouteLabel(pathname: string): string {
  if (pathname.startsWith("/products/")) {
    const slug = pathname.split("/products/")[1] || "";
    return slug
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }
  return routeLabels[pathname] ?? "Loading page";
}

// ─── Context ──────────────────────────────────────────────────────────────────
interface NavLoadingCtx {
  startLoading: (dest?: string) => void;
}

export const NavigationLoadingContext = React.createContext<NavLoadingCtx>({
  startLoading: () => {},
});

export function useNavLoading() {
  return React.useContext(NavigationLoadingContext);
}

// ─── Shimmer progress bar ─────────────────────────────────────────────────────
function ShimmerBar() {
  return (
    <div className="w-full h-1 bg-primary/15 rounded-full overflow-hidden relative">
      <motion.div
        className="absolute top-0 bottom-0 left-0 w-[35%] bg-primary rounded-full"
        animate={{ left: ["-35%", "105%"] }}
        transition={{
          repeat: Infinity,
          duration: 1.4,
          ease: "easeInOut",
          repeatDelay: 0.2,
        }}
      />
    </div>
  );
}

// ─── Spinning logo ring ───────────────────────────────────────────────────────
function SpinnerLogo() {
  return (
    <div className="relative w-16 h-16 flex items-center justify-center">
      {/* Static ring */}
      <div className="absolute inset-0 rounded-full border-4 border-primary/15" />
      {/* Spinning arc */}
      <motion.div
        className="absolute inset-0 rounded-full border-4 border-transparent border-t-primary"
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 0.9, ease: "linear" }}
      />
      {/* Center logo */}
      <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-lg shadow-primary/30">
        <Zap className="w-4 h-4 text-primary-foreground" />
      </div>
    </div>
  );
}

// ─── Overlay popup ────────────────────────────────────────────────────────────
function LoadingOverlay({
  visible,
  destination,
}: {
  visible: boolean;
  destination: string;
}) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="nav-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/70 backdrop-blur-sm"
        >
          {/* Card popup */}
          <motion.div
            initial={{ opacity: 0, scale: 0.93, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 6 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-center gap-5 px-10 py-8 rounded-2xl bg-card border border-border/60 shadow-2xl shadow-black/10 w-[280px]"
          >
            <SpinnerLogo />

            <div className="text-center space-y-1">
              <p className="text-sm font-semibold text-foreground">
                Đang chuyển trang...
              </p>
              <p className="text-xs text-primary font-medium truncate max-w-[200px]">
                {destination}
              </p>
            </div>

            <ShimmerBar />

            <p className="text-[10px] text-muted-foreground/60 -mt-1">
              Đang tải dữ liệu từ server
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Top progress bar (NProgress-style) ──────────────────────────────────────
function TopProgressBar({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="top-bar"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed top-0 left-0 right-0 z-[10000] h-[3px] overflow-hidden"
        >
          <motion.div
            className="h-full bg-primary rounded-r-full shadow-lg shadow-primary/40"
            initial={{ width: "0%" }}
            animate={{ width: "88%" }}
            transition={{ duration: 3, ease: [0.1, 0.4, 0.6, 1] }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Provider (wraps the whole app in layout.tsx) ─────────────────────────────
export function NavigationLoadingProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [isLoading, setIsLoading] = React.useState(false);
  const [destination, setDestination] = React.useState("");

  // When the pathname actually changes → navigation is done → hide overlay
  React.useEffect(() => {
    setIsLoading(false);
  }, [pathname]);

  // Safety timeout: always hide after 8 seconds even if route never changes
  React.useEffect(() => {
    if (!isLoading) return;
    const t = setTimeout(() => setIsLoading(false), 8000);
    return () => clearTimeout(t);
  }, [isLoading]);

  const startLoading = React.useCallback((dest?: string) => {
    const label = dest ? getRouteLabel(dest) : "Loading...";
    setDestination(label);
    setIsLoading(true);
  }, []);

  return (
    <NavigationLoadingContext.Provider value={{ startLoading }}>
      {children}
      <TopProgressBar visible={isLoading} />
      <LoadingOverlay visible={isLoading} destination={destination} />
    </NavigationLoadingContext.Provider>
  );
}
