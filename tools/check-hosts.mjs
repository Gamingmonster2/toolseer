#!/usr/bin/env node
/**
 * tools/check-hosts.mjs — verify the canonical-host contract.
 *
 * An installed web app belongs to its ORIGIN. `toolseer.com` and
 * `www.toolseer.com` are different origins with different manifests, different
 * service workers and different installed shortcuts. So exactly one of them must
 * serve the site, and every other spelling must redirect to it — otherwise half
 * the returning audience lands somewhere else, or on a certificate error.
 *
 * This is one of the two decisions flagged in docs/MIGRATION.md as "it will bite
 * if you skip it", and it is the one part of the migration that cannot be seen
 * from inside the site: the site looks perfect on whichever host you typed.
 *
 * usage: node tools/check-hosts.mjs [--host toolseer.com]
 */
const args = process.argv.slice(2);
const HOST = args.includes('--host') ? args[args.indexOf('--host') + 1] : 'toolseer.com';

/** Every spelling a person or a bookmark might use. */
const VARIANTS = [
  `https://${HOST}/`,
  `https://www.${HOST}/`,
  `http://${HOST}/`,
  `http://www.${HOST}/`,
];

const rows = [];
let failures = 0;

async function probe(url) {
  try {
    const res = await fetch(url, { redirect: 'manual', headers: { 'user-agent': 'toolseer-check-hosts' } });
    return { status: res.status, location: res.headers.get('location') || '' };
  } catch (err) {
    return { error: err.message };
  }
}

console.log(`\nCANONICAL HOST CHECK — ${HOST}\n`);

const serving = [];
for (const url of VARIANTS) {
  const r = await probe(url);
  if (r.error) {
    rows.push({ ok: false, test: url, detail: `unreachable: ${r.error}` });
    failures++;
    continue;
  }
  const redirects = r.status >= 300 && r.status < 400;
  const serves = r.status === 200;

  if (serves) serving.push(url);
  rows.push({
    ok: serves || redirects,
    test: url,
    detail: serves ? `200 — serves the site` : `${r.status} → ${r.location || '(no location)'}`,
  });
  if (!serves && !redirects) failures++;
}

/* Exactly one host may serve the site; the rest must redirect to it. */
if (serving.length === 1) {
  rows.push({ ok: true, test: 'exactly one canonical host serves the site', detail: serving[0] });
} else if (serving.length === 0) {
  rows.push({ ok: false, test: 'exactly one canonical host serves the site', detail: 'none of the four spellings served the site' });
  failures++;
} else {
  rows.push({
    ok: false,
    test: 'exactly one canonical host serves the site',
    detail: `${serving.length} hosts serve it: ${serving.join(', ')} — an install made on one will not see the other's manifest`,
  });
  failures++;
}

/* Redirects must all land on the same canonical host, in one hop. */
const targets = rows
  .filter((row) => /→/.test(row.detail || ''))
  .map((row) => (row.detail.split('→')[1] || '').trim())
  .filter(Boolean);
const uniqueTargets = [...new Set(targets.map((t) => {
  try { return new URL(t, 'https://x').host; } catch { return t; }
}))];
if (targets.length) {
  const consistent = uniqueTargets.length === 1;
  rows.push({
    ok: consistent,
    test: 'every other spelling redirects to one host',
    detail: consistent ? uniqueTargets[0] : `inconsistent: ${uniqueTargets.join(', ')}`,
  });
  if (!consistent) failures++;
}

/* The page's own canonical link must name the host that is actually serving it. */
if (serving.length >= 1) {
  const res = await fetch(serving[0]);
  const html = await res.text();
  const canonical = (html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) || [])[1] || '';
  const canonicalHost = canonical ? (() => { try { return new URL(canonical).host; } catch { return ''; } })() : '';
  const servingHost = new URL(serving[0]).host;
  rows.push({
    ok: canonicalHost === servingHost,
    test: 'the canonical link names the serving host',
    detail: canonical ? `${canonical} (serving: ${servingHost})` : 'no canonical link found',
  });
  if (canonicalHost !== servingHost) failures++;
}

/* --------------------------------------------------------------- report --- */

for (const row of rows) {
  console.log(`  ${row.ok ? '✓' : '✗'} ${row.test.padEnd(44)} ${row.detail}`);
}
console.log(`\n${rows.filter((r) => r.ok).length} passed, ${failures} failed\n`);
if (failures) {
  console.log('Pick ONE host, serve the site there, and 301 every other spelling to it.');
  console.log('Do that in the same change as any domain move: an installed shortcut');
  console.log('follows the host it was installed from, not the site you improved.\n');
}
process.exitCode = failures ? 1 : 0;
