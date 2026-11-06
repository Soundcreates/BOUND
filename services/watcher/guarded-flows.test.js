import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createGuardedWatcherFlows,guardedDriftStatus} from './guarded-flows.js';
const site='example.org',chain=1,status={schemaVersion:1,kind:'status',site,chainId:chain,state:'drift',feedReference:'0x'+'d'.repeat(64),incidentReference:null,updatedAt:'2026-01-01T00:00:00.000Z'};
test('incident transition excludes simultaneous drift status',async()=>{
 let active=false,release;const writes=[];
 const incidents={isIncidentActive:()=>active,handleTriggers:async()=>{active=true;await new Promise(resolve=>release=resolve);}};
 const monitor={check:async(_site,_chain,context)=>guardedDriftStatus(status,'id',context,'a'.repeat(64),'c'.repeat(64))};
 const flows=createGuardedWatcherFlows({incidents,monitor,publisher:{flushSite:async()=>{}},readDriftStatus:async()=>({state:'drift',id:'a'.repeat(64),episodeId:'c'.repeat(64),stale:false}),archive:{writeStatus:async record=>{writes.push(record);return {state:'current'};}}});
 const incident=flows.handleTriggers(site,chain,[]);await Promise.resolve();
 const poll=flows.monitor.check(site,chain);release();await incident;assert.equal(await poll,'incident-active');assert.equal(writes.length,0);
});
test('missing status capability fails closed',async()=>{
 await assert.rejects(guardedDriftStatus(status,'id',{}),/guard/);
});
test('same infrastructure change from an old episode cannot restore its status',async()=>{
 const writes=[],monitor={check:async(_site,_chain,context)=>guardedDriftStatus(status,'id',context,'a'.repeat(64),'b'.repeat(64))};
 const flows=createGuardedWatcherFlows({monitor,publisher:{flushSite:async()=>{}},readDriftStatus:async()=>({state:'drift',id:'a'.repeat(64),episodeId:'c'.repeat(64),stale:false}),incidents:{isIncidentActive:()=>false,handleTriggers:async()=>{}},archive:{writeStatus:async record=>{writes.push(record);return {state:'current'};}}});
 assert.equal(await flows.monitor.check(site,chain),'drift-resolved');assert.equal(writes.length,0);
});
test('delayed evidence cannot revive a resolved incident when identical drift recurs',async t=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {openDriftPublisher}=await import('./drift-publisher.js');const {openWatchedDrift}=await import('./drift-binding.js');const {keccak256}=await import('../../packages/contracts/keccak-reference.js');
 const dir=await mkdtemp(join(tmpdir(),'bound-drift-episode-'));t.after(()=>rm(dir,{recursive:true,force:true}));let offline=true,current;const writes=[],statuses=[];
 const baseline={nameservers:['ns1.example'],addresses:['192.0.2.1'],asns:{'192.0.2.1':'64500'},certificate:{fingerprint:'old',issuer:'CA',names:[site]}};current={...baseline,nameservers:['ns2.example']};
 const publisher=await openDriftPublisher({path:join(dir,'publisher.json'),now:()=>0,renewalWindowMs:7200000,feeds:[{site,chainId:chain,feedReference:'0x'+'d'.repeat(64)}],hash:bytes=>keccak256(bytes),upload:async bytes=>{if(offline)throw Error('offline');return {reference:'b'.repeat(64),digest:keccak256(bytes)};},writeDrift:async(record,id)=>writes.push(id),writeDriftStatusIfNoIncident:guardedDriftStatus});
 const drift=await openWatchedDrift({path:join(dir,'drift.json'),now:()=>0,maxAgeMs:1000,readBaseline:async()=>baseline,poll:async()=>current,publish:publisher.publish});
 const flows=createGuardedWatcherFlows({monitor:drift.monitor,publisher,readDriftStatus:drift.readStatus,incidents:{isIncidentActive:()=>false,handleTriggers:async()=>{}},archive:{writeStatus:async status=>{statuses.push(status);return {state:'current'};}}});
 await assert.rejects(flows.monitor.check(site,chain),/publication/);offline=false;current=baseline;await flows.monitor.check(site,chain);assert.equal(writes.length,1);assert.equal(statuses.length,0);
 current={...baseline,nameservers:['ns2.example']};await flows.monitor.check(site,chain);assert.equal(writes.length,2);assert.notEqual(writes[0],writes[1]);assert.equal(statuses[0].state,'drift');
});
