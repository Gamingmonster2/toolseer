/**
 * ToolSeer V3 — every browser-only capability, isolated in one module.
 *
 * `docs/ARCHITECTURE.md` §4 rule 1: DOM access must never happen at module
 * scope, and anything that needs a canvas lives here. Nothing in this file
 * touches `document`, `canvas`, `Blob` or `createImageBitmap` until a function
 * is called, which is exactly what lets the Node test suite import the engine
 * and drive real PDFs.
 *
 * ## The canvas seam
 *
 * Rendering needs a surface. Two shapes are accepted, because the UI toolkit and
 * the architecture document name them differently:
 *
 *   { create(w, h) -> canvas,        toBytes(canvas, format, quality) -> Uint8Array }
 *   { createCanvas(w, h) -> canvas,  toBytes(canvas, format, quality) -> Uint8Array }
 *
 * `pdfToImages(bytes, opts, io)` takes one per call; `setCanvasFactory(factory)`
 * installs a process-wide default (used by `renderThumbnails`). With no factory
 * in Node, rendering operations throw `ToolError('unsupported')` instead of
 * crashing — the tests rely on that, and so does any future non-canvas renderer.
 */

import { ToolError, isToolError, mapEngineError } from './errors.js';
import { VENDOR, loadPdfJs, loadPdfLib } from './engines.js';
import { safeBaseName, toBytes } from './pdf-ops.js';

/** @typedef {{ create: (w: number, h: number) => any, toBytes?: Function, toDataURL?: Function,
 *              release?: Function }} CanvasFactory */

/** The default white page background. `background: null` renders transparent. */
const DEFAULT_BACKGROUND = '#ffffff';

/** @type {CanvasFactory|null} */
let installedFactory = null;

/* -------------------------------------------------------- canvas factory -- */

function normalizeFactory(factory) {
  if (!factory || typeof factory !== 'object') return null;
  const create = typeof factory.createCanvas === 'function'
    ? factory.createCanvas.bind(factory)
    : typeof factory.create === 'function'
      ? factory.create.bind(factory)
      : null;
  if (!create) return null;
  return {
    create,
    hasToBytes: typeof factory.toBytes === 'function',
    toBytes: typeof factory.toBytes === 'function' ? factory.toBytes.bind(factory) : null,
    hasToDataURL: typeof factory.toDataURL === 'function',
    toDataURL: typeof factory.toDataURL === 'function' ? factory.toDataURL.bind(factory) : null,
    release: typeof factory.release === 'function' ? factory.release.bind(factory) : null,
  };
}

/** A `<canvas>`/`OffscreenCanvas` backed factory, or null outside a browser. */
function browserFactory() {
  const makeCanvas = typeof document !== 'undefined' && typeof document.createElement === 'function'
    ? (width, height) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      return canvas;
    }
    : typeof OffscreenCanvas === 'function'
      ? (width, height) => new OffscreenCanvas(width, height)
      : null;
  if (!makeCanvas) return null;
  return normalizeFactory({
    create: makeCanvas,
    async toBytes(canvas, format, quality) {
      const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
      if (typeof canvas.convertToBlob === 'function') {
        const blob = await canvas.convertToBlob({ type: mime, quality: format === 'jpeg' ? quality : undefined });
        return new Uint8Array(await blob.arrayBuffer());
      }
      if (typeof canvas.toBlob === 'function') {
        const blob = await new Promise((resolve, reject) => {
          canvas.toBlob((result) => {
            if (result) resolve(result);
            else reject(new ToolError('render-failed', 'The canvas could not encode the page.'));
          }, mime, format === 'jpeg' ? quality : undefined);
        });
        return new Uint8Array(await blob.arrayBuffer());
      }
      throw new ToolError('unsupported', 'This canvas cannot encode images.');
    },
    toDataURL(canvas, format) {
      if (typeof canvas.toDataURL !== 'function') {
        throw new ToolError('unsupported', 'This canvas cannot produce a data URL.');
      }
      return canvas.toDataURL(format === 'jpeg' ? 'image/jpeg' : 'image/png');
    },
  });
}

/**
 * Install a process-wide canvas factory (or `null` to fall back to the browser
 * default). The toolkit uses this so page-grid thumbnails and PDF→Images share
 * one rendering surface.
 *
 * @param {CanvasFactory|null} factory
 */
export function setCanvasFactory(factory) {
  installedFactory = factory ? normalizeFactory(factory) : null;
  if (factory && !installedFactory) {
    throw new ToolError('invalid-option', 'A canvas factory needs a create(w, h) function.');
  }
}

/**
 * The canvas factory that will be used: the injected one, else the browser default.
 *
 * @returns {CanvasFactory|null}
 */
export function getCanvasFactory() {
  return installedFactory || browserFactory();
}

/**
 * Canvas-backed adapter for the architecture document's `io` parameter.
 * Throws `unsupported` when there is no canvas (Node).
 *
 * @returns {CanvasFactory}
 */
export function createCanvasIo() {
  const factory = browserFactory();
  if (!factory) {
    throw new ToolError('unsupported', 'This environment provides no canvas, so pages cannot be rendered.');
  }
  return factory;
}

function resolveFactory(explicit) {
  return normalizeFactory(explicit) || installedFactory || browserFactory();
}

function fillBackground(context, width, height, background) {
  if (!background) return;
  try {
    context.save();
    context.fillStyle = background;
    context.fillRect(0, 0, width, height);
    context.restore();
  } catch (cause) {
    /* a canvas double without fill support: pdf.js will still draw */
  }
}

async function releaseCanvas(factory, canvas) {
  if (factory && factory.release) {
    try {
      factory.release(canvas);
    } catch (cause) {
      /* best effort */
    }
  }
}

/* ----------------------------------------------------------- pdf.js glue -- */

function mapPdfJsError(cause, password) {
  if (isToolError(cause)) return cause;
  const name = (cause && cause.name) || '';
  const code = cause && cause.code;
  if (name === 'PasswordException') {
    // pdf.js: 1 = NEED_PASSWORD, 2 = INCORRECT_PASSWORD (PasswordResponses).
    if (code === 2 || code === 'INCORRECT_PASSWORD') {
      return password
        ? new ToolError('wrong-password', 'That password did not open the PDF.')
        : new ToolError('need-password', 'This PDF is encrypted; enter its password.');
    }
    return new ToolError('need-password', 'This PDF is encrypted; enter its password.');
  }
  if (name === 'InvalidPDFException' || name === 'MissingPDFException' ||
      name === 'UnexpectedResponseException' || name === 'ResponseException') {
    return new ToolError('corrupt', 'This PDF could not be read: it looks damaged.', cause && cause.message);
  }
  const mapped = mapEngineError(cause, 'unsupported');
  if (mapped.code === 'out-of-memory') return mapped;
  return mapped;
}

/** pdf.js proxy objects are not ours to extend; keep the task on the side. */
const loadingTasks = new WeakMap();

/**
 * Open a PDF with pdf.js.
 *
 * `data` is always a **copy**: pdf.js transfers the buffer to its worker, which
 * would detach the caller's array. Bytes-in/bytes-out must never mutate the
 * caller's data.
 *
 * @param {Uint8Array} bytes
 * @param {{ password?: string }} [opts]
 * @returns {Promise<any>} the PDFDocumentProxy
 */
async function openPdf(bytes, opts = {}) {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    password: opts.password ? String(opts.password) : undefined,
    useSystemFonts: false,
    cMapUrl: VENDOR.pdfJsCMaps,
    cMapPacked: true,
    standardFontDataUrl: VENDOR.pdfJsStandardFonts,
    wasmUrl: VENDOR.pdfJsWasm,
  });
  try {
    const pdf = await task.promise;
    loadingTasks.set(pdf, task);
    return pdf;
  } catch (cause) {
    try {
      await task.destroy();
    } catch (cleanupCause) {
      /* already torn down */
    }
    throw mapPdfJsError(cause, opts.password);
  }
}

/** pdf.js proxy objects are not ours to extend; keep the task on the side. */
async function closePdf(pdf) {
  if (!pdf) return;
  try {
    const task = loadingTasks.get(pdf);
    if (task) await task.destroy();
    else await pdf.destroy();
  } catch (cause) {
    /* the document is finished with either way */
  } finally {
    loadingTasks.delete(pdf);
  }
}

function selectPages(pages, numPages) {
  if (pages === undefined || pages === null) {
    const all = [];
    for (let page = 1; page <= numPages; page++) all.push(page);
    return all;
  }
  if (!Array.isArray(pages)) {
    throw new ToolError('invalid-option', `pages must be an array of page numbers (got ${typeof pages}).`);
  }
  const selected = [];
  const seen = new Set();
  for (const value of pages) {
    const page = Number(value);
    if (!Number.isInteger(page) || page < 1 || page > numPages) {
      throw new ToolError('invalid-option', `pages contains ${JSON.stringify(value)}, which is not a page of a ${numPages}-page document.`);
    }
    if (!seen.has(page)) {
      seen.add(page);
      selected.push(page);
    }
  }
  if (!selected.length) throw new ToolError('range-empty', 'No pages were selected.');
  return selected;
}

function normalizeDpi(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const dpi = Number(value);
  if (!Number.isFinite(dpi) || dpi < 18 || dpi > 1200) {
    throw new ToolError('invalid-option', `dpi must be between 18 and 1200 (got ${JSON.stringify(value)}).`);
  }
  return dpi;
}

function normalizeQuality(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const quality = Number(value);
  if (!Number.isFinite(quality) || quality <= 0 || quality > 1) {
    throw new ToolError('invalid-option', `quality must be between 0.05 and 1.0 (got ${JSON.stringify(value)}).`);
  }
  return Math.min(1, Math.max(0.05, quality));
}

function baseNameOf(opts, fallback = 'document') {
  return safeBaseName(opts && (opts.name || opts.baseName || opts.filename) || fallback, fallback);
}

/* ------------------------------------------------------------- rendering -- */

/** Rasterisation presets for `compressPdf` level 'balanced' / 'strong'. */
const RASTER_PRESETS = Object.freeze({
  balanced: Object.freeze({ dpi: 150, quality: 0.8 }),
  strong: Object.freeze({ dpi: 96, quality: 0.6 }),
});

/**
 * Rebuild every page as a single JPEG — the lossy half of compression.
 *
 * This is a visual rebuild: text stops being selectable and links/annotations
 * are flattened away. `compressPdf` therefore only adopts the result when it is
 * meaningfully smaller, and says `text-layer-lost` when it does.
 *
 * Page geometry is preserved *visually*: each output page is created at the
 * source page's viewport size (which already accounts for `/Rotate`) and the
 * bitmap is drawn to fill it, so the rebuilt page looks the same and is not
 * double-rotated.
 *
 * @param {Uint8Array} bytes
 * @param {{ level?: 'balanced'|'strong', dpi?: number, quality?: number, io?: CanvasFactory }} [opts]
 * @returns {Promise<{ bytes: Uint8Array, pageCount: number, dpi: number, quality: number, warnings: string[] }>}
 */
export async function rasterizeForCompression(bytes, opts = {}) {
  const source = toBytes(bytes);
  const level = opts.level === 'strong' ? 'strong' : 'balanced';
  const preset = RASTER_PRESETS[level];
  const dpi = normalizeDpi(opts.dpi, preset.dpi);
  const quality = normalizeQuality(opts.quality, preset.quality);
  const factory = resolveFactory(opts.io);
  if (!factory || !factory.hasToBytes) {
    throw new ToolError('unsupported',
      'Rebuilding pages as images needs a canvas, which this environment does not provide.');
  }
  const { PDFDocument } = await loadPdfLib();
  const warnings = [];
  const pdf = await openPdf(source, {});
  try {
    const out = await PDFDocument.create();
    const scale = dpi / 72;
    for (const pageNumber of selectPages(undefined, pdf.numPages)) {
      const page = await pdf.getPage(pageNumber);
      const visual = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale });
      const width = Math.max(1, Math.floor(viewport.width));
      const height = Math.max(1, Math.floor(viewport.height));
      const canvas = factory.create(width, height);
      const context = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
      if (!context) {
        await releaseCanvas(factory, canvas);
        throw new ToolError('unsupported', 'The canvas factory returned something without a 2D context.');
      }
      fillBackground(context, width, height, DEFAULT_BACKGROUND);
      try {
        await page.render({ canvasContext: context, canvas, viewport, background: DEFAULT_BACKGROUND }).promise;
        const jpeg = toBytes(await factory.toBytes(canvas, 'jpeg', quality), 'the rendered page');
        const image = await out.embedJpg(jpeg);
        const rebuilt = out.addPage([visual.width, visual.height]);
        rebuilt.drawImage(image, { x: 0, y: 0, width: visual.width, height: visual.height });
      } catch (cause) {
        throw isToolError(cause)
          ? cause
          : new ToolError('render-failed', `Page ${pageNumber} could not be rebuilt as an image.`, (cause && cause.message) || undefined);
      } finally {
        await releaseCanvas(factory, canvas);
      }
    }
    if (pdf.numPages > 200) warnings.push(`rasterized-large-document:${pdf.numPages}`);
    const rebuiltBytes = await out.save();
    return { bytes: rebuiltBytes, pageCount: out.getPageCount(), dpi, quality, warnings };
  } finally {
    await closePdf(pdf);
  }
}

/**
 * Render pages to PNG/JPEG byte strings.
 *
 * @param {Uint8Array} bytes
 * @param {{ format?: 'png'|'jpeg', dpi?: 72|150|300, pages?: number[], quality?: number,
 *           background?: string|null, name?: string, baseName?: string, filename?: string,
 *           password?: string }} [opts]
 * @param {CanvasFactory} [io] canvas adapter (see the header comment)
 * @returns {Promise<{ outputs: Array<{name: string, bytes: Uint8Array, type: string}>,
 *                     pageCount: number, warnings: string[] }>}
 *   `pageCount` is the page count of the **source** document.
 */
export async function pdfToImages(bytes, opts = {}, io) {
  const source = toBytes(bytes);
  const factory = resolveFactory(io);
  if (!factory) {
    throw new ToolError('unsupported',
      'Rendering PDF pages to images needs a canvas, which this environment does not provide.',
      'A canvas factory can be injected with setCanvasFactory().');
  }
  if (!factory.hasToBytes) {
    throw new ToolError('invalid-option', 'The canvas factory has no toBytes(canvas, format, quality) function.');
  }
  const format = opts.format === undefined ? 'png' : opts.format;
  if (format !== 'png' && format !== 'jpeg') {
    throw new ToolError('invalid-option', `format must be 'png' or 'jpeg' (got ${JSON.stringify(opts.format)}).`);
  }
  const dpi = normalizeDpi(opts.dpi, 150);
  const quality = normalizeQuality(opts.quality, 0.92);
  const background = opts.background === null ? null
    : typeof opts.background === 'string' && opts.background ? opts.background : DEFAULT_BACKGROUND;
  const extension = format === 'jpeg' ? 'jpg' : 'png';
  const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const base = baseNameOf(opts);

  const pdf = await openPdf(source, { password: opts.password });
  try {
    const scale = dpi / 72;
    const outputs = [];
    for (const pageNumber of selectPages(opts.pages, pdf.numPages)) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const width = Math.max(1, Math.floor(viewport.width));
      const height = Math.max(1, Math.floor(viewport.height));
      const canvas = factory.create(width, height);
      const context = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
      if (!context) {
        await releaseCanvas(factory, canvas);
        throw new ToolError('unsupported', 'The canvas factory returned something without a 2D context.');
      }
      fillBackground(context, width, height, background);
      try {
        await page.render({
          canvasContext: context,
          canvas,
          viewport,
          background: background || undefined,
        }).promise;
        const encoded = await factory.toBytes(canvas, format, quality);
        outputs.push({ name: `${base}-page-${pageNumber}.${extension}`, bytes: toBytes(encoded, 'the rendered page'), type: mime });
      } catch (cause) {
        throw isToolError(cause)
          ? cause
          : new ToolError('render-failed', `Page ${pageNumber} could not be rendered.`, (cause && cause.message) || undefined);
      } finally {
        await releaseCanvas(factory, canvas);
      }
    }
    return { outputs, pageCount: pdf.numPages, warnings: [] };
  } finally {
    await closePdf(pdf);
  }
}

/**
 * Small PNG thumbnails for page grids (organize, split, PDF→Images).
 *
 * @param {Uint8Array} bytes
 * @param {{ maxWidth?: number, pages?: number[], password?: string }} [opts]
 * @returns {Promise<Array<{ pageNumber: number, dataUrl: string, width: number, height: number }>>}
 */
export async function renderThumbnails(bytes, opts = {}) {
  const source = toBytes(bytes);
  const factory = getCanvasFactory();
  if (!factory) {
    throw new ToolError('unsupported',
      'Thumbnails need a canvas, which this environment does not provide.',
      'A canvas factory can be injected with setCanvasFactory().');
  }
  const requestedWidth = Number(opts.maxWidth === undefined ? 220 : opts.maxWidth);
  if (!Number.isFinite(requestedWidth) || requestedWidth < 16 || requestedWidth > 4096) {
    throw new ToolError('invalid-option', `maxWidth must be between 16 and 4096 (got ${JSON.stringify(opts.maxWidth)}).`);
  }
  const pdf = await openPdf(source, { password: opts.password });
  try {
    const thumbnails = [];
    for (const pageNumber of selectPages(opts.pages, pdf.numPages)) {
      const page = await pdf.getPage(pageNumber);
      const natural = page.getViewport({ scale: 1 });
      const scale = Math.min(1, requestedWidth / natural.width);
      const viewport = page.getViewport({ scale });
      const width = Math.max(1, Math.min(requestedWidth, Math.round(viewport.width)));
      const height = Math.max(1, Math.round(viewport.height));
      const canvas = factory.create(width, height);
      const context = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
      if (!context) {
        await releaseCanvas(factory, canvas);
        throw new ToolError('unsupported', 'The canvas factory returned something without a 2D context.');
      }
      fillBackground(context, width, height, DEFAULT_BACKGROUND);
      try {
        await page.render({ canvasContext: context, canvas, viewport, background: DEFAULT_BACKGROUND }).promise;
        let dataUrl = null;
        if (factory.hasToDataURL) dataUrl = await factory.toDataURL(canvas, 'png');
        else if (typeof canvas.toDataURL === 'function') dataUrl = canvas.toDataURL('image/png');
        if (!dataUrl) {
          throw new ToolError('unsupported', 'The canvas factory cannot produce a data URL.');
        }
        thumbnails.push({ pageNumber, dataUrl, width, height });
      } catch (cause) {
        throw isToolError(cause)
          ? cause
          : new ToolError('render-failed', `Page ${pageNumber} could not be rendered as a thumbnail.`, (cause && cause.message) || undefined);
      } finally {
        await releaseCanvas(factory, canvas);
      }
    }
    return thumbnails;
  } finally {
    await closePdf(pdf);
  }
}

/* ---------------------------------------------------------- image decode -- */

/**
 * Decode an image the browser can read (WebP, GIF, BMP, AVIF, SVG…) and
 * re-encode it as PNG or JPEG. Browser-only: it is the one place that uses
 * `createImageBitmap`.
 *
 * @param {Uint8Array} bytes
 * @param {{ name?: string, type?: string, quality?: number, format?: 'png'|'jpeg' }} [opts]
 * @returns {Promise<{ bytes: Uint8Array, format: 'png'|'jpeg' }>}
 */
export async function transcodeImageToPng(bytes, opts = {}) {
  const source = toBytes(bytes);
  const name = opts.name || 'image';
  const format = opts.format === 'jpeg' ? 'jpeg' : 'png';
  if (typeof createImageBitmap !== 'function') {
    throw new ToolError('unsupported',
      'This environment cannot decode images other than JPEG and PNG.',
      'Convert the file to PNG or JPEG first.');
  }
  const factory = getCanvasFactory();
  if (!factory || !factory.hasToBytes) {
    throw new ToolError('unsupported', 'Decoding images needs a canvas, which this environment does not provide.');
  }
  const type = typeof opts.type === 'string' && opts.type ? opts.type : 'application/octet-stream';
  let bitmap;
  try {
    bitmap = await createImageBitmap(new Blob([source], { type }));
  } catch (cause) {
    throw new ToolError('bad-type', `"${name}" could not be decoded as an image.`,
      'Convert the file to PNG or JPEG and try again.');
  }
  const width = Math.max(1, bitmap.width);
  const height = Math.max(1, bitmap.height);
  const canvas = factory.create(width, height);
  try {
    const context = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if (!context) throw new ToolError('unsupported', 'The canvas factory returned something without a 2D context.');
    // JPEG has no alpha channel: fill white first so transparent areas do not
    // turn black. PNG keeps its transparency.
    fillBackground(context, width, height, format === 'jpeg' ? DEFAULT_BACKGROUND : null);
    context.save();
    context.drawImage(bitmap, 0, 0, width, height);
    context.restore();
    const encoded = await factory.toBytes(canvas, format, opts.quality);
    return { bytes: toBytes(encoded, `decoded "${name}"`), format };
  } finally {
    if (bitmap && typeof bitmap.close === 'function') bitmap.close();
    await releaseCanvas(factory, canvas);
  }
}

/* ------------------------------------------------------------ text layer -- */

function itemGeometry(item) {
  const transform = Array.isArray(item.transform) ? item.transform : [1, 0, 0, 1, 0, 0];
  const height = Math.abs(Number(item.height) || 0) || Math.abs(Number(transform[3]) || 0) || 10;
  return {
    x: Number(transform[4]) || 0,
    y: Number(transform[5]) || 0,
    width: Number(item.width) || 0,
    height,
  };
}

/**
 * Rebuild readable text from pdf.js text items.
 *
 * pdf.js 6 no longer offers `disableCombineTextItems`; instead it emits a
 * separate whitespace item whose `width` *is* the horizontal gap it detected
 * (a 14pt run followed by a 146pt gap comes back as `"LEFT"`, `" "` with
 * width 146, `"RIGHT"`). That is exactly what this function needs:
 *
 *   - both modes rebuild line breaks from item positions
 *   - `layout: false` collapses every gap to a single space
 *   - `layout: true` expands a wide whitespace item into the matching number of
 *     spaces, so tabular text keeps its columns
 *
 * @param {any[]} items pdf.js TextItem[]
 * @param {boolean} layout
 * @returns {string}
 */
function reconstructText(items, layout) {
  let out = '';
  let previous = null;
  let pendingSpace = false;

  for (const item of items) {
    if (!item || typeof item.str !== 'string') continue; // TextMarkedContent markers
    const geometry = itemGeometry(item);

    if (item.str === '') {
      if (item.hasEOL && out && !out.endsWith('\n')) out += '\n';
      continue;
    }

    if (/^\s+$/.test(item.str)) {
      if (layout) {
        const reference = previous ? previous.height : (geometry.height || 10);
        const spaceWidth = Math.max(0.5, reference * 0.28);
        const spaces = Math.max(1, Math.min(60, Math.round((geometry.width || spaceWidth) / spaceWidth)));
        out += ' '.repeat(spaces);
        // Treat the whitespace run as consumed space so the next item does not
        // add a second gap for the same distance.
        previous = {
          x: geometry.x + geometry.width,
          y: previous ? previous.y : geometry.y,
          width: 0,
          height: reference,
        };
      } else {
        pendingSpace = true;
      }
      continue;
    }

    if (previous) {
      const lineHeight = Math.max(previous.height, geometry.height);
      const moved = Math.abs(geometry.y - previous.y) > Math.max(2, lineHeight * 0.4);
      if (item.hasEOL || moved) {
        out += '\n';
        pendingSpace = false;
      } else {
        const gap = geometry.x - (previous.x + previous.width);
        const spaceWidth = Math.max(0.5, geometry.height * 0.25);
        if ((pendingSpace || gap > spaceWidth) && !out.endsWith('\n') && !out.endsWith(' ')) {
          if (layout && !pendingSpace) {
            out += ' '.repeat(Math.max(1, Math.min(24, Math.round(gap / spaceWidth))));
          } else {
            out += ' ';
          }
        }
      }
    }

    out += item.str;
    previous = geometry;
    pendingSpace = false;
  }

  return out
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function assertOcrLanguage(lang) {
  if (!/^[a-z]{3}(\+[a-z]{3})*$/i.test(lang)) {
    throw new ToolError('invalid-option',
      `ocrLang must look like 'eng', 'ara' or 'eng+ara' (got ${JSON.stringify(lang)}).`);
  }
}

/**
 * Extract the text layer of a PDF.
 *
 * OCR: `ocr: true` enables the **fallback** path — pages that already carry a
 * text layer keep it, pages that do not are rendered and handed to
 * `opts.ocrEngine.recognize(dataUrl, lang)`. No OCR engine is bundled in this
 * build (tesseract.js is not vendored), so `ocr: true` without an injected
 * engine throws `ocr-unavailable` rather than silently returning nothing.
 *
 * @param {Uint8Array} bytes
 * @param {{ pages?: number[], layout?: boolean, ocr?: boolean, ocrLang?: string,
 *           ocrEngine?: { recognize: (dataUrl: string, lang: string) => Promise<{text?: string}> },
 *           ocrDpi?: number, password?: string, io?: CanvasFactory }} [opts]
 * @returns {Promise<{ text: string, pages: Array<{page: number, text: string, source?: string}>,
 *                     meta: { pageCount: number, info: any, metadata: any }, warnings: string[] }>}
 *   `text` joins the pages with a form feed (`\f`), the POSIX page separator.
 */
export async function extractText(bytes, opts = {}) {
  const source = toBytes(bytes);
  const layout = opts.layout === true;
  const warnings = [];
  const wantsOcr = opts.ocr === true;
  let ocrLang = 'eng';
  let ocrEngine = null;
  if (wantsOcr) {
    ocrLang = opts.ocrLang === undefined || opts.ocrLang === null ? 'eng' : String(opts.ocrLang);
    assertOcrLanguage(ocrLang);
    ocrEngine = opts.ocrEngine && typeof opts.ocrEngine.recognize === 'function' ? opts.ocrEngine : null;
    if (!ocrEngine) {
      throw new ToolError('ocr-unavailable',
        `OCR (${ocrLang}) needs language data that is not bundled in this build.`,
        'Text extraction still works for PDFs that already contain a text layer.');
    }
  }

  const pdf = await openPdf(source, { password: opts.password });
  try {
    const pageNumbers = selectPages(opts.pages, pdf.numPages);
    const pages = [];
    for (const pageNumber of pageNumbers) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      let text = reconstructText(content.items || [], layout);
      let origin = 'text';
      if (wantsOcr && !text.trim()) {
        try {
          text = await ocrPage(page, { engine: ocrEngine, lang: ocrLang, dpi: opts.ocrDpi, io: opts.io });
          origin = 'ocr';
          warnings.push(`ocr-used:page-${pageNumber}`);
        } catch (cause) {
          warnings.push(`ocr-failed:page-${pageNumber}`);
          if (isToolError(cause) && (cause.code === 'unsupported' || cause.code === 'invalid-option')) throw cause;
        }
      }
      pages.push({ page: pageNumber, text, source: origin });
    }

    let info = null;
    let metadata = null;
    try {
      const result = await pdf.getMetadata();
      info = result && result.info ? result.info : null;
      metadata = result && result.metadata ? result.metadata : null;
    } catch (cause) {
      warnings.push('metadata-unavailable');
    }

    return {
      text: pages.map((page) => page.text).join('\f'),
      pages,
      meta: { pageCount: pdf.numPages, info, metadata },
      warnings,
    };
  } finally {
    await closePdf(pdf);
  }
}

async function ocrPage(page, { engine, lang, dpi, io }) {
  const factory = resolveFactory(io);
  if (!factory) {
    throw new ToolError('unsupported', 'OCR needs a canvas to rasterise the page, and this environment has none.');
  }
  const scale = normalizeDpi(dpi, 200) / 72;
  const viewport = page.getViewport({ scale });
  const width = Math.max(1, Math.floor(viewport.width));
  const height = Math.max(1, Math.floor(viewport.height));
  const canvas = factory.create(width, height);
  const context = typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
  if (!context) throw new ToolError('unsupported', 'The canvas factory returned something without a 2D context.');
  fillBackground(context, width, height, DEFAULT_BACKGROUND);
  try {
    await page.render({ canvasContext: context, canvas, viewport, background: DEFAULT_BACKGROUND }).promise;
    const dataUrl = typeof canvas.toDataURL === 'function'
      ? canvas.toDataURL('image/png')
      : factory.hasToDataURL
        ? await factory.toDataURL(canvas, 'png')
        : null;
    if (!dataUrl) throw new ToolError('unsupported', 'The canvas factory cannot produce a data URL for OCR.');
    const result = await engine.recognize(dataUrl, lang);
    return result && typeof result.text === 'string' ? result.text : '';
  } finally {
    await releaseCanvas(factory, canvas);
  }
}
