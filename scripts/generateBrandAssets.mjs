import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const brandDir = path.join(root, "public", "brand");

const exports = [
  { source: "RelicMark.svg", output: "relic-mark-1024.png", width: 1024, height: 1024 },
  { source: "RelicMark.svg", output: "relic-mark-512.png", width: 512, height: 512 },
  { source: "RelicMark.svg", output: "relic-mark-256.png", width: 256, height: 256 },
  { source: "RelicLogoDark.svg", output: "relic-logo-dark.png", width: 1600, height: 380 },
  { source: "RelicLogoLight.svg", output: "relic-logo-light.png", width: 1600, height: 380 },
  { source: "RelicFavicon.svg", output: "favicon-64.png", width: 64, height: 64 },
  { source: "RelicFavicon.svg", output: "favicon-32.png", width: 32, height: 32 },
  { source: "RelicFavicon.svg", output: "favicon-16.png", width: 16, height: 16 },
  { source: "RelicFavicon.svg", output: "apple-touch-icon.png", width: 180, height: 180 },
  { source: "RelicFavicon.svg", output: "icon-192.png", width: 192, height: 192 },
  { source: "RelicFavicon.svg", output: "icon-512.png", width: 512, height: 512 },
];

await mkdir(brandDir, { recursive: true });

await Promise.all(
  exports.map(({ source, output, width, height }) =>
    sharp(path.join(brandDir, source))
      .resize(width, height, { fit: "contain" })
      .png({ compressionLevel: 9, adaptiveFiltering: true })
      .toFile(path.join(brandDir, output)),
  ),
);

console.log(`Generated ${exports.length} brand assets in public/brand`);
