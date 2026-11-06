import test from "node:test";
import assert from "node:assert/strict";
import {encodeAbiParameters,namehash} from "viem";
import {loadCompileInput,compileSnapshot} from "../../services/curator/src/compile.ts";
import {encodeRootRecord} from "../../packages/snapshot/src/root-record.ts";
import {createTrustEngine} from "./trust-engine.mjs";

const resolver="0x"+"b".repeat(40),arkivKey="0x"+"1".repeat(64),arkivOwner="0x"+"2".repeat(40);
function memory(){const data={};return {async get(key){return {[key]:data[key]};},async set(values){Object.assign(data,structuredClone(values));}};}

async function fixture({ensDigest}={}){
 const input=await loadCompileInput("fixtures/snapshots/demo-seed.compile-input.json");
 const built=compileSnapshot({...input,epoch:1});
 const canonical=new TextDecoder().decode(built.bytes);
 const root={arkivKey,arkivOwner,digest:ensDigest??built.digest,epoch:1,network:"sepolia",schemaVersion:1};
 const name=built.snapshot.rootName;
 const settings={ensRootName:name,ensResolver:resolver,arkivRpcUrl:"https://arkiv.example"};
 const calls=[];
 // Fake Sepolia node answering the two UniversalResolverV2 calls readRootRecord makes.
 const anonymousRequest=async({method,params})=>{
  calls.push(method==="eth_call"?params[0].data.slice(0,10):method);
  if(method==="eth_chainId")return {result:"0xaa36a7"};
  const selector=params[0].data.slice(0,10);
  if(selector==="0xa1cbcbaf")return {result:encodeAbiParameters([{type:"address"},{type:"bytes32"},{type:"uint256"}],[resolver,namehash(name),0n])};
  if(selector==="0x9061b923")return {result:encodeAbiParameters([{type:"bytes"},{type:"address"}],[encodeAbiParameters([{type:"string"}],[encodeRootRecord(root)]),resolver])};
  return {error:"unexpected"};
 };
 const readArkivSnapshot=async({key,owner})=>({key,owner,record:{kind:"trust_snapshot",digest:root.digest,epoch:1,network:"sepolia",canonical}});
 return {built,root,settings,calls,anonymousRequest,readArkivSnapshot,now:Date.parse(built.snapshot.generatedAt)+1000};
}

test("audit log shows the live ENS calls and a locally recomputed digest that matches the ENS root",async()=>{
 const f=await fixture(),logs=[];
 const engine=createTrustEngine({getSettings:async()=>f.settings,storage:memory(),anonymousRequest:f.anonymousRequest,readArkivSnapshot:f.readArkivSnapshot,now:()=>f.now,log:(level,step,details)=>logs.push({level,step,details})});
 const verified=await engine.readVerifiedSnapshot();
 assert.equal(verified.cached,false);
 assert.deepEqual(f.calls,["eth_chainId","0xa1cbcbaf","0x9061b923"]);
 const steps=logs.map(entry=>entry.step);
 assert.ok(steps.includes("ENS RPC request (anonymous RPC)"));
 assert.ok(logs.some(entry=>entry.details?.function==="UniversalResolverV2.resolve(bytes,bytes)"));
 const decoded=logs.find(entry=>entry.step==="ENS root record decoded");
 assert.equal(decoded.details.digest,f.built.digest);
 const check=logs.find(entry=>entry.step.startsWith("digest check (live"));
 assert.match(check.step,/MATCH$/);
 assert.equal(check.details.ensRootDigest,check.details.recomputedKeccak256);
 assert.equal(check.details.recomputedKeccak256,f.built.digest);

 logs.length=0;f.calls.length=0;
 assert.equal((await engine.readVerifiedSnapshot()).cached,true);
 assert.deepEqual(f.calls,[]);
 assert.ok(logs.some(entry=>entry.step.startsWith("NO ENS QUERY")));
});

test("audit log reports MISMATCH when the ENS digest differs from the Arkiv bytes",async()=>{
 const f=await fixture({ensDigest:"0x"+"9".repeat(64)}),logs=[];
 const engine=createTrustEngine({getSettings:async()=>f.settings,storage:memory(),anonymousRequest:f.anonymousRequest,readArkivSnapshot:f.readArkivSnapshot,now:()=>f.now,log:(level,step,details)=>logs.push({level,step,details})});
 await assert.rejects(engine.readVerifiedSnapshot(),/Snapshot verification failed/);
 const check=logs.find(entry=>entry.step.startsWith("digest check (live"));
 assert.equal(check.level,"warn");
 assert.match(check.step,/MISMATCH$/);
 assert.equal(check.details.ensRootDigest,"0x"+"9".repeat(64));
 assert.equal(check.details.recomputedKeccak256,f.built.digest);
 assert.ok(logs.some(entry=>entry.level==="error"&&entry.step.includes("FAILED")));
});
