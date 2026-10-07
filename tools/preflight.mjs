#!/usr/bin/env node
/**
 * tools/preflight.mjs — one command that answers "is this tree deployable?".
 *
 * Run it before pushing. It chains the four gates that matter and stops at the
 * first failure, so a broken deploy is caught on this machine instead of on
 * Cloudflare — where the only feedback is a live site that misbehaves.
 *
 * It also checks the things Cloudflare Pages will care about and that the other
 * gates do not cover: the publishable folder's size, the per-file limit, that
 * `_headers`/`_redirects`/`404.html` sit at the output root, and that no
 * development-only file is being shipped to users.
 *
 * usage: node tools/preflight.mjs [--skip-browser]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'apps', 'web');
const SKIP_BROWSER = process.argv.includes('--skip-browser');

const results = [];
let failed = false;

/**
 * Run a node script and capture its output through a FILE, not a pipe: a confined
 * sandbox refuses piped stdio for child processes, which would turn every check
 * into a false failure.
 */
function run(label, file, args = [], { optional = false } = {}) {
  const log = path.join(ROOT, '.cache', `preflight-${label.replace(/[^\w]+/g, '-')}.log`);
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const fd = fs.openSync(log, 'w');
  const started = Date.now();
  const result = spawnSync(process.execPath, [file, ...args], { stdio: ['ignore', fd, fd] });
  fs.closeSync(fd);
  const output = fs.readFileSync(log, 'utf8');
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const ok = result.status === 0;
  results.push({ label, ok, seconds, output, optional });
  if (!ok && !optional) failed = true;
  return ok;
}

function report(label, ok, detail) {
  results.push({ label, ok, seconds: null, output: '', detail });
  if (!ok) failed = true;
}

console.log('\nToolSeer preflight — is this tree deployable?\n');

run('vendored engines verified', path.join(ROOT, 'tools', 'vendor.mjs'), ['verify']);
run('integrity gate', path.join(ROOT, 'tools', 'check.mjs'));
run('tests', path.join(ROOT, 'tests', 'run.mjs'));
run('mascot geometry', path.join(ROOT, 'tools', 'validate-mascots.mjs'));

/* --- what Cloudflare Pages will actually publish --- */

const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else files.push(full);
  }
};
walk(WEB);

const totalBytes = files.reduce((sum, f) => sum + fs.statSync(f).size, 0);
const largest = files.reduce((max, f) => Math.max(max, fs.statSync(f).size), 0);

report('publishable folder has files', files.length > 50, `${files.length} files`);
report('under the 25 MB per-file limit', largest < 25 * 1024 * 1024, `largest ${(largest / 1048576).toFixed(1)} MB`);
report('under the 20,000 file limit', files.length < 20000, `${files.length} files`);
report(
  'Pages control files at the output root',
  ['_headers', '_redirects', '404.html', 'robots.txt', 'sitemap.xml', 'manifest.webmanifest', 'sw.js', 'offline.html']
    .every((name) => fs.existsSync(path.join(WEB, name))),
  '_headers · _redirects · 404.html · robots.txt · sitemap.xml · manifest · sw.js · offline.html'
);

/* Development-only files must not ship to users. */
const suspicious = files
  .map((f) => path.relative(WEB, f).replace(/\\/g, '/'))
  .filter((rel) => /(^|\/)_[^/]*\.mjs$/.test(rel) || /\.(log|tmp|bak|map)$/i.test(rel) || /(^|\/)_probe|_debug|_oc/.test(rel));
report('no development files inside the published tree', suspicious.length === 0, suspicious.join(', ') || 'clean');

/* The index must not reference a file that is not there. The integrity gate
   already resolves <link>/<script> srcs; this is the belt-and-braces version for
   the two files whose absence breaks the whole PWA. */
report(
  'service worker and manifest are self-consistent',
  fs.readFileSync(path.join(WEB, 'sw.js'), 'utf8').includes('toolseer') &&
    JSON.parse(fs.readFileSync(path.join(WEB, 'manifest.webmanifest'), 'utf8')).start_url === '/',
  "sw.js present · manifest start_url '/'"
);

/* The deploy configuration must agree with the folder it points at. This is the
   check that would have caught the failed first deploy: Cloudflare ran
   `npx wrangler deploy`, and with no `assets.directory` it refused to guess. */
{
  const wranglerPath = path.join(ROOT, 'wrangler.jsonc');
  if (!fs.existsSync(wranglerPath)) {
    report('deploy config present', false, 'no wrangler.jsonc — a Workers deploy cannot find the site');
  } else {
    const raw = fs.readFileSync(wranglerPath, 'utf8');
    /* JSONC: strip comments before parsing. The pattern ignores `//` inside strings. */
    const stripped = raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => line.replace(/(^|[^:"'])\/\/.*$/, '$1'))
      .join('\n');
    let cfg = null;
    try { cfg = JSON.parse(stripped); } catch { /* reported below */ }
    report('deploy config parses (wrangler.jsonc)', cfg !== null, cfg ? `name: ${cfg.name}` : 'invalid JSON');
    if (cfg) {
      const dir = cfg.assets && cfg.assets.directory;
      const abs = dir ? path.join(ROOT, dir) : null;
      report('deploy config points at a real folder', Boolean(abs) && fs.existsSync(abs), dir || '(no assets.directory)');
      report('that folder holds the site', Boolean(abs) && fs.existsSync(path.join(abs, 'index.html')), 'index.html present');
      report('worker name is set', typeof cfg.name === 'string' && cfg.name.length > 0,
        'must match the Worker name in the Cloudflare dashboard');

      /* Trailing-slash agreement. The project declares canonical URLs WITHOUT a
         trailing slash everywhere (link rel=canonical, sitemap, JSON-LD). If the
         host prefers the trailing-slash form instead, it redirects `/tool` →
         `/tool/` while `_redirects` does the opposite, and the two rules loop
         until the browser gives up with an empty page. This check exists because
         that is exactly what the first live deploy did. */
      const handling = cfg.assets && cfg.assets.html_handling;
      const safeHandling = ['drop-trailing-slash', 'none'];
      report(
        'trailing-slash handling agrees with the canonical URLs',
        safeHandling.includes(handling),
        handling
          ? `html_handling: ${handling}`
          : `html_handling defaults to auto-trailing-slash, which fights _redirects — set "drop-trailing-slash"`
      );
    }
  }
}

if (!SKIP_BROWSER) {
  run('browser gate', path.join(ROOT, 'tools', 'e2e.mjs'), [], { optional: true });
}

/* --- report --- */

console.log('');
for (const r of results) {
  const mark = r.ok ? '✓' : r.optional ? '⚠' : '✗';
  const time = r.seconds ? ` (${r.seconds}s)` : '';
  console.log(`  ${mark} ${r.label}${time}${r.detail ? `  — ${r.detail}` : ''}`);
  if (!r.ok && !r.optional && r.output) {
    const tail = r.output.trim().split('\n').slice(-12).join('\n    ');
    console.log(`    ${tail}`);
  }
}

const optionalFails = results.filter((r) => !r.ok && r.optional);
if (failed) {
  console.log('\n❌ Not ready to deploy — fix the ✗ lines above.\n');
  process.exitCode = 1;
} else {
  console.log('\n✅ Ready to deploy to Cloudflare Pages.');
  console.log('   Build command: (leave empty)   Output directory: apps/web\n');
  if (optionalFails.length) {
    console.log(`   Note: ${optionalFails.map((r) => r.label).join(', ')} could not run here —`);
    console.log('   it needs a sandbox where Chrome can start. Run it again before the final cutover.\n');
  }
}
