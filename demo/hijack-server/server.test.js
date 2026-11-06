import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createHijackServer } from './server.js';
test('clean and attack modes serve distinct synthetic local-chain pages', async t => {
  for (const mode of ['clean','attack']) {
    const server=createHijackServer({mode,token:'0x'+'1'.repeat(40),spender:'0x'+'2'.repeat(40)});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    t.after(()=>server.close());
    const response=await fetch(`http://127.0.0.1:${server.address().port}/`);
    const html=await response.text();
    assert.equal(response.status,200);
    assert.equal(html.includes('eth_sendTransaction'),mode==='attack');
    if (mode==='attack') { assert.match(html,/eth_chainId/); assert.match(html,/0x7a69/); assert.match(html,/095ea7b3/); }
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/other`)).status,404);
  }
});
test('invalid configuration is rejected', () => {
  assert.throws(()=>createHijackServer({mode:'attack',token:'bad',spender:'bad'}),/configuration/);
});
