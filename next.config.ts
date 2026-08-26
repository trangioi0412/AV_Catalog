import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: ["192.168.1.101", "10.150.105.188", "192.168.1.109, 172.16.13.121"],
  serverExternalPackages: ["xlsx"],
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



