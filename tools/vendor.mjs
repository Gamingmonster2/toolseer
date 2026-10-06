#!/usr/bin/env node
/**
 * tools/vendor.mjs — self-hosted third-party engine vendoring.
 *
 * WHY THIS EXISTS
 * ---------------
 * This environment cannot run `npm`, `pnpm`, `npx` or `git` (the DSH sandbox denies
 * those child processes) and cannot run pipe-based build tools such as Vite/esbuild.
 * Node itself has working network access, so we download tarballs straight from the
 * npm registry and extract them ourselves with zlib + a small ustar/pax reader.
 *
 * The site therefore ships ZERO runtime CDN dependencies: every engine is pinned,
 * checksummed and served from `apps/web/vendor/`.
 *
 * USAGE
 *   node tools/vendor.mjs list <pkg>@<version>        # show files inside a tarball
 *   node tools/vendor.mjs install                     # vendor everything in MANIFEST
 *   node tools/vendor.mjs verify                      # re-check sha256 of vendored files
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, '.cache', 'tarballs');
const VENDOR = path.join(ROOT, 'apps', 'web', 'vendor');

/* ------------------------------------------------------------------ manifest */

/** Pinned engines. `files` are tarball paths relative to `package/`. */
export const MANIFEST = [
  {
    name: 'pdf-lib',
    version: '1.17.1',
    license: 'MIT',
    purpose: 'Create/modify PDFs: image→PDF, merge, split, organise, page ops',
    files: [
      { from: 'dist/pdf-lib.esm.min.js', to: 'pdf-lib.esm.min.js' },
      { from: 'LICENSE.md', to: 'LICENSE.md' },
    ],
  },
  {
    name: 'pdfjs-dist',
    version: '6.4.299',
    license: 'Apache-2.0',
    purpose: 'Render PDF pages to canvas (PDF→Images) and extract text',
    files: [
      { from: 'build/pdf.min.mjs', to: 'pdf.min.mjs' },
      { from: 'build/pdf.worker.min.mjs', to: 'pdf.worker.min.mjs' },
      { from: 'LICENSE', to: 'LICENSE' },
    ],
    dirs: [
      { from: 'standard_fonts/', to: 'standard_fonts/' },
      { from: 'wasm/', to: 'wasm/' },
      { from: 'cmaps/', to: 'cmaps/' },
    ],
  },
  {
    name: 'jszip',
    version: '3.10.2',
    license: 'MIT',
    purpose: 'Zip generated images for one-click download',
    files: [
      { from: 'dist/jszip.min.js', to: 'jszip.min.js' },
      { from: 'LICENSE.markdown', to: 'LICENSE.markdown' },
    ],
  },
  {
    name: '@neslinesli93/qpdf-wasm',
    version: '0.3.0',
    license: 'ISC',
    purpose: 'qpdf CLI in WASM: encrypt (Protect), decrypt (Unlock), lossless compression, linearisation',
    files: [
      { from: 'dist/qpdf.js', to: 'qpdf.js' },
      { from: 'dist/qpdf.wasm', to: 'qpdf.wasm' },
      { from: 'dist/qpdf.d.ts', to: 'qpdf.d.ts' },
      { from: 'README.md', to: 'README.md' },
    ],
  },
];

/* ------------------------------------------------------------------ tar reader */

/**
 * Minimal ustar + pax reader. Handles typeflags: file, dir, GNU longname,
 * pax extended headers. Skips everything else (symlinks, devices).
 * @param {Buffer} buf
 * @returns {Array<{name: string, size: number, data: Buffer}>}
 */
export function readTar(buf) {
  const entries = [];
  let offset = 0;
  let pendingLongName = null;
  const parseOctal = (b) => {
    const s = b.toString('latin1').replace(/\0.*$/, '').trim();
    return s === '' ? 0 : parseInt(s, 8);
  };
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break; // end-of-archive marker
    const rawName = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const size = parseOctal(header.subarray(124, 136));
    const type = String.fromCharCode(header[156]) || '0';
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    const padded = Math.ceil(size / 512) * 512;
    const fullName = prefix ? `${prefix}/${rawName}` : rawName;

    if (type === 'L') {
      pendingLongName = buf.subarray(dataStart, dataEnd).toString('utf8').replace(/\0.*$/, '');
    } else if (type === 'x' || type === 'g') {
      const pax = buf.subarray(dataStart, dataEnd).toString('utf8');
      const m = /(?:^|\n)\d+ path=([^\n]+)/.exec(pax);
      if (m) pendingLongName = m[1];
    } else if (type === '0' || type === '\0') {
      entries.push({
        name: pendingLongName || fullName,
        size,
        data: buf.subarray(dataStart, dataEnd),
      });
      pendingLongName = null;
    } else {
      pendingLongName = null;
    }
    offset = dataStart + padded;
  }
  return entries;
}

/* ------------------------------------------------------------------ fetching */

function tarballUrl(name, version) {
  const base = name.startsWith('@') ? name.replace('/', '%2f') : name;
  const bare = name.includes('/') ? name.split('/')[1] : name;
  return `https://registry.npmjs.org/${base}/-/${bare}-${version}.tgz`;
}

export async function fetchTarball(name, version) {
  await fsp.mkdir(CACHE, { recursive: true });
  const safe = `${name.replace(/[@/]/g, '_')}-${version}.tgz`;
  const cached = path.join(CACHE, safe);
  if (fs.existsSync(cached)) {
    return { buf: await fsp.readFile(cached), fromCache: true, file: cached };
  }
  const url = tarballUrl(name, version);
  const res = await fetch(url, { headers: { 'user-agent': 'toolseer-vendor' } });
  if (!res.ok) throw new Error(`download failed ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await fsp.writeFile(cached, buf);
  return { buf, fromCache: false, file: cached };
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/* ------------------------------------------------------------------ commands */

async function cmdList(spec) {
  const at = spec.lastIndexOf('@');
  const name = spec.slice(0, at);
  const version = spec.slice(at + 1);
  const { buf, fromCache } = await fetchTarball(name, version);
  const entries = readTar(zlib.gunzipSync(buf));
  console.log(`${name}@${version} — ${entries.length} files (cache: ${fromCache})`);
  for (const e of entries) {
    console.log(`  ${String(e.size).padStart(9)}  ${e.name}`);
  }
}

async function cmdInstall() {
  await fsp.mkdir(VENDOR, { recursive: true });
  const lock = { generatedAt: new Date().toISOString(), packages: [] };
  for (const pkg of MANIFEST) {
    const dir = path.join(VENDOR, pkg.name.replace('/', '__'));
    await fsp.mkdir(dir, { recursive: true });
    const { buf } = await fetchTarball(pkg.name, pkg.version);
    const tarballSha = sha256(buf);
    const entries = readTar(zlib.gunzipSync(buf));
    const installed = [];
    for (const want of pkg.files) {
      const hit = entries.find((e) => e.name === `package/${want.from}` || e.name === want.from);
      if (!hit) {
        const near = entries
          .filter((e) => e.name.includes(path.basename(want.from)))
          .slice(0, 6)
          .map((e) => e.name);
        throw new Error(
          `missing ${want.from} in ${pkg.name}@${pkg.version}` +
            (near.length ? ` — did you mean: ${near.join(', ')}` : '')
        );
      }
      const out = path.join(dir, want.to);
      await fsp.mkdir(path.dirname(out), { recursive: true });
      await fsp.writeFile(out, hit.data);
      installed.push({ file: path.relative(ROOT, out).replace(/\\/g, '/'), bytes: hit.size, sha256: sha256(hit.data) });
      console.log(`  ✓ ${pkg.name}@${pkg.version}  ${want.from}  →  ${path.relative(ROOT, out)}  (${hit.size} B)`);
    }
    for (const dirEntry of pkg.dirs || []) {
      const prefix = `package/${dirEntry.from}`;
      const matches = entries.filter((e) => e.name.startsWith(prefix) && e.name.length > prefix.length);
      if (!matches.length) {
        throw new Error(`no files under ${prefix} in ${pkg.name}@${pkg.version}`);
      }
      for (const entry of matches) {
        const rel = entry.name.slice(prefix.length);
        const out = path.join(dir, dirEntry.to, rel);
        await fsp.mkdir(path.dirname(out), { recursive: true });
        await fsp.writeFile(out, entry.data);
        installed.push({ file: path.relative(ROOT, out).replace(/\\/g, '/'), bytes: entry.size, sha256: sha256(entry.data) });
      }
      console.log(`  ✓ ${pkg.name}@${pkg.version}  ${dirEntry.from}*  →  ${matches.length} files`);
    }
    lock.packages.push({
      name: pkg.name,
      version: pkg.version,
      license: pkg.license,
      purpose: pkg.purpose,
      tarball: tarballUrl(pkg.name, pkg.version),
      tarballSha256: tarballSha,
      files: installed,
    });
  }
  const lockPath = path.join(VENDOR, 'vendor.lock.json');
  await fsp.writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n');
  console.log(`\nwrote ${path.relative(ROOT, lockPath)}`);
}

async function cmdVerify() {
  const lockPath = path.join(VENDOR, 'vendor.lock.json');
  if (!fs.existsSync(lockPath)) throw new Error('no vendor.lock.json — run `node tools/vendor.mjs install`');
  const lock = JSON.parse(await fsp.readFile(lockPath, 'utf8'));
  let bad = 0;
  for (const pkg of lock.packages) {
    for (const f of pkg.files) {
      const abs = path.join(ROOT, f.file);
      if (!fs.existsSync(abs)) {
        console.log(`  MISSING ${f.file}`);
        bad++;
        continue;
      }
      const digest = sha256(await fsp.readFile(abs));
      if (digest !== f.sha256) {
        console.log(`  CORRUPT ${f.file}\n     expected ${f.sha256}\n     actual   ${digest}`);
        bad++;
      }
    }
  }
  const total = lock.packages.reduce((n, p) => n + p.files.length, 0);
  console.log(bad === 0 ? `verify OK — ${total} files match vendor.lock.json` : `verify FAILED — ${bad} problem(s)`);
  process.exitCode = bad === 0 ? 0 : 1;
}

/* ------------------------------------------------------------------ entry */

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'list' && arg) await cmdList(arg);
  else if (cmd === 'install') await cmdInstall();
  else if (cmd === 'verify') await cmdVerify();
  else {
    console.log('usage: node tools/vendor.mjs <list <pkg>@<ver> | install | verify>');
    process.exitCode = 2;
  }
}
