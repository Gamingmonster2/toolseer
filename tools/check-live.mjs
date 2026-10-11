#!/usr/bin/env node
/**
 * tools/check-live.mjs — verify a DEPLOYED origin against the continuity contract.
 *
 * The migration is the riskiest moment in this project: 71% of the old audience
 * arrives by bookmark, shortcut or typed address, so a broken redirect costs real
 * visitors. This tool checks that contract against the real thing, before the
 * domain is switched onto it and again afterwards.
 *
 * It checks, against one origin:
 *   · every canonical route answers 200 with the expected <title>
 *   · every legacy URL shape answers 3xx and lands on a real page (no 404, no loop)
 *   · the PWA files are reachable, are the right type, and are not stale-cached
 *   · robots.txt and sitemap.xml are present and the sitemap's URLs resolve
 *
 * usage:
 *   node tools/check-live.mjs --base https://toolseer.com
 *   node tools/check-live.mjs --base https://x.pages.dev --legacy /2026/09/anything.html
 *   node tools/check-live.mjs --base https://x.pages.dev --offline   # skip network? (n/a)
 */
const args = process.argv.slice(2);
const arg = (name, fallback = null) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
let BASE = (arg('--base') || 'https://toolseer.com').replace(/\/+$/, '');
const EXTRA_LEGACY = args.filter((a) => a.startsWith('/') && !a.startsWith('/--'));

/**
 * Normalise to the canonical origin first.
 *
 * The host redirect runs BEFORE the site's own `_redirects` rules, so probing a
 * non-canonical spelling produces two kinds of false result: every legacy URL
 * appears to redirect to a path that then 404s, and every revision marker looks
 * missing because the first response is a 301 rather than the page. Both happened
 * while checking `www.toolseer.com` after the host consolidation, and both were
 * the tool's fault, not the site's.
 */
{
  try {
    const res = await fetch(BASE + '/', { redirect: 'follow' });
    const origin = new URL(res.url).origin;
    if (origin !== new URL(BASE).origin) {
      console.log(`note: ${BASE} redirects to ${origin} — checking ${origin} instead`);
      BASE = origin;
    }
  } catch { /* unreachable: the checks below will report it properly */ }
}

const CANONICAL = [
  '/', '/image-to-pdf', '/merge-pdf', '/compress-pdf', '/split-pdf',
  '/protect-pdf', '/unlock-pdf', '/pdf-to-images', '/organize-pdf',
  '/extract-text-pdf', '/desktop', '/privacy', '/terms', '/works', '/contact',
];

/* The URL shapes the old Blogger site produced, plus the shapes a bookmark may hold.
 *
 * `tolerate404` marks a shape that Blogger never actually produced, kept in the probe
 * list only to document the decision: `/YYYY/MM/slug` without `.html` is not a Blogger
 * URL (posts always end in `.html`, archives end at `/YYYY/MM/`), and covering it would
 * mean a `/:year/:month/:slug` rule — which would also swallow real four-segment assets
 * such as `/vendor/pdf-lib/pdf-lib.esm.min.js`. A 404 there is the correct outcome. */
const LEGACY = [
  '/index.html', '/home', '/convert', '/converter', '/our-works', '/contact-us',
  { path: '/2026/09/anything.html' },
  { path: '/2026/09/anything', tolerate404: true },
  { path: '/2026/09/' }, { path: '/2026/09' },
  { path: '/2025/12/some-tool.html' },
  { path: '/p/about.html' }, { path: '/p/contact.html' },
  '/feed', '/feeds/posts/default', '/search', '/search/label/pdf',
  '/image-to-pdf/', '/merge-pdf/', '/desktop/',
  ...EXTRA_LEGACY,
].map((entry) => (typeof entry === 'string' ? { path: entry } : entry));

const ASSETS = [
  { path: '/manifest.webmanifest', type: /manifest\+json|application\/json|text\/plain/i },
  { path: '/sw.js', type: /javascript/i },
  { path: '/offline.html', type: /text\/html/i },
  { path: '/robots.txt', type: /text\/plain/i },
  { path: '/sitemap.xml', type: /xml/i },
  { path: '/assets/css/toolseer.css', type: /text\/css/i },
  { path: '/assets/js/ui/toolbox.js', type: /javascript/i },
  { path: '/assets/js/core/index.js', type: /javascript/i },
  { path: '/assets/img/favicon.svg', type: /svg/i },
  { path: '/assets/img/pwa/icon-192.png', type: /image\/png/i },
  { path: '/assets/img/mascot/base.svg', type: /svg/i },
  { path: '/vendor/pdf-lib/pdf-lib.esm.min.js', type: /javascript/i },
];

const rows = [];
let failures = 0;

async function get(url, redirect = 'follow') {
  try {
    const res = await fetch(url, { redirect, headers: { 'user-agent': 'toolseer-check-live' } });
    return res;
  } catch (err) {
    return { error: err.message };
  }
}

const status = (res) => (res && res.error ? 'ERR' : String(res.status));

/* ------------------------------------------------------------- canonical --- */

for (const path of CANONICAL) {
  const url = BASE + path;
  const res = await get(url);
  if (res.error) {
    rows.push({ ok: false, test: path, detail: `network error: ${res.error}` });
    failures++;
    continue;
  }
  const ok = res.status === 200;
  let title = '';
  if (ok) {
    const html = await res.text();
    title = (html.match(/<title>([\s\S]*?)<\/title>/i) || [, ''])[1].trim();
    if (!title) {
      rows.push({ ok: false, test: path, detail: 'no <title>' });
      failures++;
      continue;
    }
    if (/Page not found|404/i.test(title) && path !== '/') {
      rows.push({ ok: false, test: path, detail: `served an error page (${title})` });
      failures++;
      continue;
    }
  }
  if (!ok) failures++;
  rows.push({ ok, test: path, detail: `${res.status} ${title.slice(0, 44)}` });
}

/* --------------------------------------------------------------- legacy --- */

for (const probe of LEGACY) {
  const path = probe.path;
  const res = await get(BASE + path, 'manual');
  if (res.error) {
    rows.push({ ok: false, test: `legacy ${path}`, detail: `network error: ${res.error}` });
    failures++;
    continue;
  }
  const isRedirect = res.status >= 300 && res.status < 400;
  if (!isRedirect) {
    const isCanonical = CANONICAL.includes(path.replace(/\/$/, ''));
    const tolerated = probe.tolerate404 && res.status === 404;
    rows.push({
      ok: isCanonical || tolerated,
      test: `legacy ${path}`,
      detail: isCanonical
        ? `${res.status} (already a real route)`
        : tolerated
          ? `${res.status} — not a Blogger shape, deliberately not covered`
          : `${res.status} — expected a redirect to a live page`,
    });
    if (!isCanonical && !tolerated) failures++;
    continue;
  }
  const location = res.headers.get('location') || '';
  const target = location.startsWith('http') ? location : BASE + location;
  const followed = await get(target);
  const landed = !followed.error && followed.status === 200;
  rows.push({
    ok: landed,
    test: `legacy ${path}`,
    detail: `${res.status} → ${location || '(no location)'}${landed ? '' : ' → DEAD END'}`,
  });
  if (!landed) failures++;
}

/* --------------------------------------------------------------- assets --- */

for (const asset of ASSETS) {
  const res = await get(BASE + asset.path);
  if (res.error) {
    rows.push({ ok: false, test: asset.path, detail: `network error: ${res.error}` });
    failures++;
    continue;
  }
  const type = res.headers.get('content-type') || '';
  const ok = res.status === 200 && (!type || asset.type.test(type));
  rows.push({ ok, test: asset.path, detail: `${res.status} ${type.split(';')[0] || '(no type)'}` });
  if (!ok) failures++;

  if (asset.path === '/sw.js') {
    const cc = res.headers.get('cache-control') || '';
    const fresh = /no-cache|no-store|max-age=0/i.test(cc);
    rows.push({ ok: fresh, test: '/sw.js cache-control', detail: `${cc || '(none)'}${fresh ? '' : ' — a cached worker keeps serving the old site'}` });
    if (!fresh) failures++;
  }
}

/* ------------------------------------------------------------ revision --- */

/**
 * Is the DEPLOYED build the one in this repository?
 *
 * The failure this catches is subtle and it already happened once: the site is up,
 * every check passes, and the person testing it is looking at week-old code — so
 * every fix they were told about appears not to work. Each marker below exists in
 * exactly one revision, so their presence identifies what is actually live.
 */
{
  const markers = [
    {
      what: 'the Rotate PDF tool exists',
      check: async () => (await get(BASE + '/rotate-pdf', 'manual')).status === 200,
      hint: 'missing → the deployment predates the simplified tool lineup',
    },
    {
      what: 'the hub offers the current lineup',
      check: async () => {
        const res = await get(BASE + '/sitemap.xml');
        if (res.status !== 200) return false;
        const xml = await res.text();
        return !/protect-pdf|unlock-pdf|extract-text-pdf/.test(xml) && /rotate-pdf/.test(xml);
      },
      hint: 'missing → the sitemap still advertises the retired tools',
    },
    {
      what: 'the design pass is deployed (short header)',
      check: async () => {
        const res = await get(BASE + '/assets/css/toolseer.css');
        if (res.status !== 200) return false;
        const css = await res.text();
        return /--ts-header-h:\s*60px/.test(css) && css.includes('--ts-ink');
      },
      hint: 'missing → the shorter header and the dark-mode art tokens are not live',
    },
    {
      what: 'the language-loop fix is deployed',
      check: async () => {
        const res = await get(BASE + '/assets/js/ui/i18n.js');
        if (res.status !== 200) return false;
        return (await res.text()).includes('Array.from(listeners)');
      },
      hint: 'missing → the language button still locks the page',
    },
  ];

  for (const marker of markers) {
    let ok = false;
    try { ok = await marker.check(); } catch { ok = false; }
    rows.push({ ok, test: `revision · ${marker.what}`, detail: ok ? 'present' : marker.hint });
    if (!ok) failures++;
  }
}

/* -------------------------------------------------------------- sitemap --- */

{
  const res = await get(BASE + '/sitemap.xml');
  if (res.status === 200) {
    const xml = await res.text();
    const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    const bad = [];
    for (const url of urls) {
      const r = await get(url, 'manual');
      if (r.error || r.status >= 400) bad.push(`${url} → ${status(r)}`);
    }
    rows.push({ ok: bad.length === 0, test: 'sitemap URLs resolve', detail: bad.length ? bad.join(', ') : `${urls.length} URLs ok` });
    if (bad.length) failures++;
  }
}

/* --------------------------------------------------------------- report --- */

const label = BASE.replace(/^https?:\/\//, '');
console.log(`\nLIVE CONTINUITY CHECK — ${label}\n`);
for (const row of rows) {
  console.log(`  ${row.ok ? '✓' : '✗'} ${row.test.padEnd(44)} ${row.detail}`);
}
console.log(`\n${rows.filter((r) => r.ok).length} passed, ${failures} failed\n`);
if (failures) {
  console.log('Fix the ✗ lines before pointing the domain at this deployment.');
  console.log('A legacy URL that dead-ends costs a visitor who arrived from a bookmark.\n');
}
process.exitCode = failures ? 1 : 0;
