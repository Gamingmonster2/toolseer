#!/usr/bin/env node
/**
 * ToolSeer V3 — zero-dependency test runner.
 *
 *   node tests/run.mjs            # everything
 *   node tests/run.mjs core-pdf   # only files whose name contains "core-pdf"
 *   node tests/run.mjs --list     # list test names without running them
 *
 * Exits non-zero when anything fails. Deliberately not a framework: the point is
 * that `node tests/run.mjs` works with no package manager, in a sandbox where
 * `npm` does not.
 */

import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

import { assert, beginFile, installBrowserPrimitives, tests } from './harness.mjs';

const TEST_TIMEOUT_MS = 180_000;
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const listOnly = args.includes('--list');
const filters = args.filter((arg) => !arg.startsWith('--'));

installBrowserPrimitives();

const files = readdirSync(here)
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .filter((name) => (filters.length ? filters.some((filter) => name.includes(filter)) : true));

if (!files.length) {
  process.stdout.write(`No test files matched ${JSON.stringify(filters)} in ${here}\n`);
  process.exit(2);
}

const importFailures = [];
for (const file of files) {
  beginFile(file);
  try {
    await import(pathToFileURL(path.join(here, file)).href);
  } catch (error) {
    importFailures.push({ file, error });
  }
}

if (listOnly) {
  for (const entry of tests) process.stdout.write(`${entry.file}\t${entry.name}\n`);
  process.exit(importFailures.length ? 1 : 0);
}

let passed = 0;
const failures = [];

function report({ file, name }, error, durationMs) {
  const timing = `${durationMs.toFixed(0)} ms`;
  if (!error) {
    passed += 1;
    process.stdout.write(`  PASS  ${name}  (${timing})\n`);
    return;
  }
  failures.push({ file, name, error });
  process.stdout.write(`  FAIL  ${name}  (${timing})\n`);
  const detail = error && error.stack ? error.stack : String(error);
  process.stdout.write(`${detail.split('\n').map((line) => `        ${line}`).join('\n')}\n`);
}

async function withTimeout(fn) {
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve().then(fn),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`test timed out after ${TEST_TIMEOUT_MS} ms`)), TEST_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const startedAt = Date.now();
let lastFile = null;
for (const entry of tests) {
  if (entry.file !== lastFile) {
    lastFile = entry.file;
    process.stdout.write(`\n${entry.file}\n`);
  }
  const testStarted = Date.now();
  let error = null;
  try {
    await withTimeout(entry.fn);
  } catch (cause) {
    error = cause;
  }
  report(entry, error, Date.now() - testStarted);
}

for (const failure of importFailures) {
  failures.push({ file: failure.file, name: '(import)', error: failure.error });
  process.stdout.write(`\n${failure.file}\n  FAIL  (import)\n`);
  process.stdout.write(`${String(failure.error && failure.error.stack ? failure.error.stack : failure.error)
    .split('\n').map((line) => `        ${line}`).join('\n')}\n`);
}

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
const total = passed + failures.length;
const summary = [
  '',
  '─'.repeat(64),
  `${passed} passed, ${failures.length} failed, ${total} total  (${elapsed}s)`,
  ...failures.map((failure) => `  ✗ ${failure.file} :: ${failure.name}`),
  '─'.repeat(64),
  '',
].join('\n');

// qpdf-wasm sets process.exitCode on its own error paths, so the exit status is
// forced explicitly once the summary has actually been flushed.
process.stdout.write(summary, () => {
  process.exit(failures.length ? 1 : 0);
});

// Keep the assertion helper reachable for ad-hoc debugging without changing the
// exported surface of the harness.
void assert;
