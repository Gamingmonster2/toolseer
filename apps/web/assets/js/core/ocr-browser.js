/**
 * ocr-browser.js — the browser-side OCR engine the extract-text tool injects.
 *
 * The core engine deliberately ships no OCR backend (docs/ARCHITECTURE.md §4):
 * `extractText(bytes, { ocr: true, ocrEngine })` requires one to be injected.
 * This module provides that backend using the self-hosted tesseract.js build in
 * `vendor/ocr/`, so no runtime CDN is involved and the ~12.6 MB of language data
 * is fetched only when a user actually turns OCR on.
 *
 * Everything heavy is lazy: importing this module costs nothing, and the 4 MB
 * WebAssembly core plus the language file download on the first `recognize()`.
 */
import { ToolError } from './errors.js';

const PATHS = {
  workerPath: '/vendor/ocr/worker.min.js',
  corePath: '/vendor/ocr/tesseract-core-simd-lstm.wasm.js',
  langPath: '/vendor/ocr/lang',
};

let tesseractPromise = null;

/** Inject the classic UMD bundle once; resolve with the global. */
function loadTesseract() {
  if (tesseractPromise) return tesseractPromise;
  tesseractPromise = new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      reject(new ToolError('ocr-unavailable', 'OCR needs a browser environment.'));
      return;
    }
    if (window.Tesseract && typeof window.Tesseract.createWorker === 'function') {
      resolve(window.Tesseract);
      return;
    }
    const script = document.createElement('script');
    script.src = '/vendor/ocr/tesseract.min.js';
    script.async = true;
    script.addEventListener('load', () => {
      if (window.Tesseract && typeof window.Tesseract.createWorker === 'function') resolve(window.Tesseract);
      else reject(new ToolError('ocr-unavailable', 'The OCR bundle loaded but exposed no API.'));
    });
    script.addEventListener('error', () => {
      reject(new ToolError('ocr-unavailable', 'The OCR bundle could not be loaded.'));
    });
    document.head.append(script);
  });
  return tesseractPromise;
}

/** tesseract.js fixes its languages when the worker is created, so cache per language set. */
const workers = new Map();

async function getWorker(lang, onProgress) {
  if (workers.has(lang)) return workers.get(lang);
  const promise = (async () => {
    const Tesseract = await loadTesseract();
    return Tesseract.createWorker(lang, 1, {
      ...PATHS,
      gzip: true,
      logger: (message) => {
        if (!onProgress || !message || !message.status) return;
        const labels = {
          'loading tesseract core': 'Loading the OCR engine…',
          'initializing tesseract': 'Starting OCR…',
          'loading language traineddata': 'Downloading language data…',
          'initializing api': 'Preparing the language model…',
          'recognizing text': 'Reading text…',
        };
        onProgress({
          phase: 'ocr',
          label: labels[message.status] || message.status,
          value: typeof message.progress === 'number' ? message.progress : undefined,
        });
      },
    });
  })();
  workers.set(lang, promise);
  try {
    return await promise;
  } catch (err) {
    workers.delete(lang);
    throw err instanceof ToolError ? err : new ToolError('ocr-unavailable', `OCR engine failed to start: ${err.message}`);
  }
}

/**
 * @param {{ onProgress?: Function }} [hooks]
 * @returns {{ recognize: (image: string, lang: string) => Promise<{text: string, confidence?: number}>, terminate: Function }}
 */
export function createBrowserOcrEngine(hooks = {}) {
  const { onProgress } = hooks;
  return {
    async recognize(image, lang) {
      const wanted = String(lang || 'eng').includes('+') ? String(lang) : String(lang || 'eng');
      const worker = await getWorker(wanted, onProgress);
      try {
        const { data } = await worker.recognize(image);
        return { text: data && data.text ? data.text : '', confidence: data ? data.confidence : undefined };
      } catch (err) {
        throw new ToolError('ocr-failed', `OCR could not read this page: ${err.message}`);
      }
    },
    async terminate() {
      const pending = [...workers.values()];
      workers.clear();
      for (const promise of pending) {
        try {
          const worker = await promise;
          await worker.terminate();
        } catch { /* already gone */ }
      }
    },
  };
}

/** Languages actually vendored under vendor/ocr/lang. */
export const AVAILABLE_OCR_LANGS = Object.freeze(['eng', 'ara']);

export default { createBrowserOcrEngine, AVAILABLE_OCR_LANGS };
