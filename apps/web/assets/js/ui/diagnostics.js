/**
 * diagnostics.js — an on-page error report you can copy and send.
 *
 * WHY THIS EXISTS
 * ---------------
 * The failures being chased happen only on a phone, only sometimes in the
 * installed app, and the agent doing the work cannot attach a debugger to that
 * device and cannot read a screenshot. So the page reports on itself, as text.
 *
 * It is off by default and costs nothing when off. Turn it on any of three ways:
 *   · `?debug=1` in the address bar (works in a normal browser tab)
 *   · a triple-tap on the logo (works INSIDE the installed app, which has no
 *     address bar at all)
 *   · once enabled it stays enabled until "Turn off" is pressed
 *
 * What it captures: uncaught errors, unhandled promise rejections, console.error
 * and console.warn, and — most usefully — the text of the tool's own error banner,
 * so the report says exactly what went wrong rather than "it did not work".
 */
const PANEL_ID = 'ts-diagnostics';
const FLAG = 'toolseer:debug';

let panel = null;
let body = null;
let lines = [];
let startedAt = Date.now();

const enabled = () => {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('debug') === '1') return true;
    return localStorage.getItem(FLAG) === '1';
  } catch { return false; }
};

function stamp() {
  return `+${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
}

function add(kind, text) {
  const line = `${stamp()}  [${kind}] ${String(text).slice(0, 600)}`;
  lines.push(line);
  if (lines.length > 200) lines.shift();
  if (body) {
    const el = document.createElement('div');
    el.textContent = line;
    el.style.cssText = 'padding:1px 0;border-bottom:1px solid rgba(255,255,255,.08);white-space:pre-wrap;word-break:break-word';
    if (kind === 'error') el.style.color = '#ff9b9b';
    else if (kind === 'warn') el.style.color = '#ffd48a';
    else if (kind === 'seen') el.style.color = '#9be8b4';
    body.append(el);
    body.scrollTop = body.scrollHeight;
  }
}

function environment() {
  const d = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
  const facts = {
    page: window.location.href,
    standalone: d ? 'yes (installed app)' : 'no (browser tab)',
    language: document.documentElement.lang,
    dir: document.documentElement.dir,
    theme: document.documentElement.dataset.theme,
    viewport: `${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}x`,
    touch: window.matchMedia && window.matchMedia('(pointer: coarse)').matches ? 'coarse' : 'fine',
    deviceMemory: navigator.deviceMemory ? `${navigator.deviceMemory} GB` : 'not reported',
    cpuThreads: navigator.hardwareConcurrency || 'not reported',
    serviceWorker: navigator.serviceWorker && navigator.serviceWorker.controller ? 'controlling' : 'none',
    online: navigator.onLine ? 'yes' : 'no',
    apis: [
      'createImageBitmap', 'OffscreenCanvas', 'File', 'Blob', 'navigator.share', 'navigator.canShare',
      'showSaveFilePicker', 'Worker',
    ].map((k) => {
      const path = k.split('.');
      const value = path.length === 2 ? navigator[path[1]] : window[k];
      return `${k}=${typeof value === 'function' ? 'yes' : 'NO'}`;
    }).join('  '),
  };
  return Object.entries(facts).map(([k, v]) => `${k.padEnd(16)} ${v}`).join('\n');
}

function render() {
  if (panel) return;
  panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.style.cssText = [
    'position:fixed', 'inset:auto 0 0 0', 'max-height:52vh', 'z-index:9999',
    'background:#0b1120', 'color:#e7ecf5', 'font:12px/1.45 ui-monospace,Consolas,monospace',
    'box-shadow:0 -8px 24px rgba(0,0,0,.45)', 'display:flex', 'flex-direction:column',
    'direction:ltr', 'text-align:left',
  ].join(';');

  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;gap:8px;align-items:center;padding:8px 10px;background:#111a2e;border-bottom:1px solid #1f2a3c';
  const title = document.createElement('strong');
  title.textContent = 'ToolSeer diagnostics';
  title.style.cssText = 'flex:1;font-size:12px';

  const copy = document.createElement('button');
  copy.textContent = 'Copy all';
  copy.style.cssText = 'padding:5px 10px;border-radius:6px;border:1px solid #2c3a50;background:#182238;color:#e7ecf5;cursor:pointer';
  copy.addEventListener('click', async () => {
    const text = panelText();
    try { await navigator.clipboard.writeText(text); copy.textContent = 'Copied ✓'; }
    catch { copy.textContent = 'Select and copy below'; }
    setTimeout(() => { copy.textContent = 'Copy all'; }, 2500);
  });

  const hide = document.createElement('button');
  hide.textContent = 'Hide';
  hide.style.cssText = copy.style.cssText;
  hide.addEventListener('click', () => { panel.style.display = 'none'; });

  const off = document.createElement('button');
  off.textContent = 'Turn off';
  off.style.cssText = copy.style.cssText;
  off.addEventListener('click', () => {
    try { localStorage.removeItem(FLAG); } catch { /* ignore */ }
    panel.remove();
    panel = null;
    window.location.reload();
  });

  bar.append(title, copy, hide, off);

  body = document.createElement('div');
  body.style.cssText = 'overflow:auto;padding:8px 10px;flex:1';
  panel.append(bar, body);
  document.body.append(panel);

  add('info', 'Environment');
  for (const line of environment().split('\n')) add('info', line);
  add('info', '— activity below —');
}

function panelText() {
  return [
    'ToolSeer diagnostics report',
    `generated ${new Date().toISOString()}`,
    '',
    environment(),
    '',
    '--- events ---',
    ...lines,
  ].join('\n');
}

export function initDiagnostics() {
  if (!enabled()) return false;
  render();

  /* Errors the page itself throws. */
  window.addEventListener('error', (event) => {
    add('error', event.message || String(event.error));
    if (event.filename) add('error', `at ${event.filename}:${event.lineno}:${event.colno}`);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    add('error', 'unhandled promise: ' + (reason && reason.message ? reason.message : String(reason)));
    if (reason && reason.code) add('error', `code: ${reason.code}  hint: ${reason.hint || ''}`);
  });

  /* The console, without losing it for anyone else. */
  for (const level of ['error', 'warn']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      add(level, args.map((a) => (a && a.message ? a.message : String(a))).join(' '));
      original(...args);
    };
  }

  /* What the user actually SAW: the tool's own banner, and the result card. */
  const observer = new MutationObserver(() => {
    document.querySelectorAll('.ts-alert--error .ts-alert__title, .ts-alert--error .ts-alert__hint, .ts-alert--warning .ts-alert__title')
      .forEach((node) => {
        const text = (node.textContent || '').trim();
        if (text && !lines.some((line) => line.includes(text))) add('seen', text);
      });
    const result = document.querySelector('.ts-result .ts-result__meta, .ts-card pre');
    if (result) {
      const text = (result.textContent || '').trim().slice(0, 120);
      if (text && !lines.some((line) => line.includes(text))) add('seen', 'result: ' + text);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  document.addEventListener('toolseer:done', (event) => {
    add('info', `conversion finished in ${event.detail.seconds}s`);
  });

  add('info', 'diagnostics ready — reproduce the problem now');
  return true;
}

export default { initDiagnostics };
