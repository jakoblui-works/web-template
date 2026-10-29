// Renders public/icon.svg to the bitmap icons: favicon.ico (16/32/48) and apple-touch-icon.png
// (180, square: drawn over the tile's colour, since iOS fills transparency with black and rounds the
// corners itself). Run with `pnpm icons` after changing the SVG.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

// The icons every app gets from the template.
const publicDir = path.join(import.meta.dirname, "../template/public");
const svg = await readFile(path.join(publicDir, "icon.svg"), "utf8");
const svgUrl = `data:image/svg+xml;base64,${btoa(svg)}`;

const browser = await chromium.launch();
const page = await browser.newPage();

const render = async (size, background = "transparent") => {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html, body { margin: 0; background: ${background}; }</style>` +
      `<img src="${svgUrl}" width="${size}" height="${size}" style="display: block">`,
  );
  await page.locator("img").evaluate((img) => img.decode());
  return page.screenshot({ omitBackground: background === "transparent" });
};

// An ICO is a directory of images; modern ones can hold PNGs as they are.
const ico = (pngs) => {
  const header = new DataView(new ArrayBuffer(6 + 16 * pngs.length));
  header.setUint16(2, 1, true); // type: icon
  header.setUint16(4, pngs.length, true);
  let offset = header.byteLength;
  pngs.forEach(({ size, data }, i) => {
    const entry = 6 + 16 * i;
    header.setUint8(entry, size % 256); // 0 means 256
    header.setUint8(entry + 1, size % 256);
    header.setUint16(entry + 4, 1, true); // colour planes
    header.setUint16(entry + 6, 32, true); // bits per pixel
    header.setUint32(entry + 8, data.length, true);
    header.setUint32(entry + 12, offset, true);
    offset += data.length;
  });
  return new Blob([header, ...pngs.map(({ data }) => data)]);
};

const icoSizes = [16, 32, 48];
const pngs = [];
for (const size of icoSizes) pngs.push({ size, data: await render(size) });
const favicon = ico(pngs);
await writeFile(
  path.join(publicDir, "favicon.ico"),
  new Uint8Array(await favicon.arrayBuffer()),
);
await writeFile(
  path.join(publicDir, "apple-touch-icon.png"),
  await render(180, "#0a0a0a"),
);

await browser.close();
