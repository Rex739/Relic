import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Relic",
  description: "Evidence-backed change intelligence for legacy systems.",
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/brand/RelicFavicon.svg", type: "image/svg+xml" },
      { url: "/brand/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/brand/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    other: [
      { rel: "icon", url: "/brand/icon-192.png", sizes: "192x192", type: "image/png" },
      { rel: "icon", url: "/brand/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#141512",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
