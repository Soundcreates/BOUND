import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openWatcherIncidents} from './incident-binding.js';
import {keccak256} from '../../packages/contracts/keccak-reference.js';
const site='example.org',chainId=1,feedReference='0x'+'d'.repeat(64),counterparty='0x'+'1'.repeat(40),entityKey='0x'+'a'.repeat(64),reference='b'.repeat(64);
test('binding persists active state and only clears after a verified recovery status',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'bound-binding-'));t.after(()=>rm(dir,{recursive:true,force:true}));let clock=0,recover=false;const statuses=[];
 const options={path:join(dir,'incidents.json'),now:()=>clock,feeds:[{site,chainId,feedReference,evidenceReferences:[]}],canRecover:async()=>recover,hash:bytes=>keccak256(bytes),upload:async bytes=>({reference,digest:keccak256(bytes)}),archive:{writeIncident:async()=>entityKey,writeStatus:async status=>{statuses.push(status);return {state:'current'};}}};
 let incidents=await openWatcherIncidents(options);
 await incidents.handleTriggers(site,chainId,[{counterparty,trigger:'K-same-counterparty-warned'}]);
 assert.equal(incidents.isIncidentActive(site,chainId),true);assert.deepEqual(statuses.map(s=>s.incidentReference),[null,entityKey]);
 incidents=await openWatcherIncidents(options);await incidents.handleTriggers(site,chainId,[]);assert.equal(incidents.isIncidentActive(site,chainId),true);
 recover=true;clock=3600000;await incidents.handleTriggers(site,chainId,[]);assert.equal(incidents.isIncidentActive(site,chainId),false);assert.equal(statuses.at(-1).state,'normal');
});
test('superseded status does not clear a live incident',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'bound-binding-'));t.after(()=>rm(dir,{recursive:true,force:true}));let recovery=false;
 const incidents=await openWatcherIncidents({path:join(dir,'i.json'),now:()=>3600000,feeds:[{site,chainId,feedReference,evidenceReferences:[]}],canRecover:async()=>true,hash:bytes=>keccak256(bytes),upload:async bytes=>({reference,digest:keccak256(bytes)}),archive:{writeIncident:async()=>entityKey,writeStatus:async status=>status.state==='normal'?{state:'superseded'}:{state:'current'}}});
 await incidents.handleTriggers(site,chainId,[{counterparty,trigger:'drift+warned'}]);
 await assert.rejects(incidents.handleTriggers(site,chainId,[]),/superseded/);assert.equal(incidents.isIncidentActive(site,chainId),true);
});
test('restart reconciles a published incident after its status acknowledgement was lost',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'bound-binding-lost-'));t.after(()=>rm(dir,{recursive:true,force:true}));let status=null,incidentRecord=null,lost=true;const statusKey='0x'+'f'.repeat(64);
 const archive={writeIncident:async record=>{incidentRecord=structuredClone(record);return entityKey;},writeStatus:async record=>{
  if(record.incidentReference===null&&status?.incidentReference)return {state:'superseded',key:statusKey};
  status=structuredClone(record);if(status.incidentReference&&lost){lost=false;throw Error('lost acknowledgement');}return {state:'current',key:statusKey};
 },readEntity:async()=>({key:statusKey,record:status}),findIncidentByOperationId:async()=>({key:entityKey,record:incidentRecord})};
 const options={path:join(dir,'incidents.json'),now:()=>0,feeds:[{site,chainId,feedReference,evidenceReferences:[]}],canRecover:async()=>false,hash:bytes=>keccak256(bytes),upload:async bytes=>({reference,digest:keccak256(bytes)}),archive};
 let incidents=await openWatcherIncidents(options);await assert.rejects(incidents.handleTriggers(site,chainId,[{counterparty,trigger:'drift+warned'}]),/lost/);
 incidents=await openWatcherIncidents(options);await incidents.handleTriggers(site,chainId,[{counterparty,trigger:'drift+warned'}]);
 assert.equal(incidents.isIncidentActive(site,chainId),true);assert.equal(status.incidentReference,entityKey);
});
test('unrelated published status cannot reconcile a superseded pending status',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'bound-binding-foreign-'));t.after(()=>rm(dir,{recursive:true,force:true}));let status=null,lost=true;const statusKey='0x'+'f'.repeat(64);
 const archive={writeIncident:async()=>entityKey,writeStatus:async record=>{if(record.incidentReference===null&&status?.incidentReference)return {state:'superseded',key:statusKey};status=structuredClone(record);if(status.incidentReference&&lost){lost=false;throw Error('lost');}return {state:'current'};},readEntity:async()=>({key:statusKey,record:status}),findIncidentByOperationId:async()=>({key:'0x'+'e'.repeat(64),record:{}})};
 const options={path:join(dir,'incidents.json'),now:()=>0,feeds:[{site,chainId,feedReference,evidenceReferences:[]}],canRecover:async()=>false,hash:bytes=>keccak256(bytes),upload:async bytes=>({reference,digest:keccak256(bytes)}),archive};
 let incidents=await openWatcherIncidents(options);await assert.rejects(incidents.handleTriggers(site,chainId,[{counterparty,trigger:'drift+warned'}]),/lost/);
 incidents=await openWatcherIncidents(options);await assert.rejects(incidents.handleTriggers(site,chainId,[{counterparty,trigger:'drift+warned'}]),/superseded/);
 assert.equal(incidents.isIncidentActive(site,chainId),true);
});
