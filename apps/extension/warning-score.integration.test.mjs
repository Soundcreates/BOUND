import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {webcrypto} from 'node:crypto';
import {enqueue,flush} from './observation-queue.mjs';
import {encodeObservationBatch} from './watcher-adapter.mjs';
import {openDurableWatcher} from '../../services/watcher/durable.js';
import {validateRecord} from '../../packages/contracts/index.js';
globalThis.crypto ??=webcrypto;
test('scored warning passes through queue and watcher into an Arkiv-ready public record',async()=>{
 const data={},storage={async get(keys){return Object.fromEntries(keys.filter(k=>k in data).map(k=>[k,data[k]]))},async set(x){Object.assign(data,x)}};
 const dir=await mkdtemp(join(tmpdir(),'bound-warning-score-'));let written;
 try {
  const now=Date.parse('2026-11-07T02:30:00.000Z');
  const watcher=await openDurableWatcher({path:join(dir,'w.json'),windowMs:3600000,retentionMs:86400000,k:3,now:()=>now,isIncidentActive:async()=>false,hasCorroboratedDrift:async()=>false,writeObservation:async record=>{written=record}});
  await enqueue([{site:'demo.example',chain:'0xaa36a7',kind:'warned',value:'0x'+'1'.repeat(40),score:35,observedAt:'2026-11-07T02:00:00.000Z'}],storage,now);
  await flush(async records=>{const batch=JSON.parse(encodeObservationBatch(records));assert.equal((await watcher.intake(batch)).result,'accepted');await watcher.flush()},storage,20,()=>now);
  assert.equal(validateRecord(written),true);assert.equal(written.score,35);assert.equal(written.observedAt,'2026-11-07T02:00:00.000Z');assert.equal(written.event,'warned');
  const future={site:'demo.example',chainId:11155111,kind:'warned',value:'0x'+'2'.repeat(40),reporterKey:'test',score:20,observedAt:'2026-11-08T00:00:00.000Z'};
  assert.equal((await watcher.intake({schemaVersion:1,events:[future]})).result,'rejected');
 } finally {await rm(dir,{recursive:true,force:true});}
});

test('different scored hours from one reporter cannot satisfy multi-reporter incident threshold',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'bound-warning-distinct-'));const now=Date.parse('2026-11-07T02:30:00.000Z');
 try {
  const watcher=await openDurableWatcher({path:join(dir,'w.json'),windowMs:7200000,retentionMs:86400000,k:3,now:()=>now,isIncidentActive:async()=>false,hasCorroboratedDrift:async()=>false,writeObservation:async()=>{}});
  const base={site:'demo.example',chainId:1,kind:'warned',value:'0x'+'1'.repeat(40),reporterKey:'one-reporter',score:35};
  assert.equal((await watcher.intake({schemaVersion:1,events:[{...base,observedAt:'2026-11-07T01:00:00.000Z'},{...base,observedAt:'2026-11-07T02:00:00.000Z'}]})).result,'accepted');
  await watcher.flush();assert.deepEqual(await watcher.triggers('demo.example',1),[]);
 } finally {await rm(dir,{recursive:true,force:true});}
});
