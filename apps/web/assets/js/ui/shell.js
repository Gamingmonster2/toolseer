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
import { t, reflect, langButton, onLangChange, getLang, toggleLang, hasKey } from './i18n.js';

export const SITE = {
  name: 'ToolSeer',
  domain: 'toolseer.com',
  url: 'https://toolseer.com',
  version: '3.0.0',
  supportUrl: 'https://donatr.ee/sayfe',
  repoUrl: 'https://github.com/',
  releasesUrl: 'https://github.com/toolseer/toolseer-desktop/releases/latest',
};

/** True when this same page is running inside the Tauri desktop shell. */
export const isDesktop = () => typeof window !== 'undefined' && Boolean(window.__TAURI__);

/**
 * The preserved old tool ("النسخة القديمة").
 *
 * The plan: the new site takes the main domain, and the original single page is
 * kept alive on a subdomain with a link to it from the top of the new site. The
 * link stays hidden while `url` is null, because a link to a site that does not
 * exist yet is a dead button. Set it on the day the subdomain is live:
 *
 *   url: 'https://old.toolseer.com'
 */
export const LEGACY_SITE = {
  url: null,
  labelKey: 'legacy.label',
  textKey: 'legacy.text',
};

/**
 * Slim bar at the very top offering the preserved old tool. Renders nothing
 * unless LEGACY_SITE.url is set. It sits below the desktop window toolbar so the
 * native chrome stays where the operating system expects it.
 */
function renderLegacyBar(app) {
  if (!app || !LEGACY_SITE.url) return;
  const bar = document.createElement('div');
  bar.className = 'ts-legacybar';
  const text = document.createElement('span');
  text.className = 'ts-legacybar__text';
  text.textContent = t(LEGACY_SITE.textKey);
  const link = document.createElement('a');
  link.className = 'ts-legacybar__link';
  link.href = LEGACY_SITE.url;
  link.rel = 'noopener';
  link.innerHTML = `${icon('arrow-right', { size: 14 })}<span>${t(LEGACY_SITE.labelKey)}</span>`;
  bar.append(text, link);
  const titlebar = app.querySelector('.ts-titlebar');
  if (titlebar) titlebar.after(bar);
  else app.prepend(bar);
}

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
 * The desktop shell gets a real window toolbar (home / back / forward / reload
 * on the left, minimise / close on the right) — the pattern the owner's
 * reference app uses. On the web this renders nothing at all: no dead buttons.
 */
function renderTitlebar(app) {
  if (!app || !isDesktop()) return;

  const bar = document.createElement('div');
  bar.className = 'ts-titlebar';

  const mk = (ico, label, onClick, extra = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `ts-titlebar__btn${extra ? ' ' + extra : ''}`;
    b.setAttribute('aria-label', label);
    b.title = label;
    b.innerHTML = icon(ico, { size: 17 });
    b.addEventListener('click', () => { try { onClick(); } catch { /* shell API missing */ } });
    return b;
  };

  const home = () => { window.location.href = '/'; };
  const go = (dir) => { if (dir === 'back') window.history.back(); else window.history.forward(); };

  bar.append(
    mk('house', t('titlebar.home'), home),
    mk('arrow-left', t('titlebar.back'), () => go('back')),
    mk('arrow-right', t('titlebar.forward'), () => go('forward')),
    mk('arrow-clockwise', t('titlebar.reload'), () => window.location.reload()),
  );

  const spacer = document.createElement('div');
  spacer.className = 'ts-titlebar__spacer';
  const title = document.createElement('div');
  title.className = 'ts-titlebar__title';
  title.textContent = `${SITE.name} ${SITE.version}`;
  const spacer2 = document.createElement('div');
  spacer2.className = 'ts-titlebar__spacer';
  bar.append(spacer, title, spacer2);

  /* Window controls go through the shell API when it is actually present. */
  const appWindow = () => {
    const api = window.__TAURI__ && window.__TAURI__.window;
    if (!api) return null;
    if (typeof api.getCurrentWindow === 'function') return api.getCurrentWindow();
    if (typeof api.getCurrent === 'function') return api.getCurrent();
    return null;
  };
  bar.append(
    mk('minus', t('titlebar.minimize'), () => appWindow()?.minimize()),
    mk('x', t('titlebar.close'), () => appWindow()?.close(), 'ts-titlebar__close'),
  );

  app.prepend(bar);
}

/**
 * Swap the placeholder brand glyph for the real logo file when it exists, so
 * the mark can be redrawn without touching any page.
 */
async function hydrateBrandMark() {
  const holder = document.querySelector('.ts-brand__mark');
  if (!holder) return;
  try {
    const res = await fetch('/assets/img/brand/mark.svg');
    if (!res.ok) return;
    const text = await res.text();
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svg = doc.documentElement;
    if (!svg || svg.nodeName.toLowerCase() !== 'svg') return;
    svg.setAttribute('width', '22');
    svg.setAttribute('height', '22');
    svg.setAttribute('aria-hidden', 'true');
    holder.innerHTML = '';
    holder.append(svg);
  } catch { /* keep the built-in glyph */ }
}

/**
 * Install-to-home-screen affordance, wired to pwa.js. Nothing renders unless the
 * browser can actually install (or is iOS, where a manual path exists) — no dead
 * buttons, and any missing API degrades to no UI rather than an exception.
 */
async function wireInstallButton(actions) {
  try {
    const pwa = await import('./pwa.js');
    if (!pwa || typeof pwa.initPwa !== 'function') return;
    const api = pwa.initPwa();

    const mount = (state) => {
      const existing = actions.querySelector('.ts-install');
      const showNative = Boolean(state && state.canInstall);
      const showIos = Boolean(state && !state.isInstalled && !state.canInstall && state.isIosInstallable);
      if (!showNative && !showIos) { if (existing) existing.remove(); return; }
      if (existing) return;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ts-btn ts-btn--ghost ts-btn--sm ts-install';
      btn.innerHTML = `${icon('download', { size: 16 })}<span>${t('pwa.install')}</span>`;
      btn.addEventListener('click', async () => {
        if (showNative) {
          const result = await api.promptInstall();
          if (result && result.outcome === 'accepted') btn.remove();
          return;
        }
        const keys = typeof api.getIosInstallStepKeys === 'function' ? api.getIosInstallStepKeys() : [];
        const steps = typeof api.getIosInstallSteps === 'function' ? api.getIosInstallSteps() : [];
        const list = steps.length
          ? `<ol>${steps.map((step, i) => `<li>${keys[i] && hasKey(keys[i]) ? t(keys[i]) : step}</li>`).join('')}</ol>`
          : '';
        openModal({ title: t('pwa.howto.title'), body: `<p>${t('pwa.howto.ios')}</p>${list}` });
      });

      const lang = actions.querySelector('.ts-lang');
      if (lang) lang.after(btn);
      else actions.prepend(btn);
    };

    if (typeof api.onChange === 'function') api.onChange(mount);
    if (typeof api.onInstalled === 'function') {
      api.onInstalled(() => actions.querySelector('.ts-install')?.remove());
    }
    /* initial state — initPwa already emitted once, but be explicit */
    mount({ canInstall: api.canInstall(), isInstalled: api.isStandalone(), isIosInstallable: api.isIosInstallable() });
  } catch { /* PWA module unavailable — no install UI, no error */ }
}

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
  renderTitlebar(app);
  renderLegacyBar(app);

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
    wireInstallButton(actions);

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
  hydrateBrandMark().catch(() => { /* built-in glyph stays */ });

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
