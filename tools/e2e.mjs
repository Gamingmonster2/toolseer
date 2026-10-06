#!/usr/bin/env node
/**
 * tools/e2e.mjs — REAL browser verification over the Chrome DevTools Protocol.
 *
 * No Playwright, no Puppeteer, no npm: Node's built-in fetch + WebSocket drive a
 * headless Chrome. For every route it collects console/page/network errors,
 * asserts the shell contract and the design system behaviour (theme, RTL),
 * captures screenshots, and — for tool pages — can run an actual conversion
 * end-to-end and assert the downloaded bytes are a valid PDF.
 *
 * usage:
 *   node tools/e2e.mjs                 # all routes, structural checks
 *   node tools/e2e.mjs --only image-to-pdf
 *   node tools/e2e.mjs --shot          # also write screenshots to .screenshots/
 *   node tools/e2e.mjs --convert image-to-pdf   # run a real conversion on one tool
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'apps', 'web');
const SHOTS = path.join(ROOT, '.screenshots');
const CHROME = process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe';

const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const ONLY = arg('--only');
const SHOT = args.includes('--shot');
const CONVERT = arg('--convert');

const ROUTES = [
  { slug: '', url: '/' },
  { slug: 'image-to-pdf', url: '/image-to-pdf' },
  { slug: 'merge-pdf', url: '/merge-pdf' },
  { slug: 'compress-pdf', url: '/compress-pdf' },
  { slug: 'split-pdf', url: '/split-pdf' },
  { slug: 'protect-pdf', url: '/protect-pdf' },
  { slug: 'unlock-pdf', url: '/unlock-pdf' },
  { slug: 'pdf-to-images', url: '/pdf-to-images' },
  { slug: 'organize-pdf', url: '/organize-pdf' },
  { slug: 'extract-text-pdf', url: '/extract-text-pdf' },
  { slug: 'desktop', url: '/desktop' },
  { slug: 'privacy', url: '/privacy' },
  { slug: 'terms', url: '/terms' },
  { slug: 'works', url: '/works' },
  { slug: 'contact', url: '/contact' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const problems = [];

/* ------------------------------------------------------------- CDP client -- */

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this._open = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = (e) => reject(new Error('websocket error'));
    });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      } else if (m.method) {
        this.events.push(m);
      }
    };
  }
  async send(method, params = {}) {
    await this._open;
    const id = ++this.id;
    const result = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.ws.send(JSON.stringify({ id, method, params }));
    return result;
  }
  async eval(expression, awaitPromise = true) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise,
      userGesture: true,
    });
    if (r.exceptionDetails) {
      throw new Error('page eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    }
    return r.result ? r.result.value : undefined;
  }
  close() { try { this.ws.close(); } catch { /* ignore */ } }
}

/* ---------------------------------------------------------------- browser -- */

async function startChrome() {
  /* Unique profile per run: leftover chrome processes can hold the directory
     for a while on Windows, so we never reuse or delete a live one. */
  const profile = path.join(ROOT, `.chrome-e2e-${Date.now()}`);
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
  const errLog = path.join(ROOT, '.chrome-e2e.err.log');
  const errFd = fs.openSync(errLog, 'w');
  const child = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
    '--no-default-browser-check', '--disable-crash-reporter', '--disable-breakpad',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', errFd, errFd] });

  /* Chrome writes the real port into <profile>/DevToolsActivePort */
  let port = null;
  for (let i = 0; i < 60 && !port; i++) {
    await sleep(250);
    const file = path.join(profile, 'DevToolsActivePort');
    if (fs.existsSync(file)) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      if (lines[0]) port = Number(lines[0]);
    }
  }
  if (!port) throw new Error('Chrome did not open a debugging port: ' + fs.readFileSync(errLog, 'utf8').slice(0, 500));
  return { child, port, profile };
}

async function openTab(port, url) {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  if (!res.ok) throw new Error('could not open tab: HTTP ' + res.status);
  return res.json();
}

/* ---------------------------------------------------------------- server --- */

async function startServer() {
  const child = spawn(process.execPath, [path.join(ROOT, 'tools', 'serve.mjs'), '4173'], {
    stdio: 'ignore', detached: false,
  });
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch('http://127.0.0.1:4173/robots.txt');
      if (r.ok) return child;
    } catch { /* not up */ }
    await sleep(250);
  }
  throw new Error('static server did not come up');
}

/* --------------------------------------------------------------- checks --- */

async function checkPage(cdp, route) {
  const label = route.slug || 'home';
  const r = { label, ok: [], fail: [], warnings: [] };
  const ok = (cond, name, detail = '') => {
    if (cond) r.ok.push(name);
    else r.fail.push(`${name}${detail ? ' — ' + detail : ''}`);
  };

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Log.enable');
  cdp.events = [];

  const loaded = cdp.send('Page.navigate', { url: 'http://127.0.0.1:4173' + route.url });
  await Promise.race([loaded, sleep(15000)]);

  /* wait until the app shell has mounted (or a hard cap) */
  let mounted = false;
  for (let i = 0; i < 60 && !mounted; i++) {
    mounted = !!(await cdp.eval(`!!(document.querySelector('#ts-header .ts-brand, #ts-header a[href="/"]'))`));
    if (!mounted) await sleep(200);
  }
  ok(mounted, 'shell mounted');

  const title = await cdp.eval('document.title');
  ok(title && title.length >= 10, 'title set', title);

  const h1 = await cdp.eval(`document.querySelectorAll('h1').length`);
  ok(h1 === 1, 'single h1', `found ${h1}`);

  const shell = await cdp.eval(`({
    header: !!document.querySelector('#ts-header'),
    rail: !!document.querySelector('#ts-rail'),
    footer: !!document.querySelector('#ts-footer'),
    tool: !!document.querySelector('#ts-tool'),
    skip: !!document.querySelector('.ts-skip-link'),
  })`);
  ok(shell.header && shell.rail && shell.footer, 'shell containers');
  ok(shell.skip, 'skip link');
  if (route.slug && !['privacy', 'terms', 'works', 'contact', 'desktop'].includes(route.slug)) {
    ok(shell.tool, 'tool mount point');
    const toolMounted = await cdp.eval(`!!document.querySelector('#ts-tool .ts-drop')`);
    ok(toolMounted, 'toolkit mounted drop zone');
    const railControls = await cdp.eval(`document.querySelectorAll('#ts-rail-body input, #ts-rail-body select, #ts-rail-body button').length`);
    ok(railControls >= 1 || route.slug === 'organize-pdf', 'settings controls rendered', `${railControls} controls`);
  }

  /* broken images: every <img> must have loaded, unless it has an onerror guard */
  const brokenImages = await cdp.eval(`[...document.images].filter(i => i.complete && i.naturalWidth === 0 && !i.hasAttribute('onerror') && !i.dataset.e2eIgnore).map(i => i.src)`);
  ok(brokenImages.length === 0, 'no broken images', brokenImages.join(', '));

  /* theme behaviour */
  const theme1 = await cdp.eval(`document.documentElement.dataset.theme`);
  await cdp.eval(`document.querySelector('[data-theme-value="dark"]').click()`);
  await sleep(120);
  const theme2 = await cdp.eval(`document.documentElement.dataset.theme`);
  ok(theme2 === 'dark', 'dark theme toggle', `${theme1} → ${theme2}`);
  await cdp.eval(`document.querySelector('[data-theme-value="light"]').click()`);

  /* language / RTL behaviour: assert a real toggle happened, in either direction */
  const langBtn = await cdp.eval(`!!document.querySelector('.ts-lang')`);
  if (langBtn) {
    const before = await cdp.eval(`({ lang: document.documentElement.lang, dir: document.documentElement.dir })`);
    await cdp.eval(`document.querySelector('.ts-lang').click()`);
    await sleep(150);
    const after = await cdp.eval(`({ lang: document.documentElement.lang, dir: document.documentElement.dir })`);
    const toggled = before.lang !== after.lang;
    const dirMatches = (after.lang === 'ar') === (after.dir === 'rtl');
    ok(toggled, 'language toggle changes language', `${before.lang} → ${after.lang}`);
    ok(dirMatches, 'RTL matches Arabic', `${after.lang}/${after.dir}`);
    await cdp.eval(`document.querySelector('.ts-lang').click()`);
    await sleep(120);
  }

  /* console + page errors + failed requests, excluding favicon noise */
  await sleep(300);
  const errorEvents = cdp.events.filter((e) =>
    (e.method === 'Runtime.exceptionThrown') ||
    (e.method === 'Log.entryAdded' && ['error', 'assert'].includes(e.params.entry.level)) ||
    (e.method === 'Network.responseReceived' && e.params.response.status >= 400));
  const unique = new Map();
  for (const e of errorEvents) {
    let key = '';
    if (e.method === 'Runtime.exceptionThrown') key = e.params.exceptionDetails?.text || 'exception';
    if (e.method === 'Log.entryAdded') key = 'log:' + (e.params.entry.text || '').slice(0, 120);
    if (e.method === 'Network.responseReceived') key = `http:${e.params.response.status} ${e.params.response.url}`;
    if (key && !unique.has(key)) unique.set(key, e);
  }
  const softErrors = [...unique.values()].filter((e) => {
    const key = e.method === 'Network.responseReceived'
      ? `${e.params.response.status} ${e.params.response.url}`
      : (e.params?.entry?.text || e.params?.exceptionDetails?.text || '');
    return !/404.*(favicon|apple-touch|mascot|og)/.test(key);
  });
  ok(softErrors.length === 0, 'no console/network errors', [...unique.keys()].join(' || ') || '');

  if (SHOT) {
    fs.mkdirSync(SHOTS, { recursive: true });
    for (const theme of ['light', 'dark']) {
      await cdp.eval(`document.documentElement.dataset.theme='${theme}'`);
      await sleep(200);
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const file = path.join(SHOTS, `${label}-${theme}.png`);
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    }
  }

  return r;
}

/* -------------------------------------------------- real conversion tests -- */

/** Build a real multi-page PDF with text, using the vendored pdf-lib. */
async function makeTestPdf(pages = 2, label = 'PAGE') {
  const { pathToFileURL } = await import('node:url');
  const pdfLibUrl = pathToFileURL(path.join(WEB, 'vendor', 'pdf-lib', 'pdf-lib.esm.min.js')).href;
  const { PDFDocument, StandardFonts, rgb } = await import(pdfLibUrl);
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`${label} ${i + 1}`, { x: 60, y: 760, size: 28, font, color: rgb(0, 0, 0) });
  }
  const bytes = await doc.save();
  const file = path.join(ROOT, `.e2e-fixture-${pages}p.pdf`);
  fs.writeFileSync(file, bytes);
  return file;
}

/** Read page count + encryption flag straight from the bytes, no engine involved. */
async function inspectPdfBytes(file) {
  const buf = fs.readFileSync(file);
  const head = buf.subarray(0, 5).toString('ascii');
  const raw = buf.toString('latin1');
  return {
    head,
    bytes: buf.length,
    encrypted: /\/Encrypt\b/.test(raw),
  };
}

async function countPdfPages(file) {
  const { pathToFileURL } = await import('node:url');
  const pdfLibUrl = pathToFileURL(path.join(WEB, 'vendor', 'pdf-lib', 'pdf-lib.esm.min.js')).href;
  const { PDFDocument } = await import(pdfLibUrl);
  const doc = await PDFDocument.load(fs.readFileSync(file), { ignoreEncryption: true });
  return doc.getPageCount();
}

/** Shared browser-side helpers injected with Runtime.evaluate. */
const JS_SET_INPUT = (sel, value, index = 0) => `(() => {
  const el = document.querySelectorAll(${JSON.stringify(sel)})[${index}];
  if (!el) return 'missing';
  el.value = ${JSON.stringify(value)};
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el.value;
})()`;

async function attachFiles(cdp, files) {
  const doc = await cdp.send('DOM.getDocument', { depth: -1 });
  const input = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#ts-tool input[type=file]' });
  if (!input.nodeId) return false;
  await cdp.send('DOM.setFileInputFiles', { files, nodeId: input.nodeId });
  return true;
}

async function waitForResult(cdp, tries = 240) {
  for (let i = 0; i < tries; i++) {
    if (await cdp.eval(`!!document.querySelector('#ts-tool .ts-result, #ts-tool .ts-card')`)) return true;
    if (await cdp.eval(`!!document.querySelector('.ts-alert--error')`)) return false;
    await sleep(250);
  }
  return false;
}

async function grabDownload(cdp, dl, ext) {
  await cdp.eval(`document.querySelector('.ts-result .ts-btn--primary')?.click()`);
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    const files = fs.existsSync(dl) ? fs.readdirSync(dl).filter((f) => f.endsWith(ext)) : [];
    if (files.length) return path.join(dl, files[0]);
  }
  return null;
}

function freshDownloadDir() {
  const dl = path.join(ROOT, '.e2e-downloads');
  fs.rmSync(dl, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
  fs.mkdirSync(dl, { recursive: true });
  return dl;
}

async function openTool(port, slug) {
  const tab = await openTab(port, 'about:blank');
  const cdp = new Cdp(tab.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:4173/${slug}` });
  for (let i = 0; i < 60; i++) {
    if (await cdp.eval(`!!document.querySelector('#ts-tool .ts-drop')`)) break;
    await sleep(200);
  }
  return cdp;
}

/* -------------------------------------------- image-to-pdf (pdf-lib path) -- */

async function convertImageToPdf(port) {
  const r = { label: 'image-to-pdf (conversion)', ok: [], fail: [], warnings: [] };
  const ok = (cond, name, detail = '') => cond ? r.ok.push(name) : r.fail.push(`${name}${detail ? ' — ' + detail : ''}`);

  const png = await makeTestPng();
  const cdp = await openTool(port, 'image-to-pdf');
  ok(await attachFiles(cdp, [png]), 'file input found');
  await sleep(800);
  ok((await cdp.eval(`document.querySelectorAll('#ts-tool .ts-file').length`)) === 1, 'file card rendered');

  const dl = freshDownloadDir();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl, eventsEnabled: true });
  ok(await cdp.eval(`!!document.querySelector('#ts-run')`), 'run button present');
  await cdp.eval(`document.querySelector('#ts-run').click()`);
  ok(await waitForResult(cdp), 'conversion finished');
  ok(/toolseer-images\.pdf/.test(await cdp.eval(`document.querySelector('.ts-result')?.innerText || ''`)), 'result names the output');

  const file = await grabDownload(cdp, dl, '.pdf');
  ok(file !== null, 'download produced a file');
  if (file) {
    const info = await inspectPdfBytes(file);
    ok(info.head === '%PDF-', 'downloaded bytes are a real PDF', info.head);
    ok(info.bytes > 1000, 'PDF has plausible size', `${info.bytes} bytes`);
    ok((await countPdfPages(file)) === 1, 'PDF contains exactly one page');
  }
  cdp.close();
  results.push(r);
}

/* ------------------------------------------------ merge-pdf (pdf-lib ops) -- */

async function convertMergePdf(port) {
  const r = { label: 'merge-pdf (conversion)', ok: [], fail: [], warnings: [] };
  const ok = (cond, name, detail = '') => cond ? r.ok.push(name) : r.fail.push(`${name}${detail ? ' — ' + detail : ''}`);

  const a = await makeTestPdf(2, 'ALPHA');
  const b = await makeTestPdf(3, 'BETA');
  const cdp = await openTool(port, 'merge-pdf');
  ok(await attachFiles(cdp, [a, b]), 'file input found');
  await sleep(900);
  const rows = await cdp.eval(`document.querySelectorAll('#ts-tool .ts-row').length`);
  ok(rows === 2, 'two inputs listed', `${rows} rows`);

  const dl = freshDownloadDir();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl, eventsEnabled: true });
  await cdp.eval(`document.querySelector('#ts-run').click()`);
  ok(await waitForResult(cdp), 'merge finished');
  const file = await grabDownload(cdp, dl, '.pdf');
  ok(file !== null, 'download produced a file');
  if (file) {
    const info = await inspectPdfBytes(file);
    ok(info.head === '%PDF-', 'merged bytes are a real PDF', info.head);
    ok((await countPdfPages(file)) === 5, 'merged PDF has 2 + 3 = 5 pages', String(await countPdfPages(file)));
  }
  cdp.close();
  results.push(r);
}

/* ------------------------------------ protect-pdf (qpdf-wasm in browser) -- */

async function convertProtectPdf(port) {
  const r = { label: 'protect-pdf (qpdf in browser)', ok: [], fail: [], warnings: [] };
  const ok = (cond, name, detail = '') => cond ? r.ok.push(name) : r.fail.push(`${name}${detail ? ' — ' + detail : ''}`);

  const src = await makeTestPdf(2, 'SECRET');
  const cdp = await openTool(port, 'protect-pdf');
  ok(await attachFiles(cdp, [src]), 'file input found');
  await sleep(800);

  const pwFields = await cdp.eval(`document.querySelectorAll('#ts-rail-body input[type=password]').length`);
  ok(pwFields >= 2, 'password fields rendered', `${pwFields} fields`);
  await cdp.eval(JS_SET_INPUT('#ts-rail-body input[type=password]', 'CorrectHorse1', 0));
  await cdp.eval(JS_SET_INPUT('#ts-rail-body input[type=password]', 'CorrectHorse1', 1));

  const dl = freshDownloadDir();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl, eventsEnabled: true });
  await cdp.eval(`document.querySelector('#ts-run').click()`);
  const finished = await waitForResult(cdp);
  ok(finished, 'protect finished (this proves qpdf-wasm loaded as a classic script)',
    finished ? '' : await cdp.eval(`document.querySelector('.ts-alert--error')?.innerText || ''`));

  if (finished) {
    const file = await grabDownload(cdp, dl, '.pdf');
    ok(file !== null, 'download produced a file');
    if (file) {
      const info = await inspectPdfBytes(file);
      ok(info.head === '%PDF-', 'protected bytes are a real PDF', info.head);
      ok(info.encrypted, 'output carries an /Encrypt dictionary (really encrypted)');
    }
  }
  cdp.close();
  results.push(r);
}

/* ------------------------------------------- extract-text (pdf.js in browser) */

async function convertExtractText(port) {
  const r = { label: 'extract-text-pdf (pdf.js in browser)', ok: [], fail: [], warnings: [] };
  const ok = (cond, name, detail = '') => cond ? r.ok.push(name) : r.fail.push(`${name}${detail ? ' — ' + detail : ''}`);

  const src = await makeTestPdf(3, 'WORD');
  const cdp = await openTool(port, 'extract-text-pdf');
  ok(await attachFiles(cdp, [src]), 'file input found');
  await sleep(800);
  await cdp.eval(`document.querySelector('#ts-run').click()`);
  const finished = await waitForResult(cdp);
  ok(finished, 'extraction finished (this proves the pdf.js worker ran in a real browser)',
    finished ? '' : await cdp.eval(`document.querySelector('.ts-alert--error')?.innerText || ''`));
  if (finished) {
    const text = await cdp.eval(`document.querySelector('.ts-card pre')?.innerText || ''`);
    ok(/WORD\s*1/.test(text) && /WORD\s*2/.test(text) && /WORD\s*3/.test(text),
      'extracted text contains every page marker', JSON.stringify(text.slice(0, 80)));
  }
  cdp.close();
  results.push(r);
}

const CONVERTERS = {
  'image-to-pdf': convertImageToPdf,
  'merge-pdf': convertMergePdf,
  'protect-pdf': convertProtectPdf,
  'extract-text-pdf': convertExtractText,
};

async function conversionTest(port, slug) {
  const fn = CONVERTERS[slug];
  if (!fn) {
    results.push({ label: `${slug} (conversion)`, ok: [], fail: [], warnings: [`no conversion test implemented for ${slug}`] });
    return;
  }
  await fn(port);
}

async function makeTestPng() {
  const file = path.join(ROOT, '.e2e-test.png');
  const { execFileSync } = await import('node:child_process');
  // Reuse the icon generator's encoder: draw a tiny gradient PNG.
  const { default: zlib } = await import('node:zlib');
  const w = 64; const h = 48;
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const i = y * (stride + 1) + 1 + x * 4;
      raw[i] = Math.round((x / w) * 255);
      raw[i + 1] = Math.round((y / h) * 200);
      raw[i + 2] = 120;
      raw[i + 3] = 255;
    }
  }
  const crc32 = (buf) => { let c = ~0; for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
  return file;
}

/* ------------------------------------------------------------------ main -- */

const server = await startServer();
const browser = await startChrome();
try {
  for (const route of ROUTES.filter((r) => (ONLY ? r.slug === ONLY || (!ONLY && false) : true))) {
    const tab = await openTab(browser.port, 'about:blank');
    const cdp = new Cdp(tab.webSocketDebuggerUrl);
    try {
      results.push(await checkPage(cdp, route));
    } catch (err) {
      results.push({ label: route.slug || 'home', ok: [], fail: ['harness error: ' + err.message], warnings: [] });
    }
    cdp.close();
  }

  if (CONVERT) {
    for (const slug of CONVERT.split(',').map((s) => s.trim()).filter(Boolean)) {
      await conversionTest(browser.port, slug);
    }
  }
} finally {
  /* Tree-kill: headless Chrome spawns many children that survive kill(). */
  if (browser && browser.child && browser.child.pid) {
    const { spawnSync } = await import('node:child_process');
    spawnSync('taskkill', ['/PID', String(browser.child.pid), '/T', '/F'], { stdio: 'ignore' });
  }
  try { server.kill(); } catch { /* ignore */ }
}

/* ----------------------------------------------------------------- report -- */

let totalOk = 0;
let totalFail = 0;
console.log('\n════════════════════════ E2E REPORT ════════════════════════');
for (const r of results) {
  totalOk += r.ok.length;
  totalFail += r.fail.length;
  const line = r.fail.length ? '❌' : '✅';
  console.log(`${line} ${r.label.padEnd(26)}  ${r.ok.length} passed${r.fail.length ? `, ${r.fail.length} FAILED` : ''}`);
  for (const f of r.fail) console.log(`      • ${f}`);
  for (const w of r.warnings) console.log(`      ⚠ ${w}`);
}
console.log('════════════════════════════════════════════════════════════');
console.log(`${totalOk} checks passed, ${totalFail} failed across ${results.length} routes`);
if (SHOT) console.log(`screenshots → ${SHOTS}`);
process.exitCode = totalFail ? 1 : 0;
