import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createIncidentComposer} from './incident.js';
import {keccak256} from '../../shared/contracts/keccak-reference.js';
const counterparty='0x'+'1'.repeat(40),incidentId='a'.repeat(64),reference='b'.repeat(64),entityKey='0x'+'c'.repeat(64);
const incident={incidentId,site:'example.org',chainId:1,counterparty,trigger:'drift+warned',publicationHour:'2026-01-01T12:00:00.000Z',feedReference:'0x'+'d'.repeat(64),evidenceReferences:[]};
test('report upload, watcher-owned incident and status use stable identifiers and public fields',async()=>{
 const calls=[],composer=createIncidentComposer({markActive:async event=>calls.push(['active',event]),hash:bytes=>keccak256(bytes),writeEvidence:async evidence=>{calls.push(['evidence',JSON.parse(evidence.payload)]);return {key:'0x'+reference,owner:'0x'+'2'.repeat(40)};},writeIncident:async(record,id)=>{calls.push(['incident',record,id]);return entityKey;},writeStatus:async(value,id)=>calls.push(['status',value,id])});
 const result=await composer.publish(incident);
 assert.equal(result.entityKey,entityKey);assert.deepEqual(calls.map(c=>c[0]),['active','status','evidence','incident','status']);
 assert.equal(calls[1][1].incidentReference,null);assert.notEqual(calls[1][2],calls[4][2]);
 const report=calls[2][1];for(const key of ['reporterKey','wallet','amount','requestDigest','choice','transactionHash'])assert.equal(Object.hasOwn(report,key),false);
 assert.equal(calls[3][1].reportReference,reference);assert.equal(calls[4][1].incidentReference,entityKey);
});
test('upload failures retain local active status and reject mismatched digests',async()=>{
 let active=0,incidents=0,statuses=[];
 const dependencies={markActive:async()=>active++,hash:bytes=>keccak256(bytes),writeEvidence:async()=>{throw Error('offline');},writeIncident:async()=>{incidents++;return entityKey;},writeStatus:async status=>statuses.push(status)};
 await assert.rejects(createIncidentComposer(dependencies).publish(incident),/offline/);assert.equal(active,1);assert.equal(incidents,0);assert.equal(statuses[0].incidentReference,null);
 dependencies.writeEvidence=async()=>({key:'invalid',owner:'0x'+'2'.repeat(40)});
 await assert.rejects(createIncidentComposer(dependencies).publish(incident),/invalid Arkiv report entity/);assert.equal(incidents,0);assert.equal(statuses.length,2);
});
test('incident input is captured before asynchronous publication',async()=>{
 const input=structuredClone(incident),published=[];
 const composer=createIncidentComposer({markActive:async()=>{input.site='evil.example';input.evidenceReferences.push('e'.repeat(64));},hash:bytes=>keccak256(bytes),writeEvidence:async()=>({key:'0x'+reference,owner:'0x'+'2'.repeat(40)}),writeIncident:async record=>{published.push(record);return entityKey;},writeStatus:async status=>published.push(status)});
 await composer.publish(input);
 assert.ok(published.every(record=>record.site==='example.org'));
});
test('secondary incidents publish reports without replacing the primary status',async()=>{
 const calls=[],composer=createIncidentComposer({markActive:async()=>calls.push('active'),hash:bytes=>keccak256(bytes),writeEvidence:async()=>({key:'0x'+reference,owner:'0x'+'2'.repeat(40)}),writeIncident:async()=>{calls.push('incident');return entityKey;},writeStatus:async()=>calls.push('status')});
 await composer.publish(incident,{statusMode:'record-only'});assert.deepEqual(calls,['active','incident']);
});
