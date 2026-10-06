#!/usr/bin/env node
/**
 * tools/make-icons.mjs — generate the site's raster icons with zero dependencies.
 *
 * A minimal PNG encoder (zlib + hand-rolled chunks) draws the ToolSeer brand
 * mark: a #0040ff field with a white layered "stack" glyph, matching the SVG
 * logo. Outputs:
 *   apps/web/assets/img/favicon.svg          (hand-written SVG, theme-proof)
 *   apps/web/assets/img/apple-touch-icon.png (180×180)
 *   apps/web/assets/img/og/toolseer-og.png   (1200×630, vertical gradient)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMG = path.join(ROOT, 'apps', 'web', 'assets', 'img');

/* ------------------------------------------------------------ png encoder -- */

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------- raster ops -- */

function makeCanvas(w, h) {
  return { w, h, data: Buffer.alloc(w * h * 4) };
}

function blend(cv, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= cv.w || y >= cv.h) return;
  const i = (y * cv.w + x) * 4;
  const da = a / 255;
  cv.data[i] = Math.round(r * da + cv.data[i] * (1 - da));
  cv.data[i + 1] = Math.round(g * da + cv.data[i + 1] * (1 - da));
  cv.data[i + 2] = Math.round(b * da + cv.data[i + 2] * (1 - da));
  cv.data[i + 3] = Math.min(255, cv.data[i + 3] + a);
}

function fillRect(cv, x0, y0, x1, y1, color) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) blend(cv, x, y, ...color);
}

function fillRounded(cv, x0, y0, x1, y1, radius, color) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const dx = Math.max(x0 + radius - x, x - (x1 - radius), 0);
      const dy = Math.max(y0 + radius - y, y - (y1 - radius), 0);
      if (dx * dx + dy * dy <= radius * radius) blend(cv, x, y, ...color);
    }
  }
}

/** Diamond (rotated square) centred at (cx, cy) with half-diagonal r. */
function fillDiamond(cv, cx, cy, r, color) {
  for (let dy = -r; dy <= r; dy++) {
    const half = r - Math.abs(dy);
    for (let dx = -half; dx <= half; dx++) blend(cv, cx + dx, cy + dy, ...color);
  }
}

function horizontalGradient(cv, stops) {
  for (let y = 0; y < cv.h; y++) {
    const f = y / (cv.h - 1);
    let c0 = stops[0];
    let c1 = stops[stops.length - 1];
    for (let i = 1; i < stops.length; i++) {
      if (f <= stops[i][0]) { c0 = stops[i - 1]; c1 = stops[i]; break; }
    }
    const f0 = c0[0]; const f1 = c1[0];
    const local = (f - f0) / Math.max(1e-6, f1 - f0);
    const r = Math.round(c0[1] + (c1[1] - c0[1]) * local);
    const g = Math.round(c0[2] + (c1[2] - c0[2]) * local);
    const b = Math.round(c0[3] + (c1[3] - c0[3]) * local);
    for (let x = 0; x < cv.w; x++) blend(cv, x, y, r, g, b, 255);
  }
}

const WHITE = [255, 255, 255, 255];
const BLUE = [0, 64, 255, 255];

/* The glyph: three stacked chevron "layers", scaled to the canvas. */
function drawLayers(cv, cx, cy, scale, color) {
  const thickness = Math.max(1, Math.round(scale * 0.10));
  for (let layer = 0; layer < 3; layer++) {
    const width = Math.round(scale * (0.62 - layer * 0.16));
    const y = Math.round(cy + (layer - 1) * scale * 0.24);
    // a chevron: two diagonals meeting at top centre
    const half = Math.round(width / 2);
    const hgt = Math.round(scale * 0.30);
    for (let i = 0; i < hgt; i++) {
      const inset = Math.round((i / hgt) * half);
      for (let t = -thickness / 2; t < thickness / 2; t++) {
        for (const side of [-1, 1]) {
          const x = Math.round(cx + side * (half - inset) + t);
          const yy = Math.round(y + i);
          blend(cv, x, yy, ...color);
        }
      }
      // closing bar across the top
      for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) {
        if (i === 0) blend(cv, x, Math.round(y), ...color);
      }
    }
  }
}

/* --------------------------------------------------------------- favicon --- */

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0040ff"/>
  <path d="M32 16 14 26l18 10 18-10z" fill="#ffffff"/>
  <path d="m14 33 18 10 18-10" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>
  <path d="m14 42 18 10 18-10" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity=".6"/>
</svg>
`;
fs.writeFileSync(path.join(IMG, 'favicon.svg'), favicon);

/* ------------------------------------------------------- apple-touch icon -- */

{
  const S = 180;
  const cv = makeCanvas(S, S);
  fillRounded(cv, 0, 0, S, S, 40, BLUE);
  drawLayers(cv, S / 2, S / 2, S * 0.66, WHITE);
  fs.writeFileSync(path.join(IMG, 'apple-touch-icon.png'), encodePng(S, S, cv.data));
}

/* -------------------------------------------------------------- og image --- */

{
  const W = 1200;
  const H = 630;
  const cv = makeCanvas(W, H);
  horizontalGradient(cv, [
    [0, 8, 40, 120, 255],
    [1, 0, 64, 255, 255],
  ]);
  drawLayers(cv, W / 2, H / 2 - 40, 300, WHITE);
  // simple wordmark bars under the glyph (geometric stand-in for "ToolSeer")
  const barY = H / 2 + 190;
  fillRounded(cv, W / 2 - 170, barY, W / 2 - 60, barY + 22, 11, WHITE);
  fillRounded(cv, W / 2 - 40, barY, W / 2 + 40, barY + 22, 11, [255, 255, 255, 200]);
  fillRounded(cv, W / 2 + 60, barY, W / 2 + 170, barY + 22, 11, [255, 255, 255, 150]);
  fs.mkdirSync(path.join(IMG, 'og'), { recursive: true });
  fs.writeFileSync(path.join(IMG, 'og', 'toolseer-og.png'), encodePng(W, H, cv.data));
}

console.log('icons written:');
console.log('  apps/web/assets/img/favicon.svg');
console.log('  apps/web/assets/img/apple-touch-icon.png');
console.log('  apps/web/assets/img/og/toolseer-og.png');
