// Debug: inspect a vendored tarball's entry names (no pipes needed).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { readTar } from './vendor.mjs';

const cache = 'C:\\toolseer\\.cache\\tarballs';
const spec = process.argv[2] || 'pdf-lib-1.17.1.tgz';
const file = path.join(cache, spec);
const buf = fs.readFileSync(file);
console.log('tarball bytes:', buf.length);
const raw = zlib.gunzipSync(buf);
console.log('gunzipped bytes:', raw.length);
const entries = readTar(raw);
console.log('entries parsed:', entries.length);
for (const e of entries.slice(0, 25)) console.log(' ', String(e.size).padStart(9), e.name);
console.log('--- names containing .min ---');
for (const e of entries) if (e.name.includes('.min')) console.log(' ', String(e.size).padStart(9), e.name);
console.log('--- first 64 bytes of archive ---');
console.log(JSON.stringify(raw.subarray(0, 64).toString('latin1')));
