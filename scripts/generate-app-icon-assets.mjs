// One-off asset-generation script for the app's brand icon images —
// Capacitor's Android adaptive icon/splash source, and the Next.js web
// favicon — all composited from the real PMP Group logo checked into
// public/brand/logo-pmp-group.png. Not part of the Next.js app or its
// runtime — run manually via `node scripts/generate-app-icon-assets.mjs`
// whenever that source logo changes, then re-run
// `npx capacitor-assets generate --android --iconBackgroundColor "#ffffff" --splashBackgroundColor "#ffffff"`
// to regenerate every platform-specific size from resources/icon.png and
// resources/splash.png.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const LOGO_PATH = path.join(process.cwd(), "public", "brand", "logo-pmp-group.png");
const RESOURCES_DIR = path.join(process.cwd(), "resources");
const APP_DIR = path.join(process.cwd(), "src", "app");

// Composites the logo centered on a canvas of `size`, scaled to `logoWidth`
// px wide (aspect ratio preserved). `background` is `undefined` for a
// transparent canvas (used for the Capacitor adaptive-icon foreground,
// which gets its own solid backing color from --iconBackgroundColor) or an
// opaque color (used for the splash screen and the web favicon, which are
// each flattened, standalone images with no separate background layer).
async function compositeLogo({ size, logoWidth, background }) {
  const logo = await sharp(LOGO_PATH).resize({ width: logoWidth }).toBuffer();
  const logoMeta = await sharp(logo).metadata();

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: background ?? { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: logo,
        top: Math.round((size - logoMeta.height) / 2),
        left: Math.round((size - logoMeta.width) / 2),
      },
    ])
    .png();
}

async function main() {
  await mkdir(RESOURCES_DIR, { recursive: true });

  // Adaptive icons crop into circular/squircle/rounded-square masks
  // depending on the launcher, keeping only a centered "safe zone" — scale
  // well under full-bleed so none of the wordmark's text gets clipped.
  await (await compositeLogo({ size: 1024, logoWidth: 620 })).toFile(path.join(RESOURCES_DIR, "icon.png"));

  // Splash screens aren't mask-cropped, but still read better with the mark
  // smaller and centered amid generous whitespace rather than edge-to-edge.
  await (
    await compositeLogo({ size: 2732, logoWidth: 1000, background: { r: 255, g: 255, b: 255, alpha: 1 } })
  ).toFile(path.join(RESOURCES_DIR, "splash.png"));

  // Next.js file-convention favicon/tab icon (src/app/icon.png) — picked up
  // automatically, no <link> tag needed. Square canvas with light padding
  // so it isn't cropped oddly in browser tab UI.
  await (await compositeLogo({ size: 512, logoWidth: 440, background: { r: 255, g: 255, b: 255, alpha: 1 } })).toFile(
    path.join(APP_DIR, "icon.png")
  );

  console.log("Wrote resources/icon.png, resources/splash.png, and src/app/icon.png");
}

main();
