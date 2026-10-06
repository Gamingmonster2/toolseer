/**
 * ToolSeer V3 — encryption and lossless compression through qpdf (WebAssembly).
 *
 * qpdf is a CLI compiled to wasm, so every operation is: write bytes into the
 * module's in-memory filesystem, `callMain([...])`, read the result back.
 *
 * Three hard-won facts drive the code below (all measured against the vendored
 * build, qpdf 12.2.0):
 *
 *  1. `callMain` **returns** qpdf's exit status and does not throw: 0 = success,
 *     2 = error, 3 = warning. qpdf writes its diagnostics straight to fd 1/2, so
 *     `Module.print` cannot capture them — failures are classified with qpdf's
 *     own query flags (`--is-encrypted`, `--requires-password`) instead of by
 *     scraping English text.
 *  2. `--is-encrypted` exits 0 for an encrypted file and 2 for a plain one.
 *  3. `--requires-password` exits 3 when the supplied password (possibly empty)
 *     is accepted, 2 when it is not accepted *or* the file is not encrypted, and
 *     0 when a different password is required. Because it is only ever called
 *     after `--is-encrypted` said "encrypted", 0 and 2 both mean "this password
 *     does not open the file".
 *
 * Every operation verifies its own output before returning it. Returning bytes
 * that lost pages would be the worst possible outcome, so a page-count check
 * gates every result.
 */

import { ToolError, isToolError, toToolError } from './errors.js';
import { loadPdfLib, loadQpdf } from './engines.js';
import { MAX_INPUT_BYTES, formatBytes, pdfInfo, toBytes } from './pdf-ops.js';
import { rasterizeForCompression } from './render.js';

const PDF_HEADER = /%PDF-(\d\.\d)/;

/** Encryption algorithms the UI offers, mapped to qpdf's key length + AES switch. */
const ALGORITHMS = Object.freeze({
  'aes-256': Object.freeze({ bits: 256, aes: true, weak: false }),
  'aes-128': Object.freeze({ bits: 128, aes: true, weak: true }),
  'rc4-128': Object.freeze({ bits: 128, aes: false, weak: true }),
});

let workspaceCounter = 0;

function nextWorkspaceId() {
  workspaceCounter += 1;
  return `${workspaceCounter.toString(36)}${Date.now().toString(36)}`;
}

/**
 * One qpdf instance shared by all operations; each call gets its own file names
 * inside the module's MEMFS so concurrent or repeated calls cannot collide.
 *
 * @template T
 * @param {(ctx: { q: any, run: (args: string[]) => number, put: (bytes: Uint8Array, label?: string) => string,
 *                 path: (label?: string) => string, read: (label?: string) => Uint8Array,
 *                 has: (label?: string) => boolean }) => Promise<T>} body
 * @returns {Promise<T>}
 */
async function withWorkspace(body) {
  const q = await loadQpdf();
  const id = nextWorkspaceId();
  const created = new Set();

  const path = (label = 'in') => {
    const target = `/ts-${id}-${label}.pdf`;
    created.add(target);
    return target;
  };
  const put = (bytes, label = 'in') => {
    const target = path(label);
    q.FS.writeFile(target, toBytes(bytes));
    return target;
  };
  const has = (label = 'out') => {
    try {
      q.FS.stat(path(label));
      return true;
    } catch (cause) {
      return false;
    }
  };
  const read = (label = 'out') => {
    if (!has(label)) {
      throw new ToolError('qpdf-failed', `qpdf exited without writing ${path(label)}.`);
    }
    const bytes = q.FS.readFile(path(label));
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  };
  const run = (args) => {
    try {
      const code = q.callMain(args);
      return typeof code === 'number' ? code : 0;
    } catch (cause) {
      throw toToolError(cause, 'qpdf-failed', `qpdf failed: ${(cause && cause.message) || cause}`);
    }
  };

  try {
    return await body({ q, run, put, path, read, has });
  } finally {
    for (const target of created) {
      try {
        q.FS.unlink(target);
      } catch (cause) {
        /* never written, or already removed */
      }
    }
  }
}

function looksLikePdf(bytes) {
  if (!bytes || bytes.length < 5) return false;
  // Readers tolerate a little junk before the header; scan the first 1 KiB.
  const limit = Math.min(bytes.length, 1024);
  let view = '';
  for (let i = 0; i < limit; i++) view += String.fromCharCode(bytes[i]);
  return PDF_HEADER.test(view);
}

function assertPdfInput(bytes, name, maxBytes) {
  const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : MAX_INPUT_BYTES;
  if (bytes.length > limit) {
    throw new ToolError('too-large',
      `"${name}" is ${formatBytes(bytes.length)}; the limit for a browser tab is ${formatBytes(limit)}.`);
  }
  if (!looksLikePdf(bytes)) {
    throw new ToolError('corrupt', `"${name}" has no %PDF header, so it is not a PDF.`);
  }
}

/**
 * Encryption detection.
 *
 * Measured, not documented: qpdf 12's `--is-encrypted` is useless here. On a
 * properly protected AES-256 file it fails with "invalid password" and exits 2 —
 * the same code it uses for "this file is not encrypted" — because it cannot
 * read the file to answer. pdf-lib reads the trailer's `/Encrypt` reference
 * without the key, so that is the detector.
 *
 * The *proof* that a file is protected is not a flag at all: we try to decrypt
 * it with no password. A successful `--decrypt` is unambiguous.
 */
async function isEncryptedBytes(bytes) {
  const info = await pdfInfo(bytes);
  return info.encrypted === true;
}

/** True when qpdf can decrypt the file without any password. */
function opensWithoutPassword(ctx, inputPath) {
  const probePath = ctx.path('probe');
  return ctx.run(['--decrypt', inputPath, probePath]) === 0;
}

/** @returns {number} qpdf's `--requires-password` exit status (3 = accepted). */
function passwordStatus(ctx, inputPath, password) {
  return ctx.run([`--password=${password}`, '--requires-password', inputPath]);
}

/**
 * qpdf's own structural validator: 0 = clean, 3 = warnings, 2 = errors.
 * Used as a second opinion next to pdf-lib's parser.
 *
 * @returns {'ok'|'warnings'|'errors'}
 */
function qpdfCheck(ctx, inputPath) {
  const code = ctx.run(['--check', inputPath]);
  if (code === 0) return 'ok';
  if (code === 3) return 'warnings';
  return 'errors';
}

async function pageCountStrict(bytes, failureCode, failureMessage) {
  const { PDFDocument } = await loadPdfLib();
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
    return doc.getPageCount();
  } catch (cause) {
    if (isToolError(cause)) {
      throw new ToolError(failureCode, failureMessage, cause.message);
    }
    throw new ToolError(failureCode, failureMessage);
  }
}

/* -------------------------------------------------------------- protect -- */

function normalizeAllow(allow) {
  const source = allow && typeof allow === 'object' ? allow : {};
  const pick = (key) => (source[key] === undefined ? true : source[key] !== false);
  return {
    print: pick('print'),
    copy: pick('copy'),
    modify: pick('modify'),
    annotate: pick('annotate'),
  };
}

/**
 * Build qpdf's `--encrypt` argument list.
 *
 * Positional form: `--encrypt user owner bits [options] -- in out`.
 * 40/128-bit output is considered weak by qpdf 11+ and needs
 * `--allow-weak-crypto`, which must sit outside the `--encrypt` block.
 *
 * `--allow-insecure` is deliberately **never** passed. qpdf offers it for
 * "a non-empty user password with an empty owner password", and it produces a
 * file that opens with no password at all — the opposite of protecting it.
 * {@link protectPdf} copies the user password into the owner slot instead, which
 * is what the PDF specification does with an empty owner password, and then
 * proves with `--requires-password` that the result is not openable for free.
 */
function encryptArgs({ userPassword, ownerPassword, algorithm, allow }) {
  const spec = ALGORITHMS[algorithm];
  const args = [];
  if (spec.weak) args.push('--allow-weak-crypto');
  args.push('--encrypt', userPassword, ownerPassword, String(spec.bits));
  if (spec.bits === 128) args.push(`--use-aes=${spec.aes ? 'y' : 'n'}`);
  args.push(
    `--print=${allow.print ? 'full' : 'none'}`,
    `--modify=${allow.modify ? 'all' : 'none'}`,
    `--extract=${allow.copy ? 'y' : 'n'}`,
    `--annotate=${allow.annotate ? 'y' : 'n'}`,
  );
  return args;
}

/**
 * Encrypt a PDF with a user password and optional permission restrictions.
 *
 * @param {Uint8Array} bytes
 * @param {{ userPassword?: string, ownerPassword?: string,
 *           allow?: { print?: boolean, copy?: boolean, modify?: boolean, annotate?: boolean },
 *           algorithm?: 'aes-256'|'aes-128'|'rc4-128', maxBytes?: number }} [opts]
 * @returns {Promise<{ bytes: Uint8Array, warnings: string[] }>}
 */
export async function protectPdf(bytes, opts = {}) {
  const source = toBytes(bytes);
  assertPdfInput(source, 'the document', opts.maxBytes);
  const userPassword = typeof opts.userPassword === 'string' ? opts.userPassword : '';
  let ownerPassword = opts.ownerPassword === undefined || opts.ownerPassword === null
    ? ''
    : String(opts.ownerPassword);
  if (!userPassword && !ownerPassword) {
    throw new ToolError('password-empty', 'Enter a password before protecting the PDF.');
  }
  const algorithm = opts.algorithm === undefined ? 'aes-256' : opts.algorithm;
  if (!Object.prototype.hasOwnProperty.call(ALGORITHMS, algorithm)) {
    throw new ToolError('invalid-option',
      `algorithm must be 'aes-256', 'aes-128' or 'rc4-128' (got ${JSON.stringify(opts.algorithm)}).`);
  }
  const allow = normalizeAllow(opts.allow);
  const warnings = [];
  if (ALGORITHMS[algorithm].weak) warnings.push(`weak-encryption:${algorithm}`);
  if (!ownerPassword && userPassword) {
    // PDF spec behaviour for an empty owner password: the user password becomes
    // the owner password. Critical for security — see encryptArgs().
    ownerPassword = userPassword;
  }
  if (!userPassword) warnings.push('no-user-password');

  // qpdf has no "re-encrypt with a new password" mode here, so the input must be
  // readable as-is. Check that before paying for a wasm round trip.
  const sourceInfo = await pdfInfo(source);
  if (sourceInfo.encrypted) {
    throw new ToolError('encrypted', 'This PDF is already password-protected.',
      'Use Unlock PDF to remove the existing password first.');
  }
  const before = sourceInfo.pageCount;
  if (!before) throw new ToolError('corrupt', 'The PDF has no pages.');

  return withWorkspace(async (ctx) => {
    const inputPath = ctx.put(source, 'in');
    const outputPath = ctx.path('out');
    const code = ctx.run([
      ...encryptArgs({ userPassword, ownerPassword, algorithm, allow }),
      '--', inputPath, outputPath,
    ]);
    if (code !== 0) {
      throw new ToolError('qpdf-failed', `qpdf could not encrypt this PDF (exit ${code}).`);
    }
    const output = ctx.read('out');
    if (!looksLikePdf(output)) {
      throw new ToolError('qpdf-failed', 'qpdf produced something that is not a PDF.');
    }

    // --- verification: the result must really be encrypted, openable with the
    // password we set, NOT openable without it, and complete.
    if (!await isEncryptedBytes(output)) {
      throw new ToolError('qpdf-failed', 'The protected copy is not actually encrypted.');
    }
    const opener = userPassword || ownerPassword;
    const status = passwordStatus(ctx, outputPath, opener);
    if (status !== 3) {
      throw new ToolError('qpdf-failed', 'The protected copy does not open with the password that was set.');
    }
    if (userPassword && opensWithoutPassword(ctx, outputPath)) {
      // The qpdf `--allow-insecure` trap: a non-empty user password with an empty
      // owner password yields a file that anyone can open. Refuse to ship it.
      throw new ToolError('qpdf-failed',
        'The protected copy can be opened without a password, so it was discarded.');
    }
    const roundTripPath = ctx.path('check');
    if (ctx.run([`--password=${opener}`, '--decrypt', outputPath, roundTripPath]) !== 0) {
      throw new ToolError('qpdf-failed', 'The protected copy could not be read back with its password.');
    }
    const after = await pageCountStrict(ctx.read('check'), 'qpdf-failed',
      'The protected copy lost pages, so it was discarded.');
    if (after !== before) {
      throw new ToolError('qpdf-failed', `The protected copy has ${after} pages instead of ${before}.`);
    }
    return { bytes: output, warnings };
  });
}

/* --------------------------------------------------------------- unlock -- */

/**
 * Remove a password from a PDF (requires either the user or the owner password).
 *
 * @param {Uint8Array} bytes
 * @param {{ password?: string, maxBytes?: number }} [opts]
 * @returns {Promise<{ bytes: Uint8Array, warnings: string[] }>}
 */
export async function unlockPdf(bytes, opts = {}) {
  const source = toBytes(bytes);
  assertPdfInput(source, 'the document', opts.maxBytes);
  const password = opts.password === undefined || opts.password === null ? '' : String(opts.password);
  const warnings = [];
  // Page count of the encrypted original. `null` when the page tree sits inside
  // encrypted object streams, which is the normal case for qpdf's own output —
  // in that situation nobody can count the pages without the password.
  const sourceInfo = await pdfInfo(source);
  const expectedPages = sourceInfo.pageCount > 0 ? sourceInfo.pageCount : null;
  const encrypted = sourceInfo.encrypted === true;

  return withWorkspace(async (ctx) => {
    const inputPath = ctx.put(source, 'in');
    if (!encrypted) {
      // Never hand back bytes we have not proved are a readable PDF: a file that
      // only *looks* parseable could still be truncated.
      if (expectedPages === null) throw new ToolError('corrupt', 'The PDF has no readable pages.');
      warnings.push('not-encrypted');
      return { bytes: source, warnings };
    }

    const status = passwordStatus(ctx, inputPath, password);
    if (status !== 3) {
      if (!password) {
        throw new ToolError('need-password', 'This PDF is encrypted; enter its password to unlock it.');
      }
      throw new ToolError('wrong-password', 'That password did not unlock the PDF.');
    }

    const outputPath = ctx.path('out');
    const code = ctx.run([`--password=${password}`, '--decrypt', inputPath, outputPath]);
    if (code !== 0) {
      throw new ToolError('corrupt', `qpdf could not decrypt this PDF (exit ${code}).`);
    }
    const output = ctx.read('out');
    if (!looksLikePdf(output)) {
      throw new ToolError('qpdf-failed', 'The decrypted output is not a PDF.');
    }

    // Two independent checks on the bytes we are about to hand back:
    // pdf-lib must parse them strictly, and qpdf's own validator must not report
    // errors. When the original page count was knowable it must match exactly.
    const after = await pageCountStrict(output, 'qpdf-failed',
      'The decrypted copy could not be read back, so it was discarded.');
    if (!after) {
      throw new ToolError('qpdf-failed', 'The decrypted copy has no pages, so it was discarded.');
    }
    if (expectedPages !== null && after !== expectedPages) {
      throw new ToolError('qpdf-failed', `The decrypted copy has ${after} pages instead of ${expectedPages}.`);
    }
    if (qpdfCheck(ctx, outputPath) === 'errors') {
      throw new ToolError('qpdf-failed', 'The decrypted copy failed qpdf’s structural check.');
    }
    return { bytes: output, warnings };
  });
}

/* ------------------------------------------------------------- compress -- */

/**
 * Strip document metadata from a PDF by rewriting it with pdf-lib.
 *
 * Re-saving the parsed document (rather than rebuilding it with `copyPages`)
 * keeps annotations, form fields and outlines attached to their pages.
 */
async function stripMetadata(bytes) {
  const { PDFDocument, PDFName } = await loadPdfLib();
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: true });
  doc.setTitle('');
  doc.setAuthor('');
  doc.setSubject('');
  doc.setKeywords([]);
  doc.setCreator('');
  doc.setProducer('');
  for (const key of ['Metadata', 'PieceInfo']) {
    try {
      doc.catalog.delete(PDFName.of(key));
    } catch (cause) {
      /* catalog has no such key */
    }
  }
  return doc.save();
}

/**
 * Shrink a PDF, with three levels:
 *
 *   lossless  qpdf object streams + recompressed Flate streams. Nothing is
 *             discarded; text stays selectable.
 *   balanced  lossless **plus** a visual rebuild of every page at 150 DPI as
 *             JPEG q0.8. Text becomes non-selectable (warning `text-layer-lost`).
 *   strong    the same rebuild at 96 DPI, JPEG q0.6.
 *
 * The lossless rewrite runs first and becomes the baseline; the rebuilt version
 * is only adopted when it is at least 5% smaller, so the caller never receives a
 * bigger file. Without a canvas (Node, or any non-canvas host) the rebuild is
 * skipped and `image-recompression-unavailable:<level>` is reported.
 *
 * If the qpdf rewrite is not smaller than the input, the **input** is returned
 * unchanged and `after` reflects that, so `before`/`after`/`ratio` always
 * describe the bytes the caller actually receives.
 *
 * @param {Uint8Array} bytes
 * @param {{ level?: 'lossless'|'balanced'|'strong', dpi?: number, quality?: number,
 *           removeMetadata?: boolean, maxBytes?: number }} [opts]
 * @returns {Promise<{ bytes: Uint8Array, before: number, after: number, ratio: number, warnings: string[] }>}
 */
export async function compressPdf(bytes, opts = {}) {
  const source = toBytes(bytes);
  assertPdfInput(source, 'the document', opts.maxBytes);
  const level = opts.level === undefined ? 'lossless' : opts.level;
  if (level !== 'lossless' && level !== 'balanced' && level !== 'strong') {
    throw new ToolError('invalid-option', `level must be 'lossless', 'balanced' or 'strong' (got ${JSON.stringify(opts.level)}).`);
  }
  const warnings = [];

  const info = await pdfInfo(source);
  if (info.encrypted) {
    throw new ToolError('encrypted', 'This PDF is password-protected.',
      'Use Unlock PDF to remove the password first.');
  }
  const before = source.length;
  const pageCountBefore = info.pageCount;
  if (!pageCountBefore) throw new ToolError('corrupt', 'The PDF has no pages.');

  const rewritten = await withWorkspace(async (ctx) => {
    const inputPath = ctx.put(source, 'in');
    const outputPath = ctx.path('out');
    const code = ctx.run([
      '--object-streams=generate',
      '--compress-streams=y',
      '--recompress-flate',
      '--compression-level=9',
      '--',
      inputPath,
      outputPath,
    ]);
    if (code !== 0) {
      throw new ToolError('compress-failed', `qpdf could not rewrite this PDF (exit ${code}).`);
    }
    if (qpdfCheck(ctx, outputPath) === 'errors') {
      throw new ToolError('compress-failed', 'The rewritten PDF failed qpdf’s structural check.');
    }
    return ctx.read('out');
  });

  // Lossless baseline: never hand back bytes that grew.
  let chosen = rewritten;
  if (rewritten.length >= before) {
    chosen = source;
    warnings.push(`compression-ineffective:${Math.round((rewritten.length / before) * 100)}%`);
  }

  // 'balanced'/'strong' add a visual rebuild on top: rasterise every page and
  // keep the result only when it is at least 5% smaller than the baseline.
  if (level !== 'lossless') {
    try {
      const rebuilt = await rasterizeForCompression(source, {
        level,
        dpi: opts.dpi,
        quality: opts.quality,
      });
      for (const warning of rebuilt.warnings) warnings.push(warning);
      if (rebuilt.bytes.length < chosen.length * 0.95) {
        chosen = rebuilt.bytes;
        warnings.push('text-layer-lost');
      } else if (!warnings.some((warning) => warning.startsWith('compression-ineffective'))) {
        warnings.push(`compression-ineffective:${Math.round((rebuilt.bytes.length / chosen.length) * 100)}%`);
      }
    } catch (cause) {
      // No canvas (Node, or a stripped-down build): the lossless result stands.
      warnings.push(`image-recompression-unavailable:${level}`);
    }
  }

  let result = chosen;
  if (opts.removeMetadata === true) {
    try {
      result = await stripMetadata(chosen);
    } catch (cause) {
      throw toToolError(cause, 'compress-failed', 'Metadata could not be removed from this PDF.');
    }
  }

  const pageCountAfter = await pageCountStrict(result, 'compress-failed',
    'Compression produced a document we could not read back.');
  if (pageCountAfter !== pageCountBefore) {
    throw new ToolError('compress-failed',
      `Compression changed the page count (${pageCountBefore} -> ${pageCountAfter}); the original is returned instead.`);
  }

  return {
    bytes: result,
    before,
    after: result.length,
    ratio: result.length / before,
    warnings,
  };
}
