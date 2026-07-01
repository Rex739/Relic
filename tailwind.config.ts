import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#F2F0EA",
        raised: "#FAF9F5",
        ink: "#141512",
        muted: "#62665E",
        line: "#D9D7CF",
        moss: "#4E6253",
        sage: "#AEB9AA",
        ochre: "#B46E2A",
        blocked: "#A9483F",
        approved: "#3D694D",
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};

export default config;
