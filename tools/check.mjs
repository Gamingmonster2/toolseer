#!/usr/bin/env node
/**
 * tools/check.mjs — the repository integrity gate.
 *
 * Verifies everything that can be verified WITHOUT a browser:
 *   route inventory · per-page SEO structure · JSON-LD vs visible FAQ parity ·
 *   runtime-CDN ban · asset existence · i18n completeness · JS syntax ·
 *   vendor checksums · prose volume.
 *
 * The browser-level verification lives in tools/e2e.mjs.
 *
 * usage: node tools/check.mjs [--only <slug>] [--skip-vendor]
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'apps', 'web');
const VENDOR_LOCK = path.join(WEB, 'vendor', 'vendor.lock.json');

const args = process.argv.slice(2);
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const SKIP_VENDOR = args.includes('--skip-vendor');

/* ------------------------------------------------------------ i18n source -- */

const i18nPath = path.join(WEB, 'assets', 'js', 'ui', 'i18n.js');
const { EN: I18N_EN, AR: I18N_AR } = await import(pathToFileURL(i18nPath).href);

const ROUTES = [
  { slug: null, dir: '' },
  { slug: 'image-to-pdf', dir: 'image-to-pdf' },
  { slug: 'merge-pdf', dir: 'merge-pdf' },
  { slug: 'compress-pdf', dir: 'compress-pdf' },
  { slug: 'split-pdf', dir: 'split-pdf' },
  { slug: 'protect-pdf', dir: 'protect-pdf' },
  { slug: 'unlock-pdf', dir: 'unlock-pdf' },
  { slug: 'pdf-to-images', dir: 'pdf-to-images' },
  { slug: 'organize-pdf', dir: 'organize-pdf' },
  { slug: 'extract-text-pdf', dir: 'extract-text-pdf' },
  { slug: 'desktop', dir: 'desktop' },
];

const problems = [];
let checks = 0;
const ok = (cond, where, msg) => {
  checks++;
  if (!cond) problems.push(`[${where}] ${msg}`);
};

/* ------------------------------------------------------------- utilities -- */

const decodeEntities = (s) =>
  s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');

const normalize = (s) =>
  decodeEntities(String(s)).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();

function extractJsonLd(html) {
  const out = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try { out.push(JSON.parse(m[1])); } catch { out.push(null); }
  }
  return out;
}

function allAssets(html) {
  const refs = [];
  const re = /(?:src|href)\s*=\s*["']([^"'#][^"']*)["']/gi;
  let m;
  while ((m = re.exec(html))) refs.push(m[1]);
  return refs;
}

function wordCount(text) {
  const cleaned = text.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ');
  return (cleaned.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;
}

/* -------------------------------------------------------------- i18n gate -- */

const enKeys = new Set(Object.keys(I18N_EN));
const arKeys = new Set(Object.keys(I18N_AR));
const missingInAr = [...enKeys].filter((k) => !arKeys.has(k)).sort();
const missingInEn = [...arKeys].filter((k) => !enKeys.has(k)).sort();
ok(missingInAr.length === 0, 'i18n', `keys present in EN but missing in AR: ${missingInAr.join(', ')}`);
ok(missingInEn.length === 0, 'i18n', `keys present in AR but missing in EN: ${missingInEn.join(', ')}`);
for (const k of enKeys) {
  if (I18N_EN[k].includes('{') && !/\{\w+\}/.test(I18N_EN[k]) && /\{[^a-zA-Z0-9_]/.test(I18N_EN[k])) {
    ok(false, 'i18n', `EN key "${k}" contains a stray brace`);
  }
}

/* -------------------------------------------------------------- js syntax -- */

/**
 * `node --check` through a temp FILE rather than a pipe: under a confined
 * sandbox, spawning a child with piped stdio fails with EPERM, which would
 * turn every file into a false positive. File descriptors always work.
 */
function checkJsSyntax(file) {
  checks++;
  const tmp = path.join(ROOT, '.cache', `syntax-${path.basename(file)}.log`);
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  let fd;
  try {
    fd = fs.openSync(tmp, 'w');
    const r = spawnSync(process.execPath, ['--check', file], {
      stdio: ['ignore', fd, fd],
    });
    fs.closeSync(fd);
    fd = null;
    if (r.error) {
      problems.push(`[js] ${file}: could not run node --check (${r.error.code})`);
      return;
    }
    if (r.status !== 0) {
      const out = fs.readFileSync(tmp, 'utf8');
      const line = out.split('\n').find((l) => /Error|error/.test(l));
      problems.push(`[js] ${file}: ${line ? line.trim() : 'syntax error'}`);
    }
  } catch (err) {
    if (fd !== null && fd !== undefined) { try { fs.closeSync(fd); } catch { /* ignore */ } }
    problems.push(`[js] ${file}: syntax check crashed (${err.message})`);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

/* ------------------------------------------------------------ route gates -- */

for (const route of ONLY ? ROUTES.filter((r) => r.slug === ONLY) : ROUTES) {
  const where = route.slug || 'home';
  const dir = path.join(WEB, route.dir);
  const file = path.join(dir, 'index.html');

  if (!fs.existsSync(file)) {
    problems.push(`[${where}] missing page file ${path.relative(ROOT, file)}`);
    continue;
  }

  const html = fs.readFileSync(file, 'utf8');

  ok(/<!doctype html>/i.test(html), where, 'missing doctype');
  ok(html.startsWith('<!doctype'), where, 'file does not start with doctype');

  /* shell contract */
  for (const id of ['ts-support', 'ts-rail', 'ts-header', 'ts-main', 'ts-footer']) {
    ok(html.includes(`id="${id}"`), where, `missing shell container #${id}`);
  }
  ok(html.includes('ts-skip-link'), where, 'missing skip link');

  /* headings */
  const h1s = (html.match(/<h1\b[^>]*>/gi) || []).length;
  ok(h1s === 1, where, `expected exactly one <h1>, found ${h1s}`);

  /* head meta */
  const head = (html.match(/<head>([\s\S]*?)<\/head>/i) || [])[1] || '';
  const metaOf = (name) => {
    const m = head.match(new RegExp(`<meta[^>]*(?:name|property)=["']${name}["'][^>]*>`));
    return m ? (m[0].match(/content=["']([^"']*)["']/) || [])[1] || '' : null;
  };
  const title = (head.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const canonical = (head.match(/<link[^>]*rel=["']canonical["'][^>]*>/i) || [])[0] || '';
  ok(title.length >= 20, where, 'title missing or too short');
  ok(title.length <= 70, where, `title too long (${title.length} chars)`);
  const desc = metaOf('description');
  ok(desc !== null && desc.length >= 90 && desc.length <= 200, where, `description missing or wrong length (${desc === null ? 'missing' : desc.length})`);
  ok(canonical.includes(`https://toolseer.com/${route.slug || ''}`), where, `canonical wrong: ${canonical}`);
  for (const og of ['og:title', 'og:description', 'og:type', 'og:url', 'og:site_name']) {
    ok(metaOf(og) !== null, where, `missing meta ${og}`);
  }
  for (const tw of ['twitter:card', 'twitter:title', 'twitter:description']) {
    ok(metaOf(tw) !== null, where, `missing meta ${tw}`);
  }

  /* JSON-LD */
  const blocks = extractJsonLd(html).filter(Boolean);
  ok(blocks.length >= 1, where, 'no parseable JSON-LD block');
  if (blocks.length) {
    const all = blocks.flatMap((b) => (b['@graph'] && Array.isArray(b['@graph']) ? b['@graph'] : [b]));
    const types = new Set(all.map((b) => b['@type']).filter(Boolean));
    if (route.slug) {
      for (const t of ['SoftwareApplication', 'BreadcrumbList', 'FAQPage']) {
        ok(types.has(t), where, `JSON-LD missing @type ${t}`);
      }
    } else {
      ok(types.has('WebSite'), where, 'home JSON-LD missing @type WebSite');
      ok(types.has('FAQPage'), where, 'home JSON-LD missing @type FAQPage');
    }
    /* FAQ parity: visible <details> must equal JSON-LD questions */
    const visible = [...html.matchAll(/<details[^>]*>\s*<summary>([\s\S]*?)<\/summary>/gi)]
      .map((m) => normalize(m[1]));
    const ldQuestions = all
      .filter((b) => b['@type'] === 'FAQPage' && Array.isArray(b.mainEntity))
      .flatMap((b) => b.mainEntity.map((q) => normalize(q.name)));
    if (visible.length && ldQuestions.length) {
      const inLdNotVisible = ldQuestions.filter((q) => !visible.includes(q));
      const visibleNotInLd = visible.filter((q) => !ldQuestions.includes(q));
      ok(inLdNotVisible.length === 0, where, `FAQ in JSON-LD but not visible: ${inLdNotVisible.join(' | ')}`);
      ok(visibleNotInLd.length === 0, where, `FAQ visible but not in JSON-LD: ${visibleNotInLd.join(' | ')}`);
    }
  }

  /* runtime-CDN ban: scripts and stylesheets must be local */
  for (const m of html.matchAll(/<script[^>]*src=["'](https?:[^"']+)["']/gi)) {
    ok(false, where, `runtime CDN script: ${m[1]}`);
  }
  for (const m of html.matchAll(/<link[^>]*rel=["']stylesheet["'][^>]*href=["'](https?:[^"']+)["']/gi)) {
    ok(false, where, `runtime CDN stylesheet: ${m[1]}`);
  }
  for (const m of html.matchAll(/<img[^>]*src=["'](https?:[^"']+)["']/gi)) {
    ok(false, where, `runtime CDN image: ${m[1]}`);
  }

  /* local asset existence */
  const localRefs = allAssets(html).filter((r) => r.startsWith('/'));
  for (const ref of localRefs) {
    const p = path.join(WEB, ref.replace(/^\//, ''));
    if (fs.existsSync(p)) continue;
    const withHtml = path.join(WEB, ref.replace(/^\//, ''), 'index.html');
    if (fs.existsSync(withHtml)) continue;
    ok(false, where, `broken local reference: ${ref}`);
  }

  /* i18n keys referenced by data-i18n must exist */
  for (const m of html.matchAll(/data-i18n(?:-attr)?=["'](?:[\w-]+:)?([\w.-]+)["']/g)) {
    const key = m[1].split(',')[0];
    if (!enKeys.has(key)) problems.push(`[${where}] data-i18n key missing from EN: ${key}`);
  }

  /* prose volume: tools must carry real copy, not filler */
  const prose = (html.match(/<section class="ts-prose"[\s\S]*?<\/section>/gi) || []).join(' ');
  const words = wordCount(prose);
  if (route.slug) ok(words >= 300, where, `prose only ${words} words (need 300+)`);

  /* Inline module syntax. Every tool page carries its own <script type="module">
     and nothing else parses it — a typo there ships a page whose engine silently
     never runs. Extracted to a temp file because `node --check` must not be given
     a pipe in a confined sandbox. */
  const modules = [...html.matchAll(/<script type="module"[^>]*>([\s\S]*?)<\/script>/gi)];
  for (let i = 0; i < modules.length; i++) {
    const tmp = path.join(ROOT, '.cache', `inline-${where.replace(/[^\w-]/g, '_')}-${i}.mjs`);
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    fs.writeFileSync(tmp, modules[i][1]);
    checkJsSyntax(tmp);
    fs.rmSync(tmp, { force: true });
  }
  if (modules.length) checks++;

  /* mascot references degrade gracefully or resolve */
  for (const m of html.matchAll(/<img[^>]*src=["'](\/assets\/img\/mascot\/[^"']+)["'][^>]*>/gi)) {
    const hasFallback = /onerror=/.test(m[0]);
    const exists = fs.existsSync(path.join(WEB, m[1].replace(/^\//, '')));
    ok(exists || hasFallback, where, `mascot ${m[1]} missing and has no onerror fallback`);
  }

  /* favicon must exist (site-wide, but cheap to check per page) */
  ok(fs.existsSync(path.join(WEB, 'assets', 'img', 'favicon.svg')), 'site', 'assets/img/favicon.svg missing');
}

/* ------------------------------------------------------- js syntax (site) -- */

for (const f of walk(path.join(WEB, 'assets', 'js')).filter((f) => f.endsWith('.js') || f.endsWith('.mjs'))) {
  checkJsSyntax(f);
}

/* -------------------------------------------------------------- vendor ----- */

if (!SKIP_VENDOR) {
  if (!fs.existsSync(VENDOR_LOCK)) {
    problems.push('[vendor] vendor.lock.json missing — run node tools/vendor.mjs install');
  } else {
    const lock = JSON.parse(fs.readFileSync(VENDOR_LOCK, 'utf8'));
    for (const pkg of lock.packages) {
      for (const f of pkg.files) {
        const abs = path.join(ROOT, f.file);
        if (!fs.existsSync(abs)) {
          problems.push(`[vendor] missing ${f.file}`);
          continue;
        }
        const { createHash } = await import('node:crypto');
        const digest = createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
        if (digest !== f.sha256) problems.push(`[vendor] checksum mismatch ${f.file}`);
      }
      ok(pkg.license === 'MIT' || pkg.license === 'ISC' || pkg.license === 'Apache-2.0',
        'vendor', `${pkg.name}: license "${pkg.license}" needs human review`);
    }
    checks++;
  }
}

/* -------------------------------------------------------------- PWA gate --- */

{
  const pwaFiles = [
    'manifest.webmanifest',
    'sw.js',
    'offline.html',
    'assets/js/ui/pwa.js',
    'assets/img/favicon.svg',
    'assets/img/apple-touch-icon.png',
    'assets/img/pwa/icon-192.png',
    'assets/img/pwa/icon-512.png',
    'assets/img/pwa/maskable-512.png',
  ];
  for (const rel of pwaFiles) {
    ok(fs.existsSync(path.join(WEB, rel)), 'pwa', `missing ${rel}`);
  }

  /* the manifest must parse and must point at files that exist */
  const manifestPath = path.join(WEB, 'manifest.webmanifest');
  if (fs.existsSync(manifestPath)) {
    let manifest = null;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
    catch (err) { ok(false, 'pwa', `manifest is not valid JSON (${err.message})`); }
    if (manifest) {
      ok(manifest.start_url === '/', 'pwa', `start_url should be "/" (got ${manifest.start_url})`);
      ok(manifest.scope === '/', 'pwa', `scope should be "/" (got ${manifest.scope})`);
      ok(manifest.theme_color === '#0040ff', 'pwa', `theme_color should be #0040ff (got ${manifest.theme_color})`);
      const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
      ok(icons.length >= 2, 'pwa', 'manifest needs at least two icons');
      ok(icons.some((i) => i.purpose === 'maskable'), 'pwa', 'manifest needs a maskable icon');
      for (const entry of icons) {
        const src = String(entry.src || '').replace(/^\//, '');
        ok(fs.existsSync(path.join(WEB, src)), 'pwa', `manifest icon does not exist: ${entry.src}`);
        ok(Boolean(entry.sizes && entry.type && entry.purpose), 'pwa', `icon ${entry.src} needs sizes, type and purpose`);
      }
    }
  }

  /* every page must carry the install declarations */
  const pageFiles = [];
  const collect = (dir, depth = 0) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (['assets', 'vendor', 'node_modules'].includes(entry.name)) continue;
        collect(path.join(dir, entry.name), depth + 1);
      } else if (entry.name.endsWith('.html') && entry.name !== 'offline.html') {
        pageFiles.push(path.join(dir, entry.name));
      }
    }
  };
  collect(WEB);
  for (const file of pageFiles) {
    const html = fs.readFileSync(file, 'utf8');
    const rel = path.relative(WEB, file).replace(/\\/g, '/');
    ok(html.includes('rel="manifest"'), 'pwa', `${rel} has no manifest link`);
    ok(html.includes('__toolseerInstallPrompt'), 'pwa', `${rel} does not capture beforeinstallprompt`);
  }
  console.log(`   (pwa: ${pageFiles.length} pages wired, ${pwaFiles.length} files present)`);
}

/* -------------------------------------------------------------- summary ---- */

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, acc);
    else acc.push(p);
  }
  return acc;
}

const mode = ONLY ? ` (--only ${ONLY})` : '';
if (problems.length) {
  console.log(`\n❌ check FAILED${mode} — ${problems.length} problem(s) across ${checks} checks:\n`);
  for (const p of problems) console.log(`  • ${p}`);
  process.exitCode = 1;
} else {
  console.log(`\n✅ check PASSED${mode} — ${checks} checks, 0 problems`);
  process.exitCode = 0;
}
