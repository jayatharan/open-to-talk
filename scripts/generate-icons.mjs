#!/usr/bin/env node
// Generate every app icon from the SVGs in brand/. Re-run after changing the logo:
//   node scripts/generate-icons.mjs
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const brand = (f) => join(root, "brand", f);
const out = (f) => {
  const p = join(root, f);
  mkdirSync(dirname(p), { recursive: true });
  return p;
};
const png = (svg, size, file) => sharp(brand(svg), { density: 384 }).resize(size, size).png().toFile(out(file));

/** The rounded logo on a transparent canvas with a margin (macOS/Windows/Linux app icon grid). */
async function padded(size, margin, file) {
  const inner = Math.round(size * (1 - margin * 2));
  const logo = await sharp(brand("logo.svg"), { density: 384 }).resize(inner, inner).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toFile(out(file));
}

const jobs = [
  // Web (Next.js picks these up by file name in app/).
  copyFileSync(brand("logo.svg"), out("apps/web/app/icon.svg")),
  png("logo-square.svg", 180, "apps/web/app/apple-icon.png"),
  png("logo.svg", 512, "apps/web/public/logo-512.png"),

  // Desktop: electron-builder turns build/icon.png into .icns/.ico. ~10% margin per the macOS grid.
  padded(1024, 0.1, "apps/desktop/build/icon.png"),
  copyFileSync(brand("logo.svg"), out("apps/desktop/src/renderer/src/assets/logo.svg")),

  // Mobile (Expo): iOS masks the corners itself, so its icon is full-bleed.
  png("logo-square.svg", 1024, "apps/mobile/assets/images/icon.png"),
  png("logo-foreground.svg", 1024, "apps/mobile/assets/images/android-icon-foreground.png"),
  png("logo-background.svg", 1024, "apps/mobile/assets/images/android-icon-background.png"),
  png("logo-monochrome.svg", 1024, "apps/mobile/assets/images/android-icon-monochrome.png"),
  png("logo.svg", 1024, "apps/mobile/assets/images/splash-icon.png"),
  png("logo.svg", 48, "apps/mobile/assets/images/favicon.png"),
];

await Promise.all(jobs);
console.log("Icons generated.");
