// Renders public/icon.svg to the bitmap icons, so they always match it: favicon.ico (16/32/48) and
// apple-touch-icon.png (180, square: drawn over the tile's colour, since iOS fills transparency with
// black and rounds the corners itself). Added to the client build's output, and served in dev.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";

const TILE = "#0a0a0a";
const ICO_SIZES = [16, 32, 48];
const TOUCH_SIZE = 180;

const render = (svg, size, background) =>
  new Resvg(svg, { fitTo: { mode: "width", value: size }, background }).render().asPng();

// An ICO is a directory of images; modern ones can hold PNGs as they are.
const ico = (pngs) => {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size % 256, entry); // 0 means 256
    header.writeUInt8(size % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4); // colour planes
    header.writeUInt16LE(32, entry + 6); // bits per pixel
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map(({ data }) => data)]);
};

const renderIcons = async (publicDir) => {
  const svg = await readFile(path.join(publicDir, "icon.svg"), "utf8");
  return {
    "favicon.ico": ico(ICO_SIZES.map((size) => ({ size, data: render(svg, size) }))),
    "apple-touch-icon.png": render(svg, TOUCH_SIZE, TILE),
  };
};

const CONTENT_TYPES = { "favicon.ico": "image/x-icon", "apple-touch-icon.png": "image/png" };

/** @returns {import("vite").Plugin} */
export const icons = () => {
  let publicDir;
  return {
    name: "icons",
    configResolved(config) {
      publicDir = config.publicDir;
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const name = req.url?.split("?")[0].slice(1);
        if (!(name in CONTENT_TYPES)) return next();
        const files = await renderIcons(publicDir);
        res.setHeader("Content-Type", CONTENT_TYPES[name]);
        res.end(files[name]);
      });
    },
    async generateBundle() {
      // Only the browser build: `pnpm build` also builds the prerender for the server.
      if (this.environment.config.consumer !== "client") return;
      for (const [fileName, source] of Object.entries(await renderIcons(publicDir))) {
        this.emitFile({ type: "asset", fileName, source });
      }
    },
  };
};
