import type { NextConfig } from "next";

type WebpackConfig = {
  resolve: {
    alias?: Record<string, string | false>;
    extensionAlias?: Record<string, string[]>;
  };
};

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@relic/domain"],
  webpack(config: WebpackConfig): WebpackConfig {
    config.resolve.alias = {
      ...config.resolve.alias,
      // Privy declares this as an optional peer. Relic is EVM-only and never
      // loads Farcaster's Solana mini-app connector.
      "@farcaster/mini-app-solana": false,
    };
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
