/**
 * ToolSeer V3 — zero-dependency test harness.
 *
 * Test files call `test(name, fn)`; `tests/run.mjs` imports them, runs them in
 * registration order and reports. Assertions are intentionally strict and print
 * real bytes on failure — a passing test here has to mean the bytes are right.
 */

/** @typedef {{ file: string, name: string, fn: () => any }} RegisteredTest */

/** @type {RegisteredTest[]} */
export const tests = [];

let currentFile = 'unknown';

/** Called by the runner before importing a test file. */
export function beginFile(name) {
  currentFile = name;
}

/**
 * Register one test.
 * @param {string} name
 * @param {() => any} fn sync or async
 */
export function test(name, fn) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('test() needs a name');
  if (typeof fn !== 'function') throw new Error(`test("${name}") needs a function`);
  tests.push({ file: currentFile, name, fn });
}

/** Error thrown by the assertions below; the runner prints it verbatim. */
export class AssertionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AssertionError';
  }
}

function fail(message) {
  throw new AssertionError(message);
}

/** Render bytes for an error message without dumping megabytes. */
export function describeBytes(value, limit = 48) {
  if (value === null || value === undefined) return String(value);
  let bytes = null;
  if (value instanceof Uint8Array) bytes = value;
  else if (ArrayBuffer.isView(value)) bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
  if (!bytes) return JSON.stringify(value);
  const head = Array.from(bytes.subarray(0, Math.min(limit, bytes.length)))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join(' ');
  const ascii = Array.from(bytes.subarray(0, Math.min(limit, bytes.length)))
    .map((byte) => (byte >= 32 && byte < 127 ? String.fromCharCode(byte) : '.'))
    .join('');
  return `<${bytes.length} bytes: ${head}${bytes.length > limit ? ' …' : ''} | ${ascii}${bytes.length > limit ? '…' : ''}>`;
}

function show(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value instanceof Uint8Array || ArrayBuffer.isView(value)) return describeBytes(value);
  if (typeof value === 'object' && value !== null) {
    try {
      const json = JSON.stringify(value);
      return json.length > 400 ? `${json.slice(0, 400)}…` : json;
    } catch (cause) {
      return String(value);
    }
  }
  return String(value);
}

function structuralEqual(a, b, path = '$') {
  if (a === b) return null;
  if (typeof a !== typeof b) return `${path}: ${show(a)} (${typeof a}) !== ${show(b)} (${typeof b})`;
  if (a === null || b === null) return `${path}: ${show(a)} !== ${show(b)}`;
  if (Array.isArray(a) || Array.isArray(b) || a instanceof Uint8Array || b instanceof Uint8Array) {
    const listA = a instanceof Uint8Array ? Array.from(a) : a;
    const listB = b instanceof Uint8Array ? Array.from(b) : b;
    if (!Array.isArray(listA) || !Array.isArray(listB)) return `${path}: ${show(a)} !== ${show(b)}`;
    if (listA.length !== listB.length) return `${path}.length: ${listA.length} !== ${listB.length}`;
    for (let i = 0; i < listA.length; i++) {
      const diff = structuralEqual(listA[i], listB[i], `${path}[${i}]`);
      if (diff) return diff;
    }
    return null;
  }
  if (typeof a === 'object') {
    const keysA = Object.keys(a).sort();
    const keysB = Object.keys(b).sort();
    if (keysA.join(',') !== keysB.join(',')) {
      return `${path} keys: [${keysA.join(', ')}] !== [${keysB.join(', ')}]`;
    }
    for (const key of keysA) {
      const diff = structuralEqual(a[key], b[key], `${path}.${key}`);
      if (diff) return diff;
    }
    return null;
  }
  return `${path}: ${show(a)} !== ${show(b)}`;
}

export const assert = {
  ok(value, message = 'expected a truthy value') {
    if (!value) fail(`${message} (got ${show(value)})`);
  },

  notOk(value, message = 'expected a falsy value') {
    if (value) fail(`${message} (got ${show(value)})`);
  },

  equal(actual, expected, message = 'values differ') {
    if (actual !== expected) fail(`${message}: ${show(actual)} !== ${show(expected)}`);
  },

  notEqual(actual, expected, message = 'values should differ') {
    if (actual === expected) fail(`${message}: both are ${show(actual)}`);
  },

  close(actual, expected, tolerance = 1e-6, message = 'numbers differ') {
    if (typeof actual !== 'number' || Number.isNaN(actual)) fail(`${message}: ${show(actual)} is not a number`);
    if (Math.abs(actual - expected) > tolerance) {
      fail(`${message}: ${actual} is not within ${tolerance} of ${expected}`);
    }
  },

  deepEqual(actual, expected, message = 'structures differ') {
    const diff = structuralEqual(actual, expected);
    if (diff) fail(`${message}: ${diff}`);
  },

  lengthOf(value, expected, message = 'unexpected length') {
    const length = value && typeof value.length === 'number' ? value.length : undefined;
    if (length !== expected) fail(`${message}: expected ${expected}, got ${show(length)}`);
  },

  includes(haystack, needle, message = 'missing expected content') {
    const found = typeof haystack === 'string' ? haystack.includes(needle) : Array.isArray(haystack) && haystack.includes(needle);
    if (!found) fail(`${message}: ${show(haystack)} does not contain ${show(needle)}`);
  },

  notIncludes(haystack, needle, message = 'unexpected content') {
    const found = typeof haystack === 'string' ? haystack.includes(needle) : Array.isArray(haystack) && haystack.includes(needle);
    if (found) fail(`${message}: ${show(haystack)} unexpectedly contains ${show(needle)}`);
  },

  match(value, pattern, message = 'pattern did not match') {
    if (typeof value !== 'string' || !pattern.test(value)) fail(`${message}: ${show(value)} !~ ${pattern}`);
  },

  bytesEqual(actual, expected, message = 'byte arrays differ') {
    const a = actual instanceof Uint8Array ? actual : new Uint8Array(actual || []);
    const b = expected instanceof Uint8Array ? expected : new Uint8Array(expected || []);
    if (a.length !== b.length) {
      fail(`${message}: length ${a.length} !== ${b.length}\n  actual:   ${describeBytes(a)}\n  expected: ${describeBytes(b)}`);
    }
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        fail(`${message}: first difference at byte ${i} (${a[i]} !== ${b[i]})\n  actual:   ${describeBytes(a)}\n  expected: ${describeBytes(b)}`);
      }
    }
  },

  /** Assert the PDF magic at the start of a byte array. */
  isPdf(bytes, message = 'not a PDF') {
    const head = new TextDecoder('latin1').decode(bytes.subarray(0, 5));
    if (head !== '%PDF-') fail(`${message}: starts with ${show(head)} ${describeBytes(bytes, 16)}`);
  },

  /**
   * Await `work` and assert it rejects with a ToolError carrying `code`.
   * Returns the error so the test can inspect `message`/`hint`.
   */
  async throwsCode(work, code, message = 'wrong error') {
    let error = null;
    try {
      await work();
    } catch (cause) {
      error = cause;
    }
    if (!error) fail(`${message}: expected ToolError('${code}') but nothing was thrown`);
    if (error.name !== 'ToolError') {
      fail(`${message}: expected ToolError('${code}') but got ${error.name}: ${error.message}`);
    }
    if (error.code !== code) {
      fail(`${message}: expected code '${code}' but got '${error.code}' (${error.message})`);
    }
    return error;
  },

  /** Await `work` and assert it does NOT reject. */
  async doesNotThrow(work, message = 'unexpected error') {
    try {
      return await work();
    } catch (cause) {
      fail(`${message}: ${cause && cause.name}: ${cause && cause.message}`);
      return undefined;
    }
  },
};

/** Install browser primitives pdf.js expects that Node does not provide. */
export function installBrowserPrimitives() {
  if (typeof globalThis.Path2D !== 'function') {
    class Path2DStub {
      addPath() {}
      moveTo() {}
      lineTo() {}
      bezierCurveTo() {}
      quadraticCurveTo() {}
      arc() {}
      arcTo() {}
      ellipse() {}
      rect() {}
      closePath() {}
    }
    globalThis.Path2D = Path2DStub;
  }
}
