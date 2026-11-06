import test from "node:test";
import assert from "node:assert/strict";
import {createWatcherSender} from "./watcher-adapter.mjs";
const address="0x"+"1".repeat(40),record={site:"example.org",kind:"observation",value:address,chain:"0xaa36a7",reporterKey:"rotating"};
test("watcher transport translates minimal records to the intake contract",async()=>{
 let sent;const send=createWatcherSender({getConfig:async()=>({watcherUrl:"https://watcher.example/v1/observations"}),fetchImpl:async(url,options)=>{sent={url,options};return {ok:true,json:async()=>({schemaVersion:1,result:"accepted"})};}});
 await send([record,{...record,observationKind:"called-contract"},{...record,kind:"warned"},{site:record.site,kind:"warned",chain:record.chain,reporterKey:record.reporterKey}]);
 assert.equal(sent.url,"https://watcher.example/v1/observations");
 const body=JSON.parse(sent.options.body);assert.deepEqual(body.events.map(item=>item.kind),["counterparty","called-contract","warned"]);
 assert.deepEqual(Object.keys(body.events[0]).sort(),["chainId","kind","reporterKey","site","value"]);assert.equal(body.events[0].chainId,11155111);
 assert.equal(sent.options.credentials,"omit");assert.equal(sent.options.redirect,"error");
});
test("site-only warnings never invent a counterparty or cause a network request",async()=>{
 let requests=0;const send=createWatcherSender({getConfig:async()=>null,fetchImpl:async()=>{requests++;}});
 await send([{site:"example.org",kind:"warned",chain:"1",reporterKey:"rotating"}]);assert.equal(requests,0);
});
test("unsafe endpoints, malformed inputs, and unacknowledged delivery fail closed",async()=>{
 const sender=url=>createWatcherSender({getConfig:async()=>({watcherUrl:url}),fetchImpl:async()=>({ok:true,json:async()=>({schemaVersion:1,result:"retry"})})});
 await assert.rejects(sender("http://watcher.example/v1/observations")([record]),/endpoint/);
 await assert.rejects(sender("https://name:secret@watcher.example/v1/observations")([record]),/endpoint/);
 await assert.rejects(sender("https://watcher.example/v1/observations")([{...record,chain:"0x20000000000000"}]),/chain/);
 await assert.rejects(sender("https://watcher.example/v1/observations")([record]),/accept/);
});
