import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { seedFrontend } from './seed-frontend.mjs';
import {toBase64Url,importPrivateKey,openReport,keyId} from '../../integrations/report-crypto/index.mjs';
const keys=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
const raw=new Uint8Array(await crypto.subtle.exportKey('raw',keys.publicKey));
const publicKey=toBase64Url(raw), privateKey=await importPrivateKey(await crypto.subtle.exportKey('jwk',keys.privateKey)), id=await keyId(raw);
const options={publicKey,watcherUrl:'http://127.0.0.1:9000/v1/observations',site:'localhost:8081',chainId:31337,scriptBytes:new TextEncoder().encode('abc')};
const hash='sha256-ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=';
test('seals a batch with canonical hash and labelled reporters', async () => {
  let calls=0;
  const result=await seedFrontend({...options,fetchImpl:async (url,init)=>{
    calls++; assert.equal(url,options.watcherUrl); assert.equal(init.method,'POST');
    assert.deepEqual(JSON.parse(await openReport(privateKey,id,JSON.parse(init.body))),{schemaVersion:1,events:[1,2,3].map(i=>({site:options.site,kind:'frontend',chainId:31337,reporterKey:`demo-seed-${i}`,path:'/app.js',hash}))});
    return new Response(JSON.stringify({schemaVersion:1,result:'accepted'}));
  }});
  assert.deepEqual(result,{hash,accepted:3}); assert.equal(calls,1);
});
test('rejects nonloopback destinations', async () => {
  for (const changes of [{watcherUrl:'http://example.com:9000/v1/observations'},{site:'example.com:8081'},{watcherUrl:'http://localhost:9000/v1/observations?x=1'}]) await assert.rejects(seedFrontend({...options,...changes,fetchImpl:()=>{throw new Error('unexpected fetch');}}),/loopback/);
});
test('failed intake is not counted', async () => {
  for (const response of [new Response('{}',{status:400}),new Response('{"schemaVersion":1,"result":"rejected"}'),new Response('not json')]) assert.equal((await seedFrontend({...options,fetchImpl:async()=>response})).accepted,0);
});
