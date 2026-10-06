/**
 * shell.js — page chrome shared by every ToolSeer page.
 *
 * A page provides four empty containers and the shell fills them. Keeping the
 * chrome in one place is what lets eleven pages stay visually identical while
 * their editorial content (which must be real HTML for crawlers) stays in the
 * page itself.
 *
 * PAGE CONTRACT — every page includes exactly this skeleton:
 *   <div class="ts-app">
 *     <div class="ts-support" id="ts-support"></div>
 *     <aside class="ts-rail"  id="ts-rail" aria-label="Tool settings"></aside>
 *     <div class="ts-main">
 *       <header class="ts-header" id="ts-header"></header>
 *       <main class="ts-view" id="ts-main">
 *         …static, crawlable content…
 *         <footer class="ts-footer" id="ts-footer"></footer>
 *       </main>
 *     </div>
 *   </div>
 */
import { icon } from './icons.js';
import { t, reflect, langButton, onLangChange, getLang, toggleLang } from './i18n.js';

export const SITE = {
  name: 'ToolSeer',
  domain: 'toolseer.com',
  url: 'https://toolseer.com',
  version: '3.0.0',
  supportUrl: 'https://donatr.ee/sayfe',
  repoUrl: 'https://github.com/',
  releasesUrl: 'https://github.com/toolseer/toolseer-desktop/releases/latest',
};

/* ------------------------------------------------------------------ theme -- */

const THEME_KEY = 'toolseer:theme';

/**
 * Mascot SVGs use `currentColor` + `var(--ts-primary)` so they follow the
 * theme, but CSS variables and color do NOT cross into an <img>-embedded
 * document. This replaces every mascot <img> with the inlined SVG (fetched
 * from the same static file that remains the single source of truth), which
 * makes the theme contract work. Failure to fetch keeps the original <img>
 * (pages also carry an onerror guard). The files are same-origin static
 * assets we authored, so inlining them introduces no untrusted markup.
 */
export async function hydrateMascots(root = document) {
  const imgs = [...root.querySelectorAll('img[src*="/assets/img/mascot/"]')];
  await Promise.all(imgs.map(async (img) => {
    try {
      const res = await fetch(img.getAttribute('src'));
      if (!res.ok) return;
      const text = await res.text();
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      const svg = doc.documentElement;
      if (!svg || svg.nodeName.toLowerCase() !== 'svg') return;
      for (const attr of ['width', 'height', 'class']) {
        const v = img.getAttribute(attr);
        if (v) svg.setAttribute(attr, v);
      }
      svg.setAttribute('aria-hidden', 'true');
      svg.removeAttribute('alt');
      img.replaceWith(svg);
    } catch { /* keep the <img> fallback */ }
  }));
}

export function getTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* ignore */ }
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function setTheme(name) {
  document.documentElement.dataset.theme = name;
  try { localStorage.setItem(THEME_KEY, name); } catch { /* ignore */ }
  document.dispatchEvent(new CustomEvent('toolseer:theme', { detail: { theme: name } }));
}

/** Apply the resolved theme before first paint (call this from <head> inline). */
export function initTheme() { document.documentElement.dataset.theme = getTheme(); }

/* ------------------------------------------------------------------ modal -- */

let modalEl = null;

/**
 * @param {{title: string, body: string|Node, actions?: {label:string, variant?:string, onClick?:Function, href?:string}[], center?: boolean}} spec
 */
export function openModal(spec) {
  closeModal();
  modalEl = document.createElement('div');
  modalEl.className = 'ts-modal';
  modalEl.setAttribute('role', 'dialog');
  modalEl.setAttribute('aria-modal', 'true');
  modalEl.setAttribute('aria-label', spec.title);

  const panel = document.createElement('div');
  panel.className = `ts-modal__panel${spec.center ? ' ts-modal--center' : ''}`;

  const head = document.createElement('div');
  head.className = 'ts-modal__head';
  const title = document.createElement('h2');
  title.className = 'ts-modal__title';
  title.textContent = spec.title;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'ts-icon-btn';
  close.setAttribute('aria-label', t('action.close'));
  close.innerHTML = icon('x', { size: 18 });
  close.addEventListener('click', closeModal);
  head.append(title, close);

  const body = document.createElement('div');
  body.className = 'ts-modal__body';
  if (spec.body instanceof Node) body.append(spec.body);
  else body.innerHTML = spec.body;

  panel.append(head, body);

  if (spec.actions && spec.actions.length) {
    const foot = document.createElement('div');
    foot.className = 'ts-modal__foot';
    for (const a of spec.actions) {
      const btn = document.createElement(a.href ? 'a' : 'button');
      btn.className = `ts-btn ${a.variant ? 'ts-btn--' + a.variant : 'ts-btn--ghost'}`;
      btn.textContent = a.label;
      if (a.href) { btn.href = a.href; btn.target = '_blank'; btn.rel = 'noopener'; }
      else btn.type = 'button';
      if (a.onClick) btn.addEventListener('click', () => { a.onClick(); closeModal(); });
      foot.append(btn);
    }
    if (!spec.center) {
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'ts-btn ts-btn--ghost';
      cancel.textContent = t('action.close');
      cancel.addEventListener('click', closeModal);
      foot.append(cancel);
    }
    panel.append(foot);
  }

  modalEl.append(panel);
  modalEl.addEventListener('click', (e) => { if (e.target === modalEl) closeModal(); });
  document.body.append(modalEl);
  requestAnimationFrame(() => {
    const focusable = panel.querySelector('button, a, input, select, textarea');
    if (focusable) focusable.focus();
  });
}

export function closeModal() {
  if (modalEl) { modalEl.remove(); modalEl = null; }
}

/** One-time legal notice, remembered locally (no cookie, no server). */
export function maybeShowDisclaimer() {
  const KEY = 'toolseer:disclaimer-seen';
  let seen = false;
  try { seen = localStorage.getItem(KEY) === '1'; } catch { /* ignore */ }
  if (seen) return;
  openDisclaimer(() => { try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } });
}

export function openDisclaimer(onClose) {
  openModal({
    title: t('footer.disclaimer'),
    body: `<p>${t('footer.disclaimerBody')}</p><p>${t('privacy.body')}</p>`,
    actions: [{ label: t('action.close'), variant: 'primary', onClick: onClose }],
  });
}

export function openUpgrade() {
  openModal({
    title: t('upgrade.title'),
    body: `<p>${t('upgrade.body')}</p>`,
    center: true,
    actions: [{ label: t('bigfile.cta'), variant: 'primary', href: '/desktop' }],
  });
}

/* ------------------------------------------------------------------- nav -- */

const NAV = [
  { key: 'nav.tools', href: '/', icon: 'stack' },
  { key: 'nav.works', href: '/works', icon: 'sparkle' },
  { key: 'nav.contact', href: '/contact', icon: 'info' },
  { key: 'nav.desktop', href: '/desktop', icon: 'monitor' },
];

/* ------------------------------------------------------------------ shell -- */

/**
 * Fill the page chrome.
 * @param {{slug?: string, rail?: {title?: string, subtitle?: string}, onThemeChange?: Function}} [opts]
 * @returns {{railBody: HTMLElement, rerender: Function}}
 */
export function renderShell(opts = {}) {
  initTheme();
  reflect();

  const supportHost = document.getElementById('ts-support');
  const rail = document.getElementById('ts-rail');
  const header = document.getElementById('ts-header');
  const footer = document.getElementById('ts-footer');
  const app = document.querySelector('.ts-app');

  /* --- support strip --- */
  if (supportHost) {
    const KEY = 'toolseer:support-dismissed';
    let dismissed = false;
    try { dismissed = sessionStorage.getItem(KEY) === '1'; } catch { /* ignore */ }
    if (dismissed) {
      supportHost.remove();
    } else {
      supportHost.innerHTML =
        `${icon('heart', { size: 15, cls: 'ts-support__icon' })}` +
        `<span data-i18n="support.text">${t('support.text')}</span> ` +
        `<a href="${SITE.supportUrl}" target="_blank" rel="noopener" data-i18n="support.cta">${t('support.cta')}</a>`;
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'ts-support__close';
      close.setAttribute('aria-label', t('support.close'));
      close.innerHTML = icon('x', { size: 14 });
      close.addEventListener('click', () => {
        try { sessionStorage.setItem(KEY, '1'); } catch { /* ignore */ }
        supportHost.remove();
      });
      supportHost.append(close);
    }
  }

  /* --- header --- */
  if (header) {
    const burger = document.createElement('button');
    burger.type = 'button';
    burger.className = 'ts-burger';
    burger.setAttribute('aria-label', t('rail.title'));
    burger.innerHTML = icon('menu', { size: 20 });

    const brand = document.createElement('a');
    brand.className = 'ts-brand';
    brand.href = '/';
    brand.innerHTML =
      `<span class="ts-brand__mark">${icon('layers', { size: 21 })}</span>` +
      `<span class="ts-brand__name">${SITE.name}</span>`;

    const nav = document.createElement('nav');
    nav.className = 'ts-nav';
    nav.setAttribute('aria-label', t('nav.tools'));
    for (const item of NAV) {
      const a = document.createElement('a');
      a.className = 'ts-nav__link';
      a.href = item.href;
      if (opts.slug && item.href === `/${opts.slug}`) a.setAttribute('aria-current', 'page');
      a.innerHTML = `${icon(item.icon, { size: 17 })}<span data-i18n="${item.key}">${t(item.key)}</span>`;
      nav.append(a);
    }

    const spacer = document.createElement('div');
    spacer.className = 'ts-header__spacer';

    const actions = document.createElement('div');
    actions.className = 'ts-header__actions';
    actions.append(langButton());

    const upgrade = document.createElement('button');
    upgrade.type = 'button';
    upgrade.className = 'ts-btn ts-btn--primary ts-btn--sm';
    upgrade.innerHTML = `${icon('rocket', { size: 16 })}<span data-i18n="upgrade.label">${t('upgrade.label')}</span>`;
    upgrade.addEventListener('click', openUpgrade);
    actions.append(upgrade);

    header.append(burger, brand, nav, spacer, actions);

    /* mobile drawer */
    const scrim = document.createElement('div');
    scrim.className = 'ts-rail__scrim';
    scrim.hidden = true;
    const openRail = () => {
      rail.classList.add('is-open');
      scrim.hidden = false;
      burger.setAttribute('aria-expanded', 'true');
    };
    const closeRail = () => {
      rail.classList.remove('is-open');
      scrim.hidden = true;
      burger.setAttribute('aria-expanded', 'false');
    };
    burger.setAttribute('aria-expanded', 'false');
    burger.addEventListener('click', () => (rail.classList.contains('is-open') ? closeRail() : openRail()));
    scrim.addEventListener('click', closeRail);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeRail(); closeModal(); } });
    if (app) app.append(scrim);
  }

  /* --- settings rail --- */
  let railBody = null;
  if (rail) {
    rail.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'ts-rail__head';
    const mark = document.createElement('span');
    mark.className = 'ts-brand__mark';
    mark.innerHTML = icon('sliders', { size: 20 });
    const text = document.createElement('div');
    const h2 = document.createElement('h2');
    h2.className = 'ts-rail__title';
    h2.textContent = (opts.rail && opts.rail.title) || t('rail.title');
    const sub = document.createElement('div');
    sub.className = 'ts-rail__sub';
    sub.textContent = (opts.rail && opts.rail.subtitle) || t('rail.subtitle');
    text.append(h2, sub);
    head.append(mark, text);

    railBody = document.createElement('div');
    railBody.className = 'ts-rail__body';
    railBody.id = 'ts-rail-body';

    const foot = document.createElement('div');
    foot.className = 'ts-rail__foot';

    const themeSeg = document.createElement('div');
    themeSeg.className = 'ts-segment ts-segment--icon';
    themeSeg.setAttribute('role', 'group');
    themeSeg.setAttribute('aria-label', t('theme.label'));
    const mk = (name, ico, key) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ts-segment__btn';
      b.dataset.themeValue = name;
      b.setAttribute('aria-pressed', String(getTheme() === name));
      b.setAttribute('aria-label', t(key));
      b.title = t(key);
      b.innerHTML = icon(ico, { size: 17 });
      b.addEventListener('click', () => {
        setTheme(name);
        themeSeg.querySelectorAll('[data-theme-value]').forEach((x) =>
          x.setAttribute('aria-pressed', String(x.dataset.themeValue === name)));
        if (opts.onThemeChange) opts.onThemeChange(name);
      });
      return b;
    };
    themeSeg.append(mk('light', 'sun', 'theme.light'), mk('dark', 'moon', 'theme.dark'));

    const version = document.createElement('div');
    version.className = 'ts-rail__version';
    version.textContent = `${SITE.name} · v${SITE.version}`;

    const legal = document.createElement('div');
    legal.className = 'ts-rail__legal';
    const disclaimerBtn = document.createElement('button');
    disclaimerBtn.type = 'button';
    disclaimerBtn.setAttribute('data-i18n', 'footer.disclaimer');
    disclaimerBtn.textContent = t('footer.disclaimer');
    disclaimerBtn.addEventListener('click', () => openDisclaimer());
    legal.append(disclaimerBtn);

    foot.append(themeSeg, version, legal);
    rail.append(head, railBody, foot);
  }

  /* --- footer --- */
  if (footer) {
    const tools = [
      ['image-to-pdf', 'tool.image-to-pdf.title'],
      ['merge-pdf', 'tool.merge-pdf.title'],
      ['compress-pdf', 'tool.compress-pdf.title'],
      ['split-pdf', 'tool.split-pdf.title'],
      ['pdf-to-images', 'tool.pdf-to-images.title'],
      ['organize-pdf', 'tool.organize-pdf.title'],
    ];
    footer.innerHTML =
      `<div class="ts-footer__col">
         <div class="ts-footer__strong">${SITE.name}</div>
         <div data-i18n="footer.tagline">${t('footer.tagline')}</div>
         <div data-i18n="footer.builtWith">${t('footer.builtWith')}</div>
       </div>
       <div class="ts-footer__col">
         <div class="ts-footer__strong" data-i18n="footer.tools">${t('footer.tools')}</div>
         <div class="ts-footer__links">
           ${tools.map(([slug, key]) => `<a href="/${slug}">${t(key)}</a>`).join('')}
           <a href="/" data-i18n="nav.tools">${t('nav.tools')}</a>
         </div>
       </div>
       <div class="ts-footer__col">
         <div class="ts-footer__strong" data-i18n="footer.legal">${t('footer.legal')}</div>
         <div class="ts-footer__links">
           <a href="/privacy" data-i18n="nav.privacy">${t('nav.privacy')}</a>
           <a href="/terms" data-i18n="nav.terms">${t('nav.terms')}</a>
           <a href="/contact" data-i18n="nav.contact">${t('nav.contact')}</a>
         </div>
       </div>`;
  }

  /* mascots must become inline SVGs to follow the theme (see hydrateMascots) */
  hydrateMascots().catch(() => { /* <img> fallback stays */ });

  return { railBody, rerender: () => reflect() };
}

/** Let pages react to language changes without wiring their own listeners. */
export { onLangChange, getLang, toggleLang };

export function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html != null) node.innerHTML = html;
  return node;
}

export default { renderShell, openModal, closeModal, openDisclaimer, openUpgrade, setTheme, getTheme, initTheme, SITE, el };
