// Debug the language toggle in the live browser.
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

const profile = path.join(ROOT, '.chrome-dbg-profile');
fs.rmSync(profile, { recursive: true, force: true });
const errFd = fs.openSync(path.join(ROOT, '.chrome-dbg.err'), 'w');
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
const logs = [];
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  else if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
  else if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + (m.params.exceptionDetails?.text || '?'));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  return r.result?.value;
};

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:4173/image-to-pdf' });
await sleep(2500);

console.log('lang buttons:', await evalJs(`document.querySelectorAll('.ts-lang').length`));
console.log('before click: lang=' + await evalJs(`document.documentElement.lang`),
  'stored=' + await evalJs(`localStorage.getItem('toolseer:lang')`));
await evalJs(`document.querySelector('.ts-lang').click()`);
await sleep(400);
console.log('after click 1: lang=' + await evalJs(`document.documentElement.lang`),
  'stored=' + await evalJs(`localStorage.getItem('toolseer:lang')`),
  'btn text=' + await evalJs(`document.querySelector('.ts-lang').innerText`));
await evalJs(`document.querySelector('.ts-lang').click()`);
await sleep(400);
console.log('after click 2: lang=' + await evalJs(`document.documentElement.lang`),
  'stored=' + await evalJs(`localStorage.getItem('toolseer:lang')`),
  'btn text=' + await evalJs(`document.querySelector('.ts-lang').innerText`));
console.log('console logs:', logs.slice(0, 10));

try { chrome.kill(); server.kill(); } catch {}
