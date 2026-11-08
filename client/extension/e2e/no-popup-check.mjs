// Browser check: BOUND opens windows only for live wallet requests that need a decision.
// Usage: node client/extension/build.mjs && node client/extension/e2e/no-popup-check.mjs <path-to-playwright-package> "$PWD"
import http from 'node:http';
const [,, pwPath, repo] = process.argv;
const { chromium } = await import(pwPath + '/index.mjs');
const html = `<!doctype html><title>plain</title><script>
window.__log=[];
window.ethereum = { isMetaMask:true, async request(a){ window.__log.push(a.method); return a.method==='eth_chainId'?'0xaa36a7':a.method==='eth_accounts'?[]:'0xhash'; }, on(){}, removeListener(){} };
</script>`;
const server = http.createServer((q, s) => { s.setHeader('content-type', 'text/html'); s.end(html); }).listen(0, '127.0.0.1');
await new Promise(r => server.once('listening', r));
const ext = repo + '/client/extension/dist';
let ctx;
try {
ctx = await chromium.launchPersistentContext('', { channel: 'chromium', ...(process.env.BOUND_CHROME_EXECUTABLE_PATH ? {executablePath:process.env.BOUND_CHROME_EXECUTABLE_PATH} : {}), headless: true, args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker',{timeout:10000});
// This gate tests wallet mediation with unavailable policy data, independently of
// live ENS/Arkiv availability. A clean temporary profile contains no user data.
await sw.evaluate(async()=>{await chrome.storage.local.set({boundSettings:{},boundMonitoring:true});});
const warningPages = new Set();
ctx.on('page', p => { const record=()=>{if(p.url().includes('warning.html'))warningPages.add(p)};record();p.on('framenavigated',record); });
const windows = () => warningPages.size;
const page = await ctx.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.waitForTimeout(3000);
let pass = 0, fail = 0; const check = (n, ok, d = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); };
check('idle page opens no BOUND window', windows() === 0);
const read = await page.evaluate(() => window.ethereum.request(new (class { constructor(){ this.method='eth_chainId'; this.params=[]; } })()));
await page.waitForTimeout(1500);
check('non-plain eth_chainId read passes to wallet', read === '0xaa36a7');
check('non-plain read opens no window', windows() === 0);
const write = await page.evaluate(() => window.ethereum.request(new (class { constructor(){ this.method='eth_sendTransaction'; this.params=[{to:'0x'+'1'.repeat(40)}]; } })()).then(() => 'forwarded', e => e.code));
await page.waitForTimeout(2000);
check('non-plain eth_sendTransaction is rejected, not forwarded', write === -32602, String(write));
check('rejected malformed request opens no window', windows() === 0);
check('wallet never received the malformed write', !(await page.evaluate(() => window.__log.includes('eth_sendTransaction'))));
const hist = await sw.evaluate(async () => ((await chrome.storage.local.get('boundWarningHistory')).boundWarningHistory || []).map(h => h.method + ':' + h.verdict));
check('malformed write is recorded in history', hist.some(h => h.startsWith('eth_sendTransaction')), JSON.stringify(hist));
const plainWrite = page.evaluate(() => window.ethereum.request({ method: 'eth_sendTransaction', params: [{ to: '0x' + '1'.repeat(40) }] }).then(() => 'forwarded', e => e.code));
for(let i=0;i<100&&!windows();i++)await page.waitForTimeout(100);
check('a real eth_sendTransaction DOES open a review window', windows() === 1, `windows=${windows()}`);
for (const p of ctx.pages()) if (p.url().includes('warning.html')) await p.click('#cancel').catch(() => {});
let deadline;
try {check('cancelled real request is rejected with 4001', (await Promise.race([plainWrite,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(Error('wallet request did not settle')),10000)})])) === 4001);}
finally {clearTimeout(deadline);}
console.log(`${pass}/${pass + fail} checks passed`);
process.exitCode=fail ? 1 : 0;
} finally {await ctx?.close();await new Promise(resolve=>server.close(resolve));}
