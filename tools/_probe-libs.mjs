// tools/_probe-libs.mjs — check that vendored builds are usable with NO bundler.
import fs from 'node:fs';
import path from 'node:path';

const V = 'C:\\toolseer\\apps\\web\\vendor';

function head(file, n = 400) {
  const s = fs.readFileSync(file, 'utf8');
  return s.slice(0, n).replace(/\n/g, '\\n');
}

function bareImports(file) {
  const s = fs.readFileSync(file, 'utf8');
  const out = new Set();
  const re = /(?:^|[;\s}])(?:import|export)\s*(?:[^'"]*?\sfrom\s*)?["']([^"'.][^"']*)["']/g;
  let m;
  while ((m = re.exec(s))) out.add(m[1]);
  return [...out];
}

function report(label, file) {
  const abs = path.join(V, file);
  if (!fs.existsSync(abs)) return console.log(`${label.padEnd(16)} MISSING (${file})`);
  const size = fs.statSync(abs).size;
  const bare = bareImports(abs);
  console.log(`${label.padEnd(16)} ${String(size).padStart(9)}B  bare-imports=[${bare.join(', ') || 'none'}]`);
  console.log(`   head: ${head(abs, 220)}`);
}

report('pdf-lib', 'pdf-lib\\pdf-lib.esm.min.js');
report('qpdf.js', '@neslinesli93__qpdf-wasm\\qpdf.js');

// qpdf.js tail usually reveals the module wrapper (UMD vs ESM).
const qpdf = path.join(V, '@neslinesli93__qpdf-wasm', 'qpdf.js');
if (fs.existsSync(qpdf)) {
  const s = fs.readFileSync(qpdf, 'utf8');
  console.log('\n--- qpdf.js TAIL (500 chars) ---');
  console.log(s.slice(-500));
  console.log('\n--- qpdf.js wrapper fingerprints ---');
  for (const pat of ['export default', 'module.exports', 'define.amd', 'typeof exports', 'ENVIRONMENT_IS_NODE', "require('fs')", 'require("fs")', 'locateFile', 'noInitialRun', 'callMain']) {
    console.log(`   ${pat.padEnd(22)} ${s.includes(pat) ? 'yes' : 'no'}`);
  }
}

// pdfjs worker + module sanity
for (const f of ['pdfjs-dist\\pdf.min.mjs', 'pdfjs-dist\\pdf.worker.min.mjs']) {
  const abs = path.join(V, f);
  if (!fs.existsSync(abs)) { console.log(`${f} MISSING`); continue; }
  const s = fs.readFileSync(abs, 'utf8');
  console.log(`\n${f}: ${s.length}B  has-export=${/\bexport\s*\{/.test(s) || /\bexport default\b/.test(s)}  head=${s.slice(0, 150).replace(/\n/g, ' ')}`);
}

// jszip global check
const jz = path.join(V, 'jszip\\jszip.min.js');
if (fs.existsSync(jz)) {
  const s = fs.readFileSync(jz, 'utf8');
  console.log(`\njszip.min.js: ${s.length}B  head=${s.slice(0, 200).replace(/\n/g, ' ')}`);
}
