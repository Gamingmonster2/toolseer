#!/usr/bin/env node
/**
 * tools/render-icons.mjs — derive the brand icon family from brand/mark.svg.
 *
 * One source of truth (the gecko mark, drawn for 16px) becomes:
 *   assets/img/favicon.svg              blue field, white ink   — browser tab
 *   assets/img/apple-touch-icon.png     180px, blue field       — iOS home screen
 *   assets/img/pwa/icon-192.png         192px, light field      — manifest "any"
 *   assets/img/pwa/icon-512.png         512px, light field      — manifest "any"
 *   assets/img/pwa/maskable-512.png     512px, blue, 60% inset  — manifest "maskable"
 *
 * The SVG composition is pure string work. Rasterising an SVG without a rasteriser
 * would mean re-implementing path filling, so the PNGs are produced by rendering an
 * exact-size page in headless Chrome. If Chrome cannot start (a sandbox can forbid
 * it), the script says so and leaves the existing PNGs alone rather than writing
 * something wrong — run `node tools/make-icons.mjs` for the procedural fallback.
 *
 * usage: node tools/render-icons.mjs [--only favicon|pwa|apple]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMG = path.join(ROOT, 'apps', 'web', 'assets', 'img');
const MARK = path.join(IMG, 'brand', 'mark.svg');
const CHROME = process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe';

const INK = '#111827';
const BLUE = '#0040ff';
const LIGHT_FIELD = '#ffffff';
const INK_ON_LIGHT = {
  ink: INK, eye: BLUE, pupil: LIGHT_FIELD,
};
const INK_ON_BLUE = {
  ink: '#ffffff', eye: '#ffffff', pupil: BLUE,
};

if (!fs.existsSync(MARK)) {
  console.error(`missing ${path.relative(ROOT, MARK)} — the brand mark must exist first`);
  process.exitCode = 1;
  throw new Error('no brand mark');
}

const rawMark = fs.readFileSync(MARK, 'utf8');
const inner = rawMark
  .replace(/^[\s\S]*?<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')
  .trim();

/**
 * Recolour the mark for a given field. The mark paints ink with `currentColor`,
 * the eye with `var(--ts-primary)`, and the pupil with `currentColor` again — so
 * each element has to be addressed explicitly rather than by inheriting a colour.
 */
function recolour(colours) {
  return inner
    .replace(/fill="var\(--ts-primary,\s*#0040ff\)"/g, `fill="${colours.eye}"`)
    /* the pupil is the only currentColor fill outside the ink group */
    .replace(/(<rect\b[^>]*?)fill="currentColor"/g, `$1fill="${colours.pupil}"`)
    .replace(/fill="currentColor"/g, `fill="${colours.ink}"`);
}

/**
 * Compose a complete icon SVG.
 * @param {{size:number, rounded:boolean, scale:number, colours:object}} spec
 */
function composeIcon({ size, rounded, scale, colours }) {
  const offset = ((64 - 64 * scale) / 2).toFixed(3);
  const field = rounded
    ? `<rect width="64" height="64" rx="14" fill="${colours.field}"/>`
    : `<rect width="64" height="64" fill="${colours.field}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-label="ToolSeer">
${field}
<g transform="translate(${offset},${offset}) scale(${scale})">
${recolour(colours)}
</g>
</svg>
`;
}

/* --------------------------------------------------------------- variants -- */

const variants = [
  {
    id: 'favicon',
    out: path.join(IMG, 'favicon.svg'),
    svg: composeIcon({ size: 64, rounded: true, scale: 0.74, colours: { field: BLUE, ...INK_ON_BLUE } }),
    kind: 'svg',
  },
  {
    id: 'apple',
    out: path.join(IMG, 'apple-touch-icon.png'),
    size: 180,
    svg: composeIcon({ size: 180, rounded: false, scale: 0.68, colours: { field: BLUE, ...INK_ON_BLUE } }),
    kind: 'png',
  },
  {
    id: 'pwa',
    out: path.join(IMG, 'pwa', 'icon-192.png'),
    size: 192,
    svg: composeIcon({ size: 192, rounded: true, scale: 0.72, colours: { field: LIGHT_FIELD, ...INK_ON_LIGHT } }),
    kind: 'png',
  },
  {
    id: 'pwa',
    out: path.join(IMG, 'pwa', 'icon-512.png'),
    size: 512,
    svg: composeIcon({ size: 512, rounded: true, scale: 0.72, colours: { field: LIGHT_FIELD, ...INK_ON_LIGHT } }),
    kind: 'png',
  },
  {
    id: 'pwa',
    out: path.join(IMG, 'pwa', 'maskable-512.png'),
    size: 512,
    /* maskable art must survive a circular crop: keep everything inside 80% */
    svg: composeIcon({ size: 512, rounded: false, scale: 0.58, colours: { field: BLUE, ...INK_ON_BLUE } }),
    kind: 'png',
  },
];

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const selected = only ? variants.filter((v) => v.id === only) : variants;

/* ------------------------------------------------------------------ write -- */

const staging = path.join(ROOT, '.cache', 'icons');
fs.mkdirSync(staging, { recursive: true });

function pageFor(svg, size) {
  const file = path.join(staging, `icon-${size}-${Date.now()}.html`);
  fs.writeFileSync(file, `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
  svg { display: block; width: ${size}px; height: ${size}px; }
</style></head><body>${svg}</body></html>`);
  return file;
}

function screenshot(htmlFile, size, outFile) {
  return new Promise((resolve) => {
    /* A stale file from a previous run must never be mistaken for fresh output. */
    fs.rmSync(outFile, { force: true });
    const errFile = path.join(staging, 'chrome.err.log');
    const errFd = fs.openSync(errFile, 'w');
    const args = [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
      '--hide-scrollbars', '--force-device-scale-factor=1',
      '--default-background-color=00000000',
      `--window-size=${size},${size}`,
      `--screenshot=${outFile}`,
      'file:///' + htmlFile.replace(/\\/g, '/'),
    ];
    let done = false;
    const child = spawn(CHROME, args, { stdio: ['ignore', errFd, errFd] });

    /* Chrome can exit a moment before the PNG lands on disk, so poll briefly. */
    const finish = async () => {
      for (let i = 0; i < 20; i++) {
        if (fs.existsSync(outFile) && fs.statSync(outFile).size > 200) {
          fs.closeSync(errFd);
          resolve(true);
          return;
        }
        await new Promise((r) => setTimeout(r, 150));
      }
      fs.closeSync(errFd);
      const err = fs.readFileSync(errFile, 'utf8').split('\n').filter((l) => /ERROR|FATAL/.test(l))[0];
      if (err) console.log(`       chrome: ${err.slice(0, 160)}`);
      resolve(false);
    };

    const timer = setTimeout(() => { if (!done) { done = true; try { child.kill(); } catch { /* ignore */ } finish(); } }, 30000);
    child.on('error', () => { if (!done) { done = true; clearTimeout(timer); fs.closeSync(errFd); resolve(false); } });
    child.on('exit', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      finish();
    });
  });
}

/** Read the real pixel size out of a PNG's IHDR so we never trust the filename. */
function pngSize(file) {
  const buf = fs.readFileSync(file);
  if (buf.subarray(1, 4).toString('ascii') !== 'PNG') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

let svgWritten = 0;
let pngWritten = 0;
let pngSkipped = 0;
const failures = [];

for (const v of selected) {
  fs.mkdirSync(path.dirname(v.out), { recursive: true });

  if (v.kind === 'svg') {
    fs.writeFileSync(v.out, v.svg);
    svgWritten++;
    console.log(`wrote  ${path.relative(ROOT, v.out)}`);
    continue;
  }

  const html = pageFor(v.svg, v.size);
  const ok = await screenshot(html, v.size, v.out);
  if (!ok) {
    pngSkipped++;
    failures.push(path.relative(ROOT, v.out));
    console.log(`skip   ${path.relative(ROOT, v.out)} (headless Chrome could not render here)`);
    continue;
  }
  const dims = pngSize(v.out);
  if (!dims || dims.width !== v.size || dims.height !== v.size) {
    pngSkipped++;
    failures.push(path.relative(ROOT, v.out));
    console.log(`skip   ${path.relative(ROOT, v.out)} (unexpected size ${dims ? dims.width + 'x' + dims.height : 'not a PNG'})`);
    continue;
  }
  pngWritten++;
  console.log(`wrote  ${path.relative(ROOT, v.out)}  ${dims.width}x${dims.height}  ${fs.statSync(v.out).size} B`);
}

console.log(`\n${svgWritten} SVG, ${pngWritten} PNG written${pngSkipped ? `, ${pngSkipped} PNG skipped` : ''}`);
if (failures.length) {
  console.log('skipped files keep their previous content; run `node tools/make-icons.mjs` for the procedural fallback:');
  for (const f of failures) console.log(`  • ${f}`);
}
