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
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            // This follows Privy's recommended baseline while permitting profile
            // images hosted by verified agents. The Privy and WalletConnect
            // origins are required for their embedded wallet flows.
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // Next.js App Router streams each Suspense boundary with inline
              // handoff scripts. Without this, browsers retain the loading
              // boundary even after the server has sent the page payload.
              "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
              "frame-ancestors 'none'",
              "child-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org",
              "frame-src https://auth.privy.io https://verify.walletconnect.com https://verify.walletconnect.org https://challenges.cloudflare.com",
              "connect-src 'self' https://auth.privy.io wss://relay.walletconnect.com wss://relay.walletconnect.org wss://www.walletlink.org https://*.rpc.privy.systems https://explorer-api.walletconnect.com",
              "worker-src 'self'",
              "manifest-src 'self'",
            ].join("; "),
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
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
