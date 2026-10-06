/**
 * Engine tests for everything pdf-lib does: merge, split, organize, images→PDF.
 *
 * Every assertion is made against bytes, and page order is checked with raw
 * pdf.js text extraction (an implementation the engine does not use) plus
 * qpdf's structural validator. A merge that silently reorders or drops pages
 * cannot pass these tests.
 */

import { test, assert } from './harness.mjs';
import {
  makeGrayscaleJpeg,
  makePdf,
  makePng,
  makeWebpLike,
  oracleImagePixelSizes,
  oracleImagePlacements,
  oraclePageCount,
  oraclePageRotations,
  oraclePageSizes,
  oraclePageTexts,
  oracleQpdfCheck,
} from './fixtures.mjs';
import { loadJSZip, loadPdfLib, mergePdfs, protectPdf, splitPdf, organizePdf, imagesToPdf, zipFiles } from '../apps/web/assets/js/core/index.js';

async function assertStructurallyValid(bytes, label) {
  const verdict = await oracleQpdfCheck(bytes);
  assert.equal(verdict, 'ok', `${label} must pass qpdf --check`);
}

async function twoDocs() {
  const first = await makePdf({ pages: 3, text: 'FIRST' });
  const second = await makePdf({ pages: 2, text: 'SECOND' });
  return { first, second };
}

/* ---------------------------------------------------------------- fixtures -- */

test('generated fixtures are valid multi-page PDFs with ordered markers', async () => {
  const bytes = await makePdf({ pages: 5 });
  assert.equal(await oraclePageCount(bytes), 5);
  assert.deepEqual(await oraclePageTexts(bytes), [
    'PAGE-1-MARKER', 'PAGE-2-MARKER', 'PAGE-3-MARKER', 'PAGE-4-MARKER', 'PAGE-5-MARKER',
  ]);
  await assertStructurallyValid(bytes, 'the fixture');
});

test('the hand-built JPEG fixture is a real JPEG that pdf-lib accepts', async () => {
  const jpeg = makeGrayscaleJpeg(16, 8);
  assert.deepEqual(Array.from(jpeg.subarray(0, 3)), [0xff, 0xd8, 0xff], 'JPEG SOI marker');
  assert.deepEqual(Array.from(jpeg.subarray(-2)), [0xff, 0xd9], 'JPEG EOI marker');
  const { PDFDocument } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const image = await doc.embedJpg(jpeg);
  assert.equal(image.width, 16);
  assert.equal(image.height, 8);
});

test('the hand-built PNG fixture is a real PNG that pdf-lib accepts', async () => {
  const png = makePng(32, 24);
  assert.deepEqual(Array.from(png.subarray(0, 8)), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const { PDFDocument } = await loadPdfLib();
  const doc = await PDFDocument.create();
  const image = await doc.embedPng(png);
  assert.equal(image.width, 32);
  assert.equal(image.height, 24);
});

/* ------------------------------------------------------------------- merge -- */

test('mergePdfs preserves the page count and the page order', async () => {
  const { first, second } = await twoDocs();
  const merged = await mergePdfs([
    { name: 'first.pdf', bytes: first },
    { name: 'second.pdf', bytes: second },
  ]);
  assert.equal(merged.pageCount, 5);
  assert.deepEqual(merged.warnings, []);
  assert.equal(await oraclePageCount(merged.bytes), 5);
  assert.deepEqual(await oraclePageTexts(merged.bytes), [
    'FIRST 1', 'FIRST 2', 'FIRST 3', 'SECOND 1', 'SECOND 2',
  ]);
  await assertStructurallyValid(merged.bytes, 'the merged file');
});

test('mergePdfs handles a single input and a repeated input', async () => {
  const { first } = await twoDocs();
  const single = await mergePdfs([{ name: 'one.pdf', bytes: first }]);
  assert.equal(single.pageCount, 3);
  const doubled = await mergePdfs([{ name: 'one.pdf', bytes: first }, { name: 'again.pdf', bytes: first }]);
  assert.equal(doubled.pageCount, 6);
  assert.deepEqual((await oraclePageTexts(doubled.bytes)).slice(3), ['FIRST 1', 'FIRST 2', 'FIRST 3']);
});

test('mergePdfs with addBookmarks writes a real outline', async () => {
  const { first, second } = await twoDocs();
  const merged = await mergePdfs([
    { name: 'first.pdf', bytes: first },
    { name: 'second.pdf', bytes: second },
  ], { addBookmarks: true });
  assert.deepEqual(merged.warnings, []);

  const { PDFDocument, PDFName } = await loadPdfLib();
  const doc = await PDFDocument.load(merged.bytes);
  const outlinesRef = doc.catalog.get(PDFName.of('Outlines'));
  assert.ok(outlinesRef, 'the catalog must reference /Outlines');
  const outlines = doc.context.lookup(outlinesRef);
  assert.equal(outlines.get(PDFName.of('Count')).asNumber(), 2, 'one bookmark per merged file');

  const titles = [];
  let current = doc.context.lookup(outlines.get(PDFName.of('First')));
  const pageRefs = doc.getPages().map((page) => page.ref.toString());
  const destinations = [];
  while (current) {
    titles.push(current.get(PDFName.of('Title')).decodeText());
    const dest = current.get(PDFName.of('Dest'));
    destinations.push(dest.get(0).toString());
    const next = current.get(PDFName.of('Next'));
    current = next ? doc.context.lookup(next) : null;
  }
  assert.deepEqual(titles, ['first', 'second']);
  assert.equal(destinations[0], pageRefs[0], 'the first bookmark points at the first page');
  assert.equal(destinations[1], pageRefs[3], 'the second bookmark points at the first page of file two');
  await assertStructurallyValid(merged.bytes, 'the bookmarked merge');
});

test('mergePdfs refuses encrypted inputs unless told to skip them', async () => {
  const { first, second } = await twoDocs();
  const locked = await protectPdf(second, { userPassword: 'pw' });

  await assert.throwsCode(
    () => mergePdfs([{ name: 'open.pdf', bytes: first }, { name: 'locked.pdf', bytes: locked.bytes }]),
    'need-password',
    'the default must fail loudly rather than silently dropping pages',
  );

  const skipped = await mergePdfs(
    [{ name: 'open.pdf', bytes: first }, { name: 'locked.pdf', bytes: locked.bytes }],
    { failOnEncrypted: false },
  );
  assert.equal(skipped.pageCount, 3, 'only the readable file contributes pages');
  assert.deepEqual(skipped.warnings, ['skipped-encrypted:locked.pdf']);
  assert.deepEqual(await oraclePageTexts(skipped.bytes), ['FIRST 1', 'FIRST 2', 'FIRST 3']);
});

test('mergePdfs validates its inputs', async () => {
  await assert.throwsCode(() => mergePdfs([]), 'empty-input');
  await assert.throwsCode(() => mergePdfs(null), 'empty-input');
  await assert.throwsCode(() => mergePdfs([{ name: 'x.pdf', bytes: 'not bytes' }]), 'bad-type');
  await assert.throwsCode(() => mergePdfs([{ name: 'x.pdf', bytes: new Uint8Array([1, 2, 3, 4, 5]) }]), 'corrupt');
  const valid = await makePdf({ pages: 1 });
  const truncated = valid.slice(0, Math.floor(valid.length / 3));
  await assert.throwsCode(() => mergePdfs([{ name: 'broken.pdf', bytes: truncated }]), 'corrupt');
});

/* ------------------------------------------------------------------- split -- */

test('splitPdf mode "each" produces one single-page file per page, in order', async () => {
  const source = await makePdf({ pages: 4 });
  const result = await splitPdf(source, { mode: 'each', name: 'doc.pdf' });
  assert.equal(result.pageCount, 4, 'pageCount reports the source document');
  assert.lengthOf(result.outputs, 4);
  assert.deepEqual(result.outputs.map((output) => output.name), [
    'doc-page-1.pdf', 'doc-page-2.pdf', 'doc-page-3.pdf', 'doc-page-4.pdf',
  ]);
  for (let index = 0; index < 4; index++) {
    const output = result.outputs[index];
    assert.isPdf(output.bytes, output.name);
    assert.equal(await oraclePageCount(output.bytes), 1);
    assert.deepEqual(await oraclePageTexts(output.bytes), [`PAGE-${index + 1}-MARKER`]);
  }
  await assertStructurallyValid(result.outputs[0].bytes, 'a split part');
});

test('splitPdf mode "ranges" makes one file per comma-separated group', async () => {
  const source = await makePdf({ pages: 5 });
  const result = await splitPdf(source, { mode: 'ranges', ranges: '2-4,1', name: 'report' });
  assert.lengthOf(result.outputs, 2);
  assert.deepEqual(result.outputs.map((output) => output.name), ['report-pages-2-4.pdf', 'report-page-1.pdf']);
  assert.deepEqual(await oraclePageTexts(result.outputs[0].bytes), [
    'PAGE-2-MARKER', 'PAGE-3-MARKER', 'PAGE-4-MARKER',
  ]);
  assert.deepEqual(await oraclePageTexts(result.outputs[1].bytes), ['PAGE-1-MARKER']);
});

test('splitPdf mergeToOne collapses the selection into one ordered file', async () => {
  const source = await makePdf({ pages: 5 });
  const result = await splitPdf(source, { mode: 'ranges', ranges: '3,1,3', mergeToOne: true, name: 'pick' });
  assert.lengthOf(result.outputs, 1);
  assert.equal(result.outputs[0].name, 'pick-pages.pdf');
  assert.deepEqual(await oraclePageTexts(result.outputs[0].bytes), ['PAGE-3-MARKER', 'PAGE-1-MARKER']);
  assert.deepEqual(result.warnings, ['duplicate-pages-collapsed'], 'collapsing must be reported');
});

test('splitPdf mode "every-n" chunks the document and keeps the tail', async () => {
  const source = await makePdf({ pages: 5 });
  const result = await splitPdf(source, { mode: 'every-n', everyN: 2, name: 'chunks' });
  assert.deepEqual(result.outputs.map((output) => output.name), [
    'chunks-pages-1-2.pdf', 'chunks-pages-3-4.pdf', 'chunks-page-5.pdf',
  ]);
  assert.deepEqual(await oraclePageTexts(result.outputs[2].bytes), ['PAGE-5-MARKER']);
  assert.deepEqual(result.warnings, []);
});

test('splitPdf sanitises the base name it is given', async () => {
  const source = await makePdf({ pages: 1 });
  const result = await splitPdf(source, { mode: 'each', name: 'C:\\Users\\x\\My Report.pdf' });
  assert.equal(result.outputs[0].name, 'My Report-page-1.pdf');
});

test('splitPdf validates options before touching the document', async () => {
  const source = await makePdf({ pages: 3 });
  await assert.throwsCode(() => splitPdf(source, { mode: 'diagonal' }), 'invalid-option');
  await assert.throwsCode(() => splitPdf(source, { mode: 'every-n', everyN: 0 }), 'invalid-option');
  await assert.throwsCode(() => splitPdf(source, { mode: 'every-n', everyN: 1.5 }), 'invalid-option');
  await assert.throwsCode(() => splitPdf(source, { mode: 'ranges', ranges: '  ' }), 'range-empty');
  await assert.throwsCode(() => splitPdf(source, { mode: 'ranges', ranges: 'nope' }), 'range-invalid');
  await assert.throwsCode(() => splitPdf(source, { mode: 'ranges', ranges: '99' }), 'range-empty');
});

test('splitPdf rejects encrypted and corrupt documents', async () => {
  const source = await makePdf({ pages: 2 });
  const locked = await protectPdf(source, { userPassword: 'pw' });
  await assert.throwsCode(() => splitPdf(locked.bytes, { mode: 'each' }), 'encrypted');
  await assert.throwsCode(() => splitPdf(source.slice(0, 40), { mode: 'each' }), 'corrupt');
});

/* ---------------------------------------------------------------- organize -- */

test('organizePdf reorders, duplicates and drops pages', async () => {
  const source = await makePdf({ pages: 4 });
  const result = await organizePdf(source, { order: [3, 1, 3], drop: [2] });
  assert.equal(result.pageCount, 3, 'pageCount is the output page count');
  assert.deepEqual(result.warnings, []);
  assert.equal(await oraclePageCount(result.bytes), 3);
  assert.deepEqual(await oraclePageTexts(result.bytes), [
    'PAGE-3-MARKER', 'PAGE-1-MARKER', 'PAGE-3-MARKER',
  ]);
  await assertStructurallyValid(result.bytes, 'the organised file');
});

test('organizePdf defaults to every page and only drops what is listed', async () => {
  const source = await makePdf({ pages: 4 });
  const result = await organizePdf(source, { drop: [1, 4] });
  assert.equal(result.pageCount, 2);
  assert.deepEqual(await oraclePageTexts(result.bytes), ['PAGE-2-MARKER', 'PAGE-3-MARKER']);
});

test('organizePdf applies rotation per source page and accumulates existing rotation', async () => {
  const source = await makePdf({ pages: 3, rotate: { 2: 90 } });
  assert.deepEqual(await oraclePageRotations(source), [0, 90, 0], 'fixture sanity');
  const result = await organizePdf(source, { order: [1, 2, 3], rotate: { 1: 90, 2: 90, 3: 180 } });
  assert.deepEqual(await oraclePageRotations(result.bytes), [90, 180, 180],
    'rotation is added to the rotation the page already had');
  assert.deepEqual(await oraclePageTexts(result.bytes), [
    'PAGE-1-MARKER', 'PAGE-2-MARKER', 'PAGE-3-MARKER',
  ]);
});

test('organizePdf rejects unknown pages, empty results and bad rotations', async () => {
  const source = await makePdf({ pages: 3 });
  await assert.throwsCode(() => organizePdf(source, { order: [0] }), 'invalid-option');
  await assert.throwsCode(() => organizePdf(source, { order: [4] }), 'invalid-option');
  await assert.throwsCode(() => organizePdf(source, { order: [1, 'two'] }), 'invalid-option');
  await assert.throwsCode(() => organizePdf(source, { drop: [9] }), 'invalid-option');
  await assert.throwsCode(() => organizePdf(source, { rotate: { 1: 45 } }), 'invalid-option');
  await assert.throwsCode(() => organizePdf(source, { rotate: { 7: 90 } }), 'invalid-option');
  await assert.throwsCode(() => organizePdf(source, { rotate: { page: 90 } }), 'invalid-option');
  await assert.throwsCode(() => organizePdf(source, { order: [] }), 'range-empty');
  await assert.throwsCode(() => organizePdf(source, { drop: [1, 2, 3] }), 'range-empty');
});

test('organizePdf drops pages that were also listed in order', async () => {
  const source = await makePdf({ pages: 4 });
  const result = await organizePdf(source, { order: [1, 2, 3, 4], drop: [2] });
  assert.deepEqual(await oraclePageTexts(result.bytes), ['PAGE-1-MARKER', 'PAGE-3-MARKER', 'PAGE-4-MARKER']);
});

/* ------------------------------------------------------------ imagesToPdf -- */

test('imagesToPdf embeds a real JPEG and a real PNG, one page each', async () => {
  const jpeg = makeGrayscaleJpeg(16, 8);
  const png = makePng(32, 24);
  const result = await imagesToPdf(
    [{ name: 'photo.jpg', bytes: jpeg, type: 'image/jpeg' }, { name: 'graphic.png', bytes: png, type: 'image/png' }],
    { pageSize: 'fit' },
  );
  assert.equal(result.pageCount, 2);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(await oraclePageSizes(result.bytes), [[16, 8], [32, 24]], 'fit pages match the image sizes');
  assert.deepEqual(
    (await oracleImagePixelSizes(result.bytes)).map(({ pageNumber, width, height }) => ({ pageNumber, width, height })),
    [
      { pageNumber: 1, width: 16, height: 8 },
      { pageNumber: 2, width: 32, height: 24 },
    ],
    'the embedded images keep their pixel dimensions',
  );
  assert.deepEqual(await oracleImagePlacements(result.bytes), [
    { pageNumber: 1, matrix: [16, 0, 0, 8, 0, 0] },
    { pageNumber: 2, matrix: [32, 0, 0, 24, 0, 0] },
  ]);
  await assertStructurallyValid(result.bytes, 'the image PDF');
});

test('imagesToPdf picks the page orientation from each image with "auto"', async () => {
  const portrait = makePng(10, 20, { alpha: false });
  const landscape = makePng(20, 10, { alpha: false });
  const result = await imagesToPdf(
    [{ name: 'tall.png', bytes: portrait }, { name: 'wide.png', bytes: landscape }],
    { pageSize: 'a4', orientation: 'auto' },
  );
  assert.deepEqual(await oraclePageSizes(result.bytes), [
    [595.28, 841.89],
    [841.89, 595.28],
  ]);

  const forced = await imagesToPdf([{ name: 'wide.png', bytes: landscape }], { pageSize: 'a4', orientation: 'portrait' });
  assert.deepEqual(await oraclePageSizes(forced.bytes), [[595.28, 841.89]], 'explicit portrait wins');

  const legal = await imagesToPdf([{ name: 'tall.png', bytes: portrait }], { pageSize: 'legal' });
  assert.deepEqual(await oraclePageSizes(legal.bytes), [[612, 1008]]);
});

test('imagesToPdf centres the image inside the margin box without distortion', async () => {
  const png = makePng(100, 50, { alpha: false });
  const result = await imagesToPdf([{ name: 'wide.png', bytes: png }], {
    pageSize: 'a4',
    orientation: 'portrait',
    margin: 'large',
  });
  const [placement] = await oracleImagePlacements(result.bytes);
  assert.ok(placement, 'the image must be painted');
  const [drawnWidth, skewX, skewY, drawnHeight, x, y] = placement.matrix;
  assert.close(drawnWidth / drawnHeight, 2, 1e-6, 'aspect ratio must be preserved');
  assert.close(drawnHeight, 225.64, 0.01, 'the image must fit the 451.28 x 697.89 margin box');
  assert.close(drawnWidth, 451.28, 0.01);
  assert.close(x, (595.28 - 451.28) / 2, 0.01, 'horizontally centred');
  assert.close(y, (841.89 - 225.64) / 2, 0.01, 'vertically centred');
  assert.equal(skewX, 0);
  assert.equal(skewY, 0);

  const full = await imagesToPdf([{ name: 'wide.png', bytes: png }], { pageSize: 'a4', orientation: 'portrait', margin: 'none' });
  const [fullPlacement] = await oracleImagePlacements(full.bytes);
  assert.close(fullPlacement.matrix[0], 595.28, 0.01, 'with no margin the image spans the page width');
});

test('imagesToPdf trusts the bytes, not the declared MIME type', async () => {
  const png = makePng(32, 24, { alpha: false });
  const result = await imagesToPdf([{ name: 'lying.jpg', bytes: png, type: 'image/jpeg' }], { pageSize: 'fit' });
  assert.deepEqual(await oraclePageSizes(result.bytes), [[32, 24]]);
  assert.deepEqual(await oracleImagePixelSizes(result.bytes), [
    { pageNumber: 1, name: '/Image1', width: 32, height: 24 },
  ]);
});

test('imagesToPdf routes unknown formats through an injected decoder', async () => {
  const webp = makeWebpLike();
  await assert.throwsCode(
    () => imagesToPdf([{ name: 'photo.webp', bytes: webp, type: 'image/webp' }], { pageSize: 'fit' }),
    'bad-type',
    'without a decoder an unknown format must fail loudly',
  );

  const decodedPng = makePng(20, 10, { alpha: false });
  const requests = [];
  const result = await imagesToPdf([{ name: 'photo.webp', bytes: webp, type: 'image/webp' }], {
    pageSize: 'fit',
    quality: 0.5,
    io: {
      async decodeImage(bytes, request) {
        requests.push({ length: bytes.length, ...request });
        return { bytes: decodedPng, format: 'png' };
      },
    },
  });
  assert.deepEqual(requests, [{ length: webp.length, type: 'image/webp', quality: 0.5, format: 'png' }]);
  assert.deepEqual(await oraclePageSizes(result.bytes), [[20, 10]], 'the decoded image defines the page');
  assert.deepEqual(result.warnings, []);
});

test('imagesToPdf reports re-encoding and forwards the quality setting', async () => {
  const jpeg = makeGrayscaleJpeg(16, 8);
  const requests = [];
  const result = await imagesToPdf([{ name: 'photo.jpg', bytes: jpeg, type: 'image/jpeg' }], {
    pageSize: 'fit',
    reencode: true,
    quality: 0.42,
    io: {
      async decodeImage(bytes, request) {
        requests.push(request);
        return { bytes: makeGrayscaleJpeg(16, 8), format: 'jpeg' };
      },
    },
  });
  assert.deepEqual(requests, [{ type: 'image/jpeg', quality: 0.42, format: 'jpeg' }]);
  assert.deepEqual(result.warnings, ['reencoded:photo.jpg']);
  assert.equal(result.pageCount, 1);
});

test('imagesToPdf rejects bad options and empty input', async () => {
  const png = makePng(8, 8, { alpha: false });
  const input = [{ name: 'a.png', bytes: png }];
  await assert.throwsCode(() => imagesToPdf([], {}), 'empty-input');
  await assert.throwsCode(() => imagesToPdf(input, { pageSize: 'a3' }), 'invalid-option');
  await assert.throwsCode(() => imagesToPdf(input, { orientation: 'diagonal' }), 'invalid-option');
  await assert.throwsCode(() => imagesToPdf(input, { margin: 'huge' }), 'invalid-option');
  await assert.throwsCode(() => imagesToPdf(input, { quality: 2 }), 'invalid-option');
  await assert.throwsCode(() => imagesToPdf([{ name: 'a.png', bytes: new Uint8Array(0) }], {}), 'bad-type');
});

/* --------------------------------------------------------------------- zip -- */

test('zipFiles writes a real ZIP that reads back with matching entries', async () => {
  const zipBytes = await zipFiles([
    { name: 'page-1.png', bytes: new Uint8Array([1, 2, 3, 4]) },
    { name: 'page-2.png', bytes: new Uint8Array([5, 6, 7, 8, 9]) },
    { name: '../page-1.png', bytes: new Uint8Array([10, 11]) },
  ]);
  assert.ok(zipBytes instanceof Uint8Array, 'a Uint8Array is returned');
  assert.deepEqual(Array.from(zipBytes.subarray(0, 4)), [0x50, 0x4b, 0x03, 0x04], 'local file header');
  const JSZip = await loadJSZip();
  const archive = await JSZip.loadAsync(zipBytes);
  const names = Object.keys(archive.files).sort();
  assert.deepEqual(names, ['page-1-2.png', 'page-1.png', 'page-2.png'], 'duplicates and paths are made safe');
  assert.bytesEqual(await archive.file('page-1.png').async('uint8array'), new Uint8Array([1, 2, 3, 4]));
  assert.bytesEqual(await archive.file('page-2.png').async('uint8array'), new Uint8Array([5, 6, 7, 8, 9]));
  assert.bytesEqual(await archive.file('page-1-2.png').async('uint8array'), new Uint8Array([10, 11]));
});

test('zipFiles round-trips real engine output', async () => {
  const source = await makePdf({ pages: 2 });
  const split = await splitPdf(source, { mode: 'each' });
  const zipBytes = await zipFiles(split.outputs);
  const JSZip = await loadJSZip();
  const archive = await JSZip.loadAsync(zipBytes);
  assert.lengthOf(Object.keys(archive.files), 2);
  const restored = await archive.file('document-page-1.pdf').async('uint8array');
  assert.equal(await oraclePageCount(restored), 1, 'a page survives the ZIP round trip');
});

test('zipFiles rejects an empty list', async () => {
  await assert.throwsCode(() => zipFiles([]), 'empty-input');
});
