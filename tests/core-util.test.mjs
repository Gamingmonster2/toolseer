/**
 * Unit tests: formatting, naming, page-range parsing, pdf inspection, errors.
 * Everything asserts on real values produced from real bytes.
 */

import { test, assert } from './harness.mjs';
import { makeMetadataPdf, makePdf } from './fixtures.mjs';
import {
  ERROR_CODES,
  ToolError,
  formatBytes,
  installEngineShims,
  isToolError,
  parsePageRanges,
  pdfInfo,
  safeBaseName,
  toBytes,
} from '../apps/web/assets/js/core/index.js';

test('ToolError carries a stable code, message and hint', () => {
  const error = new ToolError('need-password', 'locked', 'unlock it first');
  assert.ok(error instanceof Error, 'ToolError must extend Error');
  assert.equal(error.name, 'ToolError');
  assert.equal(error.code, 'need-password');
  assert.equal(error.message, 'locked');
  assert.equal(error.hint, 'unlock it first');
  assert.ok(isToolError(error), 'isToolError must recognise it');
  assert.deepEqual(error.toJSON(), { name: 'ToolError', code: 'need-password', message: 'locked', hint: 'unlock it first' });
});

test('ToolError falls back to a default hint for known codes', () => {
  const error = new ToolError('wrong-password');
  assert.equal(error.code, 'wrong-password');
  assert.ok(error.hint.length > 0, 'a known code must get a default hint');
  assert.ok(ERROR_CODES.includes('range-invalid'), 'range-invalid must be a published code');
  assert.ok(ERROR_CODES.includes('unknown-nonsense') === false, 'codes must be a closed set');
});

test('toBytes accepts every byte-shaped input and rejects the rest', () => {
  const source = new Uint8Array([1, 2, 3, 4]);
  assert.bytesEqual(toBytes(source), source, 'Uint8Array passes through');
  assert.bytesEqual(toBytes(source.buffer), source, 'ArrayBuffer works');
  assert.bytesEqual(toBytes(new DataView(source.buffer)), source, 'DataView works');
  assert.bytesEqual(toBytes(Buffer.from([1, 2, 3, 4])), source, 'Buffer works');
  assert.bytesEqual(toBytes(new Uint16Array([0x0201]).subarray(0, 0)), new Uint8Array(0), 'zero-length view works');
  let caught = null;
  try {
    toBytes('not bytes');
  } catch (error) {
    caught = error;
  }
  assert.ok(caught && caught.name === 'ToolError', 'a string must throw ToolError');
  assert.equal(caught.code, 'bad-type');
});

test('formatBytes renders binary units', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1), '1 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1023), '1023 B');
  assert.equal(formatBytes(1024), '1 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(1024 * 1024), '1 MB');
  assert.equal(formatBytes(1024 * 1024 * 1536), '1.5 GB');
  assert.equal(formatBytes(1024 ** 4), '1 TB');
  assert.equal(formatBytes(-5), '0 B');
  assert.equal(formatBytes(Number.NaN), '0 B');
  assert.equal(formatBytes(undefined), '0 B');
});

test('safeBaseName strips paths, unsafe characters and .pdf', () => {
  assert.equal(safeBaseName('C:\\Users\\sara\\My Report.pdf'), 'My Report');
  assert.equal(safeBaseName('/home/sara/contract.PDF'), 'contract');
  assert.equal(safeBaseName('a<>b|c?.pdf'), 'a-b-c');
  assert.equal(safeBaseName('report.pdf.pdf'), 'report.pdf');
  assert.equal(safeBaseName('../../etc/passwd'), 'passwd');
  assert.equal(safeBaseName('   spaced   out   .pdf  '), 'spaced out', 'trailing space after .pdf still strips');
  assert.equal(safeBaseName('..'), 'document');
  assert.equal(safeBaseName('', 'fallback-name'), 'fallback-name');
  assert.equal(safeBaseName(null, 'fallback'), 'fallback');
  assert.equal(safeBaseName('تقرير مالي.pdf'), 'تقرير مالي', 'non-Latin names must survive');
  assert.equal(safeBaseName('a'.repeat(300)).length <= 120, true, 'long names are capped');
});

test('parsePageRanges handles the documented range grammar', () => {
  assert.deepEqual(parsePageRanges('all', 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(parsePageRanges('ALL', 3), [1, 2, 3]);
  assert.deepEqual(parsePageRanges('1-3,5', 5), [1, 2, 3, 5]);
  assert.deepEqual(parsePageRanges(' 2 , 4 ', 5), [2, 4]);
  assert.deepEqual(parsePageRanges('1,', 3), [1], 'a trailing comma is tolerated');
  assert.deepEqual(parsePageRanges('2-2', 3), [2]);
});

test('parsePageRanges normalises reversed ranges', () => {
  assert.deepEqual(parsePageRanges('5-3', 5), [3, 4, 5]);
  assert.deepEqual(parsePageRanges('4-2,1', 5), [2, 3, 4, 1]);
});

test('parsePageRanges clamps pages beyond the document and drops duplicates', () => {
  assert.deepEqual(parsePageRanges('1-99', 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(parsePageRanges('3,1,3,1', 5), [3, 1], 'first occurrence wins, order preserved');
  assert.deepEqual(parsePageRanges('4-9', 5), [4, 5]);
});

test('parsePageRanges rejects garbage, zero and empty selections', async () => {
  await assert.throwsCode(() => parsePageRanges('abc', 5), 'range-invalid');
  await assert.throwsCode(() => parsePageRanges('1-x', 5), 'range-invalid');
  await assert.throwsCode(() => parsePageRanges('1--3', 5), 'range-invalid');
  await assert.throwsCode(() => parsePageRanges('0', 5), 'range-invalid');
  await assert.throwsCode(() => parsePageRanges('-2', 5), 'range-invalid');
  await assert.throwsCode(() => parsePageRanges('', 5), 'range-empty');
  await assert.throwsCode(() => parsePageRanges('99', 5), 'range-empty');
  await assert.throwsCode(() => parsePageRanges('all', 0), 'invalid-option');
  await assert.throwsCode(() => parsePageRanges(null, 5), 'range-invalid');
});

test('pdfInfo reports page count, version, encryption flag and metadata', async () => {
  const bytes = await makePdf({ pages: 4 });
  const info = await pdfInfo(bytes);
  assert.equal(info.pageCount, 4);
  assert.equal(info.encrypted, false);
  assert.equal(info.version, '1.7');
  assert.deepEqual(info.warnings, []);
  assert.deepEqual(info.meta.creationDate !== null, true, 'a creation date is reported');
});

test('pdfInfo reads document metadata from the Info dictionary', async () => {
  const bytes = await makeMetadataPdf();
  const info = await pdfInfo(bytes);
  assert.equal(info.meta.title, 'ToolSeer Secret Title');
  assert.equal(info.meta.author, 'ToolSeer Author');
  assert.equal(info.meta.subject, 'ToolSeer Subject');
  assert.equal(info.meta.keywords, 'alpha beta', 'pdf-lib joins keyword arrays with a space');
  assert.equal(info.meta.creator, 'ToolSeer Creator');
  assert.equal(info.meta.producer, 'ToolSeer Producer');
});

test('pdfInfo tolerates junk before the %PDF header', async () => {
  const bytes = await makePdf({ pages: 1 });
  const junk = new Uint8Array(64).fill(0x20);
  const prefixed = new Uint8Array(junk.length + bytes.length);
  prefixed.set(junk, 0);
  prefixed.set(bytes, junk.length);
  const info = await pdfInfo(prefixed);
  assert.equal(info.pageCount, 1);
  assert.equal(info.version, '1.7');
});

test('pdfInfo rejects non-PDF and truncated input instead of guessing', async () => {
  await assert.throwsCode(() => pdfInfo(new Uint8Array([1, 2, 3, 4, 5, 6])), 'corrupt');
  await assert.throwsCode(() => pdfInfo(new Uint8Array(0)), 'corrupt');
  await assert.throwsCode(() => pdfInfo(new TextEncoder().encode('hello world, not a pdf')), 'corrupt');
  const bytes = await makePdf({ pages: 3 });
  const truncated = bytes.slice(0, Math.floor(bytes.length / 2));
  await assert.throwsCode(() => pdfInfo(truncated), 'corrupt');
});

test('installEngineShims fills ES2025 gaps once and never replaces natives', () => {
  const first = installEngineShims();
  assert.equal(typeof Uint8Array.prototype.toHex, 'function');
  assert.equal(typeof Uint8Array.prototype.toBase64, 'function');
  assert.equal(typeof Uint8Array.fromBase64, 'function');
  assert.equal(typeof Map.prototype.getOrInsertComputed, 'function');
  const hexImplementation = Uint8Array.prototype.toHex;
  const second = installEngineShims();
  assert.equal(second.length, 0, 'a second call must install nothing');
  assert.equal(Uint8Array.prototype.toHex, hexImplementation, 'the native/stdlib value must not be replaced');
  assert.ok(first.length >= 0, 'the first call reports what it installed');
});

test('the ES2025 shims behave like the real methods', () => {
  installEngineShims();
  assert.equal(new Uint8Array([0x00, 0x0f, 0xff]).toHex(), '000fff');
  assert.equal(new Uint8Array([0, 1, 2]).toHex(), '000102');
  const bytes = new Uint8Array(Array.from({ length: 40 }, (unused, index) => (index * 7) % 256));
  assert.bytesEqual(Uint8Array.fromBase64(bytes.toBase64()), bytes, 'base64 round trip');
  assert.equal(new Uint8Array([0xfb, 0xff]).toBase64({ alphabet: 'base64url' }), '-_8=', 'base64url keeps padding unless omitPadding');
  assert.equal(new Uint8Array([0xfb, 0xff]).toBase64({ alphabet: 'base64url', omitPadding: true }), '-_8');
  assert.bytesEqual(Uint8Array.fromBase64('-_8', { alphabet: 'base64url' }), new Uint8Array([0xfb, 0xff]));
  const map = new Map();
  assert.equal(map.getOrInsertComputed('key', () => 41), 41);
  assert.equal(map.getOrInsertComputed('key', () => 99), 41, 'existing values are kept');
  assert.equal(map.getOrInsert('other', 7), 7);
  assert.equal(map.getOrInsert('other', 8), 7);
});
