/**
 * ⚠ UNVERIFIED SCAFFOLD — never executed. Nothing in apps/desktop/ has been built or run: Rust/cargo
 * is not installed on the machine where this was written. This file is a REFERENCE for the web-side
 * task; it is not loaded by the site today and the site does not need it to work.
 *
 * ToolSeer desktop bridge - the entire surface the web UI needs to use the native shell.
 *
 * Why a global and not an import: `tauri.conf.json` sets `withGlobalTauri: true`, so the shell is
 * detected as `window.__TAURI__` and no bundler, import map or build step is involved. That keeps the
 * project's "no bundler" rule (docs/ARCHITECTURE.md §1) intact for the desktop build too.
 *
 * The contract in one line: PATHS IN, PATHS OUT. The webview never hands file bytes to Rust and never
 * receives file bytes back. That is the whole reason the desktop build can do a 700-page export - the
 * bytes go from the user's disk, through the native engine, back to the user's disk, while the JS heap
 * only ever holds a list of strings and some progress numbers.
 */

const invoke = (command, args) => {
  if (!isDesktop()) throw new Error('not running inside the ToolSeer desktop shell');
  return window.__TAURI__.core.invoke(command, args);
};

export function isDesktop() {
  return typeof window !== 'undefined' && Boolean(window.__TAURI__);
}

/** Subscribe to progress. Returns an unlisten function; call it when the tool page unloads. */
export async function onProgress(handler) {
  if (!isDesktop()) return () => {};
  return window.__TAURI__.event.listen('engine://progress', (event) => handler(event.payload));
}

/** Fired once, when the startup self-check finishes: { ok, checks } */
export async function onReady(handler) {
  if (!isDesktop()) return () => {};
  return window.__TAURI__.event.listen('engine://ready', (event) => handler(event.payload));
}

export const appInfo = () => invoke('app_info');
export const preflight = () => invoke('engine_preflight');

/** kind: 'pdf' | 'image' | 'any'. Returns absolute paths. */
export const pickInputs = (kind = 'pdf', multiple = true) =>
  invoke('pick_input_files', { kind, multiple });

export const pickOutputFile = (defaultName) => invoke('pick_output_file', { defaultName });
export const pickOutputDir = () => invoke('pick_output_dir');
export const revealInFolder = (path) => invoke('reveal_in_folder', { path });
export const cancelJob = (jobId) => invoke('job_cancel', { jobId });

/*
 * Jobs. Every one takes `{ jobId, ... }` and returns paths, never bytes. `jobId` is generated on the
 * web side so a page can subscribe to progress BEFORE the work starts - otherwise a fast merge can
 * finish before the listener is attached and the progress bar never moves.
 *
 * Note the names: they are the native operations, not the marketing tool names. The mapping is
 * deliberate - "Compress PDF" is `job_compress` with `level: 'lossless'`, and the two lossy levels are
 * REJECTED by the engine with a clear message because image downsampling is not implemented. Check
 * `appInfo().notImplemented` before offering a control that claims otherwise.
 */

export const merge = (request) => invoke('job_merge', { request });
export const split = (request) => invoke('job_split', { request });
export const organize = (request) => invoke('job_organize', { request });
export const compress = (request) => invoke('job_compress', { request });
export const protect = (request) => invoke('job_protect', { request });
export const unlock = (request) => invoke('job_unlock', { request });
export const render = (request) => invoke('job_render', { request });
export const extractText = (request) => invoke('job_extract_text', { request });
export const imagesToPdf = (request) => invoke('job_images_to_pdf', { request });

/**
 * A worked example, for the merge page's `run()`.
 *
 * The web toolkit's contract (docs/ARCHITECTURE.md §6) gives a tool page `files` and expects
 * `{ outputs: [{ name, bytes }] }` back. In the desktop shell the bytes already exist on disk, so the
 * adapter is trivial: swap the file list for paths going in, and report the output path coming back.
 * In the browser path the same page calls the in-page engine instead - one `if`, no forked page.
 */
export async function runMergeOnDesktop({ files, settings, onProgress: report }) {
  const jobId = crypto.randomUUID();
  const unlisten = await onProgress((payload) => {
    if (payload.jobId === jobId) report?.(payload);
  });

  try {
    const output = await pickOutputFile('merged.pdf');
    if (!output) return { outputs: [] };

    const result = await merge({
      jobId,
      inputs: files.map((file) => file.path), // absolute paths from the native picker
      output,
      addBookmarks: Boolean(settings.bookmarks),
      failOnEncrypted: false,
    });

    // No bytes to hand back: the file is already saved where the user asked for it.
    return { outputs: [], savedTo: result.output, warnings: result.warnings };
  } finally {
    unlisten();
  }
}

/**
 * What the web side must NOT do.
 *
 * Reading a 700-page PDF into a Uint8Array "to hand it to the desktop engine" throws away the entire
 * benefit of the shell - it is the exact failure mode the desktop app exists to avoid. If a page finds
 * itself calling `file.arrayBuffer()` before an `invoke`, the integration is wrong.
 */
export const DESKTOP_RULES = Object.freeze([
  'never send file bytes through invoke; send paths',
  'do not keep page previews for a large job; show a count instead',
  'revoke object URLs as soon as a preview is off screen',
  'treat a jobId as required, so progress and cancel can be wired up',
  'read appInfo().notImplemented before offering a control it cannot honour',
]);
