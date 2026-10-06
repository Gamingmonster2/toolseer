/**
 * Engine tests for the qpdf-backed operations: protect, unlock, compress.
 *
 * Encryption is verified with qpdf itself, never with our own code:
 *   - `oracleAcceptsPassword` asks qpdf whether the password opens the file
 *   - `oracleOpensWithoutPassword` performs a real `--decrypt` with no password
 *   - `/P` bits are read out of the encryption dictionary with pdf-lib
 *
 * The "cannot be opened without a password" test is a regression guard: an
 * earlier build passed `--allow-insecure` and produced files anyone could open.
 */

import { test, assert } from './harness.mjs';
import { createCanvasDouble } from './canvas-double.mjs';
import {
  makeBulkyPdf,
  makeGrayscaleJpeg,
  makeMetadataPdf,
  makePdf,
  oracleAcceptsPassword,
  oracleDecrypt,
  oracleEncryptionDictionary,
  oracleOpensWithoutPassword,
  oraclePageTexts,
  oracleQpdfCheck,
  oracleUncompressStreams,
} from './fixtures.mjs';
import {
  compressPdf,
  extractText,
  loadJSZip,
  loadPdfJs,
  loadPdfLib,
  loadQpdf,
  pdfInfo,
  protectPdf,
  setCanvasFactory,
  unlockPdf,
} from '../apps/web/assets/js/core/index.js';

const PRINT_BIT = 4;
const MODIFY_BIT = 8;
const COPY_BIT = 16;
const ANNOTATE_BIT = 32;

/* ----------------------------------------------------------------- protect -- */

test('protectPdf produces a file that only the password opens', async () => {
  const source = await makePdf({ pages: 3 });
  const protectedBytes = await protectPdf(source, { userPassword: 'correct horse' });

  assert.isPdf(protectedBytes.bytes, 'the protected file');
  assert.deepEqual(protectedBytes.warnings, []);
  assert.notEqual(
    Buffer.compare(Buffer.from(protectedBytes.bytes), Buffer.from(source)),
    0,
    'the protected bytes must differ from the source',
  );

  assert.equal(await oracleAcceptsPassword(protectedBytes.bytes, 'correct horse'), true,
    'the password that was set must open the file');
  assert.equal(await oracleAcceptsPassword(protectedBytes.bytes, 'wrong password'), false);

  const withoutPassword = await oracleOpensWithoutPassword(protectedBytes.bytes);
  assert.equal(withoutPassword.opened, false,
    'a protected file must NOT be openable without a password');

  const dictionary = await oracleEncryptionDictionary(protectedBytes.bytes);
  assert.deepEqual({ R: dictionary.R, V: dictionary.V }, { R: 6, V: 5 }, 'AES-256 security handler');

  // Content survives: the password decrypts to the same pages, in the same order.
  const decrypted = await oracleDecrypt(protectedBytes.bytes, 'correct horse');
  assert.deepEqual(await oraclePageTexts(decrypted), ['PAGE-1-MARKER', 'PAGE-2-MARKER', 'PAGE-3-MARKER']);
});

test('protectPdf copies the user password into an empty owner slot', async () => {
  const source = await makePdf({ pages: 1 });
  const protectedBytes = await protectPdf(source, { userPassword: 'only-one' });
  const dictionary = await oracleEncryptionDictionary(protectedBytes.bytes);
  assert.ok(dictionary && typeof dictionary.P === 'number', 'the file must carry an encryption dictionary');
  assert.equal((await oracleOpensWithoutPassword(protectedBytes.bytes)).opened, false,
    'the empty owner password must not create a free-for-all file');
  assert.equal(await oracleAcceptsPassword(protectedBytes.bytes, 'only-one'), true);
});

test('protectPdf honours explicit owner passwords and permission bits', async () => {
  const source = await makePdf({ pages: 2 });
  const locked = await protectPdf(source, {
    userPassword: 'user',
    ownerPassword: 'owner',
    allow: { print: false, copy: false, modify: false, annotate: false },
  });
  const restricted = await oracleEncryptionDictionary(locked.bytes);
  assert.equal(restricted.P & PRINT_BIT, 0, 'printing must be denied');
  assert.equal(restricted.P & MODIFY_BIT, 0, 'modifying must be denied');
  assert.equal(restricted.P & COPY_BIT, 0, 'copy/extract must be denied');
  assert.equal(restricted.P & ANNOTATE_BIT, 0, 'annotating must be denied');
  assert.equal(await oracleAcceptsPassword(locked.bytes, 'user'), true);
  assert.equal(await oracleAcceptsPassword(locked.bytes, 'owner'), true);

  const open = await protectPdf(source, { userPassword: 'user', ownerPassword: 'owner' });
  const unrestricted = await oracleEncryptionDictionary(open.bytes);
  assert.equal((unrestricted.P & PRINT_BIT) !== 0, true, 'printing must be allowed by default');
  assert.equal((unrestricted.P & MODIFY_BIT) !== 0, true, 'modifying must be allowed by default');
  assert.equal((unrestricted.P & COPY_BIT) !== 0, true, 'extraction must be allowed by default');
  assert.equal((unrestricted.P & ANNOTATE_BIT) !== 0, true, 'annotating must be allowed by default');
});

test('protectPdf supports the weaker algorithms and says so', async () => {
  const source = await makePdf({ pages: 1 });
  const aes128 = await protectPdf(source, { userPassword: 'pw', algorithm: 'aes-128' });
  assert.includes(aes128.warnings, 'weak-encryption:aes-128');
  assert.equal(await oracleAcceptsPassword(aes128.bytes, 'pw'), true);
  assert.equal((await oracleOpensWithoutPassword(aes128.bytes)).opened, false);

  const rc4 = await protectPdf(source, { userPassword: 'pw', algorithm: 'rc4-128' });
  assert.includes(rc4.warnings, 'weak-encryption:rc4-128');
  assert.equal(await oracleAcceptsPassword(rc4.bytes, 'pw'), true);
  const dictionary = await oracleEncryptionDictionary(rc4.bytes);
  assert.equal(dictionary.V, 2, 'RC4-128 uses the traditional V=2 handler, not the AES one');
  assert.equal((await oracleOpensWithoutPassword(rc4.bytes)).opened, false);
});

test('protectPdf refuses empty passwords, unknown algorithms and encrypted input', async () => {
  const source = await makePdf({ pages: 1 });
  await assert.throwsCode(() => protectPdf(source, {}), 'password-empty');
  await assert.throwsCode(() => protectPdf(source, { userPassword: '' }), 'password-empty');
  await assert.throwsCode(() => protectPdf(source, { userPassword: 'x', algorithm: 'rot13' }), 'invalid-option');
  await assert.throwsCode(() => protectPdf(source.slice(0, 30), { userPassword: 'x' }), 'corrupt');

  const locked = await protectPdf(source, { userPassword: 'once' });
  await assert.throwsCode(() => protectPdf(locked.bytes, { userPassword: 'twice' }), 'encrypted');
});

test('protectPdf warns when there is no user password to open the file', async () => {
  const source = await makePdf({ pages: 1 });
  const ownerOnly = await protectPdf(source, { ownerPassword: 'owner' });
  assert.includes(ownerOnly.warnings, 'no-user-password');
  assert.equal(await oracleAcceptsPassword(ownerOnly.bytes, 'owner'), true);
  assert.equal((await oracleOpensWithoutPassword(ownerOnly.bytes)).opened, true,
    'an owner-only file is intentionally openable without a password');
});

/* ------------------------------------------------------------------ unlock -- */

test('unlockPdf round-trips a protected file back to identical content', async () => {
  const source = await makePdf({ pages: 4 });
  const protectedBytes = await protectPdf(source, { userPassword: 's3cret' });
  const unlocked = await unlockPdf(protectedBytes.bytes, { password: 's3cret' });

  assert.deepEqual(unlocked.warnings, []);
  assert.isPdf(unlocked.bytes, 'the unlocked file');
  assert.equal(await oracleQpdfCheck(unlocked.bytes), 'ok');
  assert.equal((await pdfInfo(unlocked.bytes)).encrypted, false);
  assert.deepEqual(await oraclePageTexts(unlocked.bytes), [
    'PAGE-1-MARKER', 'PAGE-2-MARKER', 'PAGE-3-MARKER', 'PAGE-4-MARKER',
  ]);
  assert.equal(await oracleAcceptsPassword(unlocked.bytes, 'anything'), false,
    'no password should be needed once unlocked');
});

test('unlockPdf explains a wrong password and a missing password', async () => {
  const source = await makePdf({ pages: 1 });
  const protectedBytes = await protectPdf(source, { userPassword: 'right' });
  const wrong = await assert.throwsCode(() => unlockPdf(protectedBytes.bytes, { password: 'wrong' }), 'wrong-password');
  assert.ok(wrong.hint.length > 0, 'a wrong password error must suggest what to do');
  await assert.throwsCode(() => unlockPdf(protectedBytes.bytes, {}), 'need-password');
  await assert.throwsCode(() => unlockPdf(protectedBytes.bytes), 'need-password');
});

test('unlockPdf returns an unencrypted file untouched and warns about it', async () => {
  const source = await makePdf({ pages: 2 });
  const result = await unlockPdf(source, { password: 'ignored' });
  assert.deepEqual(result.warnings, ['not-encrypted']);
  assert.bytesEqual(result.bytes, source, 'the caller gets exactly the bytes it passed in');
});

test('unlockPdf accepts the owner password of an owner-only file', async () => {
  const source = await makePdf({ pages: 1 });
  const locked = await protectPdf(source, { ownerPassword: 'the-owner' });
  const unlocked = await unlockPdf(locked.bytes, { password: 'the-owner' });
  assert.deepEqual(unlocked.warnings, []);
  assert.deepEqual(await oraclePageTexts(unlocked.bytes), ['PAGE-1-MARKER']);
});

test('unlockPdf rejects corrupt input instead of returning it', async () => {
  await assert.throwsCode(() => unlockPdf(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 1, 2, 3])), 'corrupt');
  await assert.throwsCode(() => unlockPdf(new Uint8Array(0)), 'corrupt');
  await assert.throwsCode(() => unlockPdf('not bytes'), 'bad-type');
});

test('pdfInfo reports an encrypted file without revealing unreadable metadata', async () => {
  const source = await makeMetadataPdf();
  const locked = await protectPdf(source, { userPassword: 'pw' });
  const info = await pdfInfo(locked.bytes);
  assert.equal(info.encrypted, true);
  assert.equal(info.meta.title, null, 'encrypted strings must not be reported as text');
  assert.equal(info.meta.author, null);
  assert.equal(info.meta.producer, null);
  assert.includes(info.warnings, 'page-count-unavailable',
    'the page tree lives in encrypted object streams, so the count is unknown without the password');
  assert.equal(info.pageCount, 0);
});

/* ---------------------------------------------------------------- compress -- */

test('compressPdf lossless keeps every page and every character', async () => {
  const source = await oracleUncompressStreams(await makeBulkyPdf({ pages: 5, lines: 30 }));
  const result = await compressPdf(source, { level: 'lossless' });

  assert.equal(result.before, source.length);
  assert.equal(result.after, result.bytes.length, 'after must describe the returned bytes');
  assert.close(result.ratio, result.after / result.before, 1e-12);
  assert.ok(result.bytes.length < source.length / 2,
    `an uncompressed 5-page document must shrink a lot (got ${result.before} -> ${result.after})`);
  assert.equal(await oracleQpdfCheck(result.bytes), 'ok');
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(
    await oraclePageTexts(result.bytes),
    await oraclePageTexts(source),
    'a lossless pass must not change a single character',
  );
});

test('compressPdf never hands back a bigger file', async () => {
  const source = await makePdf({ pages: 1 });
  const result = await compressPdf(source, { level: 'lossless' });
  assert.ok(result.after <= result.before, 'the result must never be larger');
  assert.equal(result.after, result.bytes.length);
  assert.bytesEqual(result.bytes, source, 'when nothing helps, the original bytes are returned');
  assert.includes(result.warnings.join(' '), 'compression-ineffective');
  assert.deepEqual(await oraclePageTexts(result.bytes), ['PAGE-1-MARKER']);
});

test('compressPdf balanced/strong fall back to lossless without a canvas', async () => {
  const source = await oracleUncompressStreams(await makeBulkyPdf({ pages: 3, lines: 20 }));
  for (const level of ['balanced', 'strong']) {
    const result = await compressPdf(source, { level });
    assert.includes(result.warnings, `image-recompression-unavailable:${level}`);
    assert.deepEqual(await oraclePageTexts(result.bytes), await oraclePageTexts(source),
      'the fallback path must stay lossless');
    assert.equal(await oracleQpdfCheck(result.bytes), 'ok');
  }
});

test('compressPdf strong rebuilds pages as images when a canvas exists', async () => {
  const source = await oracleUncompressStreams(await makeBulkyPdf({ pages: 3, lines: 20 }));
  const { factory, calls } = createCanvasDouble();
  setCanvasFactory(factory);
  try {
    const result = await compressPdf(source, { level: 'strong' });
    assert.includes(result.warnings, 'text-layer-lost', 'the rebuild destroys the text layer, so it must be reported');
    assert.ok(!result.warnings.some((warning) => warning.startsWith('image-recompression-unavailable')),
      'the raster path must have run');

    assert.equal(calls.created.length, 3, 'every page must be rasterised');
    assert.deepEqual(calls.encodings.map((entry) => entry.format), ['jpeg', 'jpeg', 'jpeg']);
    assert.deepEqual(calls.encodings.map((entry) => entry.quality), [0.6, 0.6, 0.6], 'strong = 96 dpi, q0.6');
    assert.equal(calls.encodings[0].width, Math.floor(595 * (96 / 72)), '96 dpi of a 595pt page');
    assert.ok(calls.texts.length > 0, 'pdf.js must really have painted through the canvas double');
    assert.ok(calls.fills.length >= 3, 'each page gets a white background before painting');

    assert.ok(result.bytes.length < source.length, 'the rebuild must be smaller than the source');
    assert.equal(await oracleQpdfCheck(result.bytes), 'ok');
    assert.deepEqual(await oraclePageTexts(source).then((texts) => texts.length), 3);
    assert.equal(result.after, result.bytes.length);

    const extracted = await extractText(result.bytes);
    assert.lengthOf(extracted.pages, 3);
    assert.equal(extracted.pages.every((page) => page.text === ''), true,
      'text-layer-lost must be true: the rebuilt pages carry no text layer (only the page separators remain)');
    assert.equal(extracted.text.replace(/\f/g, ''), '');
    assert.equal((await pdfInfo(result.bytes)).pageCount, 3, 'the page count survives the rebuild');
  } finally {
    setCanvasFactory(null);
  }
});

test('compressPdf balanced keeps the lossless result when the rebuild is not smaller', async () => {
  const source = await makePdf({ pages: 2 });
  const bigJpeg = makeGrayscaleJpeg(512, 512);
  const { factory, calls } = createCanvasDouble({ payload: () => bigJpeg });
  setCanvasFactory(factory);
  try {
    const result = await compressPdf(source, { level: 'balanced' });
    assert.equal(calls.created.length, 2, 'the raster path still ran');
    assert.includes(result.warnings.join(' '), 'compression-ineffective');
    assert.ok(!result.warnings.includes('text-layer-lost'));
    assert.ok(result.after <= result.before, 'never bigger than the input');
    assert.deepEqual(await oraclePageTexts(result.bytes), ['PAGE-1-MARKER', 'PAGE-2-MARKER'],
      'the readable text proves the rebuild was discarded');
    assert.deepEqual(result.warnings.filter((warning) => warning === 'text-layer-lost'), []);
  } finally {
    setCanvasFactory(null);
  }
});

test('compressPdf uses the requested dpi and quality for the rebuild', async () => {
  const source = await oracleUncompressStreams(await makeBulkyPdf({ pages: 1, lines: 20 }));
  const { factory, calls } = createCanvasDouble();
  setCanvasFactory(factory);
  try {
    await compressPdf(source, { level: 'balanced', dpi: 72, quality: 0.5 });
    assert.equal(calls.encodings[0].width, 595, '72 dpi of a 595pt page');
    assert.equal(calls.encodings[0].quality, 0.5);
  } finally {
    setCanvasFactory(null);
  }
});

test('compressPdf removes document metadata on request, at every level', async () => {
  const source = await makeMetadataPdf();
  assert.equal((await pdfInfo(source)).meta.title, 'ToolSeer Secret Title', 'fixture sanity');

  for (const level of ['lossless', 'balanced']) {
    const result = await compressPdf(source, { level, removeMetadata: true });
    const info = await pdfInfo(result.bytes);
    assert.equal(info.meta.title, '', `${level}: title must be stripped`);
    assert.equal(info.meta.author, '', `${level}: author must be stripped`);
    assert.equal(info.meta.subject, '', `${level}: subject must be stripped`);
    assert.equal(info.meta.keywords, '', `${level}: keywords must be stripped`);
    assert.equal(info.meta.creator, '', `${level}: creator must be stripped`);
    assert.equal(info.meta.producer, '', `${level}: producer must be stripped`);
    assert.equal(info.pageCount, 1, `${level}: stripping metadata must not touch pages`);
    assert.deepEqual(await oraclePageTexts(result.bytes), ['METADATA-PAGE-1']);
  }

  const kept = await compressPdf(source, { level: 'lossless' });
  assert.equal((await pdfInfo(kept.bytes)).meta.title, 'ToolSeer Secret Title', 'metadata is kept by default');
});

test('compressPdf validates its options and refuses encrypted input', async () => {
  const source = await makePdf({ pages: 1 });
  await assert.throwsCode(() => compressPdf(source, { level: 'extreme' }), 'invalid-option');
  await assert.throwsCode(() => compressPdf(new Uint8Array([1, 2, 3, 4, 5, 6])), 'corrupt');
  const locked = await protectPdf(source, { userPassword: 'pw' });
  await assert.throwsCode(() => compressPdf(locked.bytes, {}), 'encrypted');
});

/* ----------------------------------------------------------------- engines -- */

test('every vendored engine loads once and is reused', async () => {
  const pdfLib = await loadPdfLib();
  assert.equal(await loadPdfLib(), pdfLib, 'pdf-lib must be a singleton');
  const pdfjs = await loadPdfJs();
  assert.equal(await loadPdfJs(), pdfjs, 'pdf.js must be a singleton');
  const qpdf = await loadQpdf();
  assert.equal(await loadQpdf(), qpdf, 'qpdf must be a singleton');
  const JSZip = await loadJSZip();
  assert.equal(await loadJSZip(), JSZip, 'jszip must be a singleton');
  assert.equal(typeof qpdf.callMain, 'function');
});
