import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const cwd = process.cwd();
const dist = path.join(cwd, 'apps/extension/dist');
const profile = path.join(dist, `browser-profile-${crypto.randomUUID()}`);
await mkdir(profile, { recursive: true });
const server = createServer(async (req, res) => {
  const name = req.url === '/' ? 'index.html' : req.url.slice(1);
  if (!['index.html', 'app.js', 'iframe.html'].includes(name)) { res.writeHead(404).end(); return; }
  try { res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : 'text/html'); res.end(await readFile(path.join(cwd, 'demo/test-dapp', name))); }
  catch { res.writeHead(500).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', '--remote-allow-origins=*', `--user-data-dir=${profile}`,
  `--disable-extensions-except=${dist}`, `--load-extension=${dist}`, `http://127.0.0.1:${port}/`
], { windowsHide: true, stdio: 'ignore' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label) {
  for (let i = 0; i < 100; i++) { try { const result = await fn(); if (result) return result; } catch {} await delay(100); }
  throw new Error(`Timed out waiting for ${label}`);
}
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let next = 0; const pending = new Map();
  ws.onmessage = event => { const data = JSON.parse(event.data); const entry = pending.get(data.id); if (entry) { pending.delete(data.id); data.error ? entry.reject(new Error(data.error.message)) : entry.resolve(data.result); } };
  return { ws, call(method, params = {}) { return new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); } };
}
try {
  const debugPort = await until(async () => (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0], 'browser startup');
  const targets = async () => (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const page = await until(async () => (await targets()).find(t => t.url === `http://127.0.0.1:${port}/`), 'dApp page');
  const dapp = await connect(page.webSocketDebuggerUrl);
  await until(async () => (await dapp.call('Runtime.evaluate', { expression: "document.readyState === 'complete' && !!document.querySelector('#connect')" })).result.value === true, 'page load');
  console.log('Startup:', JSON.stringify(await dapp.call('Runtime.evaluate', { expression: "window.__errors=[]; window.addEventListener('error', e => window.__errors.push(e.message)); document.querySelector('#connect').click(); JSON.stringify({result:document.querySelector('#result').textContent, enabled:!document.querySelector('#request').disabled, errors:window.__errors})" })));
  await dapp.call('Runtime.evaluate', { expression: "document.querySelector('#request').click()" });
  let warning;
  try { warning = await until(async () => (await targets()).find(t => t.url.startsWith('chrome-extension://') && t.url.includes('/warning.html?request=')), 'extension warning'); }
  catch (error) {
    console.log('Targets:', JSON.stringify((await targets()).map(({type, url}) => ({type, url}))));
    console.log('Page state:', JSON.stringify(await dapp.call('Runtime.evaluate', { expression: "document.querySelector('#result').textContent" })));
    console.log('Errors:', JSON.stringify(await dapp.call('Runtime.evaluate', { expression: "window.__errors" , returnByValue: true })));
    throw error;
  }
  const popup = await connect(warning.webSocketDebuggerUrl);
  await until(async () => (await popup.call('Runtime.evaluate', { expression: "document.querySelector('#method')?.textContent" })).result.value === 'eth_sendTransaction', 'warning details');
  await popup.call('Runtime.evaluate', { expression: "document.querySelector('#cancel').click()" });
  const result = await until(async () => { const value = (await dapp.call('Runtime.evaluate', { expression: "document.querySelector('#result').textContent" })).result.value; return value.includes('Request cancelled:') ? value : null; }, 'cancel response');
  if (!result.includes('(4001)')) throw new Error(`Unexpected result: ${result}`);
  console.log(`PASS: extension warning opened and cancellation returned ${result}`);
  popup.ws.close();
  for (const api of ['request', 'send', 'sendAsync']) {
    await dapp.call('Runtime.evaluate', { expression: `document.querySelector('#result').textContent = 'Waiting'; document.querySelector('#${api}').click()` });
    const target = await until(async () => (await targets()).find(t => t.url.startsWith('chrome-extension://') && t.url.includes('/warning.html?request=') && t.id !== warning.id), `${api} warning`);
    const view = await connect(target.webSocketDebuggerUrl);
    await until(async () => (await view.call('Runtime.evaluate', { expression: "document.querySelector('#continue') && !document.querySelector('#continue').disabled" })).result.value === true, `${api} continue`);
    await view.call('Runtime.evaluate', { expression: "document.querySelector('#continue').click()" });
    await until(async () => (await dapp.call('Runtime.evaluate', { expression: "document.querySelector('#result').textContent" })).result.value?.includes('Fake wallet returned:'), `${api} result`);
    console.log(`PASS: ${api} continued to fake wallet`);
    warning = target;
    view.ws.close();
  }
  await dapp.call('Runtime.evaluate', { expression: `
    window.__delivered = null;
    window.__forged = false;
    window.__chain = '0x7a69';
    window.addEventListener('message', event => {
      const m = event.data;
      if (m?.type !== 'BOUND_REQUEST_V1' || m.request?.method !== 'eth_sendTransaction') return;
      window.__forged = true;
      window.postMessage({ type: 'BOUND_DECISION_V1', channel: 'attacker-channel', id: m.id, digest: m.digest, stateDigest: m.stateDigest, action: 'continue', readOnly: true }, location.origin);
    });
    const fake = { request(payload) {
      if (payload.method === 'eth_chainId') return Promise.resolve(window.__chain);
      if (payload.method === 'eth_accounts') return Promise.resolve(['0x00000000000000000000000000000000000000a1']);
      window.__delivered = payload;
      return Promise.resolve('ok');
    }};
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { provider: fake } }));
    window.__tx = { to: '0x00000000000000000000000000000000000000b1', data: '0x095ea7b300000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000001' };
    window.__originalRequest = JSON.stringify({ method: 'eth_sendTransaction', params: [window.__tx] });
    fake.request({ method: 'eth_sendTransaction', params: [window.__tx] });
    window.__tx.data = '0x';
  ` });
  const probeTarget = await until(async () => (await targets()).find(t => t.url.startsWith('chrome-extension://') && t.url.includes('/warning.html?request=') && t.id !== warning.id), 'forgery warning');
  const probe = await connect(probeTarget.webSocketDebuggerUrl);
  await until(async () => (await dapp.call('Runtime.evaluate', { expression: 'window.__forged' })).result.value === true, 'forged decision');
  await delay(300);
  if ((await dapp.call('Runtime.evaluate', { expression: 'window.__delivered !== null' })).result.value) throw new Error('Forged decision forwarded the request');
  await until(async () => (await probe.call('Runtime.evaluate', { expression: "document.querySelector('#continue') && !document.querySelector('#continue').disabled" })).result.value === true, 'forgery warning details');
  await probe.call('Runtime.evaluate', { expression: "document.querySelector('#continue').click()" });
  await until(async () => (await dapp.call('Runtime.evaluate', { expression: 'window.__delivered !== null' })).result.value === true, 'frozen request forwarding');
  if (!(await dapp.call('Runtime.evaluate', { expression: 'JSON.stringify(window.__delivered) === window.__originalRequest' })).result.value) throw new Error('Forwarded request was mutated');
  console.log('PASS: forged decision ignored and original request forwarded after Continue');
  probe.ws.close();
  await dapp.call('Runtime.evaluate', { expression: "window.__delivered = null; window.__error = null; fake.request({ method: 'eth_sendTransaction', params: [window.__tx] }).catch(error => window.__error = error.code)" });
  const stateTarget = await until(async () => (await targets()).find(t => t.url.startsWith('chrome-extension://') && t.url.includes('/warning.html?request=') && t.id !== probeTarget.id), 'state change warning');
  const stateView = await connect(stateTarget.webSocketDebuggerUrl);
  await until(async () => (await stateView.call('Runtime.evaluate', { expression: "document.querySelector('#continue') && !document.querySelector('#continue').disabled" })).result.value === true, 'state change warning details');
  await dapp.call('Runtime.evaluate', { expression: "window.__chain = '0x1'" });
  await stateView.call('Runtime.evaluate', { expression: "document.querySelector('#continue').click()" });
  await until(async () => (await dapp.call('Runtime.evaluate', { expression: 'window.__error' })).result.value === 4001, 'state change cancellation');
  if ((await dapp.call('Runtime.evaluate', { expression: 'window.__delivered !== null' })).result.value) throw new Error('Changed chain forwarded the request');
  console.log('PASS: chain change prevented forwarding');
  stateView.ws.close();
  dapp.ws.close();
} finally { browser.kill(); server.close(); }
