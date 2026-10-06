/**
 * Engine tests for the pdf.js-backed operations: text extraction, PDF→images,
 * and page-grid thumbnails.
 *
 * There is no browser here, so rendering is verified against a recording canvas
 * double that pdf.js paints into for real (see tests/canvas-double.mjs): the
 * operator pipeline, page geometry, dpi maths, page selection and the encode
 * call are all exercised; only the pixels are synthetic. Everything about the
 * bitmap itself is therefore reported as "not verifiable in Node".
 */

import { test, assert } from './harness.mjs';
import { createCanvasDouble } from './canvas-double.mjs';
import { makePdf, makePng, oraclePageSizes, oracleQpdfCheck } from './fixtures.mjs';
import {
  extractText,
  getCanvasFactory,
  imagesToPdf,
  loadPdfLib,
  pdfToImages,
  protectPdf,
  renderThumbnails,
  setCanvasFactory,
} from '../apps/web/assets/js/core/index.js';

async function makeTwoLinePdf() {
  const { PDFDocument, StandardFonts } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 300]);
  page.drawText('LINE-ONE', { x: 30, y: 240, size: 16, font });
  page.drawText('LINE-TWO', { x: 30, y: 210, size: 16, font });
  return doc.save();
}

async function makeTwoColumnPdf() {
  const { PDFDocument, StandardFonts } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([400, 300]);
  page.drawText('LEFT', { x: 20, y: 200, size: 14, font });
  page.drawText('RIGHT', { x: 200, y: 200, size: 14, font });
  return doc.save();
}

async function makeImageOnlyPdf() {
  const { PDFDocument } = await loadPdfLib();
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  return doc.save();
}

/* ------------------------------------------------------------ extractText -- */

test('extractText recovers the exact text of every page in order', async () => {
  const bytes = await makePdf({ pages: 3 });
  const result = await extractText(bytes);
  assert.equal(result.text, 'PAGE-1-MARKER\fPAGE-2-MARKER\fPAGE-3-MARKER', 'pages are joined with a form feed');
  assert.deepEqual(result.pages.map((page) => page.page), [1, 2, 3]);
  assert.equal(result.pages.every((page) => page.source === 'text'), true);
  assert.equal(result.meta.pageCount, 3);
  assert.deepEqual(result.warnings, []);
});

test('extractText keeps visual line order', async () => {
  const bytes = await makeTwoLinePdf();
  const result = await extractText(bytes);
  assert.equal(result.pages[0].text, 'LINE-ONE\nLINE-TWO');
});

test('extractText layout mode reproduces horizontal gaps', async () => {
  const bytes = await makeTwoColumnPdf();
  const plain = await extractText(bytes, { layout: false });
  assert.match(plain.pages[0].text, /^LEFT RIGHT$/, 'default mode inserts a single space');
  const laidOut = await extractText(bytes, { layout: true });
  assert.match(laidOut.pages[0].text, /^LEFT {2,}RIGHT$/, 'layout mode reproduces the column gap');
});

test('extractText can extract a subset of pages', async () => {
  const bytes = await makePdf({ pages: 4 });
  const result = await extractText(bytes, { pages: [3, 1] });
  assert.deepEqual(result.pages.map((page) => page.page), [3, 1]);
  assert.equal(result.text, 'PAGE-3-MARKER\fPAGE-1-MARKER');
  assert.equal(result.meta.pageCount, 4, 'meta still describes the whole document');
});

test('extractText validates the page selection', async () => {
  const bytes = await makePdf({ pages: 2 });
  await assert.throwsCode(() => extractText(bytes, { pages: [0] }), 'invalid-option');
  await assert.throwsCode(() => extractText(bytes, { pages: [3] }), 'invalid-option');
  await assert.throwsCode(() => extractText(bytes, { pages: 'first' }), 'invalid-option');
  await assert.throwsCode(() => extractText(bytes, { pages: [] }), 'range-empty');
});

test('extractText maps pdf.js failures onto stable error codes', async () => {
  await assert.throwsCode(() => extractText(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 9, 9, 9])), 'corrupt');
  await assert.throwsCode(() => extractText(new Uint8Array(0)), 'corrupt');

  const source = await makePdf({ pages: 2 });
  const locked = await protectPdf(source, { userPassword: 'sesame' });
  await assert.throwsCode(() => extractText(locked.bytes), 'need-password');
  await assert.throwsCode(() => extractText(locked.bytes, { password: 'wrong' }), 'wrong-password');

  const opened = await extractText(locked.bytes, { password: 'sesame' });
  assert.equal(opened.text, 'PAGE-1-MARKER\fPAGE-2-MARKER', 'the password path must really decrypt');
});

test('extractText refuses OCR when no engine is bundled, and accepts ocrLang', async () => {
  const bytes = await makePdf({ pages: 1 });
  const error = await assert.throwsCode(() => extractText(bytes, { ocr: true }), 'ocr-unavailable');
  assert.includes(error.message, 'eng');
  const arabic = await assert.throwsCode(() => extractText(bytes, { ocr: true, ocrLang: 'eng+ara' }), 'ocr-unavailable');
  assert.includes(arabic.message, 'eng+ara');
  await assert.throwsCode(() => extractText(bytes, { ocr: true, ocrLang: 'english' }), 'invalid-option');

  const ignored = await extractText(bytes, { ocr: false, ocrLang: 'not-a-language' });
  assert.equal(ignored.text, 'PAGE-1-MARKER', 'ocrLang is irrelevant while OCR is off');
});

test('extractText uses an injected OCR engine only where there is no text layer', async () => {
  const { PDFDocument, StandardFonts } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage([300, 200]).drawText('HAS-TEXT', { x: 20, y: 150, size: 14, font });
  doc.addPage([300, 200]); // deliberately blank: OCR territory
  const bytes = await doc.save();

  const { factory } = createCanvasDouble();
  const seen = [];
  const result = await extractText(bytes, {
    ocr: true,
    ocrLang: 'ara',
    io: factory,
    ocrEngine: {
      async recognize(dataUrl, lang) {
        seen.push({ prefix: dataUrl.slice(0, 22), lang });
        return { text: 'OCRED' };
      },
    },
  });

  assert.deepEqual(result.pages.map((page) => page.text), ['HAS-TEXT', 'OCRED']);
  assert.deepEqual(result.pages.map((page) => page.source), ['text', 'ocr']);
  assert.lengthOf(seen, 1, 'the page that already had text must not be OCRed');
  assert.equal(seen[0].prefix, 'data:image/png;base64,');
  assert.equal(seen[0].lang, 'ara');
  assert.deepEqual(result.warnings, ['ocr-used:page-2']);
});

/* ------------------------------------------------------------- pdfToImages -- */

test('pdfToImages renders every page at the requested dpi', async () => {
  const bytes = await makePdf({ pages: 2, size: [300, 200] });
  const { factory, calls } = createCanvasDouble({ payload: () => new Uint8Array([1, 2, 3, 4]) });
  const result = await pdfToImages(bytes, { dpi: 150, format: 'png' }, factory);

  assert.equal(result.pageCount, 2);
  assert.deepEqual(result.outputs.map((output) => output.name), ['document-page-1.png', 'document-page-2.png']);
  assert.deepEqual(result.outputs.map((output) => output.type), ['image/png', 'image/png']);
  assert.bytesEqual(result.outputs[0].bytes, new Uint8Array([1, 2, 3, 4]), 'the encoded bytes are passed through');
  assert.deepEqual(calls.created, [
    { width: Math.floor(300 * (150 / 72)), height: Math.floor(200 * (150 / 72)) },
    { width: Math.floor(300 * (150 / 72)), height: Math.floor(200 * (150 / 72)) },
  ]);
  assert.deepEqual(calls.encodings.map((entry) => entry.format), ['png', 'png']);
  assert.ok(calls.texts.length > 0, 'pdf.js must really have painted the pages into the double');
  assert.deepEqual(result.warnings, []);
});

test('pdfToImages honours the page selection, format, quality and base name', async () => {
  const bytes = await makePdf({ pages: 3, size: [300, 200] });
  const { factory, calls } = createCanvasDouble();
  const result = await pdfToImages(bytes, {
    dpi: 72,
    format: 'jpeg',
    quality: 0.4,
    pages: [3],
    filename: 'My Export.pdf',
  }, factory);

  assert.deepEqual(result.outputs.map((output) => output.name), ['My Export-page-3.jpg']);
  assert.deepEqual(result.outputs.map((output) => output.type), ['image/jpeg']);
  assert.deepEqual(calls.created, [{ width: 300, height: 200 }]);
  assert.deepEqual(calls.encodings, [{ format: 'jpeg', quality: 0.4, width: 300, height: 200 }]);
});

test('pdfToImages paints an opaque white background before each page', async () => {
  const bytes = await makePdf({ pages: 1, size: [100, 50] });
  const { factory, calls } = createCanvasDouble();
  await pdfToImages(bytes, { dpi: 72 }, factory);
  const fill = calls.fills.find((entry) => entry.width === 100 && entry.height === 50);
  assert.ok(fill, 'the whole canvas must be filled before painting');
  assert.equal(fill.style, '#ffffff', 'transparent areas must not turn black in a JPEG');
});

test('pdfToImages validates its options and reports a missing canvas', async () => {
  const bytes = await makePdf({ pages: 1 });
  await assert.throwsCode(() => pdfToImages(bytes, {}), 'unsupported', 'Node has no canvas');
  await assert.throwsCode(() => pdfToImages(bytes, { format: 'webp' }, createCanvasDouble().factory), 'invalid-option');
  await assert.throwsCode(() => pdfToImages(bytes, { dpi: 5000 }, createCanvasDouble().factory), 'invalid-option');
  await assert.throwsCode(() => pdfToImages(bytes, { quality: 3 }, createCanvasDouble().factory), 'invalid-option');
  await assert.throwsCode(() => pdfToImages(bytes, { pages: [7] }, createCanvasDouble().factory), 'invalid-option');
  await assert.throwsCode(() => pdfToImages(bytes, {}, { create() { return {}; } }), 'invalid-option',
    'a factory without toBytes cannot encode');
});

test('pdfToImages maps encrypted and corrupt input onto error codes', async () => {
  const source = await makePdf({ pages: 1 });
  const locked = await protectPdf(source, { userPassword: 'pw' });
  await assert.throwsCode(() => pdfToImages(locked.bytes, {}, createCanvasDouble().factory), 'need-password');
  const opened = await pdfToImages(locked.bytes, { dpi: 72, password: 'pw' }, createCanvasDouble().factory);
  assert.equal(opened.pageCount, 1, 'the password path must really decrypt');
  await assert.throwsCode(() => pdfToImages(new Uint8Array([1, 2, 3, 4, 5]), {}, createCanvasDouble().factory), 'corrupt');
});

/* -------------------------------------------------------- renderThumbnails -- */

test('renderThumbnails returns data URLs capped at maxWidth', async () => {
  const bytes = await makePdf({ pages: 3, size: [600, 300] });
  const { factory, calls } = createCanvasDouble();
  setCanvasFactory(factory);
  try {
    const thumbnails = await renderThumbnails(bytes, { maxWidth: 220 });
    assert.lengthOf(thumbnails, 3);
    assert.deepEqual(thumbnails.map((thumb) => thumb.pageNumber), [1, 2, 3]);
    for (const thumb of thumbnails) {
      assert.equal(thumb.width <= 220, true, 'thumbnails must not exceed maxWidth');
      assert.equal(thumb.dataUrl.startsWith('data:image/png;base64,'), true);
      assert.equal(thumb.height, Math.round(220 / 2), 'a 2:1 page keeps its aspect ratio');
    }
    assert.equal(calls.dataUrls.length, 3, 'each thumbnail asks the canvas for a PNG data URL');

    const single = await renderThumbnails(bytes, { maxWidth: 300, pages: [2] });
    assert.deepEqual(single.map((thumb) => thumb.pageNumber), [2]);
    assert.equal(single[0].width, 300);
  } finally {
    setCanvasFactory(null);
  }
});

test('renderThumbnails never upscales and validates maxWidth', async () => {
  const bytes = await makePdf({ pages: 1, size: [100, 100] });
  setCanvasFactory(createCanvasDouble().factory);
  try {
    const [thumbnail] = await renderThumbnails(bytes, { maxWidth: 400 });
    assert.equal(thumbnail.width, 100, 'a small page is not blown up');
    await assert.throwsCode(() => renderThumbnails(bytes, { maxWidth: 4 }), 'invalid-option');
    await assert.throwsCode(() => renderThumbnails(bytes, { pages: [9] }), 'invalid-option');
    await assert.throwsCode(() => renderThumbnails(bytes.slice(0, 20)), 'corrupt');
  } finally {
    setCanvasFactory(null);
  }
});

test('renderThumbnails reports a missing canvas instead of crashing', async () => {
  const bytes = await makePdf({ pages: 1 });
  setCanvasFactory(null);
  assert.equal(getCanvasFactory(), null, 'Node has no canvas factory by default');
  await assert.throwsCode(() => renderThumbnails(bytes, {}), 'unsupported');
  await assert.throwsCode(() => setCanvasFactory({ nothing: true }), 'invalid-option');
});

test('rendered pages can be fed straight back into imagesToPdf', async () => {
  const bytes = await makePdf({ pages: 2, size: [200, 100] });
  const { factory } = createCanvasDouble({
    payload: (canvas) => makePng(canvas.width, canvas.height, { alpha: false }),
  });
  const rendered = await pdfToImages(bytes, { dpi: 72 }, factory);
  assert.lengthOf(rendered.outputs, 2);
  assert.deepEqual(Array.from(rendered.outputs[0].bytes.subarray(0, 4)), [0x89, 0x50, 0x4e, 0x47],
    'the encoded pages are real PNGs');

  const rebuilt = await imagesToPdf(rendered.outputs, { pageSize: 'fit' });
  assert.equal(rebuilt.pageCount, 2);
  assert.deepEqual(await oraclePageSizes(rebuilt.bytes), [[200, 100], [200, 100]]);
  assert.equal(await oracleQpdfCheck(rebuilt.bytes), 'ok');
});
