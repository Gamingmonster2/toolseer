/**
 * Page-side test inside the real app, over the WebView's own debug protocol.
 *
 * It injects a real PDF into the page's file input using JavaScript alone — no
 * picker involved — and reports what the tool does with it. That isolates the two
 * halves of the problem: if this succeeds, the engine and the page are fine and the
 * fault is entirely in the Android hand-off.
 */
import fs from 'node:fs';

const PDF = fs.readFileSync('C:/toolseer/.cache/test.pdf').toString('base64');
const BASE = 'http://127.0.0.1:9222';

const list = await (await fetch(`${BASE}/json/list`)).json();
const page = list.find((t) => t.type === 'page');
if (!page) { console.error('no page target; targets were:', JSON.stringify(list.map((t) => t.type))); process.exit(1); }
console.log('attached to:', page.url);

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const waiting = new Map();
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  if (msg.method === 'Runtime.consoleAPICalled') {
    const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
    if (text) console.log('  [page console]', text.slice(0, 220));
  }
};
function send(method, params = {}) {
  const messageId = ++id;
  return new Promise((resolve) => {
    waiting.set(messageId, resolve);
    ws.send(JSON.stringify({ id: messageId, method, params }));
  });
}
async function evaluate(expression) {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.result?.exceptionDetails) return { error: res.result.exceptionDetails.text };
  return { value: res.result?.result?.value };
}

await send('Runtime.enable');
await send('Page.enable');

console.log('\n1) current page');
console.log('   ', (await evaluate('document.title + "  @  " + location.pathname')).value);

console.log('\n2) navigating to the page-numbers tool (a PDF tool, the kind that fails)');
await evaluate(`location.href = '/add-page-numbers/index.html'`);
await new Promise((r) => setTimeout(r, 3500));
console.log('   ', (await evaluate('document.title + "  @  " + location.pathname')).value);

const state = await evaluate(`JSON.stringify({
  fileInput: !!document.querySelector('input[type=file]'),
  accept: (document.querySelector('input[type=file]')||{}).accept || null,
  runButton: !!document.querySelector('#ts-run'),
  toolsCount: document.querySelectorAll('.ts-tool').length
})`);
console.log('   page state:', state.value);

console.log('\n3) injecting a real 3-page PDF into the page, bypassing the Android picker');
const injected = await evaluate(`(function () {
  var bytes = Uint8Array.from(atob('${PDF}'), function (c) { return c.charCodeAt(0); });
  var file = new File([bytes], 'toolseer-test.pdf', { type: 'application/pdf' });
  var input = document.querySelector('input[type=file]');
  if (!input) return 'no file input on this page';
  var dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return 'dispatched change with ' + input.files.length + ' file(s)';
})()`);
console.log('   ', injected.value || injected.error);

await new Promise((r) => setTimeout(r, 2500));
const after = await evaluate(`JSON.stringify({
  filesListed: document.querySelectorAll('.ts-file').length,
  runDisabled: (document.querySelector('#ts-run')||{}).disabled,
  alerts: Array.from(document.querySelectorAll('.ts-alert')).map(function(a){return a.textContent.trim().slice(0,80)})
})`);
console.log('   after injection:', after.value);

console.log('\n4) pressing RUN and waiting for the result');
await evaluate(`document.querySelector('#ts-run').click()`);
await new Promise((r) => setTimeout(r, 6000));
const result = await evaluate(`JSON.stringify({
  resultCard: !!document.querySelector('.ts-result'),
  resultText: (document.querySelector('.ts-result')||{}).textContent ? document.querySelector('.ts-result').textContent.trim().slice(0,160) : null,
  errors: Array.from(document.querySelectorAll('.ts-alert--error')).map(function(a){return a.textContent.trim().slice(0,120)}),
  progress: (document.querySelector('.ts-progress')||{}).textContent || null
})`);
console.log('   ', result.value);
ws.close();
