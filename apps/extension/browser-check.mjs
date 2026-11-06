import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { findBrowser } from './browser-path.mjs';

const cwd = process.cwd();
const dist = path.join(cwd, 'apps/extension/dist');
const executable = await findBrowser();
const profile = await mkdtemp(path.join(tmpdir(), 'bound-browser-check-'));
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
const browser = spawn(executable, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-port=0', '--remote-allow-origins=*', `--user-data-dir=${profile}`,
  `--disable-extensions-except=${dist}`, `--load-extension=${dist}`, `http://127.0.0.1:${port}/`
], { windowsHide: true, stdio: 'ignore' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, attempts = 100) {
  for (let i = 0; i < attempts; i++) { try { const result = await fn(); if (result) return result; } catch {} await delay(100); }
  throw new Error(`Timed out waiting for ${label}`);
}
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.close(); reject(new Error('DevTools connection timed out')); }, 5000);
    ws.onopen = () => { clearTimeout(timer); resolve(); };
    ws.onerror = error => { clearTimeout(timer); reject(error); };
  });
  let next = 0; const pending = new Map();
  ws.onmessage = event => { const data = JSON.parse(event.data); const entry = pending.get(data.id); if (entry) { pending.delete(data.id); data.error ? entry.reject(new Error(data.error.message)) : entry.resolve(data.result); } };
  ws.onclose = () => { for (const entry of pending.values()) entry.reject(new Error('DevTools connection closed')); pending.clear(); };
  return { ws, call(method, params = {}) { return new Promise((resolve, reject) => { const id = ++next; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); }); } };
}
async function closeBy(view, expression) {
  try { await view.call('Runtime.evaluate', { expression }); }
  catch (error) { if (error.message !== 'DevTools connection closed') throw error; }
}
try {
  const debugPort = await until(async () => (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0], 'browser startup');
  const targets = async () => (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const waitClosed = async target => until(async () => !(await targets()).some(item => item.id === target.id), 'warning window closing');
  const page = await until(async () => (await targets()).find(t => t.url === `http://127.0.0.1:${port}/`), 'dApp page');
  const dapp = await connect(page.webSocketDebuggerUrl);
  await until(async () => (await dapp.call('Runtime.evaluate', { expression: "document.readyState === 'complete' && !!document.querySelector('#connect')" })).result.value === true, 'page load');
  console.log('Startup:', JSON.stringify(await dapp.call('Runtime.evaluate', { expression: "window.__errors=[]; window.addEventListener('error', e => window.__errors.push(e.message)); document.querySelector('#connect').click(); JSON.stringify({result:document.querySelector('#result').textContent, enabled:!document.querySelector('#request').disabled, errors:window.__errors})" })));
  const startupReads = await dapp.call('Runtime.evaluate', { expression: "Promise.all([provider.request({method:'metamask_getProviderState'}), provider.request({method:'metamask_getProviderState'})])", awaitPromise: true, returnByValue: true });
  if (startupReads.exceptionDetails || startupReads.result.value?.length !== 2 || (await targets()).some(t => t.url.startsWith('chrome-extension://') && t.url.includes('/warning.html?request='))) throw new Error('Provider state reads should pass without warning windows');
  console.log('PASS: repeated MetaMask provider-state reads do not open warnings');
  await dapp.call('Page.reload');
  await until(async () => (await dapp.call('Runtime.evaluate', { expression: "document.readyState === 'complete' && !!document.querySelector('#connect')" })).result.value === true, 'page reload');
  await dapp.call('Runtime.evaluate', { expression: "document.querySelector('#connect').click()" });
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
  if ((await popup.call('Runtime.evaluate', { expression: "document.querySelectorAll('#verdict').length" })).result.value !== 1) throw new Error('Warning must show exactly one verdict');
  const revoke = (await popup.call('Runtime.evaluate', { expression: "({hidden: document.querySelector('#approval-links').hidden, href: document.querySelector('.approval-link')?.href, guidance: document.querySelector('#approval-links').textContent, pairs: document.querySelectorAll('.approval-pair').length})", returnByValue: true })).result.value;
  if (revoke.hidden || revoke.pairs !== 1 || revoke.href !== 'https://revoke.cash/?chainId=31337' || !revoke.guidance.includes('Find the same pair')) throw new Error('Revocation guidance is missing or misleading');
  await closeBy(popup, "document.querySelector('#cancel').click()");
  const result = await until(async () => { const value = (await dapp.call('Runtime.evaluate', { expression: "document.querySelector('#result').textContent" })).result.value; return value.includes('Request cancelled:') ? value : null; }, 'cancel response');
  if (!result.includes('(4001)')) throw new Error(`Unexpected result: ${result}`);
  console.log(`PASS: extension warning opened and cancellation returned ${result}`);
  popup.ws.close();
  await waitClosed(warning);
  for (const api of ['request', 'send', 'sendAsync']) {
    await dapp.call('Runtime.evaluate', { expression: `document.querySelector('#result').textContent = 'Waiting'; document.querySelector('#${api}').click()` });
    const target = await until(async () => (await targets()).find(t => t.url.startsWith('chrome-extension://') && t.url.includes('/warning.html?request=') && t.id !== warning.id), `${api} warning`);
    const view = await connect(target.webSocketDebuggerUrl);
    await until(async () => (await view.call('Runtime.evaluate', { expression: "document.querySelector('#continue') && !document.querySelector('#continue').disabled" })).result.value === true, `${api} continue`);
    await closeBy(view, "document.querySelector('#continue').click()");
    await until(async () => (await dapp.call('Runtime.evaluate', { expression: "document.querySelector('#result').textContent" })).result.value?.includes('Fake wallet returned:'), `${api} result`);
    console.log(`PASS: ${api} continued to fake wallet`);
    warning = target;
    view.ws.close();
    await waitClosed(target);
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
  await closeBy(probe, "document.querySelector('#continue').click()");
  await until(async () => (await dapp.call('Runtime.evaluate', { expression: 'window.__delivered !== null' })).result.value === true, 'frozen request forwarding');
  if (!(await dapp.call('Runtime.evaluate', { expression: 'JSON.stringify(window.__delivered) === window.__originalRequest' })).result.value) throw new Error('Forwarded request was mutated');
  console.log('PASS: forged decision ignored and original request forwarded after Continue');
  probe.ws.close();
  await waitClosed(probeTarget);
  await dapp.call('Runtime.evaluate', { expression: "window.__delivered = null; window.__error = null; fake.request({ method: 'eth_sendTransaction', params: [window.__tx] }).catch(error => window.__error = error.code)" });
  const stateTarget = await until(async () => (await targets()).find(t => t.url.startsWith('chrome-extension://') && t.url.includes('/warning.html?request=') && t.id !== probeTarget.id), 'state change warning');
  const stateView = await connect(stateTarget.webSocketDebuggerUrl);
  await until(async () => (await stateView.call('Runtime.evaluate', { expression: "document.querySelector('#continue') && !document.querySelector('#continue').disabled" })).result.value === true, 'state change warning details');
  await dapp.call('Runtime.evaluate', { expression: "window.__chain = '0x1'" });
  await closeBy(stateView, "document.querySelector('#continue').click()");
  await until(async () => (await dapp.call('Runtime.evaluate', { expression: 'window.__error' })).result.value === 4001, 'state change cancellation');
  if ((await dapp.call('Runtime.evaluate', { expression: 'window.__delivered !== null' })).result.value) throw new Error('Changed chain forwarded the request');
  console.log('PASS: chain change prevented forwarding');
  stateView.ws.close();
  await waitClosed(stateTarget);
  await dapp.call('Runtime.evaluate', { expression: "window.__chain = '0x7a69'; window.__delivered = null; window.__error = null; fake.request({ method: 'eth_sendTransaction', params: [window.__tx] }).catch(error => window.__error = error.code)" });
  const accountTarget = await until(async () => (await targets()).find(t => t.url.startsWith('chrome-extension://') && t.url.includes('/warning.html?request=') && t.id !== stateTarget.id), 'account change warning');
  const accountView = await connect(accountTarget.webSocketDebuggerUrl);
  await until(async () => (await accountView.call('Runtime.evaluate', { expression: "document.querySelector('#continue') && !document.querySelector('#continue').disabled" })).result.value === true, 'account change warning details');
  await dapp.call('Runtime.evaluate', { expression: "window.__accounts = ['0x00000000000000000000000000000000000000a2']" });
  await closeBy(accountView, "document.querySelector('#continue').click()");
  await until(async () => (await dapp.call('Runtime.evaluate', { expression: 'window.__error' })).result.value === 4001, 'account change cancellation');
  if ((await dapp.call('Runtime.evaluate', { expression: 'window.__delivered !== null' })).result.value) throw new Error('Changed account forwarded the request');
  console.log('PASS: account change prevented forwarding');
  accountView.ws.close();
  await waitClosed(accountTarget);
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
  await closeBy(frameView, "document.querySelector('#cancel').click()");
  console.log('PASS: cross-origin warning shows the top and frame origins');
  frameView.ws.close();
  await waitClosed(frameTarget);
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
  await closeBy(navView, 'window.close()');
  navView.ws.close();
  await waitClosed(navTarget);
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
  await closeBy(poisonView, 'window.close()');
  poisonView.ws.close();
  await waitClosed(poisonTarget);
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
  await restartView.call('Runtime.evaluate', { expression: "chrome.storage.session.set({boundCoverage:{}})", awaitPromise: true });
  await dapp.call('Runtime.evaluate', { expression: "window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{provider:Object.freeze({request(){return Promise.resolve('ok')}})}}))" });
  await until(async () => {
    const result = await restartView.call('Runtime.evaluate', { expression: "chrome.storage.session.get('boundCoverage').then(data => Object.values(data.boundCoverage || {}).some(item => item.bypassPossible))", awaitPromise: true, returnByValue: true });
    return result.result.value === true;
  }, 'unpatchable provider coverage');
  console.log('PASS: unpatchable provider reported bypass possible');
  await closeBy(restartView, 'window.close()');
  restartView.ws.close();
  await waitClosed(restartTarget);
  await dapp.call('Runtime.evaluate', { expression: "window.__poisonedDelivered = null; window.__crossCancelled = 0; for (let i=0; i<2; i++) poisonWallet.request({method:'eth_sendTransaction',params:[{to:'0x00000000000000000000000000000000000000b1',data:'0x'}]}).catch(error => { if (error.code === 4001) window.__crossCancelled++; })" });
  const pair = await until(async () => { const list = (await targets()).filter(t => t.url.startsWith('chrome-extension://') && t.url.includes('/warning.html?request=')); return list.length === 2 ? list : null; }, 'two warning windows');
  const firstView = await connect(pair[0].webSocketDebuggerUrl);
  const secondView = await connect(pair[1].webSocketDebuggerUrl);
  for (const view of [firstView, secondView]) await until(async () => (await view.call('Runtime.evaluate', { expression: "document.querySelector('#continue') && !document.querySelector('#continue').disabled" })).result.value === true, 'paired warning details');
  const otherId = new URL(pair[1].url).searchParams.get('request');
  const crossDecision = await firstView.call('Runtime.evaluate', { expression: `chrome.runtime.sendMessage({type:'BOUND_DECISION_V1',id:${JSON.stringify(otherId)},action:'continue'})`, awaitPromise: true, returnByValue: true });
  if (crossDecision.result.value?.ok !== false) throw new Error('Wrong warning window decided another request');
  const crossDetails = await firstView.call('Runtime.evaluate', { expression: `chrome.runtime.sendMessage({type:'BOUND_GET_V1',id:${JSON.stringify(otherId)}})`, awaitPromise: true, returnByValue: true });
  if (crossDetails.result.value !== null) throw new Error('Wrong warning window read another request');
  const spoofedWindow = await firstView.call('Runtime.evaluate', { expression: `(async () => { const original = location.search; history.replaceState(null, '', '?request=' + ${JSON.stringify(otherId)}); const result = await chrome.runtime.sendMessage({type:'BOUND_DECISION_V1',id:${JSON.stringify(otherId)},action:'continue'}); history.replaceState(null, '', original); return result; })()`, awaitPromise: true, returnByValue: true });
  if (spoofedWindow.result.value?.ok !== false) throw new Error('Warning window identity was not enforced');
  await closeBy(firstView, "document.querySelector('#cancel').click()");
  await closeBy(secondView, "document.querySelector('#cancel').click()");
  await until(async () => (await dapp.call('Runtime.evaluate', { expression: 'window.__crossCancelled' })).result.value === 2, 'paired cancellations');
  if ((await dapp.call('Runtime.evaluate', { expression: 'window.__poisonedDelivered !== null' })).result.value) throw new Error('Wrong warning forwarded a request');
  firstView.ws.close(); secondView.ws.close();
  await waitClosed(pair[0]); await waitClosed(pair[1]);
  console.log('PASS: warning windows cannot read or decide each other’s requests');
  await dapp.call('Runtime.evaluate', { expression: "window.__requestError = null; poisonWallet.request({method:'wallet_addEthereumChain',params:[]}).catch(error => window.__requestError = error.code)" });
  const unsupportedTarget = await until(async () => (await targets()).find(t => t.url.startsWith('chrome-extension://') && t.url.includes('/warning.html?request=') && t.id !== restartTarget.id), 'unsupported warning');
  const unsupportedView = await connect(unsupportedTarget.webSocketDebuggerUrl);
  await until(async () => (await unsupportedView.call('Runtime.evaluate', { expression: "document.querySelector('#coverage')?.textContent" })).result.value?.includes('unsupported'), 'unsupported coverage');
  if ((await unsupportedView.call('Runtime.evaluate', { expression: "document.querySelector('#verdict').textContent" })).result.value !== 'unsupported · no score') throw new Error('Unsupported request has an incorrect verdict');
  if (!(await unsupportedView.call('Runtime.evaluate', { expression: "document.querySelector('#notice').textContent" })).result.value.includes('cannot assess')) throw new Error('Unsupported warning is unclear');
  await closeBy(unsupportedView, "document.querySelector('#cancel').click()");
  await until(async () => (await dapp.call('Runtime.evaluate', { expression: 'window.__requestError' })).result.value === 4001, 'unsupported cancellation');
  unsupportedView.ws.close();
  await waitClosed(unsupportedTarget);
  console.log('PASS: unsupported method warned without a green verdict');
  await dapp.call('Runtime.evaluate', { expression: "window.__poisonedDelivered = null; poisonWallet.request({method:'eth_sign',params:['0x00000000000000000000000000000000000000a1','0x00']})" });
  const signTarget = await until(async () => (await targets()).find(t => t.url.startsWith('chrome-extension://') && t.url.includes('/warning.html?request=') && t.id !== unsupportedTarget.id), 'escalated warning');
  const signView = await connect(signTarget.webSocketDebuggerUrl);
  await until(async () => (await signView.call('Runtime.evaluate', { expression: "document.querySelector('#verdict')?.textContent" })).result.value?.includes('escalated'), 'escalated verdict');
  if (!(await signView.call('Runtime.evaluate', { expression: "document.querySelector('#notice').textContent" })).result.value.includes('Blind signatures')) throw new Error('Blind signature warning is unclear');
  const premature = await signView.call('Runtime.evaluate', { expression: "chrome.runtime.sendMessage({type:'BOUND_DECISION_V1',id:new URLSearchParams(location.search).get('request'),action:'continue',confirmation:''})", awaitPromise: true, returnByValue: true });
  if (premature.result.value?.ok !== false) throw new Error('Escalated request continued without confirmation');
  await closeBy(signView, "document.querySelector('#confirmation').value='I UNDERSTAND'; document.querySelector('#confirmation').dispatchEvent(new Event('input')); document.querySelector('#continue').click()");
  await until(async () => (await dapp.call('Runtime.evaluate', { expression: 'window.__poisonedDelivered?.method' })).result.value === 'eth_sign', 'confirmed signature forwarding');
  signView.ws.close();
  await waitClosed(signTarget);
  console.log('PASS: escalated warning requires typed confirmation');
  await dapp.call('Runtime.evaluate', { expression: "window.__poisonedDelivered = null; window.__requestError = null; poisonWallet.request({method:'eth_sendTransaction',params:[{to:'0x00000000000000000000000000000000000000b1',data:'0x'+'00'.repeat(140000)}]}).catch(error => window.__requestError = error.code)" });
  await until(async () => (await dapp.call('Runtime.evaluate', { expression: 'window.__requestError' })).result.value === -32602, 'oversized rejection');
  const largeTarget = await until(async () => (await targets()).find(t => t.url.startsWith('chrome-extension://') && t.url.includes('/warning.html?request=') && t.id !== signTarget.id), 'oversized warning');
  const largeView = await connect(largeTarget.webSocketDebuggerUrl);
  await until(async () => (await largeView.call('Runtime.evaluate', { expression: "document.querySelector('#notice')?.textContent" })).result.value?.includes('could not be frozen'), 'oversized warning details');
  if ((await dapp.call('Runtime.evaluate', { expression: 'window.__poisonedDelivered !== null' })).result.value) throw new Error('Oversized request was forwarded');
  await closeBy(largeView, "document.querySelector('#cancel').click()");
  largeView.ws.close();
  await waitClosed(largeTarget);
  console.log('PASS: oversized request rejected before wallet');
  await dapp.call('Runtime.evaluate', { expression: "window.__requestError = null; window.__poisonedDelivered = null; poisonWallet.request({method:'eth_sendTransaction',params:[{to:'0x00000000000000000000000000000000000000b1',data:'0x'}]}).catch(error => window.__requestError = error.code)" });
  const dismissedTarget = await until(async () => (await targets()).find(t => t.url.startsWith('chrome-extension://') && t.url.includes('/warning.html?request=') && t.id !== largeTarget.id), 'dismissed warning');
  const dismissedView = await connect(dismissedTarget.webSocketDebuggerUrl);
  await until(async () => (await dismissedView.call('Runtime.evaluate', { expression: "document.querySelector('#continue') && !document.querySelector('#continue').disabled" })).result.value === true, 'dismissed warning details');
  await closeBy(dismissedView, 'window.close()');
  dismissedView.ws.close();
  await until(async () => (await dapp.call('Runtime.evaluate', { expression: 'window.__requestError' })).result.value === 4001, 'dismissed warning cancellation');
  if ((await dapp.call('Runtime.evaluate', { expression: 'window.__poisonedDelivered !== null' })).result.value) throw new Error('Dismissed warning forwarded the request');
  await waitClosed(dismissedTarget);
  console.log('PASS: closing the warning cancels the request');
  const wrongFrameId = await until(async () => (await dapp.call('Page.getFrameTree')).frameTree.childFrames?.find(item => item.frame.url === `http://127.0.0.1:${framePort}/iframe.html`)?.frame.id, 'cross-origin frame after navigation');
  const wrongFrame = await dapp.call('Page.createIsolatedWorld', { frameId: wrongFrameId, worldName: 'bound-origin-check' });
  const makeRequest = `(async () => {
    const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
    const request = {method:'eth_sendTransaction',params:[{to:'0x00000000000000000000000000000000000000b1',data:'0x'}]};
    const state = {chainId:'0x7a69',accounts:['0x00000000000000000000000000000000000000a1']};
    return {type:'BOUND_REQUEST_V1',id:'998:' + crypto.randomUUID(),request,state,digest:await hash(JSON.stringify(request)),stateDigest:await hash(JSON.stringify(state))};
  })()`;
  const wrongSource = await dapp.call('Runtime.evaluate', { contextId: wrongFrame.executionContextId, expression: `${makeRequest}.then(message => parent.postMessage(message, '*'))`, awaitPromise: true });
  const wrongOrigin = await dapp.call('Runtime.evaluate', { expression: `${makeRequest}.then(message => window.dispatchEvent(new MessageEvent('message',{source:window,origin:'https://wrong.example',data:message})))`, awaitPromise: true });
  if (wrongSource.exceptionDetails || wrongOrigin.exceptionDetails) throw new Error('Could not send wrong-source or wrong-origin test message');
  await delay(500);
  if ((await targets()).some(t => t.url.startsWith('chrome-extension://') && t.url.includes('/warning.html?request='))) throw new Error('Wrong message source or origin opened a warning');
  console.log('PASS: wrong bridge source and origin ignored');
  await dapp.call('Runtime.evaluate', { expression: `
    window.__unmatchedReply = null;
    window.__unmatchedId = '999:' + crypto.randomUUID();
    window.addEventListener('message', event => {
      if (event.data?.type === 'BOUND_DECISION_V1' && event.data.id === window.__unmatchedId) window.__unmatchedReply = event.data;
    });
    (async () => {
      const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
      const request = { method: 'eth_chainId' };
      window.postMessage({ type: 'BOUND_REQUEST_V1', id: window.__unmatchedId, request, state: null, digest: await hash(JSON.stringify(request)), stateDigest: await hash('null') }, location.origin);
    })();
  ` });
  await delay(1000);
  if ((await dapp.call('Runtime.evaluate', { expression: 'window.__unmatchedReply !== null' })).result.value) throw new Error('An unmatched bridge reply exposed the channel to the page');
  console.log('PASS: unmatched bridge replies did not expose the channel');
  await dapp.call('Runtime.evaluate', { expression: "window.__requestError = null; poisonWallet.request({method:'eth_sendTransaction',params:[{to:'0x00000000000000000000000000000000000000b1',data:'0x'}]}).catch(error => window.__requestError = error.code)" });
  const timeoutTarget = await until(async () => (await targets()).find(t => t.url.startsWith('chrome-extension://') && t.url.includes('/warning.html?request=') && t.id !== largeTarget.id), 'timeout warning');
  await until(async () => (await dapp.call('Runtime.evaluate', { expression: 'window.__requestError' })).result.value === 4001, 'request deadline', 600);
  const timeoutView = await connect(timeoutTarget.webSocketDebuggerUrl);
  const expired = await timeoutView.call('Runtime.evaluate', { expression: "chrome.runtime.sendMessage({type:'BOUND_DECISION_V1',id:new URLSearchParams(location.search).get('request'),action:'continue'})", awaitPromise: true, returnByValue: true });
  if (expired.result.value?.ok !== false) throw new Error('Expired request accepted a decision');
  await closeBy(timeoutView, 'window.close()');
  timeoutView.ws.close();
  await waitClosed(timeoutTarget);
  console.log('PASS: unanswered request expired and could not be continued');
  await dapp.call('Runtime.evaluate', { expression: `
    window.__hungError = null;
    window.__hungForwarded = false;
    const hungWallet = { request(payload) {
      if (payload.method === 'eth_chainId') return Promise.resolve('0x7a69');
      if (payload.method === 'eth_accounts') return new Promise(() => {});
      window.__hungForwarded = true;
      return Promise.resolve('ok');
    }};
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { provider: hungWallet } }));
    hungWallet.request({ method: 'eth_sendTransaction', params: [{ to: '0x00000000000000000000000000000000000000b1', data: '0x' }] }).catch(error => window.__hungError = error.code);
  ` });
  const hungTarget = await until(async () => (await targets()).find(t => t.url.startsWith('chrome-extension://') && t.url.includes('/warning.html?request=')), 'unresponsive provider warning');
  const hungView = await connect(hungTarget.webSocketDebuggerUrl);
  await until(async () => (await hungView.call('Runtime.evaluate', { expression: "document.querySelector('#notice')?.textContent" })).result.value?.includes('could not be verified'), 'unresponsive provider details');
  if (!(await hungView.call('Runtime.evaluate', { expression: "document.querySelector('#continue').hidden" })).result.value) throw new Error('Unresponsive provider allowed continuation');
  await closeBy(hungView, "document.querySelector('#cancel').click()");
  await until(async () => (await dapp.call('Runtime.evaluate', { expression: 'window.__hungError' })).result.value === 4001, 'unresponsive provider cancellation');
  if ((await dapp.call('Runtime.evaluate', { expression: 'window.__hungForwarded' })).result.value) throw new Error('Unresponsive provider forwarded request');
  hungView.ws.close(); await waitClosed(hungTarget);
  console.log('PASS: unresponsive provider state times out and cannot continue');
  await dapp.call('Runtime.evaluate', { expression: `
    window.__eventError = null;
    window.__eventForwarded = false;
    window.__walletEvents = {};
    const eventWallet = {
      on(name, callback) { window.__walletEvents[name] = callback; },
      request(payload) {
        if (payload.method === 'eth_chainId') return Promise.resolve('0x7a69');
        if (payload.method === 'eth_accounts') return new Promise(resolve => { window.__resolveAccounts = resolve; });
        window.__eventForwarded = true;
        return Promise.resolve('ok');
      }
    };
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { provider: eventWallet } }));
    eventWallet.request({ method: 'eth_sendTransaction', params: [{ to: '0x00000000000000000000000000000000000000b1', data: '0x' }] }).catch(error => window.__eventError = error.code);
    window.__walletEvents.accountsChanged(['0x00000000000000000000000000000000000000a1']);
    window.__resolveAccounts(['0x00000000000000000000000000000000000000a1']);
  ` });
  await until(async () => (await dapp.call('Runtime.evaluate', { expression: 'window.__eventError' })).result.value === 4001, 'state event cancellation during preparation');
  if ((await dapp.call('Runtime.evaluate', { expression: 'window.__eventForwarded' })).result.value) throw new Error('State event during preparation forwarded request');
  if ((await targets()).some(t => t.url.startsWith('chrome-extension://') && t.url.includes('/warning.html?request='))) throw new Error('State event during preparation opened a warning');
  console.log('PASS: wallet state event during preparation cancels even when state returns to the same value');
  await dapp.call('Runtime.evaluate', { expression: "window.__floodErrors = 0; window.__poisonedDelivered = null; for (let i=0; i<9; i++) poisonWallet.request({method:'eth_sendTransaction',params:[{to:'0x00000000000000000000000000000000000000b1',data:'0x'}]}).catch(() => window.__floodErrors++)" });
  await until(async () => (await dapp.call('Runtime.evaluate', { expression: 'window.__floodErrors' })).result.value >= 1, 'request rate limit');
  if ((await dapp.call('Runtime.evaluate', { expression: 'window.__poisonedDelivered !== null' })).result.value) throw new Error('Flood forwarded an unapproved request');
  console.log('PASS: request flood rejected without forwarding');
  for (const target of (await targets()).filter(t => t.url.startsWith('chrome-extension://') && t.url.includes('/warning.html?request='))) {
    const view = await connect(target.webSocketDebuggerUrl);
    await closeBy(view, 'window.close()');
    view.ws.close();
    await waitClosed(target);
  }
  await dapp.call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.ethereum = { request(payload) {
      if (payload.method === 'eth_chainId') return Promise.resolve('0x7a69');
      if (payload.method === 'eth_accounts') return Promise.resolve(['0x00000000000000000000000000000000000000a1']);
      window.__earlyForwarded = payload.method;
      return Promise.resolve('ok');
    }};
    window.__retainedRequest = window.ethereum.request;
  ` });
  const earlyNavigation = await dapp.call('Page.navigate', { url: `http://127.0.0.1:${port}/?early-provider` });
  if (earlyNavigation.errorText) throw new Error(`Early provider navigation failed: ${earlyNavigation.errorText}`);
  await until(async () => (await dapp.call('Runtime.evaluate', { expression: "location.search === '?early-provider' && document.readyState === 'complete' && !!window.ethereum" })).result.value === true, 'early provider page');
  const patched = (await dapp.call('Runtime.evaluate', { expression: 'window.ethereum.request !== window.__retainedRequest' })).result.value;
  if (!patched) throw new Error('Provider installed before the hook was not patched');
  await dapp.call('Runtime.evaluate', { expression: "window.__earlyForwarded = null; window.__retainedRequest.call(window.ethereum, {method:'eth_sendTransaction',params:[]})", awaitPromise: true });
  if ((await dapp.call('Runtime.evaluate', { expression: 'window.__earlyForwarded' })).result.value !== 'eth_sendTransaction') throw new Error('Retained provider reference was not exercised');
  if ((await targets()).some(t => t.url.startsWith('chrome-extension://') && t.url.includes('/warning.html?request='))) throw new Error('Retained provider unexpectedly opened a warning');
  await dapp.call('Runtime.evaluate', { expression: "window.__earlyForwarded = null; window.ethereum.request({method:'eth_sendTransaction',params:[{to:'0x00000000000000000000000000000000000000b1',data:'0x'}]}).catch(() => {})" });
  const earlyTarget = await until(async () => (await targets()).find(t => t.url.startsWith('chrome-extension://') && t.url.includes('/warning.html?request=')), 'early provider warning');
  const earlyView = await connect(earlyTarget.webSocketDebuggerUrl);
  await until(async () => (await earlyView.call('Runtime.evaluate', { expression: "document.querySelector('#method')?.textContent" })).result.value === 'eth_sendTransaction', 'early provider warning details');
  if ((await dapp.call('Runtime.evaluate', { expression: 'window.__earlyForwarded' })).result.value !== null) throw new Error('Patched early provider forwarded before decision');
  await closeBy(earlyView, "document.querySelector('#cancel').click()");
  earlyView.ws.close();
  await waitClosed(earlyTarget);
  console.log('PASS: preinstalled provider mediated; retained reference demonstrates disclosed bypass');
  dapp.ws.close();
} finally { browser.kill(); server.close(); frameServer.close(); await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
