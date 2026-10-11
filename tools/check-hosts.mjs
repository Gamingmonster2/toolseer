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

/**
 * Follow a redirect chain to its end.
 *
 * The contract is "every spelling ends up on the canonical host", not "in one
 * hop" — `http://www` legitimately takes two (Always Use HTTPS upgrades the
 * scheme, then the www rule rewrites the host). What is never acceptable is a
 * chain that loops or dead-ends, and neither is visible from a single response:
 * the status code and the Location header both look plausible on their own.
 */
async function follow(start, maxHops = 5) {
  let url = start;
  const hops = [];
  for (let i = 0; i < maxHops; i++) {
    const r = await probe(url);
    if (r.error) return { error: r.error, hops, url };
    hops.push({ url, status: r.status, location: r.location });
    const redirecting = r.status >= 300 && r.status < 400 && r.location;
    if (!redirecting) return { hops, final: url, status: r.status };
    let next;
    try { next = new URL(r.location, url).href; } catch { next = r.location; }
    if (next === url || hops.some((hop) => hop.url === next)) return { loop: true, hops, url, next };
    url = next;
  }
  return { tooMany: true, hops, url };
}

const canonical = `https://${HOST}/`;
const serving = [];
for (const url of VARIANTS) {
  const chain = await follow(url);

  if (chain.error) {
    rows.push({ ok: false, test: url, detail: `unreachable: ${chain.error}` });
    failures++;
    continue;
  }
  if (chain.loop) {
    rows.push({
      ok: false,
      test: url,
      detail: `LOOP: 301 to itself — the browser gives up with ERR_TOO_MANY_REDIRECTS`,
    });
    failures++;
    continue;
  }
  if (chain.tooMany) {
    rows.push({ ok: false, test: url, detail: `more than 5 redirects, last at ${chain.url}` });
    failures++;
    continue;
  }

  const serves = chain.status === 200;
  const finalHost = (() => { try { return new URL(chain.final).host; } catch { return ''; } })();
  const landsOnCanonical = finalHost === HOST;
  const hops = chain.hops.length - 1;
  /* Only a variant that answers 200 WITHOUT redirecting "serves" the site. A
     variant that redirects to it is doing its job, but it is not a second origin. */
  const direct = serves && hops === 0;

  if (direct) serving.push(url);

  rows.push({
    ok: landsOnCanonical && serves,
    test: url,
    detail: direct
      ? '200 — serves the site'
      : `${hops} hop${hops === 1 ? '' : 's'} → ${chain.final}${landsOnCanonical ? '' : ' (WRONG HOST)'}`,
  });
  if (!landsOnCanonical || !serves) failures++;
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
