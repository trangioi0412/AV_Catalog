import type { Metadata, Viewport } from "next";
import { Be_Vietnam_Pro, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { NavigationLoadingProvider } from "@/components/layout/NavigationLoadingProvider";

// Be Vietnam Pro ships a "vietnamese" subset, so diacritics render in-font
// instead of falling back to a system face. Every subset × weight listed here
// is preloaded on every page, so keep both lists to what the UI uses
// (font-black/900 falls back to 800).
const beVietnam = Be_Vietnam_Pro({
  variable: "--font-be-vietnam",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
  // Only used for code/IDs — not worth a preload on every page.
  preload: false,
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1226" },
  ],
};

export const metadata: Metadata = {
  title: {
    default: "AVS-TEK Catalog Manager",
    template: "%s | AVS-TEK Catalog",
  },
  description:
    "Hệ thống quản lý catalog sản phẩm AV chuyên nghiệp — upload, validate, enrich và đồng bộ lên Wix Studio CMS.",
  keywords: ["AV catalog", "product management", "Wix CMS", "catalog upload"],
  robots: { index: false, follow: false }, // internal admin tool
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="vi"
      className={`${beVietnam.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      {/*
       * Inline script runs before React hydration to apply the saved theme
       * class instantly — prevents the "flash of wrong theme" on page load.
       */}
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var t = localStorage.getItem('av-theme');
                if (t === 'dark') document.documentElement.classList.add('dark');
              } catch(e) {}
            `,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <TooltipProvider>
          <NavigationLoadingProvider>
            {children}
          </NavigationLoadingProvider>
        </TooltipProvider>
        <Toaster
          position="bottom-right"
          richColors
          closeButton
          toastOptions={{
            style: { fontFamily: "var(--font-sans)" },
          }}
        />
      </body>
    </html>
  );
}
