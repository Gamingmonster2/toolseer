/**
 * ToolSeer V3 — lazy, single-flight loaders for the self-hosted PDF engines.
 *
 * Nothing here touches the network at module scope and nothing loads until an
 * operation actually needs it, so the hub and the tool pages stay lightweight.
 *
 * | Engine      | Kind            | Browser path                    | Node path (tests)     |
 * |-------------|-----------------|---------------------------------|-----------------------|
 * | pdf-lib     | ES module       | `import()`                      | `import(file://…)`    |
 * | pdf.js      | ES module + worker | dynamic `import()` + workerSrc | same (fake worker)  |
 * | qpdf        | classic UMD     | `<script>` once + `Module`      | `createRequire()`     |
 * | jszip       | classic UMD     | `<script>` once + `JSZip`       | `createRequire()`     |
 *
 * Paths are resolved from this module's own URL, which yields
 * `/vendor/...` over HTTP and `file:///…/vendor/...` under Node — the same file
 * either way, with no build step and no import map.
 *
 * `docs/ARCHITECTURE.md` §5 fixes the load strategy; do not change it without
 * the Lead: qpdf and jszip are *classic* scripts and must never be `import`ed.
 */

import { ToolError, toToolError } from './errors.js';

/** Vendor-relative file names. Kept in one place so the lock file is easy to audit. */
const VENDOR_FILES = Object.freeze({
  pdfLib: 'pdf-lib/pdf-lib.esm.min.js',
  pdfJs: 'pdfjs-dist/pdf.min.mjs',
  pdfJsWorker: 'pdfjs-dist/pdf.worker.min.mjs',
  pdfJsStandardFonts: 'pdfjs-dist/standard_fonts/',
  pdfJsCMaps: 'pdfjs-dist/cmaps/',
  pdfJsWasm: 'pdfjs-dist/wasm/',
  qpdfJs: '@neslinesli93__qpdf-wasm/qpdf.js',
  qpdfWasm: '@neslinesli93__qpdf-wasm/qpdf.wasm',
  jszip: 'jszip/jszip.min.js',
});

const VENDOR_BASE = new URL('../../../vendor/', import.meta.url);

/** @param {string} relative @returns {string} absolute URL (file:// or https://) */
export function vendorUrl(relative) {
  return new URL(relative, VENDOR_BASE).href;
}

/** Absolute URLs of every vendored engine file. Frozen for safety. */
export const VENDOR = Object.freeze(
  Object.fromEntries(Object.entries(VENDOR_FILES).map(([key, rel]) => [key, vendorUrl(rel)])),
);

/** True when running under Node (tests) rather than a browser page. */
export function isNodeRuntime() {
  return typeof window === 'undefined' &&
    typeof process !== 'undefined' &&
    !!process.versions &&
    typeof process.versions.node === 'string';
}

/* ------------------------------------------------------------------ shims -- */

let shimsInstalled = false;

function defineProto(target, name, value) {
  if (typeof target[name] === 'function') return false;
  Object.defineProperty(target, name, {
    value,
    writable: true,
    enumerable: false,
    configurable: true,
  });
  return true;
}

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function bytesToBase64(bytes, alphabet, omitPadding) {
  const table = alphabet === 'base64url' ? B64_URL_ALPHABET : B64_ALPHABET;
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += table[b0 >> 2] + table[((b0 & 3) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += table[((b1 & 15) << 2) | (b2 >> 6)];
    else if (!omitPadding) out += '=';
    if (i + 2 < bytes.length) out += table[b2 & 63];
    else if (!omitPadding) out += '=';
  }
  return out;
}

function base64ToBytes(text, alphabet) {
  const table = alphabet === 'base64url' ? B64_URL_ALPHABET : B64_ALPHABET;
  const lookup = new Map();
  for (let i = 0; i < table.length; i++) lookup.set(table[i], i);
  const clean = String(text).replace(/[\t\n\f\r ]/g, '').replace(/=+$/, '');
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const value = lookup.get(char);
    if (value === undefined) throw new TypeError(`Invalid base64 character: ${char}`);
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

/**
 * Fill the handful of ES2025 built-ins that `pdfjs-dist` 6.x calls
 * unconditionally, when the host engine does not ship them yet.
 *
 * Evidence (measured, not assumed): the vendored bundle calls
 * `Uint8Array.prototype.toHex()` when it computes document fingerprints and
 * `Map.prototype.getOrInsertComputed()` in the worker transport. Node 24.14 as
 * installed here has neither, and neither does any browser older than V8 13/14
 * (Chrome ~140). Without these, `getDocument()` fails with
 * `a.toHex is not a function` / `getOrInsertComputed is not a function`.
 *
 * This is a feature-detected shim: native implementations are never replaced.
 * It only patches the *current* realm, so a real browser Worker thread still
 * needs a recent enough engine — the fix for that is vendoring pdf.js's legacy
 * build, which is a vendor/tooling decision (reported to the Lead).
 *
 * @returns {string[]} names of the shims that were actually installed
 */
export function installEngineShims() {
  const installed = [];
  if (defineProto(Uint8Array.prototype, 'toHex', function toHex() {
    let hex = '';
    for (let i = 0; i < this.length; i++) hex += this[i].toString(16).padStart(2, '0');
    return hex;
  })) installed.push('Uint8Array.prototype.toHex');

  if (defineProto(Uint8Array.prototype, 'toBase64', function toBase64(options) {
    const opts = options || {};
    return bytesToBase64(this, opts.alphabet, opts.omitPadding === true);
  })) installed.push('Uint8Array.prototype.toBase64');

  if (defineProto(Uint8Array, 'fromBase64', (text, options) => {
    const opts = options || {};
    return base64ToBytes(text, opts.alphabet);
  })) installed.push('Uint8Array.fromBase64');

  if (defineProto(Map.prototype, 'getOrInsertComputed', function getOrInsertComputed(key, callback) {
    if (this.has(key)) return this.get(key);
    const value = callback(key);
    this.set(key, value);
    return value;
  })) installed.push('Map.prototype.getOrInsertComputed');

  if (defineProto(Map.prototype, 'getOrInsert', function getOrInsert(key, value) {
    if (this.has(key)) return this.get(key);
    this.set(key, value);
    return value;
  })) installed.push('Map.prototype.getOrInsert');

  shimsInstalled = true;
  return installed;
}

/** @returns {boolean} whether {@link installEngineShims} has run in this realm. */
export function areEngineShimsInstalled() {
  return shimsInstalled;
}

/* ---------------------------------------------------------------- loaders -- */

/** Single-flight cache: one engine instance per page per realm. */
const engines = { pdfLib: null, pdfJs: null, qpdf: null, jszip: null };

/**
 * Resolve an engine at most once. A rejected load is *not* cached, so a retry
 * after a transient failure can still succeed.
 *
 * @param {'pdfLib'|'pdfJs'|'qpdf'|'jszip'} key
 * @param {() => Promise<any>} factory
 * @param {string} engine human name used in the error message
 */
function loadOnce(key, factory, engine) {
  if (engines[key]) return engines[key];
  const promise = Promise.resolve()
    .then(factory)
    .catch((cause) => {
      throw toToolError(cause, 'engine-load-failed', `${engine} could not be loaded.`,
        'Reload the page; if this persists the deployment is missing a vendor file.');
    });
  engines[key] = promise;
  promise.catch(() => {
    if (engines[key] === promise) engines[key] = null;
  });
  return promise;
}

/** @returns {Promise<typeof import('../../../vendor/pdf-lib/pdf-lib.esm.min.js')>} */
export function loadPdfLib() {
  return loadOnce('pdfLib', () => import(/* @vite-ignore */ VENDOR.pdfLib), 'pdf-lib');
}

/**
 * pdf.js as an ES module, with the worker and asset URLs wired to our own origin.
 *
 * `GlobalWorkerOptions.workerSrc` must be a module-worker URL; the vendored
 * `pdf.worker.min.mjs` is an ES module. Node has no `Worker`, so pdf.js falls
 * back to its in-process "fake worker", which is why the tests can extract text
 * without a browser.
 *
 * @returns {Promise<any>} the pdfjs module namespace
 */
export function loadPdfJs() {
  return loadOnce('pdfJs', async () => {
    installEngineShims();
    const mod = await import(/* @vite-ignore */ VENDOR.pdfJs);
    if (mod && mod.GlobalWorkerOptions) mod.GlobalWorkerOptions.workerSrc = VENDOR.pdfJsWorker;
    return mod;
  }, 'pdf.js');
}

/**
 * qpdf compiled to WebAssembly.
 *
 * The build force-sets `noInitialRun`, so nothing runs until `callMain(args)`.
 * In the browser the classic script defines the `Module` global; under Node the
 * UMD tail exports it through CommonJS.
 *
 * @returns {Promise<{callMain: (args: string[]) => number, FS: any, HEAPU8: Uint8Array}>}
 */
export function loadQpdf() {
  return loadOnce('qpdf', async () => {
    const factory = await loadClassicModule(VENDOR.qpdfJs, 'Module');
    if (typeof factory !== 'function') {
      throw new ToolError('engine-load-failed', 'qpdf-wasm did not expose its module factory.');
    }
    const instance = await factory({
      locateFile: (file) => (String(file).endsWith('.wasm') ? VENDOR.qpdfWasm : vendorUrl(file)),
    });
    if (!instance || typeof instance.callMain !== 'function' || !instance.FS) {
      throw new ToolError('engine-load-failed', 'qpdf-wasm initialised without callMain/FS.');
    }
    return instance;
  }, 'qpdf-wasm');
}

/** @returns {Promise<any>} the JSZip constructor */
export function loadJSZip() {
  return loadOnce('jszip', async () => {
    const JSZip = await loadClassicModule(VENDOR.jszip, 'JSZip');
    if (typeof JSZip !== 'function') {
      throw new ToolError('engine-load-failed', 'JSZip did not define the JSZip global.');
    }
    return JSZip;
  }, 'jszip');
}

/** @type {Map<string, Promise<any>>} */
const classicScripts = new Map();

/**
 * Load a classic (non-module) vendor script exactly once per document and
 * resolve with the global it defines.
 *
 * @param {string} url absolute URL of the script
 * @param {string} globalName e.g. `Module` or `JSZip`
 * @returns {Promise<any>}
 */
async function loadClassicModule(url, globalName) {
  if (isNodeRuntime()) {
    const already = globalThis[globalName];
    if (already) return already;
    const { createRequire } = await import('node:module');
    const { fileURLToPath } = await import('node:url');
    const require = createRequire(import.meta.url);
    try {
      return require(fileURLToPath(url));
    } catch (cause) {
      throw toToolError(cause, 'engine-load-failed', `${globalName} could not be required from ${url}.`);
    }
  }

  if (typeof globalThis[globalName] !== 'undefined') return globalThis[globalName];
  if (typeof document === 'undefined') {
    throw new ToolError('engine-load-failed',
      `${globalName} is missing and there is no document to inject ${url} into.`);
  }

  let pending = classicScripts.get(url);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const marker = url.replace(/[^a-z0-9]+/gi, '-');
      const existing = document.querySelector(`script[data-toolseer-vendor="${marker}"]`);
      const done = () => {
        const value = globalThis[globalName];
        if (typeof value === 'undefined') {
          reject(new ToolError('engine-load-failed', `${url} loaded but did not define ${globalName}.`));
        } else {
          resolve(value);
        }
      };
      if (existing) {
        // Another copy of this module already injected it: wait for it instead
        // of injecting a second <script> (which would re-run the UMD wrapper).
        if (existing.dataset.toolseerVendorState === 'ready') done();
        else {
          existing.addEventListener('load', done, { once: true });
          existing.addEventListener('error', () => reject(new ToolError('engine-load-failed',
            `${url} failed to load.`)), { once: true });
        }
        return;
      }
      const script = document.createElement('script');
      script.src = url;
      script.async = true;
      script.dataset.toolseerVendor = marker;
      script.addEventListener('load', () => {
        script.dataset.toolseerVendorState = 'ready';
        done();
      }, { once: true });
      script.addEventListener('error', () => {
        script.dataset.toolseerVendorState = 'error';
        reject(new ToolError('engine-load-failed', `${url} failed to load.`));
      }, { once: true });
      document.head.append(script);
    });
    classicScripts.set(url, pending);
    // A failed load must be retryable.
    pending.catch(() => classicScripts.delete(url));
  }
  return pending;
}

/**
 * Test/debug helper: forget cached engine instances so the next call reloads.
 * Not used by the UI — the engine is intentionally a process-wide singleton.
 */
export function resetEngineCache() {
  engines.pdfLib = null;
  engines.pdfJs = null;
  engines.qpdf = null;
  engines.jszip = null;
  classicScripts.clear();
}

/* ------------------------------------------------------------------- zip -- */

/** Characters that must never appear in a download or ZIP entry name. */
const UNSAFE_NAME = /[<>:"/\\|?*\u0000-\u001f]/g;

function zipEntryName(raw, index, taken) {
  let name = typeof raw === 'string' && raw.trim() ? raw : `file-${index + 1}`;
  name = name.split(/[\\/]/).pop() || `file-${index + 1}`;
  name = name.replace(UNSAFE_NAME, '-').replace(/^\.+/, '').trim();
  if (!name) name = `file-${index + 1}`;
  if (name.length > 150) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 ? name.slice(dot) : '';
    name = name.slice(0, 150 - ext.length) + ext;
  }
  if (taken.has(name)) {
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let n = 2;
    while (taken.has(`${stem}-${n}${ext}`)) n++;
    name = `${stem}-${n}${ext}`;
  }
  taken.add(name);
  return name;
}

/**
 * Bundle outputs into a real ZIP archive (stored in memory, never uploaded).
 *
 * @param {Array<{name?: string, bytes: Uint8Array}>} outputs
 * @returns {Promise<Uint8Array>} the .zip bytes
 */
export async function zipFiles(outputs) {
  const list = Array.isArray(outputs) ? outputs.filter(Boolean) : [];
  if (!list.length) throw new ToolError('empty-input', 'There is nothing to zip.');
  const JSZip = await loadJSZip();
  const zip = new JSZip();
  const taken = new Set();
  list.forEach((output, index) => {
    const bytes = output && output.bytes;
    if (!bytes || typeof bytes.length !== 'number') {
      throw new ToolError('bad-type', `Output ${index + 1} has no bytes to zip.`);
    }
    zip.file(zipEntryName(output.name, index, taken), bytes);
  });
  try {
    return await zip.generateAsync({
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      platform: 'DOS',
    });
  } catch (cause) {
    throw toToolError(cause, 'zip-failed', 'The ZIP archive could not be created.');
  }
}
