/**
 * pwa.js — the install experience, plus the legacy-takeover path.
 *
 * WHY THIS FILE EXISTS
 * The old Blogger page let people install it as an app (apple-mobile-web-app-capable,
 * an inline apple-touch-icon, a blob manifest and a blob-URL service worker) and
 * `start_url` was `window.location.href` — so an existing install points at whatever
 * URL it was created from. This module makes the new site installable again on the
 * same origin, and removes any old service-worker registration that is not /sw.js.
 *
 * CONTRACT
 *   `initPwa()` takes no arguments, renders nothing, returns one API object, and
 *   never throws. Anything the browser does not support degrades to "no install UI"
 *   (canInstall() false, isIosInstallable() false) — never to an exception.
 *
 * HOW THE SHELL SHOULD WIRE IT (two lines, no DOM ownership here):
 *
 *   import { initPwa } from '/assets/js/ui/pwa.js';
 *   const pwa = initPwa();
 *
 *   if (pwa.canInstall())            showInstallButton(() => pwa.promptInstall());
 *   else if (pwa.isIosInstallable()) showIosInstructions(pwa.iosInstallSteps);
 *   // else: render nothing at all. There is no dead button to explain away.
 *
 * Strings: `iosInstallSteps` are English fallbacks so the feature works before any
 * translation exists. `iosInstallStepKeys` are the matching i18n keys; if the shell
 * prefers translations, map key → step and fall back to the English text:
 *
 *   const steps = pwa.iosInstallSteps.map((en, i) => t(pwa.iosInstallStepKeys[i]) || en);
 *
 * RECOMMENDED HEAD SNIPPET (the Lead adds this to index.html — it is not ours):
 * `beforeinstallprompt` can fire before a deferred module runs. Capturing it early
 * makes the install button reliable:
 *
 *   <script>window.addEventListener('beforeinstallprompt',function(e){
 *     e.preventDefault(); window.__toolseerInstallPrompt = e; });</script>
 *
 * This module adopts that value if it is present, and installs its own listener too,
 * so it works with or without the snippet.
 */

/** The only service worker we ever own. Anything else is a legacy leftover. */
const SW_URL = '/sw.js';

/** localStorage flag set by `?sw=off`, cleared by `?sw=on`. Support escape hatch. */
const SW_OPT_OUT_KEY = 'toolseer:sw';

/** Slot the optional head snippet uses to hand us an early install prompt. */
const PRE_CAPTURED_SLOT = '__toolseerInstallPrompt';

/** iOS has no beforeinstallprompt; these are the exact user steps.
    Exported both as named constants and on the API object so the shell can use
    whichever import style it already has. */
export const iosInstallSteps = Object.freeze([
  'Open the Share menu: tap the Share button in the toolbar (the square with an arrow pointing up).',
  'In the share sheet, scroll down and tap "Add to Home Screen".',
  'Tap "Add" in the top corner. The ToolSeer icon appears on your home screen.',
  'Open ToolSeer from that icon — it starts full screen, like an app.',
]);

export const iosInstallStepKeys = Object.freeze([
  'pwa.ios.step1',
  'pwa.ios.step2',
  'pwa.ios.step3',
  'pwa.ios.step4',
]);

/* ------------------------------------------------------------------ state -- */

/** The captured `beforeinstallprompt` event; single-use, per Chrome's model. */
let deferredPrompt = null;
/** True once `appinstalled` fired in this page's lifetime. */
let installedThisSession = false;
let started = false;
let registrationPromise = null;
let controllerChangeWatched = false;

const changeListeners = new Set();
const installedListeners = new Set();
const controllerListeners = new Set();

/* --------------------------------------------------------------- utilities -- */

function hasWindow() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/** Run `fn`, and on any failure return `fallback`. Nothing here may throw. */
function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function userAgent() {
  return safe(() => navigator.userAgent, '') || '';
}

/* ----------------------------------------------------------- environment -- */

/** iPadOS 13+ reports itself as a Mac, so the touch-point check matters. */
export function isIos() {
  const ua = userAgent();
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  return safe(() => navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1, false);
}

/** In-app browsers (Facebook, Instagram, …) cannot add to the home screen. */
export function isInAppBrowser() {
  return /(FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|Twitter)/i.test(userAgent());
}

/** Already running as an installed app (either display mode, or an iOS web clip). */
export function isStandalone() {
  if (!hasWindow()) return false;
  return safe(
    () =>
      Boolean(
        (window.matchMedia &&
          (window.matchMedia('(display-mode: standalone)').matches ||
            window.matchMedia('(display-mode: window-controls-overlay)').matches)) ||
          navigator.standalone === true ||
          String(document.referrer || '').indexOf('android-app://') === 0
      ),
    false
  );
}

/** True when the browser gave us a real install prompt we may replay on a click. */
export function canInstall() {
  return !isStandalone() && deferredPrompt !== null;
}

/** iOS Safari (and iOS Chrome) path: manual instructions instead of a prompt. */
export function isIosInstallable() {
  return isIos() && !isStandalone() && !isInAppBrowser();
}

export function getIosInstallSteps() {
  return iosInstallSteps.slice();
}

export function getIosInstallStepKeys() {
  return iosInstallStepKeys.slice();
}

/* ------------------------------------------------------------ state events -- */

function currentState() {
  return Object.freeze({
    canInstall: canInstall(),
    isIosInstallable: isIosInstallable(),
    isInstalled: isStandalone() || installedThisSession,
    isIos: isIos(),
    isInAppBrowser: isInAppBrowser(),
  });
}

function emit() {
  const state = currentState();
  for (const cb of Array.from(changeListeners)) safe(() => cb(state));
  safe(() =>
    document.dispatchEvent(new CustomEvent('toolseer:pwa', { detail: state }))
  );
}

/** Subscribe to install-availability changes. Returns an unsubscribe function. */
export function onChange(cb) {
  if (typeof cb !== 'function') return () => {};
  changeListeners.add(cb);
  return () => changeListeners.delete(cb);
}

/** Run `cb` when the app gets installed (`appinstalled`). Returns unsubscribe. */
export function onInstalled(cb) {
  if (typeof cb !== 'function') return () => {};
  installedListeners.add(cb);
  return () => installedListeners.delete(cb);
}

/** Run `cb` when a new worker takes control. Returns unsubscribe.
    We deliberately do NOT reload the page here: a reload would throw away files
    the user has already queued in a tool. The shell decides what to say. */
export function onControllerChange(cb) {
  if (typeof cb !== 'function') return () => {};
  controllerListeners.add(cb);
  return () => controllerListeners.delete(cb);
}

function fireInstalled() {
  for (const cb of Array.from(installedListeners)) safe(() => cb({ installed: true }));
}

/* ------------------------------------------------------- install prompting -- */

function adoptPrompt(event) {
  if (!event || typeof event.prompt !== 'function') return;
  // Suppress Chrome's own mini-infobar; the shell renders its own affordance.
  safe(() => event.preventDefault());
  deferredPrompt = event;
  emit();
}

/**
 * Replay the captured install prompt. Single-use, never throws, and always
 * resolves to a plain result the caller can show:
 *   { outcome: 'accepted' | 'dismissed' | 'unavailable' | 'error' }
 */
export async function promptInstall() {
  if (!deferredPrompt) return { outcome: 'unavailable' };
  const prompt = deferredPrompt;
  // Chrome allows a prompt to be used once; clear it so no dead button remains.
  deferredPrompt = null;
  emit();
  try {
    prompt.prompt();
    const choice = await prompt.userChoice;
    return { outcome: (choice && choice.outcome) || 'dismissed' };
  } catch (err) {
    return { outcome: 'error', error: String((err && err.message) || err) };
  }
}

/* ------------------------------------------------------- service worker ---- */

function scriptPath(url) {
  return safe(() => new URL(url).pathname, null);
}

function queryFlag(name) {
  return safe(() => new URLSearchParams(window.location.search).get(name), null);
}

function readOptOut() {
  return safe(() => window.localStorage.getItem(SW_OPT_OUT_KEY) === 'off', false);
}

function rememberOptOut() {
  safe(() => window.localStorage.setItem(SW_OPT_OUT_KEY, 'off'));
}

function clearOptOut() {
  safe(() => window.localStorage.removeItem(SW_OPT_OUT_KEY));
}

/**
 * LEGACY TAKEOVER. A registration is keyed by scope, not by script URL, so an
 * old worker registered at `/` would otherwise keep answering before ours. Any
 * registration whose script is not /sw.js — including a legacy `blob:` script,
 * whose pathname is a UUID — is unregistered first.
 */
async function releaseForeignWorkers() {
  const released = [];
  try {
    if (!navigator.serviceWorker || !navigator.serviceWorker.getRegistrations) return released;
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
      const workers = [registration.installing, registration.waiting, registration.active].filter(Boolean);
      const foreign = workers.some((worker) => scriptPath(worker.scriptURL) !== SW_URL);
      if (foreign) released.push(await registration.unregister().catch(() => false));
    }
  } catch {
    /* takeover is best-effort; it must never block registration */
  }
  return released;
}

/** `?sw=off` without an active worker: drop every registration and cache. */
async function releaseEverything() {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister().catch(() => false)));
  } catch {
    /* ignore */
  }
  try {
    if (window.caches && typeof window.caches.keys === 'function') {
      const keys = await window.caches.keys();
      await Promise.all(keys.map((key) => window.caches.delete(key).catch(() => false)));
    }
  } catch {
    /* ignore */
  }
}

function watchController() {
  if (controllerChangeWatched) return;
  if (!navigator.serviceWorker || !navigator.serviceWorker.addEventListener) return;
  controllerChangeWatched = true;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    emit();
    for (const cb of Array.from(controllerListeners)) safe(() => cb());
  });
}

/**
 * Register /sw.js, but only where a service worker can exist at all.
 *   - http(s) only (blob:, file:, data: are skipped, never attempted)
 *   - `?sw=off`  → unregister everything and remember the opt-out
 *   - `?sw=on`   → forget the opt-out and register again
 */
export function registerServiceWorker() {
  if (registrationPromise) return registrationPromise;
  registrationPromise = (async () => {
    try {
      if (!hasWindow()) return null;
      if (!('serviceWorker' in navigator)) return null;
      const protocol = safe(() => window.location.protocol, '');
      if (protocol !== 'http:' && protocol !== 'https:') return null;

      if (queryFlag('sw') === 'off') {
        rememberOptOut();
        await releaseEverything();
        return null;
      }
      if (queryFlag('sw') === 'on') clearOptOut();
      if (readOptOut()) return null;

      await releaseForeignWorkers();
      const registration = await navigator.serviceWorker.register(SW_URL);
      watchController();
      return registration;
    } catch {
      // No install UI, no worker, no exception. The site works without both.
      return null;
    }
  })();
  return registrationPromise;
}

/** True while `?sw=off` is remembered in this browser. */
export function isServiceWorkerOff() {
  return readOptOut();
}

/** The registration promise (or null when registration never started). */
export function getRegistration() {
  return registrationPromise;
}

/* ------------------------------------------------------------------ public -- */

/**
 * Wire everything up. No arguments, no rendering, never throws, idempotent.
 * Returns the frozen API object the shell talks to.
 */
export function initPwa() {
  if (started) return api;
  started = true;

  if (hasWindow()) {
    // 1. Adopt an early capture from the optional head snippet, if present.
    const preCaptured = safe(() => window[PRE_CAPTURED_SLOT], null);
    if (preCaptured) adoptPrompt(preCaptured);

    // 2. Listen ourselves, so the module works even without the snippet.
    safe(() =>
      window.addEventListener('beforeinstallprompt', (event) => adoptPrompt(event))
    );
    safe(() =>
      window.addEventListener('appinstalled', () => {
        installedThisSession = true;
        deferredPrompt = null;
        emit();
        fireInstalled();
      })
    );

    // 3. Register (or release) the worker.
    try {
      registerServiceWorker();
    } catch {
      /* already handled inside */
    }

    // Let listeners attached immediately after initPwa() receive one state event.
    safe(() => Promise.resolve().then(emit));
  }

  return api;
}

/** Frozen public surface. Every member is safe to call in any environment. */
const api = Object.freeze({
  initPwa,
  canInstall,
  promptInstall,
  isStandalone,
  isIosInstallable,
  isIos,
  isInAppBrowser,
  getIosInstallSteps,
  getIosInstallStepKeys,
  iosInstallSteps,
  iosInstallStepKeys,
  onChange,
  onInstalled,
  onControllerChange,
  registerServiceWorker,
  getRegistration,
  isServiceWorkerOff,
  serviceWorkerUrl: SW_URL,
});

export default api;
