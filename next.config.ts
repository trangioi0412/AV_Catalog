import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ["192.168.1.101", "10.150.105.188", "192.168.1.109, 172.16.13.121"],
  serverExternalPackages: ["xlsx"],
  // Next 16 forwards browser console output to the terminal in dev over an
  // internal WebSocket with a fixed max payload — an oversized browser-side
  // console message (which one is impossible to pin down: Next intentionally
  // hides every app frame from the resulting stack as "ignore-listed") throws
  // an UNCAUGHT `RangeError: Max payload size exceeded` at that WS layer,
  // which crashes the entire dev server process, not just one request. This
  // has now recurred repeatedly. Disabling the forwarding feature removes the
  // crash vector outright; it only affects mirroring browser console output
  // into the terminal — the terminal still shows all server-side logs.
  logging: {
    browserToTerminal: false,
  },
  images: {
    // Wix's media CDN — product photos referenced via wix:image:// are
    // resolved to https://static.wixstatic.com/{media,ugd}/... by
    // transformWixImageUrl(). Required for next/image to optimize them
    // (resize/WebP/AVIF/lazy-load) instead of shipping full-resolution
    // source files to every visitor.
    remotePatterns: [
      {
        protocol: "https",
        hostname: "static.wixstatic.com",
        pathname: "/**",
      },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
  turbopack: {
    resolveAlias: {
      fs: { browser: "empty" },
      net: { browser: "empty" },
      tls: { browser: "empty" },
      child_process: { browser: "empty" },
    },
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        child_process: false,
      };
    }
    return config;
  },
};

export default nextConfig;



