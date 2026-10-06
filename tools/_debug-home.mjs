// Debug: capture the home page exception verbatim.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(process.execPath, [path.join(ROOT, 'tools', 'serve.mjs'), '4173'], { stdio: 'ignore' });
for (let i = 0; i < 40; i++) {
  try { const r = await fetch('http://127.0.0.1:4173/robots.txt'); if (r.ok) break; } catch {}
  await sleep(250);
}

const profile = path.join(ROOT, '.chrome-dbg2');
fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
const errFd = fs.openSync(path.join(ROOT, '.chrome-dbg2.err'), 'w');
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', errFd, errFd] });

let port = null;
for (let i = 0; i < 60 && !port; i++) {
  await sleep(250);
  const f = path.join(profile, 'DevToolsActivePort');
  if (fs.existsSync(f)) port = Number(fs.readFileSync(f, 'utf8').split('\n')[0]);
}

const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const events = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  else events.push(m);
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) throw new Error('EVAL THREW: ' + JSON.stringify(r.exceptionDetails, null, 1).slice(0, 1500));
  return r.result?.value;
};

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:4173/' });
await sleep(2500);

console.log('exceptions/errors:');
for (const e of events) {
  if (e.method === 'Runtime.exceptionThrown') {
    console.log('  EXC:', JSON.stringify(e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text));
  }
  if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') {
    console.log('  LOG:', e.params.entry.text.slice(0, 300));
  }
}

for (const expr of [
  `!!document.querySelector('[data-theme-value="dark"]')`,
  `document.querySelectorAll('#ts-rail-body a').length`,
  `document.documentElement.dataset.theme`,
]) {
  try { console.log('  eval', expr, '→', await evalJs(expr)); }
  catch (e) { console.log('  eval', expr, 'THREW:', e.message.slice(0, 200)); }
}

try { chrome.kill(); server.kill(); } catch {}
