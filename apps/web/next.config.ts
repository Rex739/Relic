import type { NextConfig } from "next";

type WebpackConfig = {
  resolve: {
    extensionAlias?: Record<string, string[]>;
  };
};

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@relic/domain"],
  webpack(config: WebpackConfig): WebpackConfig {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    return config;
  },
};

export default nextConfig;
