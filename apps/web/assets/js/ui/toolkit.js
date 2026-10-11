/**
 * toolkit.js — the shared tool runtime.
 *
 * A tool page declares WHAT it needs (settings schema + a run function) and the
 * toolkit owns HOW it behaves: drop zone, validation, reordering, previews,
 * progress, errors, results, downloads. This is what keeps eleven pages
 * consistent without a framework and without a build step.
 *
 * Minimal tool page:
 *
 *   import { defineTool } from '/assets/js/ui/toolkit.js';
 *   defineTool({
 *     slug: 'merge-pdf',
 *     accept: 'application/pdf', multiple: true, minFiles: 2, preview: 'rows',
 *     settings: [{ type:'switch', id:'bookmarks', default:true }],
 *     async run({ files, settings, onProgress }) {
 *       const inputs = await Promise.all(files.map(f => f.asInput()));
 *       return { outputs: [{ name: 'merged.pdf', bytes }] };
 *     },
 *   });
 */
import { icon } from './icons.js';
import { t, reflect, onLangChange, hasKey } from './i18n.js';
import { renderShell, openModal, SITE } from './shell.js';

/* ------------------------------------------------------------ utilities -- */

/** UI-side byte formatting (the engine has its own; display is a UI concern). */
export function fmtBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
}

export function fmtNumber(n) {
  try { return new Intl.NumberFormat(document.documentElement.lang || 'en').format(n); }
  catch { return String(n); }
}

let uid = 0;
const nextId = () => `f${++uid}`;

/** Lazy handle on the engine so page load never blocks on it. */
let corePromise = null;
function core() {
  if (!corePromise) corePromise = import('../core/index.js');
  return corePromise;
}

/**
 * Engine warnings are stable codes (`compression-ineffective:87%`). The UI
 * maps them to localised sentences centrally; codes without a mapping are
 * shown verbatim so nothing is ever silently hidden.
 */
function describeWarning(w) {
  const s = String(w);
  const map = [
    [/^compression-ineffective:(\d+)%$/, (m) => t('warning.compressionIneffective', { pct: m[1] })],
    [/^image-recompression-unavailable:(.+)$/, (m) => t('warning.imageRecompressionUnavailable', { level: m[1] })],
    [/^not-encrypted$/, () => t('warning.notEncrypted')],
    [/^weak-encryption:(.+)$/, (m) => t('warning.weakEncryption', { algo: m[1] })],
    [/^ocr-failed:page-(\d+)$/, (m) => t('warning.ocrFailed', { page: m[1] })],
    [/^metadata-unavailable$/, () => t('warning.metadataUnavailable')],
    [/^outline-unavailable$/, () => t('warning.outlineUnavailable')],
    [/^reencoded:(.+)$/, (m) => t('warning.reencoded', { name: m[1] })],
    [/^text-layer-lost$/, () => t('warning.textLayerLost')],
    [/^password-removed$/, () => t('warning.passwordRemoved')],
    [/^images-shrunk:(\d+)$/, (m) => t('warning.imagesShrunk', { mb: m[1] })],
    [/^mobile-memory-risk$/, () => t('warning.mobileMemory')],
  ];
  for (const [re, fn] of map) {
    const m = re.exec(s);
    if (m) return fn(m);
  }
  return s;
}

/** Human message + hint for anything thrown by the engine. */
function describeError(err) {
  const code = err && err.code;
  const known = {
    'need-password': 'error.needPassword',
    'wrong-password': 'error.wrongPassword',
    'password-mismatch': 'error.passwordMismatch',
    'password-empty': 'error.passwordEmpty',
    'range-invalid': 'error.rangeInvalid',
    'range-empty': 'error.rangeEmpty',
    corrupt: 'error.corrupt',
    encrypted: 'error.encrypted',
    unsupported: 'error.unsupported',
    'too-large': 'error.tooLarge',
    'out-of-memory': 'error.memory',
    'ocr-unavailable': 'error.ocrUnavailable',
    'bad-type': 'error.badType',
  };
  if (code && known[code]) {
    return { title: t('error.title'), message: t(known[code]), hint: err.hint || '' };
  }
  const message = (err && err.message) || t('error.generic');
  return { title: t('error.title'), message, hint: (err && err.hint) || '' };
}

/* ------------------------------------------------------------- tool def -- */

export const TOOLS = new Map();

/**
 * @param {{
 *   slug: string,
 *   accept?: string, multiple?: boolean, minFiles?: number, maxFiles?: number,
 *   maxFileSize?: number, preview?: 'image'|'rows'|'pages'|'none',
 *   settings?: object[], downloads?: string, bigJobHint?: number,
 *   dropHint?: string, run: Function
 * }} config
 */
export function defineTool(config) {
  const cfg = {
    multiple: true,
    minFiles: 1,
    maxFiles: 0,
    preview: 'rows',
    settings: [],
    maxFileSize: 0,
    bigJobHint: 60 * 1024 * 1024,
    ...config,
  };
  TOOLS.set(cfg.slug, cfg);

  const start = () => {
    try {
      mount(cfg);
    } catch (err) {
      console.error('[toolseer] failed to mount tool', cfg.slug, err);
      const host = document.getElementById('ts-tool');
      if (host) {
        host.innerHTML = `<div class="ts-alert ts-alert--error">${icon('warning', { size: 18 })}
          <div class="ts-alert__body"><div class="ts-alert__title">${t('error.title')}</div>
          <div class="ts-alert__hint">${String(err && err.message ? err.message : err)}</div></div></div>`;
      }
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  return cfg;
}

/* -------------------------------------------------------------- mounting -- */

function mount(cfg) {
  const host = document.getElementById('ts-tool');
  if (!host) {
    console.warn('[toolseer] page has no #ts-tool container');
    return;
  }

  const { railBody } = renderShell({ slug: cfg.slug });
  const settings = buildSettings(cfg, railBody);

  /** @type {{id:string, file:File, url?:string}[]} */
  let items = [];
  let running = false;
  let lastResult = null;

  /* Page-grid state — only used when cfg.preview === 'pages'.
     pageState is the single source of truth for order, rotation and deletion. */
  let pageState = null;      // [{ src, rotation, deleted }]
  let pageThumbs = null;     // { [src]: { dataUrl, width, height } }
  let pagesLoading = false;
  let pagesError = null;

  /* ---------- DOM skeleton ---------- */
  host.innerHTML = '';

  const drop = document.createElement('div');
  drop.className = `ts-drop${cfg.preview === 'image' ? '' : ' ts-drop--compact'}`;
  drop.tabIndex = 0;
  drop.setAttribute('role', 'button');
  drop.setAttribute('aria-label', t('drop.title'));

  const input = document.createElement('input');
  input.type = 'file';
  input.className = 'ts-drop__input';
  input.multiple = !!cfg.multiple;
  if (cfg.accept) input.accept = cfg.accept;
  input.setAttribute('aria-label', t('action.choose'));

  const renderDropInner = () => {
    drop.querySelector('.ts-drop__icon')?.remove();
    drop.querySelector('.ts-drop__title')?.remove();
    drop.querySelector('.ts-drop__hint')?.remove();
    const iconBox = document.createElement('div');
    iconBox.className = 'ts-drop__icon';
    iconBox.innerHTML = icon(cfg.dropIcon || 'cloud-up', { size: 34 });
    const title = document.createElement('div');
    title.className = 'ts-drop__title';
    title.innerHTML = `${t('drop.title')}`;
    const hint = document.createElement('div');
    hint.className = 'ts-drop__hint';
    hint.textContent = cfg.dropHint || t('privacy.note');
    drop.prepend(hint);
    drop.prepend(title);
    drop.prepend(iconBox);
  };
  renderDropInner();
  drop.append(input);

  const privacy = document.createElement('div');
  privacy.className = 'ts-note';
  privacy.innerHTML = `${icon('shield', { size: 15 })}<span>${t('privacy.note')}</span>`;

  const bigJob = document.createElement('div');
  bigJob.className = 'ts-note ts-note--warning';
  bigJob.hidden = true;
  bigJob.innerHTML = `${icon('monitor', { size: 15 })}<span>${t('bigfile.body')} <a href="/desktop">${t('bigfile.cta')}</a></span>`;

  const filesWrap = document.createElement('div');
  filesWrap.className = 'ts-files';
  filesWrap.hidden = true;

  const filesHead = document.createElement('div');
  filesHead.className = 'ts-files__head';
  const filesTitle = document.createElement('div');
  filesTitle.className = 'ts-files__title';
  const filesTools = document.createElement('div');
  filesTools.className = 'ts-files__tools';
  filesHead.append(filesTitle, filesTools);

  const listHost = document.createElement('div');
  filesWrap.append(filesHead, listHost);

  const empty = document.createElement('div');
  empty.className = 'ts-empty';
  empty.innerHTML = `${icon(cfg.emptyIcon || 'images', { size: 86 })}<div class="ts-empty__text">${t('files.empty')}</div>`;

  const progress = document.createElement('div');
  progress.className = 'ts-progress';
  progress.hidden = true;

  const alerts = document.createElement('div');
  alerts.style.display = 'contents';

  const results = document.createElement('div');
  results.style.display = 'contents';

  const actions = document.createElement('div');
  actions.className = 'ts-actions';

  const addMore = document.createElement('button');
  addMore.type = 'button';
  addMore.className = 'ts-btn ts-btn--ghost';
  addMore.innerHTML = `${icon('plus', { size: 17 })}<span>${t('action.addMore')}</span>`;
  addMore.addEventListener('click', () => input.click());

  const right = document.createElement('div');
  right.style.display = 'flex';
  right.style.gap = '10px';
  right.style.alignItems = 'center';

  const clearAll = document.createElement('button');
  clearAll.type = 'button';
  clearAll.className = 'ts-btn ts-btn--ghost';
  clearAll.innerHTML = `${icon('trash', { size: 16 })}<span>${t('action.clearAll')}</span>`;
  clearAll.addEventListener('click', () => { clearFiles(); render(); });

  const runBtn = document.createElement('button');
  runBtn.type = 'button';
  runBtn.id = 'ts-run';
  runBtn.className = 'ts-btn ts-btn--primary ts-btn--lg';
  const runLabel = () => `${icon(cfg.actionIcon || 'sparkle', { size: 18 })}<span>${t(`tool.${cfg.slug}.action`)}</span>`;
  runBtn.innerHTML = runLabel();
  runBtn.addEventListener('click', execute);

  right.append(clearAll, runBtn);
  actions.append(addMore, right);

  host.append(drop, privacy, bigJob, filesWrap, alerts, progress, results, empty, actions);

  /* ---------- file input handling ---------- */

  input.addEventListener('change', () => {
    addFiles([...input.files]);
    input.value = '';
  });

  let dragDepth = 0;
  drop.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; drop.classList.add('is-dragging'); });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-dragging'); });
  drop.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; drop.classList.remove('is-dragging'); } });
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    drop.classList.remove('is-dragging');
    addFiles([...(e.dataTransfer?.files || [])]);
  });
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  });
  /* Whole-window drop, but only when it is not the drop zone itself. */
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    if (drop.contains(e.target)) return;
    e.preventDefault();
    addFiles([...(e.dataTransfer?.files || [])]);
  });

  function accepted(file) {
    if (!cfg.accept) return true;
    const rules = cfg.accept.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const name = file.name.toLowerCase();
    const type = (file.type || '').toLowerCase();
    return rules.some((rule) => {
      if (rule.startsWith('.')) return name.endsWith(rule);
      if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
      return type === rule;
    });
  }

  function addFiles(files) {
    if (!files.length) return;
    const rejected = [];
    for (const file of files) {
      if (!accepted(file)) { rejected.push(file); continue; }
      if (!cfg.multiple) {
        /* Single-file tools replace rather than stack, and say so after the fact. */
        if (items.length >= 1) {
          const [old] = items;
          if (old && old.url) URL.revokeObjectURL(old.url);
          resetPages();
        }
        items = [{ id: nextId(), file }];
        continue;
      }
      if (cfg.maxFiles && items.length >= cfg.maxFiles) { rejected.push(file); continue; }
      items.push({ id: nextId(), file });
    }
    if (rejected.length) {
      showAlert('warning', t('error.badType'),
        rejected.slice(0, 4).map((f) => f.name).join(', ') + (rejected.length > 4 ? '…' : ''));
    } else {
      clearAlerts();
      if (!cfg.multiple && files.length > 1) showAlert('info', t('setting.replaceFile'));
    }
    render();
  }

  function clearFiles() {
    for (const item of items) if (item.url) URL.revokeObjectURL(item.url);
    items = [];
    lastResult = null;
    results.innerHTML = '';
    resetPages();
    clearAlerts();
  }

  function move(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const [moved] = items.splice(index, 1);
    items.splice(target, 0, moved);
    render();
    const cards = listHost.querySelectorAll('[data-index]');
    const node = cards[target];
    if (node) node.focus();
  }

  function remove(index) {
    const [gone] = items.splice(index, 1);
    if (gone && gone.url) URL.revokeObjectURL(gone.url);
    if (cfg.preview === 'pages') resetPages();
    render();
  }

  function sortBy(mode) {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    items.sort((a, b) => {
      if (mode === 'name') return collator.compare(a.file.name, b.file.name);
      if (mode === 'size') return a.file.size - b.file.size;
      if (mode === 'date') return (a.file.lastModified || 0) - (b.file.lastModified || 0);
      return 0;
    });
    render();
  }

  /* ---------- page-grid mode ('preview: pages') ---------- */

  function resetPages() {
    pageState = null;
    pageThumbs = null;
    pagesError = null;
    pagesLoading = false;
  }

  /** Ask the engine for one thumbnail per page. The UI never touches pdf.js. */
  async function loadPages() {
    const item = items[0];
    if (!item || pagesLoading || pageState) return;
    pagesLoading = true;
    pagesError = null;
    render();
    try {
      const bytes = new Uint8Array(await item.file.arrayBuffer());
      const { renderThumbnails } = await core();
      const thumbs = await renderThumbnails(bytes, { maxWidth: 240 });
      pageThumbs = {};
      for (const th of thumbs) pageThumbs[th.pageNumber] = th;
      pageState = thumbs.map((th) => ({ src: th.pageNumber, rotation: 0, deleted: false }));
    } catch (err) {
      console.error('[toolseer] thumbnail rendering failed', err);
      pagesError = describeError(err);
    } finally {
      pagesLoading = false;
      render();
    }
  }

  function rotatePage(index, delta) {
    const page = pageState[index];
    if (!page) return;
    page.rotation = ((page.rotation + delta) % 360 + 360) % 360;
    renderPageGrid();
  }

  function toggleDeletePage(index) {
    const page = pageState[index];
    if (!page) return;
    page.deleted = !page.deleted;
    renderPageGrid();
  }

  function rotateAll(delta) {
    if (!pageState) return;
    for (const page of pageState) page.rotation = ((page.rotation + delta) % 360 + 360) % 360;
    renderPageGrid();
  }

  function movePage(from, to) {
    if (from === to || Number.isNaN(from)) return;
    const [moved] = pageState.splice(from, 1);
    pageState.splice(to, 0, moved);
    renderPageGrid();
  }

  function renderPageGrid(total) {
    if (total === undefined) total = items.reduce((n, i) => n + i.file.size, 0);

    if (!pageState && !pagesLoading && !pagesError) {
      loadPages();
    }

    filesTools.innerHTML = '';
    if (pageState) {
      const kept = pageState.filter((p) => !p.deleted).length;
      const counter = document.createElement('span');
      counter.style.cssText = 'font-size:13px;color:var(--ts-text-muted)';
      counter.textContent = `${kept} / ${pageState.length} ${t('units.pages')}`;
      const left = document.createElement('button');
      left.type = 'button';
      left.className = 'ts-btn ts-btn--ghost ts-btn--sm';
      left.innerHTML = `${icon('arrow-clockwise', { size: 15 })}<span>${t('action.rotateAll')}</span>`;
      left.addEventListener('click', () => rotateAll(-90));
      const reset = document.createElement('button');
      reset.type = 'button';
      reset.className = 'ts-btn ts-btn--ghost ts-btn--sm';
      reset.innerHTML = `${icon('arrow-left', { size: 15 })}<span>${t('action.reset')}</span>`;
      reset.addEventListener('click', () => {
        for (const p of pageState) { p.rotation = 0; p.deleted = false; }
        pageState.sort((a, b) => a.src - b.src);
        renderPageGrid();
      });
      filesTools.append(counter, left, reset);
    }

    listHost.className = 'ts-pages';
    listHost.innerHTML = '';

    if (pagesLoading) {
      const note = document.createElement('div');
      note.className = 'ts-empty';
      note.style.gridColumn = '1 / -1';
      note.innerHTML = `<div class="ts-spinner" style="width:32px;height:32px;border-width:3px"></div>
        <div class="ts-empty__text">${t('progress.reading')}</div>`;
      listHost.append(note);
      return;
    }

    if (pagesError) {
      const box = document.createElement('div');
      box.className = 'ts-alert ts-alert--error';
      box.style.gridColumn = '1 / -1';
      box.innerHTML = `${icon('warning', { size: 18 })}
        <div class="ts-alert__body"><div class="ts-alert__title">${pagesError.message}</div>
        ${pagesError.hint ? `<div class="ts-alert__hint">${pagesError.hint}</div>` : ''}</div>`;
      listHost.append(box);
      return;
    }

    if (!pageState) return;

    const hint = document.createElement('div');
    hint.className = 'ts-field__hint';
    hint.style.gridColumn = '1 / -1';
    hint.textContent = t('files.hintPages');
    listHost.append(hint);

    let outputNumber = 0;
    pageState.forEach((page, index) => {
      if (!page.deleted) outputNumber++;
      const card = document.createElement('div');
      card.className = `ts-page${page.deleted ? ' is-dropped' : ''}`;
      card.dataset.index = String(index);
      card.tabIndex = 0;

      const badge = document.createElement('span');
      badge.className = 'ts-page__badge';
      badge.textContent = page.deleted ? '–' : String(outputNumber);

      const thumb = document.createElement('div');
      thumb.className = 'ts-page__thumb';
      const info = pageThumbs && pageThumbs[page.src];
      if (info && info.dataUrl) {
        const img = document.createElement('img');
        img.src = info.dataUrl;
        img.alt = '';
        img.loading = 'lazy';
        img.style.transform = `rotate(${page.rotation}deg)`;
        img.style.transition = 'transform 180ms cubic-bezier(0.4,0,0.2,1)';
        thumb.append(img);
      } else {
        thumb.innerHTML = icon('file-pdf', { size: 34 });
      }

      const bar = document.createElement('div');
      bar.className = 'ts-page__bar';
      const num = document.createElement('span');
      num.className = 'ts-page__num';
      num.textContent = `${t('progress.page')} ${page.src}`;

      const acts = document.createElement('div');
      acts.className = 'ts-page__acts';

      const mkBtn = (ico, label, handler, danger) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `ts-icon-btn${danger ? ' ts-icon-btn--danger' : ''}`;
        b.setAttribute('aria-label', `${label} — ${t('progress.page')} ${page.src}`);
        b.title = label;
        b.innerHTML = icon(ico, { size: 14 });
        b.addEventListener('click', (e) => { e.stopPropagation(); handler(); });
        return b;
      };

      acts.append(
        mkBtn('arrow-left', t('action.rotateLeft'), () => rotatePage(index, -90)),
        mkBtn('arrow-right', t('action.rotateRight'), () => rotatePage(index, 90)),
        mkBtn(page.deleted ? 'check' : 'trash',
          page.deleted ? t('action.restore') : t('action.deletePage'),
          () => toggleDeletePage(index), !page.deleted),
      );

      bar.append(num, acts);
      card.append(badge, thumb, bar);

      /* reorder: drag the card itself, or use Alt+Arrow from the keyboard */
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', String(index));
        e.dataTransfer.effectAllowed = 'move';
        card.classList.add('is-dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('is-dragging'));
      card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('is-drop-target'); });
      card.addEventListener('dragleave', () => card.classList.remove('is-drop-target'));
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        card.classList.remove('is-drop-target');
        movePage(Number(e.dataTransfer.getData('text/plain')), index);
      });
      card.addEventListener('keydown', (e) => {
        if (!e.altKey) return;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); movePage(index, Math.max(0, index - 1)); }
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); movePage(index, Math.min(pageState.length - 1, index + 1)); }
      });
      card.draggable = true;

      listHost.append(card);
    });
  }

  /* ---------- rendering ---------- */

  function render() {
    const has = items.length > 0;
    filesWrap.hidden = !has;
    empty.hidden = has;
    actions.hidden = !has;
    drop.hidden = has;
    privacy.hidden = has;

    const total = items.reduce((n, i) => n + i.file.size, 0);
    bigJob.hidden = !(has && (total > cfg.bigJobHint || items.length > 150));

    filesTitle.innerHTML =
      `<span>${t('files.added')}</span>` +
      `<span class="ts-files__count">${items.length}</span>` +
      `<span style="color:var(--ts-text-muted);font-weight:500">${fmtBytes(total)}</span>`;

    if (cfg.preview === 'pages') {
      renderPageGrid(total);
      if (cfg.onRender) cfg.onRender({ items, host: listHost, settings, pages: pageState });
      return;
    }

    filesTools.innerHTML = '';
    if (items.length > 1 && cfg.preview !== 'pages') {
      const mkSort = (label, mode, ico) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ts-btn ts-btn--ghost ts-btn--sm';
        b.innerHTML = `${icon(ico, { size: 15 })}<span>${label}</span>`;
        b.addEventListener('click', () => sortBy(mode));
        return b;
      };
      filesTools.append(
        mkSort(t('opt.name'), 'name', 'text-t'),
        mkSort(t('opt.size'), 'size', 'gauge'),
      );
    }

    listHost.className = cfg.preview === 'image' ? 'ts-grid' : 'ts-rows';
    listHost.innerHTML = '';
    items.forEach((item, index) => {
      listHost.append(cfg.preview === 'image' ? imageCard(item, index) : rowItem(item, index));
    });

    if (cfg.onRender) cfg.onRender({ items, host: listHost, settings });
  }

  function wireReorder(node, index, handleSelector) {
    node.dataset.index = String(index);
    node.draggable = false;
    const handle = node.querySelector(handleSelector);
    if (handle) {
      handle.addEventListener('mousedown', () => { node.draggable = true; });
      handle.addEventListener('mouseup', () => { node.draggable = false; });
      handle.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp' && e.altKey) { e.preventDefault(); move(index, -1); }
        if (e.key === 'ArrowDown' && e.altKey) { e.preventDefault(); move(index, 1); }
      });
    }
    node.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', String(index));
      e.dataTransfer.effectAllowed = 'move';
      node.classList.add('is-dragging');
    });
    node.addEventListener('dragend', () => {
      node.classList.remove('is-dragging');
      node.draggable = false;
      listHost.querySelectorAll('.is-drop-target').forEach((n) => n.classList.remove('is-drop-target'));
    });
    node.addEventListener('dragover', (e) => { e.preventDefault(); node.classList.add('is-drop-target'); });
    node.addEventListener('dragleave', () => node.classList.remove('is-drop-target'));
    node.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      node.classList.remove('is-drop-target');
      const from = Number(e.dataTransfer.getData('text/plain'));
      if (Number.isNaN(from) || from === index) return;
      const [moved] = items.splice(from, 1);
      items.splice(index, 0, moved);
      render();
    });
  }

  function imageCard(item, index) {
    const card = document.createElement('div');
    card.className = 'ts-file';
    card.tabIndex = 0;

    const order = document.createElement('span');
    order.className = 'ts-file__order';
    order.textContent = String(index + 1);

    const drag = document.createElement('button');
    drag.type = 'button';
    drag.className = 'ts-file__drag';
    drag.setAttribute('aria-label', `${t('action.drag')}: ${item.file.name}`);
    drag.innerHTML = icon('dots-six', { size: 15 });

    const thumb = document.createElement('div');
    thumb.className = 'ts-file__thumb';
    if (!item.url && /^image\//.test(item.file.type)) item.url = URL.createObjectURL(item.file);
    if (item.url) {
      const img = document.createElement('img');
      img.src = item.url;
      img.alt = item.file.name;
      img.loading = 'lazy';
      thumb.append(img);
    } else {
      thumb.innerHTML = icon('file-pdf', { size: 40 });
    }

    const body = document.createElement('div');
    body.className = 'ts-file__body';
    const name = document.createElement('div');
    name.className = 'ts-file__name';
    name.textContent = item.file.name;
    name.title = item.file.name;
    const meta = document.createElement('div');
    meta.className = 'ts-file__meta';
    meta.textContent = fmtBytes(item.file.size);
    body.append(name, meta);

    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'ts-file__remove';
    rm.setAttribute('aria-label', `${t('action.remove')}: ${item.file.name}`);
    rm.innerHTML = icon('x', { size: 14 });
    rm.addEventListener('click', (e) => { e.stopPropagation(); remove(index); });

    /* Touch reordering. HTML5 drag-and-drop never fires on a touch screen, so a
       phone user selecting thirty photos had no way to fix the page order at all.
       These two buttons are the same operation the drag handle performs, and they
       are always visible on coarse pointers (see .ts-file__move in the CSS). */
    const moveBar = document.createElement('div');
    moveBar.className = 'ts-file__move';
    const earlier = document.createElement('button');
    earlier.type = 'button';
    earlier.className = 'ts-file__move-btn';
    earlier.disabled = index === 0;
    earlier.setAttribute('aria-label', `${t('action.moveUp')}: ${item.file.name}`);
    earlier.title = t('action.moveUp');
    earlier.innerHTML = icon('arrow-left', { size: 15 });
    earlier.addEventListener('click', (e) => { e.stopPropagation(); move(index, -1); });

    const later = document.createElement('button');
    later.type = 'button';
    later.className = 'ts-file__move-btn';
    later.disabled = index === items.length - 1;
    later.setAttribute('aria-label', `${t('action.moveDown')}: ${item.file.name}`);
    later.title = t('action.moveDown');
    later.innerHTML = icon('arrow-right', { size: 15 });
    later.addEventListener('click', (e) => { e.stopPropagation(); move(index, 1); });

    moveBar.append(earlier, later);

    card.append(order, drag, thumb, body, moveBar, rm);
    wireReorder(card, index, '.ts-file__drag');
    return card;
  }

  function rowItem(item, index) {
    const row = document.createElement('div');
    row.className = 'ts-row';
    row.tabIndex = 0;

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'ts-row__handle';
    handle.setAttribute('aria-label', `${t('action.drag')}: ${item.file.name}`);
    handle.innerHTML = icon('dots-six', { size: 17 });

    const iconBox = document.createElement('span');
    iconBox.className = 'ts-row__icon';
    const isPdf = /pdf$/i.test(item.file.name) || item.file.type === 'application/pdf';
    iconBox.innerHTML = icon(isPdf ? 'file-pdf' : 'image', { size: 18 });

    const main = document.createElement('div');
    main.className = 'ts-row__main';
    const name = document.createElement('div');
    name.className = 'ts-row__name';
    name.textContent = item.file.name;
    name.title = item.file.name;
    const meta = document.createElement('div');
    meta.className = 'ts-row__meta';
    meta.textContent = fmtBytes(item.file.size);
    main.append(name, meta);

    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'ts-icon-btn';
    up.setAttribute('aria-label', t('action.moveUp'));
    up.innerHTML = icon('caret-up', { size: 16 });
    up.addEventListener('click', () => move(index, -1));

    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'ts-icon-btn';
    down.setAttribute('aria-label', t('action.moveDown'));
    down.innerHTML = icon('caret-down', { size: 16 });
    down.addEventListener('click', () => move(index, 1));

    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'ts-icon-btn ts-icon-btn--danger';
    rm.setAttribute('aria-label', `${t('action.remove')}: ${item.file.name}`);
    rm.innerHTML = icon('trash', { size: 16 });
    rm.addEventListener('click', () => remove(index));

    row.append(handle, iconBox, main, up, down, rm);
    wireReorder(row, index, '.ts-row__handle');
    return row;
  }

  /* ---------- alerts / progress / results ---------- */

  function clearAlerts() { alerts.innerHTML = ''; }

  function showAlert(kind, message, hint) {
    const box = document.createElement('div');
    box.className = `ts-alert ts-alert--${kind}`;
    box.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    const ico = kind === 'error' ? 'warning' : kind === 'warning' ? 'warning' : 'info';
    box.innerHTML = `${icon(ico, { size: 18 })}
      <div class="ts-alert__body">
        <div class="ts-alert__title">${message}</div>
        ${hint ? `<div class="ts-alert__hint">${hint}</div>` : ''}
      </div>`;
    clearAlerts();
    alerts.append(box);
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function setProgress(value, label) {
    progress.hidden = false;
    let bar = progress.querySelector('.ts-progress__bar');
    let text = progress.querySelector('.ts-progress__label');
    if (!bar) {
      progress.innerHTML = `<div class="ts-progress__track"><div class="ts-progress__bar" style="width:0%"></div></div>
        <div class="ts-progress__label"><span></span><span></span></div>`;
      bar = progress.querySelector('.ts-progress__bar');
      text = progress.querySelector('.ts-progress__label');
      progress.setAttribute('aria-live', 'polite');
      progress.setAttribute('role', 'status');
    }
    const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
    bar.style.width = `${pct}%`;
    text.firstElementChild.textContent = label || t('progress.working');
    text.lastElementChild.textContent = `${pct}%`;
  }

  function hideProgress() { progress.hidden = true; progress.innerHTML = ''; }

  function downloadBytes(bytes, name, type = 'application/pdf') {
    const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  /**
   * Save through the operating system instead of the download manager.
   *
   * This exists because of a mobile-only failure that looks like the tool doing
   * nothing at all: in an INSTALLED app on Android, a download started from a blob
   * URL is often blocked or lands somewhere the file picker cannot see, while the
   * identical code works on a desktop browser. The share sheet puts the file
   * where the user expects it — Files, Drive, an email — and it is the one path
   * that behaves the same installed and uninstalled.
   */
  async function shareBytes(bytes, name, type = 'application/pdf') {
    try {
      const file = new File([bytes instanceof Blob ? bytes : new Blob([bytes], { type })], name, { type });
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
        && typeof navigator.share === 'function') {
        await navigator.share({ files: [file], title: name });
        return true;
      }
    } catch { /* the user dismissed it, or the platform refused */ }
    return false;
  }

  /** True when this device can save through the share sheet rather than a download. */
  function canShareBytes(name, type = 'application/pdf') {
    try {
      const file = new File([new Uint8Array([0])], name, { type });
      return typeof navigator.share === 'function'
        && typeof navigator.canShare === 'function'
        && navigator.canShare({ files: [file] });
    } catch { return false; }
  }

  async function downloadAllZip(outputs) {
    try {
      const { zipFiles } = await core();
      const zip = await zipFiles(outputs);
      downloadBytes(zip, `${cfg.slug}-toolseer.zip`, 'application/zip');
    } catch (err) {
      showAlert('error', t('error.title'), describeError(err).message);
    }
  }

  function renderResult(result) {
    results.innerHTML = '';
    if (!result) return;

    if (result.text != null) {
      const card = document.createElement('div');
      card.className = 'ts-card';
      card.style.maxWidth = 'var(--ts-content-max)';
      card.style.width = '100%';
      const words = (result.text.trim().match(/\S+/g) || []).length;
      card.innerHTML =
        `<div class="ts-files__head" style="margin-bottom:12px">
           <div class="ts-card__title">${t('result.title')}</div>
           <div class="ts-files__tools">
             <span class="ts-files__count">${fmtNumber(result.text.length)} ${t('result.characters')}</span>
             <span style="font-size:13px;color:var(--ts-text-muted)">${fmtNumber(words)} ${t('result.words')}</span>
           </div>
         </div>`;
      const pre = document.createElement('pre');
      pre.style.cssText = 'white-space:pre-wrap;word-break:break-word;max-height:420px;overflow:auto;' +
        'background:var(--ts-surface-2);padding:14px;border-radius:12px;font-size:13px;margin:0;font-family:var(--ts-mono)';
      /* The engine separates pages with \f (the pdftotext convention). HTML
         collapses form feeds, so multi-page results would read as one run-on
         paragraph — render the break visibly instead. */
      const parts = String(result.text).split('\f');
      if (parts.length > 1) {
        pre.textContent = parts
          .map((part, i) => (i === 0 ? part : `\n\n───── ${t('progress.page')} ${i + 1} ─────\n\n${part}`))
          .join('');
        const note = document.createElement('div');
        note.className = 'ts-field__hint';
        note.style.marginTop = '8px';
        note.textContent = `${parts.length} ${t('units.pages')}`;
        card.append(pre, note);
      } else {
        pre.textContent = String(result.text);
        card.append(pre);
      }
      const row = document.createElement('div');
      row.className = 'ts-files__tools';
      row.style.marginTop = '12px';
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'ts-btn ts-btn--ghost ts-btn--sm';
      copy.innerHTML = `${icon('code', { size: 15 })}<span>${t('action.copy')}</span>`;
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(result.text);
          copy.querySelector('span').textContent = t('action.copied');
        } catch { /* clipboard blocked */ }
      });
      const txt = document.createElement('button');
      txt.type = 'button';
      txt.className = 'ts-btn ts-btn--primary ts-btn--sm';
      txt.innerHTML = `${icon('download', { size: 15 })}<span>.txt</span>`;
      txt.addEventListener('click', () =>
        downloadBytes(new Blob([result.text], { type: 'text/plain;charset=utf-8' }),
          `${cfg.slug}-toolseer.txt`, 'text/plain'));
      row.append(copy, txt);
      card.append(row);
      results.append(card);
      return;
    }

    const outputs = result.outputs || [];
    if (!outputs.length) return;

    const card = document.createElement('div');
    card.className = 'ts-result';
    card.setAttribute('role', 'status');

    const saved = result.before && result.after
      ? Math.round((1 - result.after / result.before) * 100)
      : null;

    card.innerHTML =
      `<span class="ts-result__icon">${icon('check', { size: 22 })}</span>
       <div class="ts-result__main">
         <div class="ts-result__title">${outputs.length > 1 ? t('result.titleMulti') : t('result.title')}</div>
         <div class="ts-result__meta">
           ${outputs.length === 1 ? outputs[0].name : `${outputs.length} ${t('units.files')}`}
           ${result.before && result.after
             ? ` · ${t('result.before')} ${fmtBytes(result.before)} → ${t('result.after')} ${fmtBytes(result.after)}` +
               (saved > 0 ? ` (${saved}% ${t('result.saved')})` : '')
             : ''}
         </div>
       </div>`;

    const btnRow = document.createElement('div');
    btnRow.className = 'ts-files__tools';

    if (outputs.length === 1) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ts-btn ts-btn--primary';
      b.innerHTML = `${icon('download', { size: 17 })}<span>${t('action.download')}</span>`;
      b.addEventListener('click', () => downloadBytes(outputs[0].bytes, outputs[0].name, outputs[0].type));
      btnRow.append(b);

      /* On a phone, offer the operating system's own save sheet as well. In an
         installed app a blob download can be blocked or vanish, which reads as the
         tool doing nothing; the share sheet always puts the file somewhere the
         user can find it. Rendered only when the platform actually supports it. */
      if (canShareBytes(outputs[0].name, outputs[0].type)) {
        const s = document.createElement('button');
        s.type = 'button';
        s.className = 'ts-btn ts-btn--ghost';
        s.innerHTML = `${icon('upload', { size: 17 })}<span>${t('action.share')}</span>`;
        s.addEventListener('click', async () => {
          const ok = await shareBytes(outputs[0].bytes, outputs[0].name, outputs[0].type);
          if (!ok) downloadBytes(outputs[0].bytes, outputs[0].name, outputs[0].type);
        });
        btnRow.append(s);
      }
    } else {
      const all = document.createElement('button');
      all.type = 'button';
      all.className = 'ts-btn ts-btn--primary';
      all.innerHTML = `${icon('download', { size: 17 })}<span>${t('action.downloadAll')}</span>`;
      all.addEventListener('click', () => downloadAllZip(outputs));
      btnRow.append(all);
      for (const out of outputs.slice(0, 3)) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ts-btn ts-btn--ghost ts-btn--sm';
        b.innerHTML = `${icon('download', { size: 15 })}<span>${out.name}</span>`;
        b.addEventListener('click', () => downloadBytes(out.bytes, out.name, out.type));
        btnRow.append(b);
      }
    }
    card.append(btnRow);
    results.append(card);

    if (result.warnings && result.warnings.length) {
      for (const w of result.warnings) showAlert('warning', describeWarning(w));
    }
  }

  /* ---------- execution ---------- */

  async function execute() {
    if (running) return;
    if (items.length < cfg.minFiles) {
      showAlert('error', t('error.noFiles'),
        cfg.minFiles > 1 ? t('error.minFiles', { n: cfg.minFiles }) : '');
      return;
    }
    running = true;
    runBtn.disabled = true;
    clearAlerts();
    results.innerHTML = '';
    setProgress(0.02, t('progress.reading'));

    const started = Date.now();
    try {
      const files = items.map((item) => ({
        id: item.id,
        name: item.file.name,
        size: item.file.size,
        type: item.file.type,
        file: item.file,
        url: item.url,
        async asInput() {
          const bytes = new Uint8Array(await item.file.arrayBuffer());
          return { name: item.file.name, bytes, type: item.file.type };
        },
      }));

      const result = await cfg.run({
        files,
        settings: settings.values(),
        /* Present only in 'pages' mode: the visible order, rotations and deletions.
           `pages` excludes deleted pages; `allPages` includes them with a flag. */
        pages: pageState
          ? pageState.filter((p) => !p.deleted).map((p) => ({ source: p.src, rotation: p.rotation }))
          : undefined,
        allPages: pageState ? pageState.map((p) => ({ ...p })) : undefined,
        onProgress: ({ value, label }) => setProgress(value, label),
        download: (bytes, name, type) => downloadBytes(bytes, name, type),
      });

      hideProgress();
      lastResult = result;
      renderResult(result);
      if (cfg.autoDownload && result && result.outputs && result.outputs.length === 1) {
        downloadBytes(result.outputs[0].bytes, result.outputs[0].name, result.outputs[0].type);
      }
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      document.dispatchEvent(new CustomEvent('toolseer:done', { detail: { slug: cfg.slug, seconds: Number(elapsed) } }));
    } catch (err) {
      hideProgress();
      const info = describeError(err);
      console.error('[toolseer] tool failed', cfg.slug, err);
      showAlert('error', info.message, info.hint || t('error.hint.retry'));
    } finally {
      running = false;
      runBtn.disabled = false;
      runBtn.innerHTML = runLabel();
    }
  }

  /* ---------- language changes re-render dynamic chrome ---------- */
  onLangChange(() => {
    renderDropInner();
    privacy.innerHTML = `${icon('shield', { size: 15 })}<span>${t('privacy.note')}</span>`;
    bigJob.innerHTML = `${icon('monitor', { size: 15 })}<span>${t('bigfile.body')} <a href="/desktop">${t('bigfile.cta')}</a></span>`;
    empty.querySelector('.ts-empty__text').textContent = t('files.empty');
    addMore.innerHTML = `${icon('plus', { size: 17 })}<span>${t('action.addMore')}</span>`;
    clearAll.innerHTML = `${icon('trash', { size: 16 })}<span>${t('action.clearAll')}</span>`;
    runBtn.innerHTML = runLabel();
    alignDropTitle();
    render();
    if (lastResult) renderResult(lastResult);
  });

  function alignDropTitle() {
    const title = drop.querySelector('.ts-drop__title');
    if (title) title.textContent = t('drop.title');
  }

  render();
  reflect();

  return { get items() { return items; }, execute, render };
}

/* -------------------------------------------------------- settings schema -- */

function buildSettings(cfg, railBody) {
  const values = Object.fromEntries(cfg.settings.map((s) => [s.id, s.default]));
  if (!railBody) return { values: () => ({ ...values }), set: () => {} };

  railBody.innerHTML = '';
  const groups = new Map();
  for (const spec of cfg.settings) {
    const groupName = spec.group || '';
    if (!groups.has(groupName)) {
      const wrap = document.createElement('div');
      wrap.className = 'ts-field';
      if (groupName) {
        const label = document.createElement('div');
        label.className = 'ts-field__label';
        label.textContent = groupName;
        wrap.append(label);
      }
      groups.set(groupName, wrap);
      railBody.append(wrap);
    }
    groups.get(groupName).append(control(spec, values));
  }

  function control(spec, bag) {
    const labelKey = spec.labelKey || `setting.${spec.id}.label`;
    const hintKey = spec.hintKey || `setting.${spec.id}.hint`;
    const onChange = () => { if (cfg.onSettingsChange) cfg.onSettingsChange({ ...bag }); };

    if (spec.type === 'switch') {
      const row = document.createElement('label');
      row.className = 'ts-switch';
      const showHint = spec.hint !== false && hasKey(hintKey);
      row.innerHTML =
        `<input type="checkbox" ${spec.default ? 'checked' : ''}>
         <span class="ts-switch__track"></span>
         <span class="ts-switch__text">
           <span>${t(labelKey)}</span>
           ${showHint ? `<span class="ts-switch__hint">${t(hintKey)}</span>` : ''}
         </span>`;
      const input = row.querySelector('input');
      input.checked = !!spec.default;
      input.addEventListener('change', () => { bag[spec.id] = input.checked; onChange(); });
      return row;
    }

    if (spec.type === 'segment') {
      const field = document.createElement('fieldset');
      field.className = 'ts-fieldset';
      const legend = document.createElement('legend');
      legend.className = 'ts-field__label';
      legend.textContent = t(labelKey);
      const seg = document.createElement('div');
      seg.className = 'ts-segment';
      for (const opt of spec.options) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ts-segment__btn';
        btn.setAttribute('aria-pressed', String(bag[spec.id] === opt.value));
        btn.innerHTML = `${opt.icon ? icon(opt.icon, { size: 20 }) : ''}<span>${t(opt.labelKey || `opt.${opt.value}`)}</span>`;
        btn.addEventListener('click', () => {
          bag[spec.id] = opt.value;
          seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
          btn.setAttribute('aria-pressed', 'true');
          onChange();
        });
        seg.append(btn);
      }
      field.append(legend, seg);
      return field;
    }

    if (spec.type === 'pills') {
      const field = document.createElement('fieldset');
      field.className = 'ts-fieldset';
      const legend = document.createElement('legend');
      legend.className = 'ts-field__label';
      legend.textContent = t(labelKey);
      const box = document.createElement('div');
      box.className = 'ts-pills';
      for (const opt of spec.options) {
        const pill = document.createElement('label');
        pill.className = 'ts-pill';
        const optHintKey = opt.hintKey || `setting.${spec.id}.${opt.value}.hint`;
        pill.innerHTML =
          `<input type="radio" name="${cfg.slug}-${spec.id}" value="${opt.value}" ${bag[spec.id] === opt.value ? 'checked' : ''}>
           <span class="ts-pill__text">
             <span>${t(opt.labelKey || `opt.${opt.value}`)}</span>
             ${hasKey(optHintKey) ? `<span class="ts-pill__hint">${t(optHintKey)}</span>` : ''}
           </span>`;
        pill.querySelector('input').addEventListener('change', () => { bag[spec.id] = opt.value; onChange(); });
        box.append(pill);
      }
      field.append(legend, box);
      return field;
    }

    if (spec.type === 'range') {
      const field = document.createElement('div');
      field.className = 'ts-field';
      const id = `${cfg.slug}-${spec.id}`;
      field.innerHTML =
        `<label class="ts-field__label" for="${id}">${t(labelKey)}</label>
         <input class="ts-range" type="range" id="${id}" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${bag[spec.id]}">
         <div class="ts-range__scale"><span>${t(spec.minLabelKey || 'opt.low')}</span><span>${t(spec.maxLabelKey || 'opt.high')}</span></div>
         ${spec.hint !== false && hasKey(hintKey) ? `<div class="ts-field__hint">${t(hintKey)}</div>` : ''}`;
      const input = field.querySelector('input');
      input.addEventListener('input', () => { bag[spec.id] = Number(input.value); onChange(); });
      return field;
    }

    if (spec.type === 'text' || spec.type === 'password' || spec.type === 'number') {
      const field = document.createElement('div');
      field.className = 'ts-field';
      const id = `${cfg.slug}-${spec.id}`;
      field.innerHTML =
        `<label class="ts-field__label" for="${id}">${t(labelKey)}</label>
         <input class="ts-input" id="${id}" type="${spec.type}" value="${spec.default ?? ''}"
                placeholder="${spec.placeholderKey ? t(spec.placeholderKey) : ''}"
                ${spec.min != null ? `min="${spec.min}"` : ''} ${spec.max != null ? `max="${spec.max}"` : ''}
                autocomplete="${spec.type === 'password' ? 'new-password' : 'off'}" spellcheck="false">
         ${spec.hint !== false && hasKey(hintKey) ? `<div class="ts-field__hint">${t(hintKey)}</div>` : ''}`;
      const input = field.querySelector('input');
      const read = () => { bag[spec.id] = spec.type === 'number' ? Number(input.value) : input.value; onChange(); };
      input.addEventListener('input', read);
      if (spec.required) input.required = true;
      return field;
    }

    if (spec.type === 'select') {
      const field = document.createElement('div');
      field.className = 'ts-field';
      const id = `${cfg.slug}-${spec.id}`;
      field.innerHTML =
        `<label class="ts-field__label" for="${id}">${t(labelKey)}</label>
         <select class="ts-select" id="${id}">
           ${spec.options.map((o) => `<option value="${o.value}" ${bag[spec.id] === o.value ? 'selected' : ''}>${t(o.labelKey || `opt.${o.value}`)}</option>`).join('')}
         </select>
         ${spec.hint !== false && hasKey(hintKey) ? `<div class="ts-field__hint">${t(hintKey)}</div>` : ''}`;
      field.querySelector('select').addEventListener('change', (e) => { bag[spec.id] = e.target.value; onChange(); });
      return field;
    }

    console.warn(`[toolseer] unknown setting type "${spec.type}" for ${spec.id}`);
    return document.createComment('unknown setting');
  }

  return {
    values: () => ({ ...values }),
    set: (id, value) => { values[id] = value; },
    node: railBody,
  };
}

export default { defineTool, TOOLS, fmtBytes, fmtNumber };
