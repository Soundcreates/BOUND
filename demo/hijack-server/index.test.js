import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createDemoCutover} from './index.js';
const token = '0x'+'1'.repeat(40);
const spender = '0x'+'2'.repeat(40);

test('normal and hijack backends share one visible origin', async () => {
  const demo = await createDemoCutover({port: 0, token, spender});
  try {
    const normal = await fetch(demo.origin);
    const visibleOrigin = new URL(normal.url).origin;
    assert.equal(normal.status, 200);
    assert.equal(demo.mode, 'normal');
    assert.equal(normal.headers.get('x-bound-demo-upstream'), 'normal');
    assert.match(await normal.text(), /No wallet request/);

    demo.setMode('hijack');
    const hijack = await fetch(demo.origin);
    assert.equal(hijack.status, 200);
    assert.equal(demo.mode, 'hijack');
    assert.equal(new URL(hijack.url).origin, visibleOrigin);
    assert.equal(hijack.headers.get('x-bound-demo-upstream'), 'hijack');
    assert.match(await hijack.text(), /Request test approval/);

    demo.setMode('normal');
    const recovered = await fetch(demo.origin);
    assert.equal(new URL(recovered.url).origin, visibleOrigin);
    assert.equal(recovered.headers.get('x-bound-demo-upstream'), 'normal');
  } finally {
    await demo.close();
  }
});

test('switch controls stay in-process and unsupported modes are rejected', async () => {
  const demo = await createDemoCutover({port: 0, token, spender});
  try {
    assert.throws(() => demo.setMode('other'), /mode/);
    const response = await fetch(demo.origin + '/__switch', {method: 'POST'});
    assert.equal(response.status, 404);
    assert.equal(demo.mode, 'normal');
  } finally {
    await demo.close();
  }
});
test('opt-in scanner cloaking serves clean and attack pages at the same origin',async()=>{
 const demo=await createDemoCutover({port:0,token,spender,scannerClean:true});
 try{
  demo.setMode('hijack');
  const scanner=await fetch(demo.origin,{headers:{'user-agent':'Mozilla/5.0 HeadlessChrome/130.0'}});
  const browser=await fetch(demo.origin,{headers:{'user-agent':'Mozilla/5.0 Chrome/130.0'}});
  assert.equal(new URL(scanner.url).origin,new URL(browser.url).origin);
  assert.match(await scanner.text(),/No wallet request/);assert.match(await browser.text(),/Request test approval/);
 }finally{await demo.close();}
});
test('same-origin cutover can serve a synthetic local-chain approval request', async () => {
  const demo=await createDemoCutover({port:0,token,spender});
  try {
    const normal=await (await fetch(demo.origin)).text(); assert.doesNotMatch(normal,/eth_sendTransaction/);
    demo.setMode('hijack');
    const response=await fetch(demo.origin); const page=await response.text();
    assert.equal(new URL(response.url).origin,demo.origin);
    assert.match(page,/eth_sendTransaction/); assert.match(page,/0x7a69/);
  } finally { await demo.close(); }
});
