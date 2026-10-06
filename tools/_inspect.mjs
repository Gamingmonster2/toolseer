// tools/_inspect.mjs — list a tarball's entries, filtered (avoids huge output).
// usage: node tools/_inspect.mjs <pkg>@<ver> [substring]
import { fetchTarball, readTar } from './vendor.mjs';
import zlib from 'node:zlib';

const spec = process.argv[2];
const filter = process.argv[3] || '';
const dumpPath = process.argv[4] || '';
const at = spec.lastIndexOf('@');
const name = spec.slice(0, at);
const version = spec.slice(at + 1);

const { buf, fromCache } = await fetchTarball(name, version);
const entries = readTar(zlib.gunzipSync(buf));

if (dumpPath) {
  const hit = entries.find((e) => e.name === dumpPath || e.name === `package/${dumpPath}`);
  if (!hit) {
    console.log('NOT FOUND: ' + dumpPath);
    process.exitCode = 1;
  } else {
    console.log(`===== ${hit.name} (${hit.size} bytes) =====`);
    console.log(hit.data.toString('utf8'));
  }
} else {
  console.log(`${name}@${version}  entries=${entries.length}  cache=${fromCache}  tarball=${buf.length}B`);
  const roots = new Map();
  for (const e of entries) {
    const parts = e.name.split('/');
    const key = parts.length > 2 ? parts.slice(0, 3).join('/') : e.name;
    if (!roots.has(key)) roots.set(key, { n: 0, bytes: 0 });
    const r = roots.get(key);
    r.n++; r.bytes += e.size;
  }
  console.log('--- top-level layout (first 40) ---');
  let i = 0;
  for (const [k, v] of roots) {
    if (i++ >= 40) break;
    console.log(`  ${String(v.n).padStart(5)} files ${String(Math.round(v.bytes / 1024)).padStart(8)}KB  ${k}`);
  }
  if (filter) {
    console.log(`--- names containing "${filter}" ---`);
    for (const e of entries) if (e.name.includes(filter)) console.log(`  ${String(e.size).padStart(9)}  ${e.name}`);
  }
}
