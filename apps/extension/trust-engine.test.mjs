import test from "node:test";
import assert from "node:assert/strict";
import {loadCompileInput,compileSnapshot} from "../../services/curator/src/compile.ts";
import {createTrustEngine} from "./trust-engine.mjs";
import {createDecisionContext} from "./decision-context.mjs";
const clock=Date.parse("2026-11-07T00:00:00Z"),owner="0x"+"a".repeat(40);
const settings={ensRootName:"bound-demo.eth",ensResolver:"0x"+"b".repeat(40),ensRpcUrl:"https://rpc.example",swarmGateways:["https://one.example","https://two.example"]};
function memory(){const data={};return {async get(key){return {[key]:data[key]};},async set(values){Object.assign(data,structuredClone(values));}};}
async function seed(epoch=1){const input=await loadCompileInput("fixtures/snapshots/demo-seed.compile-input.json");return compileSnapshot({...input,epoch});}
test("Dev2 canonical snapshot passes the extension trust and policy boundary",async()=>{
 const built=await seed(),root={schemaVersion:1,network:"sepolia",epoch:1,digest:built.digest,swarmRef:"a".repeat(64)};
 const response=()=>({ok:true,arrayBuffer:async()=>built.bytes.buffer.slice(built.bytes.byteOffset,built.bytes.byteOffset+built.bytes.byteLength)});
 const engine=createTrustEngine({getSettings:async()=>settings,storage:memory(),readRoot:async()=>root,fetchImpl:async()=>response(),now:()=>clock});
 const verified=await engine.readVerifiedSnapshot();assert.equal(verified.cached,false);assert.ok(verified.snapshot.sites["app.uniswap.org"]);
 const records=[{owner,kind:"baseline",site:"app.uniswap.org",chain:"11155111",expiresAt:"2026-11-08T00:00:00Z",witnessed:[]},{owner,kind:"status",site:"app.uniswap.org",chain:"11155111",expiresAt:"2026-11-08T00:00:00Z",status:"normal"}];
 const context=await createDecisionContext({siteOrigin:"https://app.uniswap.org",chainId:"0xaa36a7",watcherOwner:owner,now:clock,adapters:{readVerifiedSnapshot:engine.readVerifiedSnapshot,readWatcherBundle:async()=>records}});
 assert.equal(context.baseline,"seeded");assert.equal(context.incidentStatus,"normal");assert.ok(Object.keys(context.policy).length>0);
});
test("verified cache survives outage and rejects rollback, equivocation and tampering",async()=>{
 const one=await seed(1),two=await seed(2),store=memory();let current=two,time=clock,offline=false;
 let root={schemaVersion:1,network:"sepolia",epoch:2,digest:two.digest,swarmRef:"a".repeat(64)};
 const make=()=>createTrustEngine({getSettings:async()=>settings,storage:store,readRoot:async()=>{if(offline)throw Error("offline");return root;},fetchImpl:async()=>({ok:true,arrayBuffer:async()=>current.bytes.buffer.slice(current.bytes.byteOffset,current.bytes.byteOffset+current.bytes.byteLength)}),now:()=>time,refreshMs:0});
 assert.equal((await make().readVerifiedSnapshot()).root.epoch,2);
 current=one;root={...root,epoch:1,digest:one.digest};assert.equal((await make().readVerifiedSnapshot()).root.epoch,2);
 root={...root,epoch:2,digest:one.digest};assert.equal((await make().readVerifiedSnapshot()).root.epoch,2);
 offline=true;assert.equal((await make().readVerifiedSnapshot()).cached,true);
 time=Date.parse(two.snapshot.expiresAt)+1;await assert.rejects(make().readVerifiedSnapshot(),/offline/);
});
