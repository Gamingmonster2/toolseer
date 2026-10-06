#!/usr/bin/env node
/**
 * ⚠ UNVERIFIED SCAFFOLD.
 * Nothing in apps/desktop/ has been compiled or built in the environment where this was written
 * (no Rust/cargo, and installing it was not approved). This is the one script here that runs with the
 * tooling that exists in that environment, because it only needs `node`.
 *
 * Honest status: `--check` was run there and passes. `--download` was NOT run - it would pull ~32 MB
 * of third-party binaries into the repository and shell out to `tar` - so the download, verify and
 * extract paths are unexercised code. Treat the first real run on a build machine as a test.
 *
 * Usage
 *   node apps/desktop/tools/fetch-engines.mjs --check        (default) validate the manifest, print the plan
 *   node apps/desktop/tools/fetch-engines.mjs --verify-only  hash the payload already on disk against the pins
 *   node apps/desktop/tools/fetch-engines.mjs --download     fetch, verify sha256, extract into src-tauri/payload
 *   node apps/desktop/tools/fetch-engines.mjs --help
 *
 * Why every artifact comes from a pinned tag URL and never from a "latest" URL: a released installer
 * has to stay reproducible. Mutable URLs appear in the manifest only as evidence and this script
 * refuses to follow them.
 *
 * Why extraction shells out to `tar`: modern Windows ships bsdtar, which reads both .tgz and .zip.
 * Hand-rolling a tar/zip parser in this script would be untested binary-format code for no gain.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { cp, mkdir, readdir, readFile, rename, rm, stat, unlink } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(HERE, '..');
const MANIFEST_PATH = path.join(APP_DIR, 'engine-manifest.json');
const PAYLOAD_DIR = path.join(APP_DIR, 'src-tauri', 'payload');

const HEX64 = /^[0-9a-f]{64}$/;
const MIB = 1048576;

const banner = (text) => console.log(`\n${text}\n${'-'.repeat(text.length)}`);
const fmt = (bytes) => `${bytes.toLocaleString('en-US')} bytes (${(bytes / MIB).toFixed(1)} MiB)`;

/** Strict validation. A wrong pin must fail the build; it must never be a warning. */
function validate(manifest) {
  const problems = [];
  const soft = [];
  const need = (value, label) => {
    if (value === undefined || value === null || value === '') problems.push(`missing ${label}`);
    return value;
  };

  need(manifest.schemaVersion, 'schemaVersion');
  if (manifest.schemaVersion !== undefined && manifest.schemaVersion !== 1) {
    problems.push(`schemaVersion is ${manifest.schemaVersion}, this script understands 1`);
  }
  need(manifest.app?.version, 'app.version');
  need(manifest.app?.identifier, 'app.identifier');

  const release = manifest.release ?? {};
  const repo = need(release.repo, 'release.repo');
  if (repo === 'OWNER/REPO') soft.push('release.repo is still the placeholder OWNER/REPO: fine for --check, refused by --download');
  if (typeof release.installerAssetStable === 'string' && release.installerAssetStable.includes('{version}')) {
    problems.push('release.installerAssetStable must not contain {version}: releases/latest/download/<name> needs a constant file name');
  }

  // The licence policy is the reason this architecture exists. If it ever disappears from the
  // manifest, that is a defect, not a simplification.
  const excluded = manifest.policy?.excluded ?? [];
  if (!excluded.some((entry) => entry.name === 'Stirling-PDF')) {
    problems.push('policy.excluded must keep the Stirling-PDF entry explaining why it is not bundled');
  }
  if (!manifest.policy?.attribution?.file) problems.push('policy.attribution.file must name the notices file');

  const artifacts = [
    ['engines.qpdf artifact', manifest.engines?.qpdf?.artifacts?.[0], manifest.engines?.qpdf],
    ['engines.pdfium artifact', manifest.engines?.pdfium?.artifacts?.[0], manifest.engines?.pdfium],
  ];
  for (const [label, artifact, engine] of artifacts) {
    if (!artifact || !engine) {
      problems.push(`missing ${label}`);
      continue;
    }
    if (!HEX64.test(artifact.sha256 ?? '')) problems.push(`${label}: sha256 must be 64 lowercase hex characters, with no "sha256:" prefix`);
    if (!Number.isInteger(artifact.sizeBytes) || artifact.sizeBytes <= 0) problems.push(`${label}: sizeBytes must be a positive integer`);
    if (!/^https:\/\//.test(artifact.url ?? '')) problems.push(`${label}: url must be https`);
    if (/\/releases\/latest\//.test(artifact.url ?? '')) problems.push(`${label}: url is a mutable "latest" download; pin the tag instead`);
    if (!engine.licence) problems.push(`${label}: engine must record its licence`);
  }

  if (manifest.engines?.ocr?.where !== 'webview') {
    problems.push('engines.ocr.where must stay "webview": bundling a native OCR engine was evaluated and rejected, see engines.ocr.rejectedOption');
  }
  if (manifest.engines?.ocr?.rejectedOption?.buildExamined?.sha256 !== null) {
    soft.push('the rejected tesseract build no longer records sha256: null - if a checksum now exists, re-evaluate the decision');
  }

  for (const crate of manifest.rustCrates ?? []) {
    if (!crate.licence) problems.push(`rustCrates.${crate.name} must record its licence`);
  }
  if (!Array.isArray(manifest.sources) || manifest.sources.length === 0) {
    problems.push('sources[] must list the URLs the pins were copied from');
  }

  return { problems, soft };
}

function plan(manifest) {
  const qpdf = manifest.engines.qpdf;
  const pdfium = manifest.engines.pdfium;
  const qpdfArtifact = qpdf.artifacts[0];
  const pdfiumArtifact = pdfium.artifacts[0];
  const sizes = manifest.sizes.configurations;
  const recommended = sizes.find((entry) => entry.id === 'recommended');
  const abandoned = sizes.find((entry) => entry.id === 'abandoned-stirling-bundle');

  banner('Fetch plan');
  console.log(`  app            ${manifest.app.productName} ${manifest.app.version} (${manifest.app.identifier})`);
  console.log('');
  console.log(`  ${pdfiumArtifact.file}`);
  console.log(`    ${pdfium.version} / ${pdfium.revision}  BSD-3-Clause (+Apache-2.0 for bundled parts)`);
  console.log(`    ${pdfiumArtifact.url}`);
  console.log(`    ${fmt(pdfiumArtifact.sizeBytes)}  sha256 ${pdfiumArtifact.sha256}`);
  console.log(`    paired with ${pdfium.cratePairing?.crate} ${pdfium.cratePairing?.version} - ${pdfium.cratePairing?.whyThisRevision ?? ''}`);
  console.log('');
  console.log(`  ${qpdfArtifact.file}`);
  console.log(`    ${qpdf.version}  ${qpdf.licence}`);
  console.log(`    ${qpdfArtifact.url}`);
  console.log(`    ${fmt(qpdfArtifact.sizeBytes)}  sha256 ${qpdfArtifact.sha256}`);
  console.log('');
  console.log(`  ocr            ${manifest.engines.ocr.where} (${manifest.engines.ocr.engine}); a native engine was evaluated and rejected`);
  console.log(`  payload into   ${PAYLOAD_DIR}`);
  console.log('');
  console.log('  SIZE - all estimates except the artifact sizes above:');
  for (const entry of sizes) {
    if (entry.id === 'abandoned-stirling-bundle') continue;
    console.log(`    ${entry.id.padEnd(20)} installer ${Math.round(entry.estimateInstallerBytesMin / 1e6)}-${Math.round(entry.estimateInstallerBytesMax / 1e6)} MB, installed ${Math.round(entry.estimateInstalledBytesMin / 1e6)}-${Math.round(entry.estimateInstalledBytesMax / 1e6)} MB`);
  }
  if (abandoned) {
    console.log(`    ${'abandoned (licence)'.padEnd(20)} installer ${Math.round(abandoned.estimateInstallerBytesMin / 1e6)}-${Math.round(abandoned.estimateInstallerBytesMax / 1e6)} MB - the JVM + Stirling bundle the licence blocker killed`);
  }
  if (recommended) {
    console.log(`  headline       installer ${Math.round(recommended.estimateInstallerBytesMin / 1e6)}-${Math.round(recommended.estimateInstallerBytesMax / 1e6)} MB (ESTIMATE)`);
  }
  console.log('');
  console.log(`  release repo   ${manifest.release.repo}`);
  console.log(`  stable link    ${manifest.release.stableDownloadUrl}`);
  console.log('');
  console.log('  Extraction performed by --download on a build machine (tar is bsdtar on Windows 10+):');
  console.log(`    tar -xf ${path.join(PAYLOAD_DIR, pdfiumArtifact.file)} -C ${path.join(PAYLOAD_DIR, 'pdfium')} bin/pdfium.dll`);
  console.log(`    then: copy the qpdf executable and the DLLs beside it from the archive into payload/qpdf/bin/`);
}

async function sha256File(file) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: hash.digest('hex'), bytes };
}

async function verifyExisting(manifest) {
  banner('Verify payload on disk');
  let ok = true;
  const targets = [
    ['pdfium.dll', path.join(PAYLOAD_DIR, 'pdfium', 'bin', 'pdfium.dll'), null],
    ['qpdf.exe  ', path.join(PAYLOAD_DIR, 'qpdf', 'bin', 'qpdf.exe'), null],
    ['qpdf zip  ', path.join(PAYLOAD_DIR, manifest.engines.qpdf.artifacts[0].file), manifest.engines.qpdf.artifacts[0]],
    ['pdfium tgz', path.join(PAYLOAD_DIR, manifest.engines.pdfium.artifacts[0].file), manifest.engines.pdfium.artifacts[0]],
  ];

  for (const [label, file, pin] of targets) {
    try {
      const info = await stat(file);
      const { sha256 } = await sha256File(file);
      if (pin) {
        const good = sha256 === pin.sha256 && info.size === pin.sizeBytes;
        ok = ok && good;
        console.log(`  ${good ? 'ok  ' : 'FAIL'} ${label} ${file}`);
        console.log(`        size   ${fmt(info.size)}   (pin ${fmt(pin.sizeBytes)})`);
        console.log(`        sha256 ${sha256}`);
      } else {
        // Extracted binaries have no upstream digest of their own; their integrity comes from the
        // archive they came out of, so record the hash here for the next run to compare against.
        console.log(`  ok   ${label} ${file}`);
        console.log(`        size   ${fmt(info.size)}`);
        console.log(`        sha256 ${sha256}   (no upstream pin: compare across builds)`);
      }
    } catch (error) {
      ok = false;
      console.log(`  MISS ${label} ${file} (${error.code ?? error.message})`);
    }
  }
  if (!ok) process.exitCode = 1;
  return ok;
}

async function downloadVerified(label, artifact, destination) {
  const part = `${destination}.part`;
  console.log(`  ..   ${label}: GET ${artifact.url}`);
  const response = await fetch(artifact.url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status} ${response.statusText}`);
  if (!response.body) throw new Error(`${label}: empty response body`);

  const hash = createHash('sha256');
  let bytes = 0;
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      bytes += chunk.length;
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(part));

  const actual = hash.digest('hex');
  if (bytes !== artifact.sizeBytes) {
    await unlink(part).catch(() => {});
    throw new Error(`${label}: size mismatch, expected ${artifact.sizeBytes}, got ${bytes}`);
  }
  if (actual !== artifact.sha256) {
    await unlink(part).catch(() => {});
    throw new Error(`${label}: sha256 mismatch\n       expected ${artifact.sha256}\n       actual   ${actual}`);
  }
  await rename(part, destination);
  console.log(`  ok   ${label}: ${fmt(bytes)} verified`);
}

/** bsdtar handles both .tgz and .zip, which is why there is one extraction path. */
function extract(archive, destination, members = []) {
  execFileSync('tar', ['-xf', archive, '-C', destination, ...members], { stdio: 'inherit' });
}

async function copyQpdfRuntime(fromDir, toDir) {
  const wanted = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/^qpdf\.exe$/i.test(entry.name) || /\.dll$/i.test(entry.name)) wanted.push(full);
    }
  }
  await walk(fromDir);
  if (!wanted.some((file) => /qpdf\.exe$/i.test(file))) {
    throw new Error(`no qpdf.exe found under ${fromDir}: the archive layout changed, inspect it by hand`);
  }
  await mkdir(toDir, { recursive: true });
  for (const file of wanted) await cp(file, path.join(toDir, path.basename(file)));
  console.log(`  ok   qpdf runtime: ${wanted.length} file(s) copied into ${toDir}`);
}

async function download(manifest) {
  if (manifest.release.repo === 'OWNER/REPO') {
    throw new Error('refusing to build a release payload while release.repo is still OWNER/REPO');
  }
  const qpdfArtifact = manifest.engines.qpdf.artifacts[0];
  const pdfiumArtifact = manifest.engines.pdfium.artifacts[0];
  await mkdir(PAYLOAD_DIR, { recursive: true });

  banner('Download and verify');
  await downloadVerified('pdfium', pdfiumArtifact, path.join(PAYLOAD_DIR, pdfiumArtifact.file));
  await downloadVerified('qpdf', qpdfArtifact, path.join(PAYLOAD_DIR, qpdfArtifact.file));

  banner('Extract');
  const pdfiumDir = path.join(PAYLOAD_DIR, 'pdfium');
  await mkdir(pdfiumDir, { recursive: true });
  extract(path.join(PAYLOAD_DIR, pdfiumArtifact.file), pdfiumDir, ['bin/pdfium.dll']);
  console.log(`  ok   pdfium.dll -> ${path.join(pdfiumDir, 'bin', 'pdfium.dll')}`);

  const staging = path.join(PAYLOAD_DIR, '.extract-qpdf');
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  extract(path.join(PAYLOAD_DIR, qpdfArtifact.file), staging);
  await copyQpdfRuntime(staging, path.join(PAYLOAD_DIR, 'qpdf', 'bin'));
  await rm(staging, { recursive: true, force: true });

  await verifyExisting(manifest);
  console.log('\n  Next: cargo tauri build (see apps/desktop/README.md).');
}

const HELP = `fetch-engines.mjs - download and verify the pinned PDF engine payload.

  --check        (default) validate engine-manifest.json and print what a build would fetch. No network.
  --verify-only  hash the payload already in src-tauri/payload/ against the manifest pins.
  --download     fetch the archives, verify sha256 while streaming, then extract the runtime files.
  --help         this text.

Nothing here has been compiled or run as part of a build. See the banner at the top of the file.`;

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP);
    return;
  }

  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));

  banner('engine-manifest.json');
  console.log(`  file   ${MANIFEST_PATH}`);
  console.log(`  status ${manifest._status}`);

  const { problems, soft } = validate(manifest);
  if (problems.length > 0) {
    banner('Manifest problems');
    for (const problem of problems) console.log(`  x  ${problem}`);
    console.error(`\n  ${problems.length} problem(s) must be fixed before a build.\n`);
    process.exitCode = 1;
    return;
  }

  banner('Manifest checks');
  console.log('  ok   required fields present');
  console.log('  ok   the Stirling-PDF exclusion is still recorded with its licence reason');
  console.log('  ok   pinned urls are https and immutable (no /releases/latest/)');
  console.log('  ok   sha256 fields are 64 lowercase hex characters');
  console.log(`  ok   every engine and Rust crate records its licence (${(manifest.rustCrates ?? []).length} crates)`);
  console.log(`  ok   OCR is set to ${manifest.engines.ocr.where} rather than a bundled native engine`);
  console.log(`  ok   ${manifest.sources.length} source URLs recorded for the pins`);
  for (const note of soft) console.log(`  !    open risk: ${note}`);

  plan(manifest);

  if (argv.includes('--download')) {
    await download(manifest);
    return;
  }
  if (argv.includes('--verify-only')) {
    await verifyExisting(manifest);
    return;
  }

  banner('Result');
  console.log('  Manifest is internally consistent.');
  console.log('  Payload is NOT present, NOT downloaded and NOT verified. Run --download on a build machine.');
  for (const note of soft) console.log(`  Open risk: ${note} - see docs/DESKTOP.md.`);
}

await main();
