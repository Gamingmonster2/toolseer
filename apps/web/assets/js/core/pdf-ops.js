/**
 * ToolSeer V3 — the PDF operations that do not need WebAssembly.
 *
 * Contract (docs/ARCHITECTURE.md §4):
 *   - pure ESM, zero DOM access at module scope
 *   - bytes in, bytes out (`Uint8Array`), never File/Blob/object URLs
 *   - never throw a bare Error: everything is a {@link ToolError} with a stable code
 *   - anything that can degrade returns `warnings: string[]`
 *
 * `warnings` entries are machine-readable codes, optionally with a `:detail`
 * suffix, e.g. `skipped-encrypted:report.pdf`. The UI can localise
 * `warning.<code>`; showing the raw code is still meaningful to a human.
 *
 * @typedef {{ name?: string, bytes: Uint8Array, type?: string }} Input
 * @typedef {{ code: string, message?: string, hint?: string }} Warning
 */

import { ToolError, isToolError, mapEngineError, toToolError } from './errors.js';
import { loadPdfLib } from './engines.js';

export { ToolError } from './errors.js';

/* ------------------------------------------------------------- constants -- */

/**
 * Refuse inputs larger than this. A browser tab cannot hold a multi-hundred-MB
 * PDF several times over (source + parsed objects + output), and dying with an
 * `out-of-memory` message beats being killed by the tab. Override per call with
 * `opts.maxBytes` if a deployment really needs to.
 */
export const MAX_INPUT_BYTES = 512 * 1024 * 1024;

/** ISO 216 A4 and US Letter/Legal, in PDF points (1/72 inch). */
export const IMAGE_PAGE_SIZES = Object.freeze({
  a4: Object.freeze([595.28, 841.89]),
  letter: Object.freeze([612, 792]),
  legal: Object.freeze([612, 1008]),
});

/** Margin presets in points: 0, 1/4", 1/2", 1". */
export const IMAGE_MARGINS = Object.freeze({ none: 0, small: 18, medium: 36, large: 72 });

const PDF_HEADER = /%PDF-(\d\.\d)/;
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/* --------------------------------------------------------------- helpers -- */

function describeValue(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return 'a string';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}

/**
 * Normalise anything byte-shaped to a `Uint8Array` view (no copy).
 *
 * @param {unknown} value
 * @param {string} [label] used in the error message
 * @returns {Uint8Array}
 */
export function toBytes(value, label = 'Input') {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  // Cross-realm typed arrays (iframe / structuredClone) fail `instanceof`.
  if (value && typeof value === 'object' &&
      typeof value.byteLength === 'number' && typeof value.length === 'number' &&
      typeof value.BYTES_PER_ELEMENT === 'number') {
    return new Uint8Array(value);
  }
  throw new ToolError('bad-type', `${label} must be a Uint8Array (got ${describeValue(value)}).`);
}

function assertSize(bytes, name, maxBytes) {
  const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : MAX_INPUT_BYTES;
  if (bytes.length > limit) {
    throw new ToolError('too-large',
      `"${name}" is ${formatBytes(bytes.length)}; the limit for a browser tab is ${formatBytes(limit)}.`,
      'Try fewer or smaller files, or use the desktop app.');
  }
}

function latin1(bytes, start, end) {
  let out = '';
  const stop = Math.min(end, bytes.length);
  for (let i = start; i < stop; i += 4096) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(stop, i + 4096)));
  }
  return out;
}

function startsWith(bytes, magic) {
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) if (bytes[i] !== magic[i]) return false;
  return true;
}

/**
 * Read the PDF version from the file header. PDF readers tolerate up to 1024
 * bytes of junk before `%PDF-`, and so do we.
 *
 * @returns {string|null} e.g. `'1.7'`, or null when the file is not a PDF
 */
function sniffPdfHeader(bytes) {
  if (!bytes.length) return null;
  const match = PDF_HEADER.exec(latin1(bytes, 0, Math.min(bytes.length, 1024)));
  return match ? match[1] : null;
}

/** @returns {'jpeg'|'png'|null} */
function sniffImage(bytes) {
  if (startsWith(bytes, JPEG_MAGIC)) return 'jpeg';
  if (startsWith(bytes, PNG_MAGIC)) return 'png';
  return null;
}

/**
 * Map a pdf-lib failure onto a ToolError.
 *
 * @param {unknown} cause
 * @param {{ encryptedCode?: string, name?: string }} [options]
 * @returns {ToolError}
 */
function mapPdfLibError(cause, options = {}) {
  if (isToolError(cause)) return cause;
  const encryptedCode = options.encryptedCode || 'encrypted';
  const label = options.name ? `"${options.name}" ` : '';
  const name = (cause && cause.name) || '';
  const text = (cause && cause.message) || '';
  if (name === 'EncryptedPDFError' || /encrypted/i.test(text)) {
    return new ToolError(encryptedCode, `${label}is password-protected, so it cannot be read as-is.`);
  }
  const mapped = mapEngineError(cause, 'corrupt');
  if (mapped.code === 'out-of-memory') {
    return new ToolError('out-of-memory', `Ran out of memory while reading ${label || 'the PDF'}.`);
  }
  return new ToolError('corrupt', `${label}could not be read as a PDF.`, mapped.hint);
}

/**
 * Load a PDF with pdf-lib.
 *
 * `throwOnInvalidObject: true` is deliberate: pdf-lib can skip broken objects,
 * which would silently produce a document with missing content. A loud
 * `corrupt` beats a quietly wrong merge.
 *
 * Encryption needs care. pdf-lib only raises `EncryptedPDFError` when it gets
 * far enough to inspect the trailer; with strict object parsing it usually trips
 * over the unreadable (encrypted) objects first and reports a generic parsing
 * failure. So before calling anything `corrupt`, the bytes get one lenient
 * re-read to ask the only question that matters: is this file encrypted? That
 * second parse happens only on the failure path.
 */
async function loadDocument(bytes, options = {}) {
  const { PDFDocument } = await loadPdfLib();
  try {
    return await PDFDocument.load(bytes, {
      updateMetadata: false,
      throwOnInvalidObject: true,
      ignoreEncryption: options.ignoreEncryption === true,
    });
  } catch (cause) {
    if (isToolError(cause)) throw cause;
    if (options.ignoreEncryption !== true && await looksEncrypted(bytes)) {
      const label = options.name ? `"${options.name}" ` : '';
      throw new ToolError(options.encryptedCode || 'encrypted',
        `${label}is password-protected, so it cannot be read as-is.`);
    }
    throw mapPdfLibError(cause, options);
  }
}

/** Lenient probe: does the trailer carry an /Encrypt reference? */
async function looksEncrypted(bytes) {
  const { PDFDocument } = await loadPdfLib();
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    return doc.isEncrypted === true;
  } catch (cause) {
    return false;
  }
}

async function saveDocument(doc) {
  try {
    return await doc.save();
  } catch (cause) {
    if (isToolError(cause)) throw cause;
    const mapped = mapEngineError(cause, 'corrupt', 'The output could not be written.');
    throw mapped;
  }
}

function normalizePdfInput(value, index, options = {}) {
  const input = value && typeof value === 'object' ? value : {};
  const name = typeof input.name === 'string' && input.name ? input.name : `file-${index + 1}.pdf`;
  const bytes = toBytes(input.bytes, `"${name}"`);
  if (bytes.length < 5) throw new ToolError('corrupt', `"${name}" is too small to be a PDF.`);
  assertSize(bytes, name, options.maxBytes);
  return { name, bytes, type: input.type };
}

/* ---------------------------------------------------------------- format -- */

/**
 * Human-readable binary size: `1536 -> "1.5 KB"`.
 *
 * @param {number} n bytes
 * @returns {string}
 */
export function formatBytes(n) {
  const value = Number(n);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let scaled = value;
  let unit = 0;
  while (scaled >= 1024 && unit < units.length - 1) {
    scaled /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(scaled)} B`;
  const rounded = scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1);
  return `${rounded.replace(/\.0$/, '')} ${units[unit]}`;
}

function cleanBaseName(value) {
  if (typeof value !== 'string') return '';
  let out = value.split(/[\\/]/).pop() || '';
  // Trim first: a pasted name can carry trailing spaces after ".pdf".
  out = out.trim();
  out = out.replace(/\.[Pp][Dd][Ff]$/, '');
  // eslint-disable-next-line no-control-regex
  out = out.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-');
  out = out.replace(/\s+/g, ' ').trim();
  out = out.replace(/^[.\-\s]+/, '').replace(/[.\-\s]+$/, '');
  out = out.replace(/-{2,}/g, '-');
  if (out.length > 120) out = out.slice(0, 120).replace(/[.\-\s]+$/, '');
  return out;
}

/**
 * Turn a user-facing file name into a safe download base name: strips any path,
 * unsafe/control characters, a trailing `.pdf`, and falls back when nothing is
 * left. Non-Latin names (e.g. Arabic) are preserved.
 *
 * @param {string} name
 * @param {string} [fallback]
 * @returns {string}
 */
export function safeBaseName(name, fallback = 'document') {
  const safeFallback = cleanBaseName(fallback) || 'document';
  return cleanBaseName(name) || safeFallback;
}

/**
 * Parse a page-range spec into 1-based page numbers.
 *
 * Rules (all covered by tests):
 *   - `'all'` (case-insensitive) selects every page
 *   - `'1-3,5'` selects 1,2,3,5; empty segments (`'1,,'`) are ignored
 *   - a reversed range is normalised: `'5-3'` reads as `'3-5'`
 *   - numbers above `maxPage` are clamped away; if that leaves nothing,
 *     `range-empty` is thrown
 *   - duplicates are removed, keeping the order in which they were written
 *   - page 0, negatives, and anything non-numeric throw `range-invalid`
 *
 * @param {string} spec
 * @param {number} maxPage page count of the document
 * @returns {number[]}
 */
export function parsePageRanges(spec, maxPage) {
  const max = Number(maxPage);
  if (!Number.isInteger(max) || max < 1) {
    throw new ToolError('invalid-option', `parsePageRanges needs a positive integer maxPage (got ${describeValue(maxPage)}).`);
  }
  if (spec === undefined || spec === null) {
    throw new ToolError('range-invalid', 'A page range is required.');
  }
  const raw = String(spec).trim();
  if (!raw) throw new ToolError('range-empty', 'The range selects no pages.');
  if (/^all$/i.test(raw)) {
    const all = [];
    for (let p = 1; p <= max; p++) all.push(p);
    return all;
  }

  const pages = [];
  const seen = new Set();
  for (const token of raw.split(',')) {
    const part = token.trim();
    if (!part) continue;
    const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!match) {
      throw new ToolError('range-invalid', `"${part}" is not a page number or range.`, 'Use the form 1-3, 5, 8-12.');
    }
    let from = Number(match[1]);
    let to = match[2] === undefined ? from : Number(match[2]);
    if (from < 1 || to < 1) {
      throw new ToolError('range-invalid', `Page numbers start at 1 ("${part}").`, 'Use the form 1-3, 5, 8-12.');
    }
    if (from > to) {
      const swap = from;
      from = to;
      to = swap;
    }
    for (let page = from; page <= to && page <= max; page++) {
      if (!seen.has(page)) {
        seen.add(page);
        pages.push(page);
      }
    }
  }
  if (!pages.length) {
    throw new ToolError('range-empty', `The range "${raw}" selects no pages in a ${max}-page document.`,
      'Check the page numbers and try again.');
  }
  return pages;
}

/* ------------------------------------------------------------ operations -- */

/**
 * Merge PDFs in the order given.
 *
 * @param {Input[]} inputs
 * @param {{ addBookmarks?: boolean, failOnEncrypted?: boolean, maxBytes?: number }} [opts]
 *   `failOnEncrypted` defaults to **true**: an encrypted file aborts the whole
 *   merge instead of being dropped, because a silently shorter output is the
 *   worst possible result. Pass `false` to skip encrypted files instead — the
 *   result then always carries a `skipped-encrypted:<name>` warning.
 * @returns {Promise<{ bytes: Uint8Array, pageCount: number, warnings: string[] }>}
 */
export async function mergePdfs(inputs, opts = {}) {
  if (!Array.isArray(inputs) || !inputs.length) {
    throw new ToolError('empty-input', 'Add at least one PDF to merge.');
  }
  const failOnEncrypted = opts.failOnEncrypted !== false;
  const { PDFDocument } = await pdfLib();
  const out = await PDFDocument.create();
  const warnings = [];
  /** @type {Array<{title: string, pageIndex: number}>} */
  const outline = [];
  let pageCount = 0;

  for (let index = 0; index < inputs.length; index++) {
    const input = normalizePdfInput(inputs[index], index, opts);
    let source;
    try {
      source = await loadDocument(input.bytes, { name: input.name, encryptedCode: 'need-password' });
    } catch (cause) {
      if (isToolError(cause) && cause.code === 'need-password') {
        if (failOnEncrypted) throw cause;
        warnings.push(`skipped-encrypted:${input.name}`);
        continue;
      }
      throw cause;
    }
    const indices = source.getPageIndices();
    if (!indices.length) {
      warnings.push(`skipped-empty:${input.name}`);
      continue;
    }
    let copied;
    try {
      copied = await out.copyPages(source, indices);
    } catch (cause) {
      throw mapPdfLibError(cause, { name: input.name });
    }
    for (const page of copied) out.addPage(page);
    outline.push({ title: safeBaseName(input.name, `file-${index + 1}`), pageIndex: pageCount });
    pageCount += indices.length;
  }

  if (!pageCount) {
    throw new ToolError('corrupt', 'None of the chosen files contained a readable page.');
  }
  if (opts.addBookmarks === true && outline.length) {
    try {
      addOutline(out, outline);
    } catch (cause) {
      warnings.push('outline-unavailable');
    }
  }
  const bytes = await saveDocument(out);
  return { bytes, pageCount, warnings };
}

/**
 * Add a flat PDF outline (bookmark per merged file) plus `/PageMode`.
 *
 * pdf-lib has no outline helper, so this builds the dictionaries directly.
 * Note `PDFContext.register(object)` takes one argument and allocates its own
 * reference; when the reference must exist up front (for `/Parent`, `/Prev`,
 * `/Next`) the correct call is `assign(ref, object)`. Getting that wrong writes
 * a catalog entry that points at nothing.
 *
 * Failure is never fatal: the caller downgrades it to a warning.
 */
function addOutline(doc, entries) {
  const context = doc.context;
  const { PDFDict, PDFHexString, PDFName, PDFNumber } = pdfLibTypes;
  const outlinesRef = context.nextRef();
  const itemRefs = entries.map(() => context.nextRef());

  const outlines = PDFDict.withContext(context);
  outlines.set(PDFName.of('Type'), PDFName.of('Outlines'));
  outlines.set(PDFName.of('Count'), PDFNumber.of(entries.length));
  outlines.set(PDFName.of('First'), itemRefs[0]);
  outlines.set(PDFName.of('Last'), itemRefs[itemRefs.length - 1]);
  context.assign(outlinesRef, outlines);

  entries.forEach((entry, index) => {
    const dict = PDFDict.withContext(context);
    dict.set(PDFName.of('Title'), PDFHexString.fromText(String(entry.title)));
    dict.set(PDFName.of('Parent'), outlinesRef);
    dict.set(PDFName.of('Dest'), context.obj([doc.getPage(entry.pageIndex).ref, PDFName.of('Fit')]));
    if (index > 0) dict.set(PDFName.of('Prev'), itemRefs[index - 1]);
    if (index < entries.length - 1) dict.set(PDFName.of('Next'), itemRefs[index + 1]);
    context.assign(itemRefs[index], dict);
  });

  doc.catalog.set(PDFName.of('Outlines'), outlinesRef);
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}

/** Filled by {@link primePdfLibTypes} on first use; keeps the import lazy. */
const pdfLibTypes = { PDFDict: null, PDFHexString: null, PDFName: null, PDFNumber: null, degrees: null };

async function pdfLib() {
  const lib = await loadPdfLib();
  pdfLibTypes.PDFDict = lib.PDFDict;
  pdfLibTypes.PDFHexString = lib.PDFHexString;
  pdfLibTypes.PDFName = lib.PDFName;
  pdfLibTypes.PDFNumber = lib.PDFNumber;
  pdfLibTypes.degrees = lib.degrees;
  return lib;
}

function labelForPages(pages) {
  return pages.length === 1 ? `page-${pages[0]}` : `pages-${pages[0]}-${pages[pages.length - 1]}`;
}

function rangeGroups(spec, pageCount) {
  const groups = [];
  for (const token of String(spec).split(',')) {
    const part = token.trim();
    if (!part) continue;
    const pages = parsePageRanges(part, pageCount);
    groups.push({ label: labelForPages(pages), pages });
  }
  if (!groups.length) throw new ToolError('range-empty', 'The range selects no pages.');
  return groups;
}

function everyNGroups(everyN, pageCount) {
  const step = Number(everyN);
  if (!Number.isInteger(step) || step < 1) {
    throw new ToolError('invalid-option', `everyN must be a positive integer (got ${describeValue(everyN)}).`);
  }
  const groups = [];
  for (let start = 1; start <= pageCount; start += step) {
    const end = Math.min(pageCount, start + step - 1);
    const pages = [];
    for (let page = start; page <= end; page++) pages.push(page);
    groups.push({ label: labelForPages(pages), pages });
  }
  return groups;
}

/**
 * Split a PDF into several documents.
 *
 * @param {Uint8Array} bytes
 * @param {{ mode?: 'each'|'ranges'|'every-n', ranges?: string, everyN?: number,
 *           mergeToOne?: boolean, name?: string, baseName?: string, filename?: string,
 *           maxBytes?: number }} opts
 *   `mergeToOne: true` returns a single file with every selected page in order
 *   (for `ranges`, repeated page numbers are collapsed to their first mention).
 * @returns {Promise<{ outputs: Array<{name: string, bytes: Uint8Array}>, pageCount: number, warnings: string[] }>}
 *   `pageCount` is the page count of the **source** document — the UI shows it
 *   as "12 pages", and the outputs are the selection.
 */
export async function splitPdf(bytes, opts = {}) {
  const source = toBytes(bytes);
  assertSize(source, 'the document', opts.maxBytes);
  const mode = opts.mode === undefined ? 'each' : opts.mode;
  if (mode !== 'each' && mode !== 'ranges' && mode !== 'every-n') {
    throw new ToolError('invalid-option', `mode must be 'each', 'ranges' or 'every-n' (got ${describeValue(opts.mode)}).`);
  }
  const doc = await loadDocument(source, { encryptedCode: 'encrypted' });
  const pageCount = doc.getPageCount();
  if (!pageCount) throw new ToolError('corrupt', 'The PDF has no pages.');

  let groups;
  if (mode === 'each') {
    groups = [];
    for (let page = 1; page <= pageCount; page++) groups.push({ label: `page-${page}`, pages: [page] });
  } else if (mode === 'ranges') {
    if (opts.ranges === undefined || opts.ranges === null || String(opts.ranges).trim() === '') {
      throw new ToolError('range-empty', 'Enter the pages to extract, for example 1-3, 7.');
    }
    groups = rangeGroups(opts.ranges, pageCount);
  } else {
    groups = everyNGroups(opts.everyN, pageCount);
  }

  const warnings = [];
  if (opts.mergeToOne === true) {
    const pages = [];
    const seen = new Set();
    for (const group of groups) {
      for (const page of group.pages) {
        if (!seen.has(page)) {
          seen.add(page);
          pages.push(page);
        }
      }
    }
    if (pages.length !== groups.reduce((sum, group) => sum + group.pages.length, 0)) {
      warnings.push('duplicate-pages-collapsed');
    }
    groups = [{ label: 'pages', pages }];
  }

  const base = safeBaseName(opts.name || opts.baseName || opts.filename || 'document');
  const { PDFDocument } = await loadPdfLib();
  const outputs = [];
  for (const group of groups) {
    const out = await PDFDocument.create();
    let copied;
    try {
      copied = await out.copyPages(doc, group.pages.map((page) => page - 1));
    } catch (cause) {
      throw mapPdfLibError(cause);
    }
    for (const page of copied) out.addPage(page);
    outputs.push({ name: `${base}-${group.label}.pdf`, bytes: await saveDocument(out) });
  }
  return { outputs, pageCount, warnings };
}

function normalizeDropList(drop, pageCount) {
  if (drop === undefined || drop === null) return new Set();
  if (!Array.isArray(drop)) {
    throw new ToolError('invalid-option', `drop must be an array of page numbers (got ${describeValue(drop)}).`);
  }
  const dropped = new Set();
  for (const value of drop) {
    const page = Number(value);
    if (!Number.isInteger(page) || page < 1 || page > pageCount) {
      throw new ToolError('invalid-option', `drop contains ${describeValue(value)}, which is not a page of a ${pageCount}-page document.`);
    }
    dropped.add(page);
  }
  return dropped;
}

function normalizeRotations(rotate, pageCount) {
  const rotations = new Map();
  if (rotate === undefined || rotate === null) return rotations;
  if (typeof rotate !== 'object' || Array.isArray(rotate)) {
    throw new ToolError('invalid-option', `rotate must be an object like { "2": 90 } (got ${describeValue(rotate)}).`);
  }
  for (const [key, raw] of Object.entries(rotate)) {
    if (!/^\d+$/.test(key)) {
      throw new ToolError('invalid-option', `rotate keys must be page numbers (got "${key}").`);
    }
    const page = Number(key);
    if (page < 1 || page > pageCount) {
      throw new ToolError('invalid-option', `rotate["${key}"] is not a page of a ${pageCount}-page document.`);
    }
    const angle = Number(raw);
    if (!Number.isFinite(angle) || angle % 90 !== 0) {
      throw new ToolError('invalid-option', `rotate["${key}"] must be 90, 180 or 270 (got ${describeValue(raw)}).`);
    }
    const normalised = ((angle % 360) + 360) % 360;
    if (normalised !== 0) rotations.set(page, normalised);
  }
  return rotations;
}

/**
 * Reorder, rotate and/or drop pages.
 *
 * @param {Uint8Array} bytes
 * @param {{ order?: number[], rotate?: Record<string, 90|180|270>, drop?: number[],
 *           maxBytes?: number }} opts
 *   `order` lists 1-based **source** page numbers, in output order; a page may
 *   appear more than once. Omitted `order` means "every page, in order".
 *   `rotate` and `drop` are also keyed by source page number; `drop` always
 *   wins over `order`, and rotation is added to any rotation already on the page.
 * @returns {Promise<{ bytes: Uint8Array, pageCount: number, warnings: string[] }>}
 *   `pageCount` is the page count of the **output**.
 */
export async function organizePdf(bytes, opts = {}) {
  const source = toBytes(bytes);
  assertSize(source, 'the document', opts.maxBytes);
  const doc = await loadDocument(source, { encryptedCode: 'encrypted' });
  const sourcePages = doc.getPageCount();
  if (!sourcePages) throw new ToolError('corrupt', 'The PDF has no pages.');

  const dropped = normalizeDropList(opts.drop, sourcePages);
  const rotations = normalizeRotations(opts.rotate, sourcePages);

  let order;
  if (opts.order === undefined || opts.order === null) {
    order = [];
    for (let page = 1; page <= sourcePages; page++) order.push(page);
  } else {
    if (!Array.isArray(opts.order)) {
      throw new ToolError('invalid-option', `order must be an array of page numbers (got ${describeValue(opts.order)}).`);
    }
    order = [];
    for (const value of opts.order) {
      const page = Number(value);
      if (!Number.isInteger(page) || page < 1 || page > sourcePages) {
        throw new ToolError('invalid-option', `order contains ${describeValue(value)}, which is not a page of a ${sourcePages}-page document.`);
      }
      order.push(page);
    }
  }
  order = order.filter((page) => !dropped.has(page));
  if (!order.length) {
    throw new ToolError('range-empty', 'That leaves no pages: every page was removed.');
  }

  const { PDFDocument, degrees } = await pdfLib();
  const out = await PDFDocument.create();
  let copied;
  try {
    copied = await out.copyPages(doc, order.map((page) => page - 1));
  } catch (cause) {
    throw mapPdfLibError(cause);
  }
  const warnings = [];
  copied.forEach((page, index) => {
    const extra = rotations.get(order[index]);
    if (extra) {
      const existing = page.getRotation().angle || 0;
      const angle = (((existing + extra) % 360) + 360) % 360;
      try {
        page.setRotation(degrees(angle));
      } catch (cause) {
        warnings.push(`rotation-skipped:${order[index]}`);
      }
    }
    out.addPage(page);
  });

  const bytesOut = await saveDocument(out);
  return { bytes: bytesOut, pageCount: out.getPageCount(), warnings };
}

/**
 * Build one PDF from images. JPEG and PNG bytes are embedded **without
 * re-encoding** (lossless); any other format must be decoded first.
 *
 * @param {Input[]} images
 * @param {{ pageSize?: 'a4'|'letter'|'legal'|'fit', orientation?: 'auto'|'portrait'|'landscape',
 *           margin?: 'none'|'small'|'medium'|'large', quality?: number,
 *           reencode?: boolean, io?: { decodeImage?: Function }, maxBytes?: number }} [opts]
 *   `quality` (0.1–1.0) only has an effect when an image is actually re-encoded:
 *   for a non-JPEG/PNG input, or for every image when `reencode: true`.
 *   `io.decodeImage(bytes, { type, quality, format }) -> { bytes, format }`
 *   lets a browser supply a canvas-backed decoder; without it, non-JPEG/PNG
 *   inputs throw `bad-type` under Node and use canvas in the browser.
 * @returns {Promise<{ bytes: Uint8Array, pageCount: number, warnings: string[] }>}
 */
export async function imagesToPdf(images, opts = {}) {
  if (!Array.isArray(images) || !images.length) {
    throw new ToolError('empty-input', 'Add at least one image.');
  }
  const pageSize = opts.pageSize === undefined ? 'a4' : opts.pageSize;
  if (pageSize !== 'fit' && !Object.prototype.hasOwnProperty.call(IMAGE_PAGE_SIZES, pageSize)) {
    throw new ToolError('invalid-option', `pageSize must be 'a4', 'letter', 'legal' or 'fit' (got ${describeValue(opts.pageSize)}).`);
  }
  const orientation = opts.orientation === undefined ? 'auto' : opts.orientation;
  if (orientation !== 'auto' && orientation !== 'portrait' && orientation !== 'landscape') {
    throw new ToolError('invalid-option', `orientation must be 'auto', 'portrait' or 'landscape' (got ${describeValue(opts.orientation)}).`);
  }
  const marginKey = opts.margin === undefined ? 'none' : opts.margin;
  if (!Object.prototype.hasOwnProperty.call(IMAGE_MARGINS, marginKey)) {
    throw new ToolError('invalid-option', `margin must be 'none', 'small', 'medium' or 'large' (got ${describeValue(opts.margin)}).`);
  }
  const margin = IMAGE_MARGINS[marginKey];

  let quality = 0.92;
  if (opts.quality !== undefined) {
    quality = Number(opts.quality);
    if (!Number.isFinite(quality) || quality <= 0 || quality > 1) {
      throw new ToolError('invalid-option', `quality must be between 0.1 and 1.0 (got ${describeValue(opts.quality)}).`);
    }
    quality = Math.min(1, Math.max(0.1, quality));
  }

  const io = opts.io && typeof opts.io === 'object' ? opts.io : null;
  const { PDFDocument } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const warnings = [];

  for (let index = 0; index < images.length; index++) {
    const raw = images[index] && typeof images[index] === 'object' ? images[index] : {};
    const name = typeof raw.name === 'string' && raw.name ? raw.name : `image-${index + 1}`;
    let bytes;
    try {
      bytes = toBytes(raw.bytes, `"${name}"`);
    } catch (cause) {
      throw toToolError(cause, 'bad-type', `"${name}" has no readable bytes.`);
    }
    if (!bytes.length) throw new ToolError('bad-type', `"${name}" is empty.`);
    assertSize(bytes, name, opts.maxBytes);

    const kind = sniffImage(bytes);
    const wantReencode = opts.reencode === true && kind !== null;
    let embedBytes = bytes;
    let embedFormat = kind;

    if (wantReencode || kind === null) {
      const decoded = await decodeImageForPdf(bytes, { name, type: raw.type, quality, io, wantJpeg: wantReencode });
      embedBytes = decoded.bytes;
      embedFormat = decoded.format;
      if (wantReencode) warnings.push(`reencoded:${name}`);
    }

    let embedded;
    try {
      embedded = embedFormat === 'jpeg' ? await doc.embedJpg(embedBytes) : await doc.embedPng(embedBytes);
    } catch (cause) {
      throw new ToolError('bad-type', `"${name}" is not a readable ${embedFormat === 'jpeg' ? 'JPEG' : 'PNG'} image.`,
        'Convert the file to PNG or JPEG and try again.');
    }

    const plan = planImagePlacement(embedded.width, embedded.height, { pageSize, orientation, margin });
    const page = doc.addPage([plan.pageWidth, plan.pageHeight]);
    page.drawImage(embedded, { x: plan.x, y: plan.y, width: plan.width, height: plan.height });
  }

  const bytesOut = await saveDocument(doc);
  return { bytes: bytesOut, pageCount: doc.getPageCount(), warnings };
}

async function decodeImageForPdf(bytes, { name, type, quality, io, wantJpeg }) {
  const format = wantJpeg ? 'jpeg' : 'png';
  if (io && typeof io.decodeImage === 'function') {
    let result;
    try {
      result = await io.decodeImage(bytes, { type, quality, format });
    } catch (cause) {
      throw toToolError(cause, 'bad-type', `"${name}" could not be decoded.`);
    }
    if (!result || !result.bytes) {
      throw new ToolError('bad-type', `"${name}" could not be decoded.`, 'Convert the file to PNG or JPEG and try again.');
    }
    return {
      bytes: toBytes(result.bytes, `decoded "${name}"`),
      format: result.format === 'jpeg' ? 'jpeg' : 'png',
    };
  }
  // Browser default: render.js owns every canvas/DOM dependency and is only
  // imported on this path, so pdf-ops stays DOM-free.
  const { transcodeImageToPng } = await import('./render.js');
  try {
    return await transcodeImageToPng(bytes, { name, type, quality, format });
  } catch (cause) {
    if (isToolError(cause) && cause.code === 'unsupported') {
      throw new ToolError('bad-type',
        `"${name}" is not a JPEG or PNG, and this environment has no image decoder.`,
        'Convert the file to PNG or JPEG first.');
    }
    throw cause;
  }
}

/**
 * Decide page size and image rectangle for one image.
 *
 * `fit` makes the page exactly the image size, so `orientation` is ignored.
 * For fixed paper sizes the image is scaled to fit the margin box, keeps its
 * aspect ratio, and is centred.
 */
function planImagePlacement(imageWidth, imageHeight, { pageSize, orientation, margin }) {
  const width = Math.max(1, Number(imageWidth) || 1);
  const height = Math.max(1, Number(imageHeight) || 1);
  if (pageSize === 'fit') {
    return { pageWidth: width, pageHeight: height, x: 0, y: 0, width, height };
  }
  const size = IMAGE_PAGE_SIZES[pageSize];
  const landscape = orientation === 'landscape' || (orientation === 'auto' && width > height);
  const pageWidth = landscape ? Math.max(size[0], size[1]) : Math.min(size[0], size[1]);
  const pageHeight = landscape ? Math.min(size[0], size[1]) : Math.max(size[0], size[1]);
  // A margin larger than the paper would invert the box; keep at least 1pt.
  const safeMargin = Math.min(margin, Math.min(pageWidth, pageHeight) / 2 - 1);
  const boxWidth = Math.max(1, pageWidth - 2 * safeMargin);
  const boxHeight = Math.max(1, pageHeight - 2 * safeMargin);
  const scale = Math.min(boxWidth / width, boxHeight / height);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  return {
    pageWidth,
    pageHeight,
    x: (pageWidth - drawWidth) / 2,
    y: (pageHeight - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
  };
}

const EMPTY_META = Object.freeze({
  title: null, author: null, subject: null, keywords: null,
  creator: null, producer: null, creationDate: null, modificationDate: null,
});

function readMeta(doc) {
  const read = (fn) => {
    try {
      const value = fn();
      if (value === undefined || value === null) return null;
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
      return String(value);
    } catch (cause) {
      return null;
    }
  };
  return {
    title: read(() => doc.getTitle()),
    author: read(() => doc.getAuthor()),
    subject: read(() => doc.getSubject()),
    keywords: read(() => doc.getKeywords()),
    creator: read(() => doc.getCreator()),
    producer: read(() => doc.getProducer()),
    creationDate: read(() => doc.getCreationDate()),
    modificationDate: read(() => doc.getModificationDate()),
  };
}

/**
 * Inspect a PDF without decrypting it.
 *
 * Metadata is deliberately `null` for encrypted documents: the strings in the
 * Info dictionary are encrypted too, and returning mojibake would be worse than
 * returning nothing. `encrypted` is the reliable signal.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<{ pageCount: number, encrypted: boolean, version: string|null,
 *                     meta: typeof EMPTY_META, warnings: string[] }>}
 */
export async function pdfInfo(bytes) {
  const source = toBytes(bytes);
  assertSize(source, 'the document');
  const headerVersion = sniffPdfHeader(source);
  if (!headerVersion) {
    throw new ToolError('corrupt', 'This file has no %PDF header, so it is not a PDF.');
  }
  const { PDFDocument, PDFName } = await loadPdfLib();
  let doc;
  try {
    doc = await PDFDocument.load(source, { ignoreEncryption: true, updateMetadata: false });
  } catch (cause) {
    throw mapPdfLibError(cause, { encryptedCode: 'corrupt' });
  }

  const encrypted = doc.isEncrypted === true;
  const warnings = [];
  let pageCount = 0;
  try {
    pageCount = doc.getPageCount();
  } catch (cause) {
    warnings.push('page-count-unavailable');
  }

  let version = headerVersion;
  try {
    const declared = doc.catalog.get(PDFName.of('Version'));
    if (declared && typeof declared.asString === 'function') {
      const value = String(declared.asString()).replace(/^\//, '');
      if (/^\d\.\d$/.test(value)) version = value;
    }
  } catch (cause) {
    /* catalog has no /Version: the header wins, which is the spec default */
  }

  return {
    pageCount,
    encrypted,
    version,
    meta: encrypted ? { ...EMPTY_META } : readMeta(doc),
    warnings,
  };
}
