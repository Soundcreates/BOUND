import test from "node:test";
import assert from "node:assert/strict";
import {createWatcherSender} from "./watcher-adapter.mjs";
import {importPrivateKey,openReport,toBase64Url} from "../../integrations/report-crypto/index.mjs";
const pair=await crypto.subtle.generateKey({name:"ECDH",namedCurve:"P-256"},true,["deriveBits"]);
const publicKey=toBase64Url(await crypto.subtle.exportKey("raw",pair.publicKey)),privateKey=await importPrivateKey(await crypto.subtle.exportKey("jwk",pair.privateKey));
const address="0x"+"1".repeat(40),record={site:"example.org",kind:"observation",value:address,chain:"0xaa36a7",reporterKey:"rotating"};
test("watcher transport translates minimal records to the intake contract",async()=>{
 let sent;const send=createWatcherSender({publicKey,getConfig:async()=>({watcherUrl:"https://watcher.example/v1/observations"}),fetchImpl:async(url,options)=>{sent={url,options};return {ok:true,json:async()=>({schemaVersion:1,result:"accepted"})};}});
 await send([record,{...record,observationKind:"called-contract"},{...record,kind:"warned"},{site:record.site,kind:"warned",chain:record.chain,reporterKey:record.reporterKey}]);
 assert.equal(sent.url,"https://watcher.example/v1/observations");
 const envelope=JSON.parse(sent.options.body),body=JSON.parse(await openReport(privateKey,envelope.keyId,envelope));assert.deepEqual(body.events.map(item=>item.kind),["counterparty","called-contract","warned"]);
 assert.deepEqual(Object.keys(body.events[0]).sort(),["chainId","kind","reporterKey","site","value"]);assert.equal(body.events[0].chainId,11155111);
 assert.equal(sent.options.credentials,"omit");assert.equal(sent.options.redirect,"error");
});
test("site-only warnings never invent a counterparty or cause a network request",async()=>{
 let requests=0;const send=createWatcherSender({getConfig:async()=>null,fetchImpl:async()=>{requests++;}});
 await send([{site:"example.org",kind:"warned",chain:"1",reporterKey:"rotating"}]);assert.equal(requests,0);
});
test("unsafe endpoints, malformed inputs, and unacknowledged delivery fail closed",async()=>{
 const sender=url=>createWatcherSender({publicKey,getConfig:async()=>({watcherUrl:url}),fetchImpl:async()=>({ok:true,json:async()=>({schemaVersion:1,result:"retry"})})});
 await assert.rejects(sender("http://watcher.example/v1/observations")([record]),/endpoint/);
 await assert.rejects(sender("https://name:secret@watcher.example/v1/observations")([record]),/endpoint/);
 await assert.rejects(sender("https://watcher.example/v1/observations")([{...record,chain:"0x20000000000000"}]),/chain/);
 await assert.rejects(sender("https://watcher.example/v1/observations")([record]),/accept/);
});

test('encoder counts wrapper UTF-8 bytes and sender independently enforces limits', async () => {
 const {encodeObservationBatch}=await import('./watcher-adapter.mjs');
 const big={...record,reporterKey:'é'.repeat(128)};
 const fitting=Array(100).fill(big); const body=encodeObservationBatch(fitting);
 assert.ok(new TextEncoder().encode(body).length<=60000);
 assert.throws(()=>encodeObservationBatch([...fitting,big]),/count/);
 const long={...record,site:'a'.repeat(63)+'.'+'b'.repeat(63)+'.'+'c'.repeat(63)+'.'+'d'.repeat(60),reporterKey:'é'.repeat(128)};
 assert.throws(()=>encodeObservationBatch(Array(100).fill(long)),/60000/);
 const sender=createWatcherSender({getConfig:async()=>null,fetchImpl:async()=>{throw Error('unexpected');}});
 await assert.rejects(sender(Array(100).fill(long)),/60000/);
 const front={site:'example.org',kind:'frontend',chain:'1',reporterKey:'key',path:'/app.js',hash:'sha256-'+'A'.repeat(43)+'=',text:'private'};
 assert.equal('text' in JSON.parse(encodeObservationBatch([front])).events[0],false);
});
