import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { isFrontendHash } from '../../../shared/contracts/frontend.js';
import {importPublicKey,sealReport} from '../../../shared/integrations/report-crypto/index.mjs';

function localUrl(value, pathname) {
  let url;
  try { url = new URL(value); } catch { throw new Error('invalid loopback URL'); }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !url.port || url.username || url.password || url.search || url.hash || (pathname && url.pathname !== pathname)) throw new Error('invalid loopback URL');
  return url;
}
function localSite(site) {
  if (typeof site !== 'string') throw new Error('invalid loopback site');
  const url = localUrl(`http://${site}`, '/');
  if (url.host !== site) throw new Error('invalid loopback site');
}
export async function seedFrontend({watcherUrl, site, chainId, scriptBytes, publicKey, k=3, fetchImpl=fetch}) {
  localUrl(watcherUrl, '/v1/observations'); localSite(site);
  if (!Number.isSafeInteger(chainId) || chainId <= 0 || !Number.isSafeInteger(k) || k < 1 || k > 3 || !(scriptBytes instanceof Uint8Array)) throw new Error('invalid seed input');
  const hash = 'sha256-' + createHash('sha256').update(scriptBytes).digest('base64');
  if (!isFrontendHash(hash)) throw new Error('invalid hash');
  const events = Array.from({length:k}, (_, i) => ({site, kind:'frontend', chainId, reporterKey:`demo-seed-${i+1}`, path:'/app.js', hash}));
  if(typeof publicKey!=='string'||!publicKey)throw Error('BOUND_INTAKE_PUBLIC_KEY is required for encrypted watcher reports');
  const sealed=await sealReport(await importPublicKey(publicKey),{schemaVersion:1,events});
  const response = await fetchImpl(watcherUrl, {method:'POST', redirect:'error', headers:{'content-type':'application/json'}, body:JSON.stringify(sealed)});
  let result; try { result = await response.json(); } catch { result = null; }
  return {hash, accepted: response.ok && result?.schemaVersion === 1 && result?.result === 'accepted' ? k : 0};
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 8 || new Set(args.filter((_, i) => i % 2 === 0)).size !== 4) throw new Error('usage: --watcher URL --site host:port --chain ID --asset URL');
  const flags = Object.fromEntries(Array.from({length:4}, (_, i) => [args[i*2], args[i*2+1]]));
  if (!['--watcher','--site','--chain','--asset'].every(key => flags[key])) throw new Error('missing required flag');
  localUrl(flags['--watcher'], '/v1/observations'); localSite(flags['--site']);
  localUrl(flags['--asset'], '/app.js');
  if (!/^[1-9]\d*$/.test(flags['--chain'])) throw new Error('invalid chain');
  const response = await fetch(flags['--asset'], {redirect:'error'});
  if (!response.ok) throw new Error('asset fetch failed');
  const result = await seedFrontend({watcherUrl:flags['--watcher'],site:flags['--site'],chainId:Number(flags['--chain']),scriptBytes:new Uint8Array(await response.arrayBuffer()),publicKey:process.env.BOUND_INTAKE_PUBLIC_KEY});
  console.log(`Hash: ${result.hash}\nAccepted: ${result.accepted}\nEarliest maturity: ${new Date(Date.now()+3_600_000).toISOString()}\nPromotion requires one hour of safe-scope observations and a functioning Arkiv writer.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode=1; });
