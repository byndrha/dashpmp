// One-off asset-generation script for the Capacitor app icon/splash source
// images. Not part of the Next.js app or its runtime — run manually via
// `node scripts/generate-app-icon-assets.mjs` whenever the brand mark or
// color changes, then re-run `npx capacitor-assets generate --android` to
// regenerate every platform-specific size from its output.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const BRAND_TEAL = "#0f766e"; // approximates --primary: oklch(0.55 0.14 175)
const OUT_DIR = path.join(process.cwd(), "resources");

// Same hexagonal "ice" mark as src/components/dashboard/ice-mark.tsx,
// inlined here since this script runs outside the React/Next.js build —
// centered and scaled, white on the brand teal background.
function markSvg({ size, markScale }) {
  const half = size / 2;
  const markSize = size * markScale;
  const offset = half - markSize / 2;
  return `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" fill="${BRAND_TEAL}" />
      <g transform="translate(${offset}, ${offset}) scale(${markSize / 32})" fill="none" stroke="#ffffff">
        <path d="M16 1 L29 9 V23 L16 31 L3 23 V9 Z" stroke-width="1.6" stroke-linejoin="round" />
        <path d="M16 1 V31 M3 9 L29 23 M29 9 L3 23" stroke-width="1.1" stroke-opacity="0.55" />
        <path d="M16 1 L29 9 V23 L16 31 L3 23 V9 Z" fill="#ffffff" fill-opacity="0.16" />
      </g>
    </svg>
  `;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  await sharp(Buffer.from(markSvg({ size: 1024, markScale: 0.62 })))
    .png()
    .toFile(path.join(OUT_DIR, "icon.png"));

  await sharp(Buffer.from(markSvg({ size: 2732, markScale: 0.32 })))
    .png()
    .toFile(path.join(OUT_DIR, "splash.png"));

  console.log("Wrote resources/icon.png and resources/splash.png");
}

main();
