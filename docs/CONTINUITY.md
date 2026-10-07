# ToolSeer V3 — Continuity Plan for the Existing (Blogger) Audience

**Owner's requirement, in his words:** the old Blogger site has an audience, some of whom
installed it as a web app. The new site must be **better**, must be **easy to install as an
app**, and must **not make those people lose anything**.

This document is the plan for that requirement. It states what we know from evidence, what we
are doing about it, what the owner must do, how to verify it with a real user, and — just as
importantly — **what we cannot know and cannot promise**.

Status: written by `pwa-continuity` (task-8). Files: `apps/web/manifest.webmanifest`,
`apps/web/sw.js`, `apps/web/offline.html`, `apps/web/assets/js/ui/pwa.js`, `apps/web/_redirects`,
this document. The Lead wires the HTML; see §11.

---

## 1. What the old site actually did (evidence, not assumption)

All line numbers refer to `toolseer.txt` (the frozen legacy source).

| Legacy code | Line | Consequence today |
|---|---|---|
| `theme-color #0040ff`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style`, `apple-mobile-web-app-title`, inline **base64 apple-touch-icon** | 9–13 | This is the **iOS home-screen web clip** recipe, complete. iOS users who used Share → Add to Home Screen got a real standalone icon. |
| Inline base64 PNG `icon` | 14 | No fetchable icon file exists at any URL. |
| Manifest built as a **Blob** (`new Blob`, `URL.createObjectURL`, `<link rel="manifest">`) | 28–33 | The manifest URL is `blob:…`, not a same-origin `http(s)` URL. Browsers do not treat a blob manifest as an installable manifest, so Chrome's "Install app" path was effectively unavailable. |
| `start_url: window.location.href` | 21 | **Whatever URL the user installed from is baked into the shortcut.** This is the single most important fact in this document. |
| `icons: [{ src: "data:image/png;base64,…" }]` | 25 | A `data:` URL is not a usable manifest icon. |
| Service worker registered from a **Blob URL** (`navigator.serviceWorker.register(URL.createObjectURL(swBlob))`) | 35–41 | The registration **fails** — a worker script must be a same-origin `http(s)` URL. So the old page most likely left **no registration and no caches** behind. |
| The blob worker's `fetch` handler was empty (`e => {}`) | 36 | Even if it had registered, it cached nothing. |
| Meta viewport with `maximum-scale=1.0, user-scalable=no` | 230 | Old behaviour. The new site does not do this (accessibility win, no continuity impact). |
| `google-adsense-platform-domain: blogspot.com`, Blogger cookie script | 369, 1220 | It is a Blogger-hosted page (`*.blogspot.com` and/or a Blogger-mapped custom domain). |
| Sections `#view-converter`, `#view-works`, `#view-contact` | 544, 597, 637 | The old "pages" were in-page fragments on one URL. |
| CDN scripts: Tailwind, jsPDF, Phosphor | 240–244 | The old site needed the network for its UI. The new one does not (no runtime CDN), which is what makes real offline use possible. |

**The practical conclusion.** The likely existing installs are:

1. **iOS home-screen web clips** (strongly indicated by the apple-* meta tags and base64
   apple-touch-icon). A web clip stores its own icon and its own URL and does not read a manifest.
2. **Android Chrome "Add to Home screen" shortcuts** — also just a URL, opened in Chrome.
3. **Chrome/Edge "Install app"**: unlikely to have completed, because the manifest and the
   worker were both blob URLs. *We cannot prove this from here; it is an inference from the code.*

Either way, an existing install is a **URL on one origin** — not a manifest, not a cache. That is
why the whole continuity strategy is "keep the origin, and make every old URL lead somewhere good."

---

## 2. The one-line answer to "will existing users lose anything?"

**No — provided the domain does not change.** An installed shortcut is (origin + URL). We keep the
origin, and `_redirects` maps every legacy Blogger URL shape to `/`. The old icon keeps launching,
and it now lands on the new hub. Nothing about the old install needs to be deleted or reinstalled
for that to work.

What we **cannot** do retroactively is re-key an existing install to the new manifest. See §4.4
for exactly when that does and does not happen.

---

## 3. Why the new site keeps working for those people

1. **Same origin.** `toolseer.com` stays `toolseer.com`. Origin is the identity of an installed
   shortcut and of a service-worker registration. Changing the hostname would break every existing
   install; keeping it is the whole game.
2. **Every legacy path resolves.** `_redirects` covers Blogger's shapes: `/p/*`, `/YYYY/MM/slug.html`,
   `/YYYY/MM/DD/slug.html`, `/YYYY/MM/`, `/feeds/*`, `/feed`, `/search`, `/search/label/*`,
   `/index.html`, `/home`, plus the old single-page entry points (`/convert`, `/converter`,
   `/our-works`, `/contact-us`). Cloudflare matches **first rule wins**, so the real routes are listed
   first and no dynamic rule can shadow them. Two deliberate omissions, both documented in the file:
   * `/YYYY/` (the *yearly* archive) is **not** covered. A one-segment placeholder rule would match
     every one-segment path on the site — `/sw.js`, `/robots.txt`, `/sitemap.xml`, `/offline.html`
     and every tool route — if Cloudflare ever folds trailing slashes while matching. The downside is
     catastrophic, the upside is one rare URL shape, so the rule is not there. If the owner's archive
     widget is set to yearly, add literal years (`/2019/* / 301`, …).
   * `/vendor/vendor.lock.json` (a build artifact no page fetches) does match the two-segment
     `/:year/:month` rules and 301s to the hub. Stated here so it is a known side effect rather than
     a surprise; the file documents the one-line remedy if it matters.
3. **Fragments survive the redirect.** Cloudflare never evaluates `#…`; the browser does. A redirect
   whose `Location` has no fragment keeps the original one, so an old bookmark
   `/p/toolseer.html#view-works` becomes `/#view-works` and lands on the new hub. The old anchors
   themselves need no rule and no new page — documenting that here is the correct "handling".
4. **`?m=1` still works.** Cloudflare cannot match query strings, so there is no rule for it — and
   none is needed. `/ / 200` already serves the responsive hub; `?m=1` is inert. Offline, `sw.js`
   matches cached pages with `ignoreSearch`, so `/?m=1` opens the cached hub too.
5. **Network-first HTML.** The service worker never answers a navigation from cache while the
   network is up. An old install therefore cannot be pinned to a stale copy of the site — which is
   precisely the failure mode that would "make them lose" the improvement.
6. **Real installability, properly declared.** `manifest.webmanifest` has a stable `id: "/"`,
   `start_url: "/"`, `scope: "/"`, `#0040ff` theme colour, real 192/512/maskable PNG icons, and ten
   `shortcuts` so an installed app can jump straight into a tool.
7. **An honest offline page.** `/offline.html` is styled with the same design system, needs no
   JavaScript, explains what does and does not work offline, and offers a retry. The worker caches
   it at install time.

---

## 4. The stale-cache takeover sequence, step by step

### 4.1 Before the deploy (what is on a user's phone today)
* The icon exists; **no service worker registration**, therefore **no caches** (the blob
  registration was rejected).
* If, unusually, some registration does exist on the origin, it lives at scope `/` — a scope is
  what matters, not the script URL.

### 4.2 First load of the new site
1. The page runs `initPwa()` (`assets/js/ui/pwa.js`).
2. `releaseForeignWorkers()` iterates `navigator.serviceWorker.getRegistrations()` and
   **unregisters any registration whose `scriptURL` pathname is not `/sw.js`** — this is the
   legacy-takeover path, and it also catches a `blob:` scriptURL (its pathname is a UUID).
3. It then calls `navigator.serviceWorker.register('/sw.js')` — http/https only, and never when
   `?sw=off` is present or remembered.

### 4.3 The new worker takes over
4. `install`: precache the shell (hub, all tool routes, the UI modules, the stylesheet, the offline
   page). A URL that is unavailable is logged and skipped — a missing page can never fail the
   install. Then **`skipWaiting()`**.
5. `activate`: **delete every cache that is not in the current version list** (this is what evicts
   anything a legacy worker left behind), then **`clients.claim()`** so the pages already open are
   controlled by the new worker.
6. The page that is *currently* open keeps running the code it already loaded. Its next navigation
   is served **network-first** by the new worker, so the user sees the new site. **We deliberately
   do not force a reload** on `controllerchange`: a reload would discard files the user has already
   queued in a tool. That is exactly the "don't make them lose anything" rule applied to the app
   itself. The shell may show a non-blocking "a new version is ready" note instead.

### 4.4 Browser install entry: matched or not
* Chrome keys an installed app by its manifest `id`, which defaults to the resolved `start_url`.
* If the old install was made from `https://toolseer.com/` exactly, our `id: "/"` resolves to the
  same app id, and Chrome **may** treat the new manifest as an update of the same app (new name,
  icons, theme colour).
* If the old install was made from any other URL (`…/p/toolseer.html`, `…/?m=1`, a dated post…), the
  derived id differs, so the browser sees **two** apps: the old entry (which still works, now
  redirected to the hub) and the new one after install. Nothing is destroyed; the user may remove
  the old entry whenever they like. **We do not promise an in-place upgrade** — we promise that the
  old icon keeps working and that the new app is easy to install.

### 4.5 iOS
The iOS web clip keeps its stored icon and URL. A manifest is only partially consulted by iOS. The
continuity guarantee is therefore the URL redirect plus the fact that the new page keeps
`apple-touch-icon` and `apple-mobile-web-app-title` ("ToolSeer"), so the app *name* stays the same.
New installs get the new icon; existing clips keep the icon they already stored.

---

## 5. What the owner must do

### Must
1. **Do not change the domain.** Keep `toolseer.com` as the hostname. Existing installs and any
   existing service-worker scope are keyed to it.
2. **Publish the new site on that same origin** — Cloudflare Pages, output directory `apps/web`,
   no build command.
3. **Keep HTTPS on.** Service workers and installability require a secure context, and the
   install prompt will not appear otherwise.
4. **Send the real URL list** (see §7) so §3.2 becomes evidence instead of inference.
5. **Decide what happens to the old blog posts** (§5.3 below). This is a genuine either/or, not a
   detail.

### Should
6. In Blogger, if the blog was also reachable at `*.blogspot.com`, use Blogger's own
   publish/redirect setting so the blogspot hostname points at the custom domain. Our
   `_redirects` file only ever applies to the Cloudflare project's own hostname — it cannot
   redirect a `blogspot.com` URL. Verify the setting still behaves as expected before relying on it.
7. Keep the Blogger blog itself alive for a period (do not delete it) so the archive is not lost
   while Search Console re-indexes.

### 5.3 The decision the owner has to make (be explicit about the trade-off)
* **Option A — recommended for the app audience.** Republish on the same origin. Old post URLs 301
  to the hub. The installed-app audience is fully preserved; individual old post URLs lose their
  content (they land on the hub). *Mitigation:* export the handful of posts that still get traffic
  and re-publish them as real pages on the new site, then point specific rules at those pages rather
  than at `/`.
* **Option B — leave Blogger serving the old paths.** Do not do this: the installed shortcuts would
  keep opening the old site, and the old site is the thing we are replacing.
* **Option C — hybrid.** Keep the Blogger blog live on its blogspot hostname for the archive, and
  serve the new app on the custom domain. Existing installs **on the custom domain** keep working;
  installs made on `*.blogspot.com` are on a **different origin** and cannot be redirected by us —
  they need a visible notice on the Blogger pages ("ToolSeer has moved, install the new app here").

---

## 6. How to verify continuity with a real user (checklist)

Run this on a device that actually had the old app installed. Do not accept "it works on my
desktop" as evidence.

1. **Old icon, tap.** The old icon opens **the new hub** (ToolSeer logo, the ten-tool grid) — not
   the old Blogger page, not a 404, not a redirect loop.
2. **No stale page.** The shell footer/rail shows the new version (`ToolSeer · v3.0.0`). If the old
   page is what appears, it is an HTTP/BF-cache copy: open `/?sw=off` once, then reload.
3. **A tool still works.** Open a tool from the hub, add a real PDF or image, run it, download the
   result. This is the actual "did they lose the tool" test.
4. **Offline opens something useful.** Airplane mode → close the app → reopen from the icon.
   Expected: the hub, or `/offline.html`. Never the browser's "no internet" dinosaur.
5. **Install path (Android/desktop Chrome or Edge).** Visit the site → the install affordance
   appears (only if the browser can actually install) → install. DevTools → Application →
   Manifest must show `start_url: /`, `id: /`, `display: standalone`, and the three PNG icons with
   no warnings; Application → Service Workers must show `/sw.js`, scope `/`, "activated and is
   running".
6. **iOS.** Open the site in Safari → install instructions modal appears (`isIosInstallable()` is
   true, `canInstall()` is false). Share → Add to Home Screen now yields the new icon and opens the
   hub full screen.
7. **Kill switch works.** Open `/?sw=off` → a plain "cache reset" page → reload. Then:
   `navigator.serviceWorker.getRegistrations().then(r => console.log(r.length))` must log `0`, and
   Cache Storage must be empty. Re-visit the site to re-register.
8. **Nothing leaked.** DevTools → Application → Cache Storage must contain **only**
   `toolseer-shell-<version>` and `toolseer-runtime-<version>` (after some use), and must never
   contain anything under a user file, a POST, or another origin.

Useful console probes:
```js
navigator.serviceWorker.getRegistrations().then(r =>
  console.log(r.map(x => ({ scope: x.scope, script: (x.active || x.waiting || x.installing || {}).scriptURL }))));

// asks the live worker for its version; reply arrives as a message event
navigator.serviceWorker.controller.postMessage({ type: 'toolseer:version' });
navigator.serviceWorker.addEventListener('message', e => console.log(e.data));
```

---

## 7. What we cannot know without the owner's data (open questions)

These are flagged, not guessed. Each one changes how much of §3 is evidence versus inference.

1. **The exact origin the audience installed from.** Custom domain (`toolseer.com`) or
   `*.blogspot.com`? If it was blogspot, no redirect we control can help those installs (see §5.3
   Option C). *Needed:* the blog's published URL.
2. **The exact list of indexed legacy URLs.** Without it, §3.2 is a map of Blogger's *shapes*. The
   speculative aliases in `_redirects` §6 stay commented out until the list confirms them.
   *Needed:* Blogger post list + Search Console → Indexing → Pages export.
3. **How many installs exist, and on which platform.** We have no analytics (and will not add
   tracking). *Needed:* the owner's own estimate from Search Console / app-store-style checks.
4. **Whether any Android user ever completed a Chrome "Install app"** with the blob manifest. The
   code says it should have failed; we cannot test a 2024-era Blogger page from here.
5. **The URL each existing install's `start_url` was captured from.** This decides whether Chrome
   sees the new manifest as the same app (§4.4). *Needed:* ask one or two real users what the old
   icon opens today, before the deploy — that is the single most valuable data point.
6. **Whether Blogger's blogspot→custom-domain redirect is enabled** on this blog.
7. **Device/browser mix of the audience** (iOS share, Android share, desktop share). It decides how
   much of the install UI matters in practice.

---

## 8. Risk register (every risk gets a mitigation)

| # | Risk | Mitigation |
|---|---|---|
| R1 | A stale cached old page is served to exactly the users we want to keep. | Navigations are **network-first** in `sw.js`; the cache is only read when the network fails. `skipWaiting` + `clients.claim` + version-based cache purge on activate. |
| R2 | A service worker throws on an unsupported API and breaks the page for everyone. | Every API use in `pwa.js` is wrapped; `initPwa()` returns a safe API and never throws; registration is attempted only on http/https with `serviceWorker` present; the whole `sw.js` router degrades to pass-through (no `respondWith`) for anything it does not handle. |
| R3 | A stray cache or a bad deploy leaves a device stuck. | `?sw=off` kill switch: unregisters and deletes every cache on the origin, and serves a plain reset page built without touching the caches. `?sw=on` re-enables. Documented in §10. |
| R4 | An old legacy URL 404s (>90 % of the continuity value). | `_redirects` covers Blogger's shapes, ordered first-match-wins, with real routes first. §7.2 asks for the real list to replace inference with evidence. |
| R5 | A broad wildcard swallows a real route or an asset. | Every dynamic rule is checked against `/assets/*`, `/vendor/*`, `/sw.js`, `/manifest.webmanifest`, `/offline.html`, `/robots.txt`, `/sitemap.xml` and the tool slugs; speculative rules are commented out; the `/:route/` generalisation was deliberately dropped. |
| R6 | Unhashed `/assets/js|css` are cached for 24 h by `_headers` (`max-age=86400`), so a deploy is invisible regardless of the worker. | **Lead action, `_headers` (not my write scope):** split the rule so `/assets/img/*` keeps 86400 but `/assets/js/*` and `/assets/css/*` use `no-cache`. The worker's network-first policy cannot help if the browser's own HTTP cache answers first. See §11.3. |
| R7 | A user has a file queued in a tool when a new worker takes over. | We do not auto-reload on `controllerchange`; `onControllerChange` is exposed so the shell can show a notice instead. |
| R8 | Offline promise oversold: a tool whose engine was never downloaded cannot work offline. | `/offline.html` states this in plain words; §9 states it again. Only the shell (pages + UI modules) is precached; the multi-megabyte engines are not. |
| R9 | The manifest is fetched but a declared icon file is missing. | The three icons are the Lead's deliverable (`/assets/img/pwa/*.png`); the manifest declares `sizes`, `type` and `purpose` for every entry so a missing file is loud in DevTools → Manifest. `apple-touch-icon` must exist too — `tools/check.mjs` fails index.html otherwise. |
| R10 | A user in an in-app browser (Facebook/Instagram) taps "install" and nothing happens. | `isIosInstallable()` returns false there, and `canInstall()` needs a real `beforeinstallprompt`; the shell renders nothing rather than a dead button. |
| R11 | The install affordance never appears because `beforeinstallprompt` fired before our module ran. | `pwa.js` adopts `window.__toolseerInstallPrompt` captured by the optional head snippet (§11.1) **and** installs its own listener. |

---

## 9. What the service worker does and does not promise

**It does**
* take over immediately (`skipWaiting`, `clients.claim`) and purge every non-current cache;
* answer navigations network-first, falling back to the exact cached page → the cached hub →
  `/offline.html` → a last-resort inline page, in that order;
* cache same-origin GETs only: cache-first for `/vendor/*` (marked immutable in `_headers`) and
  `/assets/img/*`, network-first for everything else including CSS and JS;
* refresh its offline copy of a page on each successful online navigation.

**It does not**
* cache POSTs, cross-origin requests, or non-`http(s)` schemes — so `blob:`/`data:` URLs, which is
  where the user's own files live, can never enter a cache;
* promise that a tool whose engine has never been downloaded works offline;
* promise to preserve in-flight work across a reload (we do not force one);
* promise an in-place upgrade of an existing install (§4.4);
* guarantee an install prompt at all: browsers decide. No prompt ⇒ `canInstall()` is false and the
  shell shows nothing.

---

## 10. Support playbook (kill switch)

Symptom: a user sees an old page / old assets after a deploy.

1. Ask them to open `https://toolseer.com/?sw=off` once. The worker deletes every cache, unregisters
   itself, and shows a plain "cache reset" page.
2. Reload. The page now comes straight from the network with no worker in the way.
3. If the site is fine, they can simply keep using it; visiting normally re-registers `/sw.js`
   (which then re-precaches).
4. On a browser where the flag is remembered in `localStorage['toolseer:sw'] = 'off'`, add `?sw=on`
   once to clear it.
5. To force every device off stale caches globally, the Lead bumps `VERSION` in `sw.js` and deploys;
   `activate` purges all older caches on the next visit.

---

## 11. What the Lead must wire (my files are inert until then)

### 11.1 HTML shell (index.html + the ten tool pages + 404.html)
```html
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#0040ff">              <!-- already present -->
<link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">  <!-- already present -->
<link rel="apple-touch-icon" sizes="180x180" href="/assets/img/pwa/icon-192.png">
```
Recommended head snippet (makes the install button reliable; `pwa.js` adopts it if present):
```html
<script>window.addEventListener('beforeinstallprompt',function(e){
  e.preventDefault(); window.__toolseerInstallPrompt = e; });</script>
```
And in the page module (two lines, exactly as designed):
```js
import { initPwa } from '/assets/js/ui/pwa.js';
const pwa = initPwa();
// then, wherever the header/rail renders:
//   if (pwa.canInstall())            → "Install app" button, onclick → pwa.promptInstall()
//   else if (pwa.isIosInstallable()) → the instructions modal using pwa.iosInstallSteps
//   else                             → render nothing
// Optionally: pwa.onChange(state => …) and document's 'toolseer:pwa' event fire on every change;
//             pwa.onInstalled(…) fires on appinstalled; pwa.onControllerChange(…) for "update ready".
```

### 11.2 Icon files the Lead generates
`/assets/img/pwa/icon-192.png` (192×192), `/assets/img/pwa/icon-512.png` (512×512),
`/assets/img/pwa/maskable-512.png` (512×512, key art inside the inner 80 % safe zone), and
`/assets/img/apple-touch-icon.png` (180×180, for iOS). Keep the mark recognisably the same as the
old base64 icon so a newly installed app does not look like a different product.

### 11.3 `_headers` additions (Lead's file)
```
/sw.js
  Cache-Control: no-cache
  Service-Worker-Allowed: /

/manifest.webmanifest
  Cache-Control: public, max-age=3600

/offline.html
  Cache-Control: public, max-age=3600
```
Two notes, both important:
* **`Service-Worker-Allowed` is not strictly required**, because `/sw.js` is served from the root
  and a worker's default maximum scope is its own directory — which is `/`. Adding it is harmless
  and documents the intent.
* **Split the existing `/assets/*: max-age=86400` rule** (put the specific rules above it and verify
  which Cloudflare applies on a preview deploy):
  ```
  /assets/img/*
    Cache-Control: public, max-age=86400
  /assets/css/*
    Cache-Control: no-cache
  /assets/js/*
    Cache-Control: no-cache
  ```
  Without this, unhashed CSS/JS stay in the browser's HTTP cache for 24 h after a deploy, and no
  service-worker policy can override that.

### 11.4 i18n keys (Lead's `i18n.js`; EN and AR must both be added — `check.mjs` enforces parity)
`pwa.js` ships English fallback strings so the iOS steps work before translation. If the shell
prefers translated text, add these keys and map
`pwa.iosInstallSteps.map((en, i) => t(pwa.iosInstallStepKeys[i]) || en)`:

| Key | EN | AR |
|---|---|---|
| `pwa.install` | Install app | تثبيت التطبيق |
| `pwa.install.title` | Install ToolSeer | ثبّت ToolSeer |
| `pwa.install.body` | Add ToolSeer to your home screen for one-tap access. Works offline once a tool has been opened. | أضف ToolSeer إلى شاشتك الرئيسية للوصول بلمسة واحدة. يعمل دون اتصال بعد فتح الأداة مرة واحدة. |
| `pwa.install.accept` | Install | تثبيت |
| `pwa.install.dismiss` | Not now | ليس الآن |
| `pwa.installed` | ToolSeer is installed | تم تثبيت ToolSeer |
| `pwa.ios.title` | Install on iPhone or iPad | التثبيت على iPhone أو iPad |
| `pwa.ios.step1` | Open the Share menu: tap the Share button in the toolbar (the square with an arrow pointing up). | افتح قائمة المشاركة: اضغط زر المشاركة في الشريط (المربع مع سهم للأعلى). |
| `pwa.ios.step2` | In the share sheet, scroll down and tap "Add to Home Screen". | في قائمة المشاركة، انزل للأسفل واضغط "إضافة إلى الشاشة الرئيسية". |
| `pwa.ios.step3` | Tap "Add" in the top corner. The ToolSeer icon appears on your home screen. | اضغط "إضافة" في الأعلى. ستظهر أيقونة ToolSeer على شاشتك الرئيسية. |
| `pwa.ios.step4` | Open ToolSeer from that icon — it starts full screen, like an app. | افتح ToolSeer من الأيقونة — سيعمل بملء الشاشة كالتطبيق. |
| `pwa.update.ready` | A new version is ready. It applies on your next visit; your current files are untouched. | يتوفر إصدار جديد. سيُطبَّق في زيارتك القادمة، وملفاتك الحالية لن تتأثر. |

### 11.5 `tools/serve.mjs` (Lead's file) — local preview gaps
* It reads `_redirects`, but only supports **exact paths** and a trailing `/*`. It does **not**
  implement `:placeholder` sources, so the `[dynamic]` legacy date rules in `_redirects` silently
  never fire on `http://127.0.0.1:4173`. Adding placeholder support (or testing those rules on a
  Cloudflare preview) is the fix. This is a local-preview limitation only — Cloudflare does support
  placeholders.
* It does not read `_headers` at all, so it sends no CSP locally. That is fine for testing the
  worker (which needs no special header from a root-served script), but it means a CSP mistake would
  only show up in production.
* It serves `.js` as `text/javascript` and `.webmanifest` as `application/manifest+json` — both
  correct for a service worker and a manifest.
* It sends `Cache-Control: no-store` for everything, which is ideal for service-worker testing.

### 11.6 Deliberate omissions (so nobody has to guess later)
* **No `screenshots` in the manifest.** Chrome's "richer install UI" wants real screenshots; we do
  not have generated image files in this scope. Adding them later improves the install dialog.
* **No `launch_handler`.** `focus-existing` makes a shortcut appear to do nothing when the app is
  already open, and `navigate-existing` can navigate away from a page where a user has files queued.
  The browser default is the safer choice.
* **No `related_applications`.** It can trigger a native-install prompt for the Tauri desktop app,
  which would be surprising from a web page.

---

## 12. Ledger — what this task shipped

| File | Role |
|---|---|
| `apps/web/manifest.webmanifest` | `id`/`start_url`/`scope` `/`, standalone + WCO, `#0040ff`, three icons with `sizes`/`type`/`purpose`, ten tool `shortcuts`. |
| `apps/web/sw.js` | Takeover worker: precache + `skipWaiting`, cache purge + `clients.claim`, network-first navigations, cache-first only for `/vendor/*` and `/assets/img/*`, `?sw=off` kill switch, version constant. |
| `apps/web/offline.html` | Styled, JavaScript-free offline page; retry; honest statement of what works. |
| `apps/web/assets/js/ui/pwa.js` | `initPwa()`: install prompt capture/replay, iOS instructions, `isStandalone`, `onInstalled`, SW registration + foreign-worker takeover, fully defensive. |
| `apps/web/_redirects` | Legacy-continuity map, first-match-wins ordering, real routes protected, owner-verify markers. |
| `docs/CONTINUITY.md` | This plan. |

**Verification honesty:** there is no browser in this environment (recorded in
`docs/ARCHITECTURE.md` §1), so the service worker, the install prompt and the manifest were
**not** exercised end to end. What was verified is listed in the task report: `node --check` on the
JS, a JSON parse of the manifest, `node tools/check.mjs`, and a read of `tools/serve.mjs` to
establish what it does and does not send.
