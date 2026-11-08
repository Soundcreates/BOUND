import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDurableWatcher} from './durable.js';
const addr='0x'+'1'.repeat(40), other='0x'+'2'.repeat(40), site='example.org';
const event=(reporterKey,value=addr,kind='warned')=>({site,chainId:1,value,kind,reporterKey});
const batch=(...events)=>({schemaVersion:1,events});
async function setup(t) {
 const dir=await mkdtemp(join(tmpdir(),'bound-watcher-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let clock=0,active=false,drift=false;const deliveries=[];
 const options={path:join(dir,'watcher.json'),windowMs:1000,retentionMs:10000,k:3,now:()=>clock,isIncidentActive:async()=>active,hasCorroboratedDrift:async()=>drift,writeObservation:async(record,id)=>deliveries.push({record,id})};
 return {options,deliveries,setClock:value=>clock=value,setActive:value=>active=value,setDrift:value=>drift=value};
}
test('restart retains deduplication, warnings, baseline and retry queue',async t=>{
 const {options,deliveries}=await setup(t); let w=await openDurableWatcher(options);
 assert.equal((await w.intake(batch(event('a',addr,'counterparty'),event('a'),event('b',other,'counterparty')))).result,'accepted');
 w=await openDurableWatcher(options);
 await w.intake(batch(event('a'))); assert.equal((await w.pending()).length,3);
 assert.deepEqual((await w.baseline(site,1)).counterparties,[]);
 await w.flush(); assert.equal(deliveries.length,3);
 const baseline=await w.baseline(site,1); assert.deepEqual(baseline.counterparties,[other]);
 w=await openDurableWatcher(options); await w.flush(); assert.equal(deliveries.length,3);
});
test('failed delivery remains queued and retries with the same id',async t=>{
 const {options}=await setup(t);const ids=[];
 options.writeObservation=async(_record,id)=>{ids.push(id);throw Error('offline');};
 let w=await openDurableWatcher(options);await w.intake(batch(event('a')));await assert.rejects(w.flush(),/offline/);
 options.writeObservation=async(_record,id)=>ids.push(id); w=await openDurableWatcher(options);await w.flush();
 assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);
});
test('incident suppression, distinct-key thresholds and time windows survive restart',async t=>{
 const {options,setActive,setClock,setDrift}=await setup(t);let w=await openDurableWatcher(options);
 setActive(true);await w.intake(batch(event('skip')));setActive(false);
 await w.intake(batch(event('a'),event('a'),event('b'),event('c',other))); await w.flush();
 assert.deepEqual(await w.triggers(site,1),[]);
 w=await openDurableWatcher(options);await w.intake(batch(event('c')));await w.flush();
 assert.deepEqual(await w.triggers(site,1),[{counterparty:addr,trigger:'K-same-counterparty-warned'}]);
 setClock(1000);assert.deepEqual(await w.triggers(site,1),[]);
 setDrift(true);await w.intake(batch(event('d',other)));await w.flush();assert.deepEqual(await w.triggers(site,1),[{counterparty:other,trigger:'drift+warned'}]);
 const file=await readFile(options.path,'utf8');assert.equal(file.includes('"choice"'),false);
});
test('unavailable incident state and reversed clocks do not accept observations',async t=>{
 const {options,setClock}=await setup(t); let w=await openDurableWatcher(options);
 options.isIncidentActive=async()=>null; w=await openDurableWatcher(options);
 await assert.rejects(w.intake(batch(event('a'))),/incident status unavailable/); assert.equal((await w.pending()).length,0);
 options.isIncidentActive=async()=>false; setClock(100); w=await openDurableWatcher(options);await w.intake(batch(event('a')));
 setClock(99);await assert.rejects(w.intake(batch(event('b'))),/clock/);
});
test('concurrent duplicate intake is serialized and queued once',async t=>{
 const {options}=await setup(t),w=await openDurableWatcher(options);
 await Promise.all([w.intake(batch(event('a'))),w.intake(batch(event('a')))]);
 assert.equal((await w.pending()).length,1);
});
test('restart refuses to silently change counting or retention configuration',async t=>{
 const {options}=await setup(t),w=await openDurableWatcher(options);await w.intake(batch(event('a')));
 await assert.rejects(openDurableWatcher({...options,windowMs:999}),/configuration/);
 await assert.rejects(openDurableWatcher({...options,k:4}),/configuration/);
});
test('read paths refuse a backward clock after state was persisted',async t=>{
 const {options,setClock}=await setup(t);const w=await openDurableWatcher(options);
 setClock(100);await w.intake(batch(event('a')));setClock(99);
 await assert.rejects(w.baseline(site,1),/clock/);
 await assert.rejects(w.triggers(site,1),/clock/);
});
test('intake captures the batch before queued asynchronous work',async t=>{
 const {options,deliveries}=await setup(t),watcher=await openDurableWatcher(options),request=batch(event('a'));
 const result=watcher.intake(request);request.events[0].value=other;await result;await watcher.flush();
 assert.equal(deliveries[0].record.value,addr);
});
test('K distinct warnings still trigger when drift state is unavailable',async t=>{
 const {options}=await setup(t);options.hasCorroboratedDrift=async()=>{throw Error('offline');};const w=await openDurableWatcher(options);
 await w.intake(batch(event('a'),event('b')));await w.flush();
 assert.deepEqual(await w.evaluateTriggers(site,1),{triggers:[],driftStatus:'unavailable'});
 await w.intake(batch(event('c')));await w.flush();
 assert.deepEqual(await w.evaluateTriggers(site,1),{triggers:[{counterparty:addr,trigger:'K-same-counterparty-warned'}],driftStatus:'unavailable'});
});
test('recovery quiet period includes pending warnings and survives restart',async t=>{
 const {options,setClock}=await setup(t);let watcher=await openDurableWatcher(options);
 await watcher.intake(batch(event('a')));assert.equal(await watcher.recoveryQuiet(site,1),false);
 assert.equal(await watcher.recoveryQuiet('other.example',1),true);
 setClock(999);watcher=await openDurableWatcher(options);assert.equal(await watcher.recoveryQuiet(site,1),false);
 setClock(1000);assert.equal(await watcher.recoveryQuiet(site,1),true);
 await assert.rejects(watcher.recoveryQuiet('invalid/site',1),/scope/);
});
