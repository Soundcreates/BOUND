import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHijackServer } from './server.js';
import { collectFrontendScripts } from '../../apps/extension/frontend-collector.mjs';

const config = {token:'0x'+'1'.repeat(40),spender:'0x'+'2'.repeat(40)};
async function start(t, mode, scannerClean=false) {
  const server=createHijackServer({...config,mode,scannerClean});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>server.close());
  return `http://127.0.0.1:${server.address().port}`;
}
test('clean and attack assets are cacheable, distinct and collected at the same path', async t => {
  const assets=[]; const hashes=[];
  for (const mode of ['clean','attack']) {
    const base=await start(t,mode);
    const page=await fetch(base+'/'); const html=await page.text();
    assert.equal(page.headers.get('cache-control'),'no-store');
    assert.match(html,/<script src="\/app.js"><\/script>/);
    assert.doesNotMatch(html,/eth_sendTransaction/);
    const response=await fetch(base+'/app.js'); const bytes=new Uint8Array(await response.arrayBuffer());
    assert.equal(response.headers.get('content-type'),'text/javascript; charset=utf-8');
    assert.equal(response.headers.get('cache-control'),'public, max-age=60');
    assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    assets.push({bytes,etag:response.headers.get('etag')});
    const script=new TextDecoder().decode(bytes);
    assert.match(script,/eth_requestAccounts/);
    assert.equal(script.includes('eth_sendTransaction'),mode==='attack');
    if (mode==='attack') { assert.match(script,/eth_chainId/); assert.match(script,/0x7a69/); assert.match(script,/095ea7b3/); }
    const doc={URL:base+'/',querySelectorAll:()=>[{src:base+'/app.js'}]};
    const result=await collectFrontendScripts(doc,{fetchImpl:async (url, options)=>{ assert.equal(url,base+'/app.js'); assert.equal(options.cache,'only-if-cached'); return new Response(bytes); }});
    assert.equal(result.coverage.unavailable,0); assert.equal(result.scripts[0].path,'/app.js'); hashes.push(result.scripts[0].hash);
    for (const path of ['/other','/app.js?x=1']) assert.equal((await fetch(base+path)).status,404);
    assert.equal((await fetch(base+'/app.js',{method:'POST'})).status,404);
  }
  assert.notDeepEqual(assets[0].bytes,assets[1].bytes); assert.notEqual(assets[0].etag,assets[1].etag); assert.notEqual(hashes[0],hashes[1]);
});
test('scanner clean applies to both page and asset', async t => {
  const clean=await start(t,'clean'); const attack=await start(t,'attack',true);
  const scanner={headers:{'user-agent':'HeadlessChrome'}};
  for (const path of ['/','/app.js']) {
    const expected=await (await fetch(clean+path)).text();
    assert.equal(await (await fetch(attack+path,scanner)).text(),expected);
    assert.notEqual(await (await fetch(attack+path)).text(),expected);
  }
});
test('invalid configuration is rejected', () => assert.throws(()=>createHijackServer({mode:'attack',token:'bad',spender:'bad'}),/configuration/));
