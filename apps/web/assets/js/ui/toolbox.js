/**
 * toolbox.js — the ToolSeer hub: a searchable, starrable grid of tools.
 *
 * Design brief came from the PDF24 Toolbox the owner showed us: a friendly mascot
 * above the fold, a search field, All / Last used filters, one card per tool with
 * its own illustration, a star on every card, and a Windows-integration row at the
 * bottom. This is the SAME component the desktop shell will render, because the
 * desktop window loads this site (docs/DESKTOP.md) — one hub, two products.
 *
 * Everything it stores is local (favourites, recently used); nothing is sent
 * anywhere, and there is no server to send it to.
 */
import { icon } from './icons.js';
import { t, getLang, onLangChange } from './i18n.js';

const FAV_KEY = 'toolseer:favorites';
const RECENT_KEY = 'toolseer:recent';
const RECENT_MAX = 12;

/** Inside the Tauri shell the same page runs as the desktop app (docs/DESKTOP.md). */
const isDesktop = () => typeof window !== 'undefined' && Boolean(window.__TAURI__);

/**
 * The tool registry: single source of truth for the hub.
 * `kw` holds extra search terms (including Arabic synonyms) that are never shown.
 */
export const TOOLS = [
  {
    slug: 'image-to-pdf', icon: 'images', group: 'create',
    kw: ['jpg', 'jpeg', 'png', 'photo', 'scan', 'image', 'صورة', 'صور', 'تحويل'],
  },
  {
    slug: 'merge-pdf', icon: 'stack', group: 'organize',
    kw: ['combine', 'join', 'append', 'دمج', 'ضم', 'جمع'],
  },
  {
    slug: 'compress-pdf', icon: 'gauge', group: 'optimize',
    kw: ['smaller', 'reduce', 'size', 'optimise', 'optimize', 'ضغط', 'تصغير', 'حجم'],
  },
  {
    slug: 'split-pdf', icon: 'scissors', group: 'organize',
    kw: ['extract', 'cut', 'divide', 'chunks', 'تقسيم', 'قص', 'فصل'],
  },
  {
    /* One click, no settings worth reading — the shape of tool the owner asked
       for after the password/OCR pages proved too heavy to use. */
    slug: 'rotate-pdf', icon: 'arrow-clockwise', group: 'optimize',
    kw: ['rotate', 'rotate pages', 'sideways', 'landscape', 'upright', 'scan',
      'تدوير', 'ميلان', 'مقلوب', 'تعديل'],
  },
  {
    slug: 'pdf-to-images', icon: 'image', group: 'convert',
    kw: ['png', 'jpg', 'jpeg', 'export', 'صورة', 'صور', 'تصدير'],
  },
  {
    slug: 'organize-pdf', icon: 'shuffle', group: 'organize',
    kw: ['reorder', 'rotate', 'delete', 'sort', 'ترتيب', 'تدوير', 'حذف', 'صفحات'],
  },
];

/** Roadmap cards: shown, honest, not clickable. */
export const SOON = [
  'watermark-pdf', 'page-numbers', 'crop-pdf', 'web-optimize-pdf',
  'repair-pdf', 'edit-metadata', 'pdf-to-word', 'sign-pdf',
].map((id) => ({ id, icon: 'sparkle' }));

/* --------------------------------------------------------------- storage -- */

/**
 * Storage seam: the browser uses localStorage, tests inject a fake so the
 * selection and favourites logic can be verified in Node without a DOM.
 */
let storageOverride = null;
export function __setStorage(adapter) { storageOverride = adapter; }
const store = () => storageOverride || (typeof localStorage !== 'undefined' ? localStorage : null);

function readList(key) {
  try {
    const active = store();
    const raw = active ? active.getItem(key) : null;
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}

function writeList(key, list) {
  try {
    const active = store();
    if (active) active.setItem(key, JSON.stringify(list));
  } catch { /* private mode */ }
}

export const getFavorites = () => readList(FAV_KEY);
export const getRecent = () => readList(RECENT_KEY);

function toggleFavorite(slug) {
  const list = getFavorites();
  const next = list.includes(slug) ? list.filter((s) => s !== slug) : [...list, slug];
  writeList(FAV_KEY, next);
  return next;
}

export function recordUse(slug) {
  const next = [slug, ...getRecent().filter((s) => s !== slug)].slice(0, RECENT_MAX);
  writeList(RECENT_KEY, next);
}

/* --------------------------------------------------------------- helpers -- */

/** Localised label / description, resolved from the shared i18n dictionaries. */
const labelOf = (tool) => t(`tool.${tool.slug}.title`);
const descOf = (tool) => t(`toolbox.desc.${tool.slug}`);
const soonLabelOf = (id) => t(`toolbox.soon.${id}`);

function matches(tool, query) {
  if (!query) return true;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystack = [
    labelOf(tool),
    descOf(tool),
    tool.slug,
    ...(tool.kw || []),
  ].join(' ').toLowerCase();
  return haystack.includes(q);
}

/* ------------------------------------------------------ pure selection API -- */

/**
 * Which tools the hub shows, in order. Pure: no DOM, no storage side effects.
 * Exported because this is the part users actually feel — a search that misses
 * or a favourites list that reorders wrongly is a product bug — and because it
 * can therefore be tested in Node (tests/ui-toolbox.test.mjs).
 *
 * @param {{query?: string, filter?: string, favorites?: string[], recent?: string[]}} [state]
 * @returns {Array<object>} TOOLS entries, filtered and ordered
 */
export function selectTools(state = {}) {
  const { query = '', filter = 'all', favorites = [], recent = [] } = state;
  const list = TOOLS.filter((tool) => matches(tool, query));

  if (filter === 'favorites') {
    return list.filter((tool) => favorites.includes(tool.slug));
  }
  if (filter === 'recent') {
    return list
      .filter((tool) => recent.includes(tool.slug))
      .sort((a, b) => recent.indexOf(a.slug) - recent.indexOf(b.slug));
  }
  return list;
}

/** The roadmap row only makes sense on the unfiltered, unsearched view. */
export function roadmapVisible(state = {}) {
  const { query = '', filter = 'all' } = state;
  return !String(query).trim() && filter === 'all';
}

/* ------------------------------------------------------------- rendering -- */

let state = { query: '', filter: 'all' };
let hostRef = null;
let unsubscribeLang = null;

/**
 * Render (or re-render) the toolbox into `host`.
 * @param {HTMLElement} host
 * @param {{masthead?: boolean}} [opts] set masthead:false when the page already
 *   shows the mascot + title + subtitle in its own hero (the home page does).
 */
export function renderToolbox(host, opts = {}) {
  const { masthead = true } = opts;
  hostRef = host;
  host.innerHTML = '';
  host.className = 'ts-toolbox';

  /* ---------- masthead ---------- */
  const head = document.createElement('div');
  head.className = 'ts-toolbox__head';
  const mascot = document.createElement('img');
  mascot.src = '/assets/img/mascot/base.svg';
  mascot.alt = '';
  mascot.setAttribute('aria-hidden', 'true');
  mascot.width = 84;
  mascot.height = 84;
  mascot.className = 'ts-toolbox__mascot';
  mascot.addEventListener('error', () => { mascot.style.display = 'none'; });
  const titles = document.createElement('div');
  titles.className = 'ts-toolbox__titles';
  const h2 = document.createElement('h2');
  h2.className = 'ts-toolbox__title';
  h2.textContent = t('toolbox.title');
  const sub = document.createElement('p');
  sub.className = 'ts-toolbox__sub';
  sub.textContent = t('toolbox.subtitle');
  titles.append(h2, sub);
  head.append(mascot, titles);

  /* ---------- controls ---------- */
  const controls = document.createElement('div');
  controls.className = 'ts-toolbox__controls';
  const searchWrap = document.createElement('div');
  searchWrap.className = 'ts-search';
  const searchLabel = document.createElement('label');
  searchLabel.className = 'ts-visually-hidden';
  searchLabel.setAttribute('for', 'ts-tool-search');
  searchLabel.textContent = t('toolbox.searchLabel');
  const searchIcon = document.createElement('span');
  searchIcon.className = 'ts-search__icon';
  searchIcon.innerHTML = icon('magnifier', { size: 18 });
  const search = document.createElement('input');
  search.type = 'search';
  search.id = 'ts-tool-search';
  search.className = 'ts-search__input';
  search.placeholder = t('toolbox.searchPlaceholder');
  search.value = state.query;
  search.autocomplete = 'off';
  search.spellcheck = false;
  search.addEventListener('input', () => { state.query = search.value; renderGrid(); });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { search.value = ''; state.query = ''; renderGrid(); }
  });
  searchWrap.append(searchLabel, searchIcon, search);

  const filters = document.createElement('div');
  filters.className = 'ts-filters';
  filters.setAttribute('role', 'group');
  filters.setAttribute('aria-label', t('toolbox.filter.all'));

  const count = document.createElement('div');
  count.className = 'ts-toolbox__count';
  count.setAttribute('aria-live', 'polite');

  controls.append(searchWrap, filters, count);

  /* ---------- grid + footer containers ---------- */
  const grid = document.createElement('div');
  grid.className = 'ts-toolgrid';
  grid.setAttribute('role', 'list');

  const empty = document.createElement('div');
  empty.className = 'ts-empty ts-toolbox__empty';
  empty.hidden = true;

  /* ---------- desktop row ---------- */
  const desktopRow = document.createElement('div');
  desktopRow.className = 'ts-desktopbar';
  desktopRow.id = 'ts-desktopbar';

  if (masthead) host.append(head);
  host.append(controls, grid, empty, desktopRow);

  renderFilters();
  renderGrid();
  renderDesktopRow(desktopRow);

  function renderFilters() {
    filters.innerHTML = '';
    const defs = [
      { id: 'all', labelKey: 'toolbox.filter.all' },
      { id: 'recent', labelKey: 'toolbox.filter.recent' },
      { id: 'favorites', labelKey: 'toolbox.filter.favorites' },
    ];
    for (const def of defs) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ts-filters__btn';
      btn.dataset.filter = def.id;
      btn.setAttribute('aria-pressed', String(state.filter === def.id));
      btn.textContent = t(def.labelKey);
      btn.addEventListener('click', () => {
        state.filter = def.id;
        renderFilters();
        renderGrid();
      });
      filters.append(btn);
    }
  }

  function visibleTools() {
    return selectTools({
      query: state.query,
      filter: state.filter,
      favorites: getFavorites(),
      recent: getRecent(),
    });
  }

  function renderGrid() {
    const favs = getFavorites();
    const list = visibleTools();
    const soonList = roadmapVisible(state) ? SOON : [];

    grid.innerHTML = '';
    const total = list.length + soonList.length;

    count.textContent = t('toolbox.count', { n: list.length });

    if (total === 0) {
      empty.hidden = false;
      const key = state.query ? 'toolbox.empty.search'
        : state.filter === 'favorites' ? 'toolbox.empty.favorites' : 'toolbox.empty.recent';
      empty.innerHTML = `${icon('magnifier', { size: 72 })}
        <div class="ts-empty__text">${t(key, { q: state.query })}</div>`;
      return;
    }
    empty.hidden = true;
    if (state.query) {
      /* searching hides the roadmap row to keep the result list honest */
      count.textContent = t('toolbox.count', { n: list.length });
    }

    for (const tool of list) {
      const isFav = favs.includes(tool.slug);
      const card = document.createElement('div');
      card.className = 'ts-tool ts-tool--link';
      card.setAttribute('role', 'listitem');

      const link = document.createElement('a');
      link.className = 'ts-tool__link';
      link.href = `/${tool.slug}`;
      link.setAttribute('data-tip', descOf(tool));
      link.setAttribute('aria-label', `${labelOf(tool)} — ${descOf(tool)}`);
      link.addEventListener('click', () => recordUse(tool.slug));

      const img = document.createElement('img');
      img.className = 'ts-tool__art';
      img.src = `/assets/img/mascot/${tool.slug}.svg`;
      img.alt = '';
      img.setAttribute('aria-hidden', 'true');
      img.width = 56;
      img.height = 56;
      img.loading = 'lazy';
      /* A tool without its own illustration must fall back to the canonical
         character rather than leaving an empty chip, so adding a tool never
         requires a picture before it can ship. */
      img.addEventListener('error', () => {
        if (img.dataset.fallback === '1') { img.style.visibility = 'hidden'; return; }
        img.dataset.fallback = '1';
        img.src = '/assets/img/mascot/base.svg';
      });

      const name = document.createElement('span');
      name.className = 'ts-tool__name';
      name.textContent = labelOf(tool);

      const desc = document.createElement('span');
      desc.className = 'ts-tool__desc';
      desc.textContent = descOf(tool);

      link.append(img, name, desc);

      const star = document.createElement('button');
      star.type = 'button';
      star.className = `ts-star${isFav ? ' is-on' : ''}`;
      star.dataset.slug = tool.slug;
      star.setAttribute('aria-pressed', String(isFav));
      star.setAttribute('aria-label', isFav ? t('toolbox.favorite.remove') : t('toolbox.favorite.add'));
      star.title = isFav ? t('toolbox.favorite.remove') : t('toolbox.favorite.add');
      star.innerHTML = icon('sparkle', { size: 15 });
      star.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const next = toggleFavorite(tool.slug);
        const on = next.includes(tool.slug);
        star.classList.toggle('is-on', on);
        star.setAttribute('aria-pressed', String(on));
        star.setAttribute('aria-label', on ? t('toolbox.favorite.remove') : t('toolbox.favorite.add'));
        if (state.filter === 'favorites') renderGrid();
      });

      card.append(link, star);
      grid.append(card);
    }

    for (const item of soonList) {
      const card = document.createElement('div');
      card.className = 'ts-tool ts-tool--soon';
      card.setAttribute('role', 'listitem');
      card.setAttribute('aria-disabled', 'true');
      const inner = document.createElement('div');
      inner.className = 'ts-tool__link';
      inner.setAttribute('data-tip', t('toolbox.soonNote'));
      inner.innerHTML =
        `<span class="ts-tool__art ts-tool__art--soon">${icon(item.icon, { size: 34 })}</span>
         <span class="ts-tool__name">${soonLabelOf(item.id)}</span>
         <span class="ts-tool__badge">${t('toolbox.soon')}</span>`;
      card.append(inner);
      grid.append(card);
    }
  }

  /* Re-render on language change. The previous subscription is dropped first,
     otherwise every switch would add a listener holding a detached host. */
  if (unsubscribeLang) unsubscribeLang();
  unsubscribeLang = onLangChange(() => {
    unsubscribeLang = null;
    renderToolbox(host, opts);
  });
}

/* --------------------------------------------------------- desktop strip -- */

async function renderDesktopRow(row) {
  const desktop = isDesktop();
  const wrap = document.createElement('div');
  wrap.className = 'ts-desktopbar__inner';

  const art = document.createElement('img');
  art.src = '/assets/img/mascot/desktop.svg';
  art.alt = '';
  art.setAttribute('aria-hidden', 'true');
  art.width = 64;
  art.height = 64;
  art.className = 'ts-desktopbar__art';
  art.addEventListener('error', () => { art.style.display = 'none'; });

  const text = document.createElement('div');
  text.className = 'ts-desktopbar__text';
  const title = document.createElement('div');
  title.className = 'ts-desktopbar__title';
  title.textContent = t('toolbox.desktop.title');
  const body = document.createElement('div');
  body.className = 'ts-desktopbar__body';
  body.textContent = t('toolbox.desktop.body');
  const status = document.createElement('div');
  status.className = 'ts-field__hint';
  status.textContent = t('toolbox.desktop.unavailable');
  text.append(title, body, status);

  wrap.append(art, text);

  if (!desktop) {
    const cta = document.createElement('a');
    cta.className = 'ts-btn ts-btn--primary';
    cta.href = '/desktop';
    cta.innerHTML = `${icon('monitor', { size: 17 })}<span>${t('toolbox.desktop.cta')}</span>`;
    wrap.append(cta);
  } else {
    /* Inside the shell: report the live native-engine state instead of a download link.
       The desktop build copies the reference bridge (apps/desktop/bridge/toolseer-desktop.js)
       to this path; until it exists the import fails and we fall back to a plain statement. */
    status.textContent = t('toolbox.desktop.checking');
    try {
      const bridge = await import('/assets/js/ui/desktop-bridge.js').catch(() => null);
      if (bridge && typeof bridge.preflight === 'function') {
        const result = await bridge.preflight();
        status.textContent = result && result.ok ? t('toolbox.desktop.ready') : t('toolbox.desktop.notReady');
      } else {
        status.textContent = t('toolbox.desktop.notReady');
      }
    } catch {
      status.textContent = t('toolbox.desktop.notReady');
    }
  }

  row.append(wrap);
}

export default { renderToolbox, TOOLS, SOON, getFavorites, getRecent, recordUse };
