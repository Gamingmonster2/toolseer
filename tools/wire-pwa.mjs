#!/usr/bin/env node
/**
 * tools/wire-pwa.mjs — put the PWA declarations into every page <head>.
 *
 * Two things must be on every page for installability and for the legacy takeover:
 *   1. <link rel="manifest" href="/manifest.webmanifest">
 *   2. a tiny classic script that captures `beforeinstallprompt` immediately.
 *      The event cannot be replayed, and a deferred ES module may run after it
 *      fires, so capturing it in the head is the difference between an install
 *      button that appears and one that never does.
 *
 * Idempotent: running it twice changes nothing. `--check` reports instead of
 * writing, which is how tools/check.mjs enforces it.
 *
 * usage: node tools/wire-pwa.mjs [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'apps', 'web');
const CHECK_ONLY = process.argv.includes('--check');

const MANIFEST_TAG = '<link rel="manifest" href="/manifest.webmanifest">';
const SNIPPET = `<script>
/* Capture the install prompt as early as possible: it can fire before the
   deferred module runs, and the event is not replayable. */
window.addEventListener('beforeinstallprompt', function (event) {
  event.preventDefault();
  window.__toolseerInstallPrompt = event;
});
</script>`;

function pages(dir = WEB, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'vendor' || entry.name === 'assets') continue;
      pages(full, acc);
    } else if (entry.name.endsWith('.html')) {
      /* offline.html is served by the service worker without the shell */
      if (entry.name !== 'offline.html') acc.push(full);
    }
  }
  return acc;
}

const targets = pages();
let changed = 0;
const problems = [];

for (const file of targets) {
  const rel = path.relative(ROOT, file).replace(/\\/g, '/');
  let html = fs.readFileSync(file, 'utf8');
  const before = html;

  if (!html.includes('rel="manifest"')) {
    if (CHECK_ONLY) problems.push(`${rel}: missing manifest link`);
    else html = html.replace(/<\/head>/i, `${MANIFEST_TAG}\n</head>`);
  }

  if (!html.includes('__toolseerInstallPrompt')) {
    if (CHECK_ONLY) problems.push(`${rel}: missing beforeinstallprompt capture`);
    else html = html.replace(/<\/head>/i, `${SNIPPET}\n</head>`);
  }

  if (!CHECK_ONLY && html !== before) {
    fs.writeFileSync(file, html);
    changed++;
    console.log(`wired  ${rel}`);
  }
}

if (CHECK_ONLY) {
  if (problems.length) {
    console.log(`❌ wire-pwa --check: ${problems.length} problem(s)`);
    for (const p of problems) console.log(`  • ${p}`);
    process.exitCode = 1;
  } else {
    console.log(`✅ wire-pwa --check: ${targets.length} pages carry the manifest link and the install-prompt capture`);
  }
} else {
  console.log(changed ? `wired ${changed} of ${targets.length} pages` : `already wired (${targets.length} pages checked)`);
}
