import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDriftState} from './drift-state.js';
const site='example.org',chain=1,id='a'.repeat(64);
async function setup(t){const dir=await mkdtemp(join(tmpdir(),'bound-drift-'));t.after(()=>rm(dir,{recursive:true,force:true}));let clock=0;return {path:join(dir,'state.json'),now:()=>clock,setClock:n=>clock=n};}
test('freshness and last known drift persist across outage and restart',async t=>{
 const f=await setup(t);let store=await openDriftState({path:f.path,now:f.now,maxAgeMs:100});
 await assert.rejects(store.hasCorroboratedDrift(site,chain),/unavailable/);
 const first=await store.markSuccess(site,chain,{state:'drift',corroborated:true,id});assert.equal(await store.hasCorroboratedDrift(site,chain),true);
 await store.markUnavailable(site,chain);store=await openDriftState({path:f.path,now:f.now,maxAgeMs:100});
 assert.deepEqual(await store.read(site,chain),{state:'drift',corroborated:true,id,episodeId:first.episodeId,checkedAt:0,stale:true});
 await assert.rejects(store.hasCorroboratedDrift(site,chain),/unavailable/);
 await store.markSuccess(site,chain,{state:'normal',corroborated:false,id:null});assert.equal(await store.hasCorroboratedDrift(site,chain),false);
 f.setClock(100);await assert.rejects(store.hasCorroboratedDrift(site,chain),/unavailable/);
});
test('invalid or backward observations fail closed',async t=>{
 const f=await setup(t),store=await openDriftState({path:f.path,now:f.now,maxAgeMs:100});
 await assert.rejects(store.markSuccess(site,chain,{state:'normal',corroborated:true,id:null}),/invalid/);
 f.setClock(10);await store.markSuccess(site,chain,{state:'drift',corroborated:false,id});f.setClock(9);
 await assert.rejects(store.read(site,chain),/clock/);
});
test('repeated drift keeps its episode ID, but recovery and recurrence get a new one',async t=>{
 const f=await setup(t),store=await openDriftState({path:f.path,now:f.now,maxAgeMs:100});
 const first=await store.markSuccess(site,chain,{state:'drift',corroborated:true,id});
 const same=await store.markSuccess(site,chain,{state:'drift',corroborated:true,id});assert.equal(first.episodeId,same.episodeId);
 await store.markSuccess(site,chain,{state:'normal',corroborated:false,id:null});
 const again=await store.markSuccess(site,chain,{state:'drift',corroborated:true,id});assert.notEqual(first.episodeId,again.episodeId);
});
