#!/usr/bin/env node
/**
 * tools/serve.mjs — zero-dependency static server for local preview.
 *
 * The site has no build step, so this serves `apps/web` exactly as Cloudflare
 * Pages would: `/slug` resolves to `apps/web/slug/index.html`, `.mjs` is served
 * as JavaScript (module workers need the right MIME type), and the Pages
 * `_headers` / `_redirects` files are honoured for the common cases.
 *
 * usage: node tools/serve.mjs [port] [--host 127.0.0.1]
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/**
 * Split a Cloudflare source path into segment matchers.
 * A segment is either literal, a bare placeholder (`:year`), or a placeholder
 * with a literal suffix (`:slug.html`) — that last form is why a naive
 * "starts with a colon means a whole segment" emulation is dangerous: it makes
 * `/:year/:month/:slug.html` swallow `/assets/js/ui/pwa.js`.
 */
function compileSource(from) {
  return from.split('/').map((segment) => {
    const m = /^:([A-Za-z_][A-Za-z0-9_]*)(.*)$/.exec(segment);
    if (!m) return { literal: segment };
    return { name: m[1], suffix: m[2] || '' };
  });
}

/**
 * Parse a Pages `_redirects` file: `from  to  [status]`.
 * Supports a trailing `*` splat and Cloudflare's `:placeholder` syntax in both
 * its bare and suffixed forms, so the local preview exercises the same rules
 * production will.
 */
async function loadRedirects() {
  const file = path.join(ROOT, '_redirects');
  if (!fs.existsSync(file)) return [];
  const text = await fsp.readFile(file, 'utf8');
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const [from, to, status] = line.split(/\s+/);
      return { from, to, status: Number(status) || 302, segments: compileSource(from), splat: from.endsWith('/*') };
    });
}

/** Match one rule against a path; returns captured values or null. */
function matchRule(rule, urlPath) {
  if (rule.splat) {
    const prefix = rule.from.slice(0, -1);
    if (!urlPath.startsWith(prefix)) return null;
    return { splat: urlPath.slice(prefix.length) };
  }

  const pathParts = urlPath.split('/');
  if (rule.segments.length !== pathParts.length) return null;

  const captures = {};
  for (let i = 0; i < rule.segments.length; i++) {
    const seg = rule.segments[i];
    const part = pathParts[i];
    if (seg.literal !== undefined) {
      if (seg.literal !== part) return null;
      continue;
    }
    if (seg.suffix) {
      if (!part.endsWith(seg.suffix) || part.length <= seg.suffix.length) return null;
      captures[seg.name] = part.slice(0, part.length - seg.suffix.length);
    } else {
      if (!part) return null;
      captures[seg.name] = part;
    }
  }
  return captures;
}

/** Fill `:name` and `:splat` placeholders in a destination. */
function expandTarget(to, captures) {
  return to
    .replace(/:splat/g, captures.splat != null ? captures.splat : '')
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (m, name) => (captures[name] != null ? captures[name] : m));
}

const args = process.argv.slice(2);
const portArg = args.find((a) => /^\d+$/.test(a));
const hostIdx = args.indexOf('--host');
const PORT = Number(portArg || process.env.PORT || 4173);
const HOST = hostIdx >= 0 ? args[hostIdx + 1] : '127.0.0.1';

const redirects = await loadRedirects();

/** Block traversal outside ROOT. */
function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const resolved = path.resolve(root, '.' + path.posix.normalize(decoded));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return resolved;
}

async function statFile(p) {
  try {
    const s = await fsp.stat(p);
    return s;
  } catch {
    return null;
  }
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  let urlPath = req.url || '/';

  for (const rule of redirects) {
    const captures = matchRule(rule, urlPath);
    if (!captures) continue;
    if (rule.status === 200) {
      /* Cloudflare "rewrite" rule (e.g. `/ / 200`): serve the target content
         at this URL instead of redirecting. */
      urlPath = expandTarget(rule.to, captures);
      continue;
    }
    res.writeHead(rule.status, { Location: expandTarget(rule.to, captures) });
    return res.end();
  }

  // Like Pages: /slug/ behaves as /slug
  if (urlPath.length > 1 && urlPath.endsWith('/')) urlPath = urlPath.slice(0, -1);

  let target = safeJoin(ROOT, urlPath);
  if (!target) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  let stats = await statFile(target);
  if (stats && stats.isDirectory()) {
    target = path.join(target, 'index.html');
    stats = await statFile(target);
  }
  if (!stats && !path.extname(target)) {
    const alt = path.join(target, 'index.html');
    const altStats = await statFile(alt);
    if (altStats) { target = alt; stats = altStats; }
  }
  if (!stats) {
    const notFound = path.join(ROOT, '404.html');
    const body = fs.existsSync(notFound) ? await fsp.readFile(notFound) : 'Not found';
    res.writeHead(404, { 'Content-Type': fs.existsSync(notFound) ? MIME['.html'] : 'text/plain' });
    res.end(body);
    console.log(`404 ${urlPath}`);
    return;
  }

  const ext = path.extname(target).toLowerCase();
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store',
    // Mirrors the CSP in apps/web/_headers; keeps local preview honest.
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
  const body = await fsp.readFile(target);
  headers['Content-Length'] = String(body.length);
  res.writeHead(200, headers);
  res.end(body);
  console.log(`200 ${urlPath}  ${path.relative(ROOT, target)}  ${body.length}B  ${Date.now() - started}ms`);
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`ToolSeer preview  →  http://${shown}:${PORT}/`);
  console.log(`serving           →  ${ROOT}`);
  console.log('press Ctrl+C to stop');
});
