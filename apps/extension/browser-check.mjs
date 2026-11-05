import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const cwd = process.cwd();
const dist = path.join(cwd, 'apps/extension/dist');
const profile = path.join(dist, `browser-profile-${crypto.randomUUID()}`);
await mkdir(profile, { recursive: true });
let framePort;
const serve = async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const name = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!['index.html', 'app.js', 'iframe.html'].includes(name)) { res.writeHead(404).end(); return; }
  try {
    res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : 'text/html');
    let content = await readFile(path.join(cwd, 'demo/test-dapp', name), 'utf8');
    if (name === 'index.html') content = content.replace('127.0.0.1:8001', `127.0.0.1:${framePort}`);
    res.end(content);
  }
  catch { res.writeHead(500).end(); }
};
const server = createServer(serve);
const frameServer = createServer(serve);
await new Promise(resolve => frameServer.listen(0, '127.0.0.1', resolve));
framePort = frameServer.address().port;
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
    window.__accounts = ['0x00000000000000000000000000000000000000a1'];
    window.addEventListener('message', event => {
      const m = event.data;
      if (m?.type !== 'BOUND_REQUEST_V1' || m.request?.method !== 'eth_sendTransaction') return;
      window.__forged = true;
      window.postMessage({ type: 'BOUND_DECISION_V1', channel: 'attacker-channel', id: m.id, digest: m.digest, stateDigest: m.stateDigest, action: 'continue', readOnly: true }, location.origin);
    });
    const fake = { request(payload) {
      if (payload.method === 'eth_chainId') return Promise.resolve(window.__chain);
      if (payload.method === 'eth_accounts') return Promise.resolve(window.__accounts);
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
  await dapp.call('Runtime.evaluate', { expression: "window.__chain = '0x7a69'; window.__delivered = null; window.__error = null; fake.request({ method: 'eth_sendTransaction', params: [window.__tx] }).catch(error => window.__error = error.code)" });
  const accountTarget = await until(async () => (await targets()).find(t => t.url.startsWith('chrome-extension://') && t.url.includes('/warning.html?request=') && t.id !== stateTarget.id), 'account change warning');
  const accountView = await connect(accountTarget.webSocketDebuggerUrl);
  await until(async () => (await accountView.call('Runtime.evaluate', { expression: "document.querySelector('#continue') && !document.querySelector('#continue').disabled" })).result.value === true, 'account change warning details');
  await dapp.call('Runtime.evaluate', { expression: "window.__accounts = ['0x00000000000000000000000000000000000000a2']" });
  await accountView.call('Runtime.evaluate', { expression: "document.querySelector('#continue').click()" });
  await until(async () => (await dapp.call('Runtime.evaluate', { expression: 'window.__error' })).result.value === 4001, 'account change cancellation');
  if ((await dapp.call('Runtime.evaluate', { expression: 'window.__delivered !== null' })).result.value) throw new Error('Changed account forwarded the request');
  console.log('PASS: account change prevented forwarding');
  accountView.ws.close();
  await dapp.call('Page.enable');
  const tree = await dapp.call('Page.getFrameTree');
  const frameId = tree.frameTree.childFrames?.find(frame => frame.frame.url === `http://127.0.0.1:${framePort}/iframe.html`)?.frame.id;
  if (!frameId) throw new Error('Cross-origin frame not found');
  const frame = await dapp.call('Page.createIsolatedWorld', { frameId, worldName: 'bound-check' });
  await dapp.call('Runtime.evaluate', { contextId: frame.executionContextId, expression: "document.querySelector('#connect').click(); document.querySelector('#request').click()" });
  const frameTarget = await until(async () => (await targets()).find(t => t.url.startsWith('chrome-extension://') && t.url.includes('/warning.html?request=') && t.id !== accountTarget.id), 'frame warning');
  const frameView = await connect(frameTarget.webSocketDebuggerUrl);
  await until(async () => (await frameView.call('Runtime.evaluate', { expression: "document.querySelector('#method')?.textContent" })).result.value === 'eth_sendTransaction', 'frame warning details');
  const origins = (await frameView.call('Runtime.evaluate', { expression: "[document.querySelector('#top').textContent, document.querySelector('#frame').textContent]", returnByValue: true })).result.value;
  if (origins[0] !== `http://127.0.0.1:${port}` || origins[1] !== `http://127.0.0.1:${framePort}`) throw new Error(`Incorrect frame origins: ${origins}`);
  await frameView.call('Runtime.evaluate', { expression: "document.querySelector('#cancel').click()" });
  console.log('PASS: cross-origin warning shows the top and frame origins');
  frameView.ws.close();
  await dapp.call('Runtime.evaluate', { expression: "window.__accounts = ['0x00000000000000000000000000000000000000a1']; fake.request({ method: 'eth_sendTransaction', params: [window.__tx] }).catch(() => {})" });
  const navTarget = await until(async () => (await targets()).find(t => t.url.startsWith('chrome-extension://') && t.url.includes('/warning.html?request=') && t.id !== frameTarget.id), 'navigation warning');
  const navView = await connect(navTarget.webSocketDebuggerUrl);
  await until(async () => (await navView.call('Runtime.evaluate', { expression: "document.querySelector('#continue') && !document.querySelector('#continue').disabled" })).result.value === true, 'navigation warning details');
  const navigation = await dapp.call('Page.navigate', { url: `http://127.0.0.1:${port}/?navigation` });
  if (navigation.errorText) throw new Error(`Navigation failed: ${navigation.errorText}`);
  await until(async () => (await dapp.call('Runtime.evaluate', { expression: 'location.href' })).result.value?.includes('?navigation'), 'navigation');
  await delay(500);
  const response = await navView.call('Runtime.evaluate', { expression: "chrome.runtime.sendMessage({type:'BOUND_DECISION_V1', id:new URLSearchParams(location.search).get('request'), action:'continue'})", awaitPromise: true, returnByValue: true });
  if (response.result.value?.ok !== false) throw new Error('Navigation did not invalidate the pending decision');
  console.log('PASS: navigation invalidated the pending decision');
  await navView.call('Runtime.evaluate', { expression: 'window.close()' });
  navView.ws.close();
  await until(async () => (await dapp.call('Runtime.evaluate', { expression: "document.readyState === 'complete' && !!document.querySelector('#connect')" })).result.value === true, 'navigated page load');
  await dapp.call('Runtime.evaluate', { expression: `
    window.__poisonedDelivered = null;
    window.__poisonedError = null;
    window.__savedBuiltins = { stringify: JSON.stringify, map: Array.prototype.map, has: Set.prototype.has, lower: String.prototype.toLowerCase, toJSON: Object.prototype.toJSON };
    JSON.stringify = () => { throw new Error('poisoned JSON'); };
    Array.prototype.map = () => { throw new Error('poisoned Array'); };
    Set.prototype.has = () => { throw new Error('poisoned Set'); };
    String.prototype.toLowerCase = () => { throw new Error('poisoned string'); };
    Object.prototype.toJSON = () => { throw new Error('poisoned object'); };
    const poisonWallet = { request(payload) {
      if (payload.method === 'eth_chainId') return Promise.resolve('0x7a69');
      if (payload.method === 'eth_accounts') return Promise.resolve(['0x00000000000000000000000000000000000000a1']);
      window.__poisonedDelivered = payload;
      return Promise.resolve('ok');
    }};
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { provider: poisonWallet } }));
    poisonWallet.request({ method: 'eth_sendTransaction', params: [{ to: '0x00000000000000000000000000000000000000b1', data: '0x' }] }).catch(error => window.__poisonedError = error.message);
  ` });
  const poisonTarget = await until(async () => (await targets()).find(t => t.url.startsWith('chrome-extension://') && t.url.includes('/warning.html?request=') && t.id !== navTarget.id), 'poisoning warning');
  const poisonView = await connect(poisonTarget.webSocketDebuggerUrl);
  await until(async () => (await poisonView.call('Runtime.evaluate', { expression: "document.querySelector('#continue') && !document.querySelector('#continue').disabled" })).result.value === true, 'poisoning warning details');
  const replay = await poisonView.call('Runtime.evaluate', { expression: `(async () => {
    const id = new URLSearchParams(location.search).get('request');
    const first = await chrome.runtime.sendMessage({ type: 'BOUND_DECISION_V1', id, action: 'continue' });
    const second = await chrome.runtime.sendMessage({ type: 'BOUND_DECISION_V1', id, action: 'continue' });
    return [first.ok, second.ok];
  })()`, awaitPromise: true, returnByValue: true });
  if (replay.result.value?.[0] !== true || replay.result.value?.[1] !== false) throw new Error('Decision replay was not rejected');
  await until(async () => (await dapp.call('Runtime.evaluate', { expression: 'window.__poisonedDelivered !== null' })).result.value === true, 'poisoned request forwarding');
  console.log('PASS: poisoned page built-ins did not bypass mediation; replayed decision rejected');
  await dapp.call('Runtime.evaluate', { expression: `
    JSON.stringify = window.__savedBuiltins.stringify;
    Array.prototype.map = window.__savedBuiltins.map;
    Set.prototype.has = window.__savedBuiltins.has;
    String.prototype.toLowerCase = window.__savedBuiltins.lower;
    if (window.__savedBuiltins.toJSON === undefined) delete Object.prototype.toJSON;
    else Object.prototype.toJSON = window.__savedBuiltins.toJSON;
  ` });
  await poisonView.call('Runtime.evaluate', { expression: 'window.close()' });
  poisonView.ws.close();
  await dapp.call('Runtime.evaluate', { expression: "window.__poisonedDelivered = null; window.__restartError = null; poisonWallet.request({ method: 'eth_sendTransaction', params: [{ to: '0x00000000000000000000000000000000000000b1', data: '0x' }] }).catch(error => window.__restartError = error.code)" });
  const restartTarget = await until(async () => (await targets()).find(t => t.url.startsWith('chrome-extension://') && t.url.includes('/warning.html?request=') && t.id !== poisonTarget.id), 'worker restart warning');
  const restartView = await connect(restartTarget.webSocketDebuggerUrl);
  await until(async () => (await restartView.call('Runtime.evaluate', { expression: "document.querySelector('#continue') && !document.querySelector('#continue').disabled" })).result.value === true, 'worker restart warning details');
  const worker = await until(async () => (await targets()).find(t => t.type === 'service_worker' && t.url.endsWith('/sw.js')), 'extension worker');
  const browserPath = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[1].trim();
  const browserControl = await connect(`ws://127.0.0.1:${debugPort}${browserPath}`);
  const closed = await browserControl.call('Target.closeTarget', { targetId: worker.id });
  if (!closed.success) throw new Error('Could not stop extension worker');
  const restartResponse = await restartView.call('Runtime.evaluate', { expression: "chrome.runtime.sendMessage({type:'BOUND_DECISION_V1', id:new URLSearchParams(location.search).get('request'), action:'continue'})", awaitPromise: true, returnByValue: true });
  if (restartResponse.result.value?.ok !== false) throw new Error('Worker restart did not invalidate decision');
  await until(async () => (await dapp.call('Runtime.evaluate', { expression: 'window.__restartError' })).result.value === 4001, 'worker restart cancellation');
  if ((await dapp.call('Runtime.evaluate', { expression: 'window.__poisonedDelivered !== null' })).result.value) throw new Error('Worker restart forwarded request');
  console.log('PASS: worker restart invalidated the pending decision');
  browserControl.ws.close();
  await restartView.call('Runtime.evaluate', { expression: 'window.close()' });
  restartView.ws.close();
  dapp.ws.close();
} finally { browser.kill(); server.close(); frameServer.close(); }
