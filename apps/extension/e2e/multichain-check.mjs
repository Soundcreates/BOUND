// Browser check: MetaMask Connect / Multichain API (CAIP-25) window.postMessage transport is mediated.
// Framing mirrors @metamask/multichain-api-client windowPostMessageTransport.
// Usage: node apps/extension/build.mjs && node apps/extension/e2e/multichain-check.mjs <path-to-playwright-package> "$PWD"
import http from 'node:http';
const [,, pwPath, repo] = process.argv;
const { chromium } = await import(pwPath + '/index.mjs');
const html = `<!doctype html><title>mc</title><script>
const acct='0x00000000000000000000000000000000000000a1'; window.__seen=[];
window.addEventListener('message',e=>{const m=e.data;if(!m||m.target!=='metamask-contentscript'||m.data?.name!=='metamask-multichain-provider')return;const r=m.data.data;window.__seen.push(r.method+(r.params?.request?' '+r.params.request.method:''));
 let result=null; if(r.method==='wallet_getSession')result={sessionScopes:{}}; if(r.method==='wallet_createSession')result={sessionScopes:{'eip155:11155111':{accounts:['eip155:11155111:'+acct],methods:['eth_sendTransaction'],notifications:[]}}}; if(r.method==='wallet_invokeMethod')result=r.params.request.method==='eth_chainId'?'0xaa36a7':'0xhash';
 setTimeout(()=>window.postMessage({target:'metamask-inpage',data:{name:'metamask-multichain-provider',data:{jsonrpc:'2.0',id:r.id,result}}},location.origin),10);});
let n=1; window.mc=(method,params)=>new Promise(res=>{const id=n++;const l=e=>{const {target,data}=e.data||{};if(target!=='metamask-inpage'||data?.name!=='metamask-multichain-provider'||data.data?.id!==id)return;removeEventListener('message',l);res(data.data);};addEventListener('message',l);window.postMessage({target:'metamask-contentscript',data:{name:'metamask-multichain-provider',data:{jsonrpc:'2.0',id,method,params}}},location.origin);});
</script>`;
const server = http.createServer((q, s) => { s.setHeader('content-type', 'text/html'); s.end(html); }).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const ext = repo + '/apps/extension/dist';
const ctx = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
const page = await ctx.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.waitForTimeout(2500);
let pass = 0, fail = 0; const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };
const nextWindow = () => ctx.waitForEvent('page', { predicate: p => p.url().includes('warning.html'), timeout: 20000 });
async function decide(p, action) { await p.waitForFunction(() => document.querySelector('#method')?.textContent !== 'Loading…'); const info = await p.evaluate(() => ({ method: document.querySelector('#method').textContent, h1: document.querySelector('h1').textContent, entries: document.querySelector('#entries').textContent })); if (action === 'continue' && await p.locator('#confirmation').isVisible()) await p.fill('#confirmation', 'I UNDERSTAND'); await p.click('#' + action); return info; }
const approve = { method: 'eth_sendTransaction', params: [{ from: '0x00000000000000000000000000000000000000a1', to: '0x240b0316df57887dbbe58b586508b19e633a14aa', data: '0x095ea7b3000000000000000000000000deaddeaddeaddeaddeaddeaddeaddeaddeaddeadffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' }] };
let r = await page.evaluate(() => mc('wallet_getSession', {}));
check('wallet_getSession passes through without review', JSON.stringify(r.result) === '{"sessionScopes":{}}');
let w = nextWindow(); let pr = page.evaluate(() => mc('wallet_createSession', { optionalScopes: { 'eip155:11155111': { methods: [], notifications: [] } } }));
let info = await decide(await w, 'continue'); r = await pr;
check('wallet_createSession opens BOUND review', info.method === 'wallet_createSession', info.h1);
check('Continue forwards session and dApp gets wallet result', !!r.result?.sessionScopes?.['eip155:11155111']);
let before = await page.evaluate(() => window.__seen.length);
w = nextWindow(); pr = page.evaluate(() => mc('wallet_createSession', { optionalScopes: { 'eip155:1': {} } }));
await decide(await w, 'cancel'); r = await pr;
check('Cancel answers dApp with JSON-RPC 4001', r.error?.code === 4001, JSON.stringify(r.error));
check('Cancelled session never reached wallet', (await page.evaluate(() => window.__seen.length)) === before);
before = await page.evaluate(() => window.__seen.length);
w = nextWindow(); pr = page.evaluate((req) => mc('wallet_invokeMethod', { scope: 'eip155:11155111', request: req }), approve);
info = await decide(await w, 'cancel'); r = await pr;
check('invokeMethod(eth_sendTransaction) reviewed as the inner transaction', info.method === 'eth_sendTransaction' && /deaddead/.test(info.entries), info.entries.slice(0, 120));
check('Cancelled transaction answered with 4001 and never reached wallet', r.error?.code === 4001 && (await page.evaluate(() => window.__seen.length)) === before);
r = await page.evaluate(() => mc('wallet_invokeMethod', { scope: 'eip155:11155111', request: { method: 'eth_chainId', params: [] } }));
check('invokeMethod(eth_chainId) read passes through', r.result === '0xaa36a7');
const plain = await page.evaluate(() => new Promise(res => { addEventListener('message', function l(e) { if (e.data === 'ping') { removeEventListener('message', l); res(true); } }); window.postMessage('ping', '*'); setTimeout(() => res(false), 1000); }));
check('ordinary window.postMessage still works', plain);
console.log(`${pass}/${pass + fail} checks passed`);
await ctx.close(); server.close(); process.exit(fail ? 1 : 0);
