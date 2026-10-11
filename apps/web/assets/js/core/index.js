/**
 * ToolSeer V3 — the engine's public surface.
 *
 * `docs/ARCHITECTURE.md` §4: **this is the only import path tool pages use.**
 *
 *   import { mergePdfs } from '/assets/js/core/index.js';
 *
 * Everything is bytes-in / bytes-out, nothing touches the DOM at module scope,
 * and every failure is a `ToolError` carrying a stable `code` the UI localises.
 * Every operation that can degrade returns `warnings: string[]` (possibly empty).
 *
 * Operations and their option shapes (see the individual modules for detail):
 *
 *   mergePdfs(inputs, { addBookmarks, failOnEncrypted })
 *   splitPdf(bytes, { mode: 'each'|'ranges'|'every-n', ranges, everyN, mergeToOne, name })
 *   organizePdf(bytes, { order, rotate, drop })
 *   imagesToPdf(images, { pageSize, orientation, margin, quality, reencode, io })
 *   compressPdf(bytes, { level, dpi, quality, removeMetadata })
 *   protectPdf(bytes, { userPassword, ownerPassword, allow, algorithm })
 *   unlockPdf(bytes, { password })
 *   extractText(bytes, { pages, layout, ocr, ocrLang, ocrEngine, password })
 *   pdfToImages(bytes, { format, dpi, pages, quality, background, name }, io)
 *   renderThumbnails(bytes, { maxWidth, pages })
 *   pdfInfo(bytes)
 *   zipFiles(outputs)                      → Uint8Array (a real .zip)
 *   parsePageRanges(spec, maxPage) → number[]
 *   formatBytes(n) → string
 *   safeBaseName(name, fallback) → string
 *
 * ## Why there is an `errors.js`
 *
 * `ToolError` is documented as part of `pdf-ops.js` and is re-exported from
 * there, but it is *defined* in `errors.js` so that the module graph stays
 * acyclic: `engines.js` needs the error type too, and a `pdf-ops <-> engines`
 * cycle would put class declarations in the temporal dead zone. Nothing else
 * changed about the published surface.
 */

export { ToolError, ERROR_CODES, isToolError, mapEngineError, toToolError } from './errors.js';

export {
  MAX_INPUT_BYTES,
  IMAGE_MARGINS,
  IMAGE_PAGE_SIZES,
  mergePdfs,
  splitPdf,
  organizePdf,
  addPageNumbers,
  imagesToPdf,
  pdfInfo,
  parsePageRanges,
  formatBytes,
  safeBaseName,
  toBytes,
} from './pdf-ops.js';

export { protectPdf, unlockPdf, compressPdf } from './qpdf-ops.js';

export {
  setCanvasFactory,
  getCanvasFactory,
  createCanvasIo,
  pdfToImages,
  renderThumbnails,
  extractText,
  transcodeImageToPng,
} from './render.js';

export {
  VENDOR,
  vendorUrl,
  isNodeRuntime,
  installEngineShims,
  missingEngineShims,
  areEngineShimsInstalled,
  loadPdfLib,
  loadPdfJs,
  loadQpdf,
  loadJSZip,
  resetEngineCache,
  zipFiles,
} from './engines.js';
