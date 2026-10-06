/**
 * ToolSeer V3 — test fixtures and, more importantly, **independent oracles**.
 *
 * No binary file is committed: every fixture is generated at runtime from code
 * in this file (pdf-lib for documents, a hand-built baseline JPEG, zlib for PNG).
 *
 * The oracles deliberately use a different implementation from the code under
 * test, so a test can never pass just because the engine agrees with itself:
 *
 *   - page counts and per-page text come from raw pdf.js `getDocument()`, not
 *     from `core/render.js`
 *   - structural validity comes from qpdf's own `--check`
 *   - "is this file really protected?" comes from a real qpdf `--decrypt` attempt
 *   - `/P` permission bits are read from the encryption dictionary with pdf-lib
 */

import { deflateSync } from 'node:zlib';
import { loadPdfJs, loadPdfLib, loadQpdf } from '../apps/web/assets/js/core/engines.js';
import { installBrowserPrimitives } from './harness.mjs';

installBrowserPrimitives();

/* ------------------------------------------------------------- documents -- */

/**
 * Build a PDF whose every page carries a unique, findable marker.
 *
 * @param {{ pages?: number, size?: [number, number], text?: string|Function,
 *           title?: string, rotate?: Record<number, number> }} [options]
 * @returns {Promise<Uint8Array>}
 */
export async function makePdf(options = {}) {
  const { pages = 3, size = [300, 200], text, title, rotate } = options;
  const { PDFDocument, StandardFonts, degrees } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let pageNumber = 1; pageNumber <= pages; pageNumber++) {
    const page = doc.addPage(size);
    const label = typeof text === 'function'
      ? text(pageNumber)
      : text
        ? `${text} ${pageNumber}`
        : `PAGE-${pageNumber}-MARKER`;
    page.drawText(label, { x: 20, y: Math.max(20, size[1] - 40), size: 14, font });
    page.drawRectangle({ x: 10, y: 10, width: 40, height: 20, color: undefined, borderWidth: 1 });
    if (rotate && rotate[pageNumber]) page.setRotation(degrees(rotate[pageNumber]));
  }
  if (title !== undefined) doc.setTitle(title);
  return doc.save();
}

/** A text-heavy PDF: real content streams that a lossless rewrite can shrink. */
export async function makeBulkyPdf({ pages = 5, lines = 30 } = {}) {
  const { PDFDocument, StandardFonts } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let pageNumber = 1; pageNumber <= pages; pageNumber++) {
    const page = doc.addPage([595, 842]);
    for (let line = 0; line < lines; line++) {
      page.drawText(`Page ${pageNumber} line ${line}: the quick brown fox jumps over the lazy dog 0123456789`, {
        x: 24,
        y: 800 - line * 12,
        size: 8,
        font,
      });
    }
  }
  return doc.save();
}

/** A PDF with document metadata set, for the strip-metadata assertions. */
export async function makeMetadataPdf() {
  const { PDFDocument, StandardFonts } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([300, 200]);
  page.drawText('METADATA-PAGE-1', { x: 20, y: 160, size: 14, font });
  doc.setTitle('ToolSeer Secret Title');
  doc.setAuthor('ToolSeer Author');
  doc.setSubject('ToolSeer Subject');
  doc.setKeywords(['alpha', 'beta']);
  doc.setCreator('ToolSeer Creator');
  doc.setProducer('ToolSeer Producer');
  return doc.save();
}

/* ----------------------------------------------------------------- images -- */

/**
 * A real baseline (SOF0) grayscale JPEG, built byte by byte.
 *
 * Standard Annex K Huffman tables, a flat quantisation table and all-zero DC
 * coefficients: every 8x8 block decodes to mid-grey. It is small (a few hundred
 * bytes) but structurally valid, which is what matters — pdf-lib parses it and
 * embeds it verbatim, and qpdf validates the resulting file.
 *
 * @param {number} width
 * @param {number} height
 * @returns {Uint8Array}
 */
export function makeGrayscaleJpeg(width, height) {
  const DC_LUM_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
  const DC_LUM_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const AC_LUM_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
  const AC_LUM_VALUES = [
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
    0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0,
    0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
    0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
    0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7,
    0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5,
    0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2,
    0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
    0xf9, 0xfa,
  ];

  const segment = (marker, payload) => Uint8Array.from([
    0xff, marker, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff, ...payload,
  ]);

  const parts = [];
  parts.push(Uint8Array.from([0xff, 0xd8]));                                     // SOI
  parts.push(segment(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0])); // JFIF
  parts.push(segment(0xdb, [0x00, ...new Array(64).fill(16)]));                   // DQT
  parts.push(segment(0xc0, [8, (height >> 8) & 255, height & 255, (width >> 8) & 255, width & 255, 1, 1, 0x11, 0])); // SOF0
  parts.push(segment(0xc4, [0x00, ...DC_LUM_BITS, ...DC_LUM_VALUES]));            // DHT (DC)
  parts.push(segment(0xc4, [0x10, ...AC_LUM_BITS, ...AC_LUM_VALUES]));            // DHT (AC)
  parts.push(segment(0xda, [1, 1, 0x00, 0, 63, 0]));                              // SOS

  // One MCU = one 8x8 block (4:4:4, single component). Each block is
  // "DC category 0" ('00') + EOB ('1010'), then 1-padding to a byte boundary.
  const mcus = Math.ceil(width / 8) * Math.ceil(height / 8);
  const bits = '001010'.repeat(mcus);
  const padded = bits.padEnd(Math.ceil(bits.length / 8) * 8, '1');
  const entropy = [];
  for (let i = 0; i < padded.length; i += 8) entropy.push(parseInt(padded.slice(i, i + 8), 2));
  parts.push(Uint8Array.from(entropy));
  parts.push(Uint8Array.from([0xff, 0xd9]));                                      // EOI

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'latin1');
  const body = Buffer.concat([typeBytes, Buffer.from(data)]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/**
 * A real PNG, compressed with zlib. `pixel(x, y)` returns `[r, g, b, a]`.
 *
 * @param {number} width
 * @param {number} height
 * @param {{ alpha?: boolean, pixel?: (x: number, y: number) => number[] }} [options]
 * @returns {Uint8Array}
 */
export function makePng(width, height, options = {}) {
  const alpha = options.alpha !== false;
  const channels = alpha ? 4 : 3;
  const pixel = options.pixel || ((x, y) => [x % 256, y % 256, (x + y) % 256, 255]);
  const stride = width * channels + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      const offset = y * stride + 1 + x * channels;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      if (alpha) raw[offset + 3] = a === undefined ? 255 : a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;                       // bit depth
  ihdr[9] = alpha ? 6 : 2;           // colour type: RGBA / RGB
  ihdr[10] = 0;                      // deflate
  ihdr[11] = 0;                      // adaptive filtering
  ihdr[12] = 0;                      // no interlace
  return new Uint8Array(Buffer.concat([
    Buffer.from(PNG_SIGNATURE),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

/** Bytes that look like a WebP container (unsupported by pdf-lib). */
export function makeWebpLike() {
  const riff = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
  const body = new Uint8Array(riff.length + 20);
  body.set(riff, 0);
  body.fill(0x7a, riff.length);
  return body;
}

/** A one-page PDF whose single page embeds the given JPEG. */
export async function makePdfWithJpeg(jpeg, width, height) {
  const { PDFDocument } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const image = await doc.embedJpg(jpeg);
  const page = doc.addPage([width, height]);
  page.drawImage(image, { x: 0, y: 0, width, height });
  return doc.save();
}

/* ---------------------------------------------------------------- oracles -- */

async function withPdfJs(bytes, options, body) {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    password: options.password ? String(options.password) : undefined,
    standardFontDataUrl: new URL('../apps/web/vendor/pdfjs-dist/standard_fonts/', import.meta.url).href,
  });
  let pdf;
  try {
    pdf = await task.promise;
  } catch (cause) {
    await task.destroy();
    throw cause;
  }
  try {
    return await body(pdf);
  } finally {
    try {
      await task.destroy();
    } catch (cause) {
      /* done with it */
    }
  }
}

/** Page count from raw pdf.js — an implementation the engine does not use. */
export async function oraclePageCount(bytes, options = {}) {
  return withPdfJs(bytes, options, (pdf) => pdf.numPages);
}

/**
 * Per-page text straight from pdf.js text items (no engine code involved).
 * Items are concatenated as pdf.js returns them.
 *
 * @returns {Promise<string[]>}
 */
export async function oraclePageTexts(bytes, options = {}) {
  return withPdfJs(bytes, options, async (pdf) => {
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => item.str || '').join('').trim());
    }
    return pages;
  });
}

/** Every page's text joined with a form feed. */
export async function oracleFullText(bytes, options = {}) {
  return (await oraclePageTexts(bytes, options)).join('\f');
}

/** Page sizes in points, from pdf.js's viewport at scale 1. */
export async function oraclePageSizes(bytes, options = {}) {
  return withPdfJs(bytes, options, async (pdf) => {
    const sizes = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      sizes.push([Math.round(viewport.width * 100) / 100, Math.round(viewport.height * 100) / 100]);
    }
    return sizes;
  });
}

/** Declared `/Rotate` per page, from pdf.js. */
export async function oraclePageRotations(bytes, options = {}) {
  return withPdfJs(bytes, options, async (pdf) => {
    const rotations = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      rotations.push(page.rotate);
    }
    return rotations;
  });
}

/**
 * Compose PDF matrices: `a` applied first, then `b` (row-vector convention).
 * Same algebra as the `cm` operator so a CTM can be accumulated.
 */
function multiplyMatrix(a, b) {
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

/**
 * Where each embedded image is painted, straight from pdf.js's operator list.
 *
 * pdf.js splits a page's transformation into several `transform` operators, so
 * the effective rectangle is the **product** of everything on the graphics
 * stack (a single `transform` op is not the answer — that mistake is why an
 * earlier version of this oracle reported a 2:1 image as 1:1).
 *
 * Returns one entry per painted image: `{ pageNumber, matrix: [a, b, c, d, e, f] }`
 * where the image fills the unit square, so `[width, 0, 0, height, x, y]`.
 */
export async function oracleImagePlacements(bytes, options = {}) {
  const pdfjs = await loadPdfJs();
  const { OPS } = pdfjs;
  const paintOps = new Set([
    OPS.paintImageXObject,
    OPS.paintJpegXObject,
    OPS.paintImageXObjectRepeat,
    OPS.paintInlineImageXObject,
  ].filter((value) => typeof value === 'number'));
  return withPdfJs(bytes, options, async (pdf) => {
    const placements = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const list = await page.getOperatorList();
      let ctm = [1, 0, 0, 1, 0, 0];
      const stack = [];
      for (let index = 0; index < list.fnArray.length; index++) {
        const fn = list.fnArray[index];
        const args = list.argsArray[index];
        if (fn === OPS.save) stack.push(ctm.slice());
        else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
        else if (fn === OPS.transform) ctm = multiplyMatrix(Array.from(args), ctm);
        else if (fn === OPS.setMatrix) ctm = Array.from(args);
        else if (paintOps.has(fn)) placements.push({ pageNumber, matrix: ctm.slice() });
      }
    }
    return placements;
  });
}

/** Pixel dimensions of every image XObject on every page, via pdf-lib. */
export async function oracleImagePixelSizes(bytes) {
  const { PDFDocument, PDFName } = await loadPdfLib();
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const sizes = [];
  doc.getPages().forEach((page, pageIndex) => {
    const resources = page.node.Resources();
    if (!resources) return;
    const xObjects = resources.get(PDFName.of('XObject'));
    const dict = xObjects ? doc.context.lookup(xObjects) : null;
    if (!dict || typeof dict.entries !== 'function') return;
    for (const [key, value] of dict.entries()) {
      const stream = doc.context.lookup(value);
      const subtype = stream && stream.dict && stream.dict.get(PDFName.of('Subtype'));
      if (!subtype || String(subtype) !== '/Image') continue;
      const width = stream.dict.get(PDFName.of('Width'));
      const height = stream.dict.get(PDFName.of('Height'));
      sizes.push({
        pageNumber: pageIndex + 1,
        name: String(key),
        width: width && width.asNumber ? width.asNumber() : null,
        height: height && height.asNumber ? height.asNumber() : null,
      });
    }
  });
  return sizes;
}

let qpdfSingleton = null;

/** The raw qpdf wasm module, shared with the engine (it is a singleton there too). */
export async function qpdf() {
  if (!qpdfSingleton) qpdfSingleton = await loadQpdf();
  return qpdfSingleton;
}

let oracleCounter = 0;

async function withQpdfFile(bytes, body) {
  const q = await qpdf();
  const id = `oracle-${++oracleCounter}`;
  const inputPath = `/${id}-in.pdf`;
  const created = [inputPath];
  q.FS.writeFile(inputPath, bytes);
  const put = (label, data) => {
    const target = `/${id}-${label}.pdf`;
    q.FS.writeFile(target, data);
    created.push(target);
    return target;
  };
  const read = (label) => {
    const target = `/${id}-${label}.pdf`;
    if (!created.includes(target)) created.push(target);
    try {
      return q.FS.readFile(target);
    } catch (cause) {
      return null;
    }
  };
  const run = (args) => {
    try {
      return q.callMain(args);
    } catch (cause) {
      return -1;
    }
  };
  try {
    return await body({ q, run, inputPath, put, read });
  } finally {
    for (const target of created) {
      try {
        q.FS.unlink(target);
      } catch (cause) {
        /* not written */
      }
    }
  }
}

/** qpdf's structural verdict: 'ok' | 'warnings' | 'errors'. */
export async function oracleQpdfCheck(bytes) {
  return withQpdfFile(bytes, async ({ run, inputPath }) => {
    const code = run(['--check', inputPath]);
    if (code === 0) return 'ok';
    if (code === 3) return 'warnings';
    return 'errors';
  });
}

/** True when qpdf can decrypt the file with no password at all. */
export async function oracleOpensWithoutPassword(bytes) {
  return withQpdfFile(bytes, async ({ run, inputPath, read, put }) => {
    const outputPath = put('probe', new Uint8Array(0));
    const code = run(['--decrypt', inputPath, outputPath]);
    const produced = read('probe');
    return { opened: code === 0, bytes: produced };
  });
}

/** True when the supplied password opens the file (pdf.js-independent). */
export async function oracleAcceptsPassword(bytes, password) {
  return withQpdfFile(bytes, async ({ run, inputPath }) => {
    return run([`--password=${password}`, '--requires-password', inputPath]) === 3;
  });
}

/** Decrypt with qpdf and return the bytes (null when it fails). */
export async function oracleDecrypt(bytes, password) {
  return withQpdfFile(bytes, async ({ run, inputPath, put, read }) => {
    const outputPath = put('dec', new Uint8Array(0));
    const args = password === undefined || password === null ? [] : [`--password=${password}`];
    const code = run([...args, '--decrypt', inputPath, outputPath]);
    if (code !== 0) return null;
    return read('dec');
  });
}

/**
 * Raw `/P`, `/R` and `/V` from the encryption dictionary of an encrypted PDF.
 * pdf-lib can read the trailer without the key, which is exactly what we need.
 */
export async function oracleEncryptionDictionary(bytes) {
  const { PDFDocument, PDFName } = await loadPdfLib();
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const reference = doc.context.trailerInfo.Encrypt;
  if (!reference) return null;
  const dict = doc.context.lookup(reference);
  const number = (key) => {
    const value = dict.get(PDFName.of(key));
    return value && typeof value.asNumber === 'function' ? value.asNumber() : null;
  };
  return { P: number('P'), R: number('R'), V: number('V') };
}

/** Page count via pdf-lib (used where pdf.js would need a text layer). */
export async function oraclePageCountWithPdfLib(bytes) {
  const { PDFDocument } = await loadPdfLib();
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return doc.getPageCount();
}
