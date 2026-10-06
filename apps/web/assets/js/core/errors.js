/**
 * ToolSeer V3 — engine error type and the stable error-code table.
 *
 * This module is the root of the core dependency graph on purpose: every other
 * core module may import it, and it imports nothing. That keeps the graph a DAG
 * (see docs/ARCHITECTURE.md §4 rule 3). `pdf-ops.js` re-exports `ToolError`, so
 * `import { ToolError } from './pdf-ops.js'` keeps working as documented.
 *
 * ## Codes the UI already localises
 *
 * `apps/web/assets/js/ui/toolkit.js` maps these codes to `error.*` i18n keys.
 * Changing them breaks the UI, so treat this table as frozen:
 *
 *   bad-type        bytes argument is not a Uint8Array/ArrayBuffer/view, or an
 *                   image input has no usable bytes
 *   too-large       input exceeds the browser-tab size guard
 *   out-of-memory   an allocation failed while building the output
 *   corrupt         not a PDF, or a PDF we cannot parse safely
 *   encrypted       PDF is encrypted and this operation has no password channel
 *   need-password   PDF is encrypted and a password could be supplied but was not
 *   wrong-password  a password was supplied and rejected
 *   range-invalid   a page-range string could not be parsed
 *   range-empty     a page-range string parsed to zero pages
 *   unsupported     the environment lacks a capability the operation needs
 *                   (no canvas, no image decoder) — or the PDF needs a feature
 *                   the vendored engines cannot provide
 *   ocr-unavailable OCR was requested but no OCR engine is bundled
 *
 * ## Codes without an i18n key (the UI shows `message` verbatim)
 *
 *   invalid-option  a caller-supplied option value is out of contract
 *   empty-input     an operation received zero inputs
 *   engine-load-failed  a vendored engine failed to load
 *   qpdf-failed / compress-failed / render-failed / zip-failed
 *                   an engine ran but the result failed our own verification
 *
 * These are programming or packaging faults, not user mistakes, so a precise
 * English diagnostic is more useful than a generic localised sentence.
 */

/** Stable machine-readable codes. Every ToolError.code is one of these. */
export const ERROR_CODES = Object.freeze([
  'bad-type',
  'too-large',
  'out-of-memory',
  'corrupt',
  'encrypted',
  'need-password',
  'wrong-password',
  'range-invalid',
  'range-empty',
  'unsupported',
  'ocr-unavailable',
  'invalid-option',
  'empty-input',
  'engine-load-failed',
  'qpdf-failed',
  'compress-failed',
  'render-failed',
  'zip-failed',
]);

/** Default English fallbacks. The UI prefers `error.<code>` from i18n. */
const DEFAULT_MESSAGES = Object.freeze({
  'bad-type': 'That file type is not supported here.',
  'too-large': 'This file is too large to process in a browser tab.',
  'out-of-memory': 'The browser ran out of memory while building the PDF.',
  corrupt: 'This file looks damaged or is not a valid PDF.',
  encrypted: 'This PDF is password-protected.',
  'need-password': 'This PDF is encrypted and needs its password.',
  'wrong-password': 'That password did not work.',
  'range-invalid': 'That page range could not be read.',
  'range-empty': 'The range selects no pages.',
  unsupported: 'This PDF uses a feature that is not supported here.',
  'ocr-unavailable': 'OCR language data is not bundled in this build.',
  'invalid-option': 'An option value is out of range.',
  'empty-input': 'No input files were provided.',
  'engine-load-failed': 'A PDF engine could not be loaded.',
  'qpdf-failed': 'The encryption engine reported a failure.',
  'compress-failed': 'Compression did not produce a faithful copy.',
  'render-failed': 'A page could not be rendered.',
  'zip-failed': 'The ZIP archive could not be created.',
});

const DEFAULT_HINTS = Object.freeze({
  'need-password': 'Use Unlock PDF to remove the password, then try again.',
  'wrong-password': 'Check the password and try again.',
  encrypted: 'Use Unlock PDF to remove the password first.',
  corrupt: 'The file may be truncated or was not produced by a PDF writer.',
  'too-large': 'Try fewer or smaller files, or use the desktop app.',
  'out-of-memory': 'Try fewer files at once, or use the desktop app.',
  'range-invalid': 'Use the form 1-3, 5, 8-12.',
  'range-empty': 'Check the page numbers: the document may have fewer pages.',
  unsupported: 'This build runs entirely in the browser and cannot do this step here.',
  'ocr-unavailable': 'Text extraction still works for PDFs that already contain text.',
  'empty-input': 'Add at least one file.',
  'engine-load-failed': 'Reload the page; if it persists the deployment is incomplete.',
});

/**
 * Every engine failure is one of these. Never throw a bare Error from `core/`.
 *
 * @param {string} code  one of ERROR_CODES
 * @param {string} [message]  English fallback; defaults to the table above
 * @param {string} [hint]  actionable next step for the user
 */
export class ToolError extends Error {
  constructor(code, message, hint) {
    const text = message || DEFAULT_MESSAGES[code] || 'The operation could not be completed.';
    super(text);
    this.name = 'ToolError';
    this.code = typeof code === 'string' && code ? code : 'unsupported';
    this.hint = hint || DEFAULT_HINTS[this.code] || '';
    // Keeps `JSON.stringify(err)` readable in logs and bug reports.
    this.details = undefined;
  }

  toJSON() {
    return { name: this.name, code: this.code, message: this.message, hint: this.hint };
  }
}

/** @returns {boolean} true if `value` is a ToolError (survives module duplication). */
export function isToolError(value) {
  return value instanceof ToolError ||
    (!!value && typeof value === 'object' && value.name === 'ToolError' && typeof value.code === 'string');
}

/**
 * Normalise any thrown value into a ToolError without losing the original.
 *
 * @param {unknown} cause
 * @param {string} fallbackCode used when `cause` is not already a ToolError
 * @param {string} [message]
 * @param {string} [hint]
 * @returns {ToolError}
 */
export function toToolError(cause, fallbackCode, message, hint) {
  if (isToolError(cause)) return /** @type {ToolError} */ (cause);
  const err = new ToolError(fallbackCode, message || (cause && cause.message) || undefined, hint);
  if (cause && cause.stack) err.stack = `${err.stack}\nCaused by: ${cause.stack}`;
  return err;
}

/**
 * Map an unknown throwable from a third-party engine onto a ToolError.
 *
 * Allocation failures are recognised explicitly: a RangeError from a typed-array
 * or TypedArray prototype is the browser telling us the tab is out of memory, and
 * `out-of-memory` has a far better user message than `corrupt`.
 *
 * @param {unknown} cause
 * @param {string} fallbackCode
 * @param {string} [hint]
 * @returns {ToolError}
 */
export function mapEngineError(cause, fallbackCode, hint) {
  if (isToolError(cause)) return /** @type {ToolError} */ (cause);
  const name = cause && cause.name;
  const text = (cause && cause.message) || '';
  if (name === 'RangeError' || /allocation failed|invalid (array|string) length|out of memory/i.test(text)) {
    return toToolError(cause, 'out-of-memory', undefined, hint);
  }
  return toToolError(cause, fallbackCode, undefined, hint);
}
