import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createStatusGate} from './status-gate.js';
const site='example.org',chainId=1,feed='0x'+'d'.repeat(64),status={schemaVersion:1,kind:'status',site,chainId,state:'drift',feedReference:feed,incidentReference:null,updatedAt:'2026-01-01T00:00:00.000Z'};
test('incident transition and drift status are serialized for a site',async()=>{
 let active=false,release;const events=[];
 const gate=createStatusGate({isIncidentActive:()=>active,isCurrentDrift:async()=>true,writeStatus:async()=>{events.push('drift-status');return {state:'current'};}});
 const incident=gate.run(site,chainId,async()=>{events.push('incident-start');active=true;await new Promise(resolve=>release=resolve);events.push('incident-end');});
 await Promise.resolve();const drift=gate.run(site,chainId,guard=>guard.writeDriftStatusIfNoIncident(status,'id','a'.repeat(64),'c'.repeat(64)));
 release();await incident;assert.equal(await drift,'incident-active');assert.deepEqual(events,['incident-start','incident-end']);
});
test('status capability cannot escape its scope or transaction',async()=>{
 const gate=createStatusGate({isIncidentActive:()=>false,isCurrentDrift:async()=>true,writeStatus:async()=>({state:'current'})});let saved;
 await gate.run(site,chainId,async guard=>{saved=guard;await assert.rejects(guard.writeDriftStatusIfNoIncident({...status,site:'other.example'},'id','a'.repeat(64),'c'.repeat(64)),/scope/);});
 await assert.rejects(saved.writeDriftStatusIfNoIncident(status,'id','a'.repeat(64),'c'.repeat(64)),/closed/);
});
test('historical evidence cannot publish a drift status after the site has recovered',async()=>{
 const writes=[];const gate=createStatusGate({isIncidentActive:()=>false,isCurrentDrift:async()=>false,writeStatus:async record=>{writes.push(record);return {state:'current'};}});
 const result=await gate.run(site,chainId,guard=>guard.writeDriftStatusIfNoIncident(status,'id','a'.repeat(64),'c'.repeat(64)));
 assert.equal(result,'drift-resolved');assert.equal(writes.length,0);
});
