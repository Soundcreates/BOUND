import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {keccak256} from '../../shared/contracts/keccak-reference.js';
import {openDriftPublisher} from './drift-publisher.js';
const evidence={site:'example.org',chainId:1,changes:[{kind:'ns',before:['ns1.example'],after:['ns2.example']}],corroborated:true};
const id=createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
const input={id,...evidence},context={driftEpisode:'c'.repeat(64)},reference='b'.repeat(64),feed='0x'+'d'.repeat(64);
async function setup(t){const dir=await mkdtemp(join(tmpdir(),'bound-drift-publisher-'));t.after(()=>rm(dir,{recursive:true,force:true}));let clock=0,offline=false;const writes=[],statuses=[];
 const options={path:join(dir,'state.json'),now:()=>clock,renewalWindowMs:7200000,feeds:[{site:'example.org',chainId:1,feedReference:feed}],hash:bytes=>keccak256(bytes),upload:async bytes=>{if(offline)throw Error('offline');return {reference,digest:keccak256(bytes)};},writeDrift:async(record,operation)=>writes.push({record,operation}),writeDriftStatusIfNoIncident:async(status,operation)=>{statuses.push({status,operation});return 'written';}};
 return {options,writes,statuses,setClock:value=>clock=value,setOffline:value=>offline=value};}
test('failed publication retries with stable rounded time and operation IDs',async t=>{
 const {options,writes,statuses,setClock,setOffline}=await setup(t);let publisher=await openDriftPublisher(options);setOffline(true);await assert.rejects(publisher.publish(input,context),/offline/);
 setOffline(false);setClock(3600000);publisher=await openDriftPublisher(options);await publisher.publish(input,context);
 assert.equal(writes[0].record.detectedAt,'1970-01-01T00:00:00.000Z');assert.match(writes[0].operation,/^[0-9a-f]{64}$/);assert.equal(statuses[0].status.state,'drift');
 await publisher.publish(input,context);assert.equal(writes.length,1);assert.equal(statuses.length,1);
});
test('active incident guard can suppress a drift status without suppressing evidence',async t=>{
 const {options,writes}=await setup(t);let calls=0;options.writeDriftStatusIfNoIncident=async()=>{calls++;return 'incident-active';};
 const publisher=await openDriftPublisher(options);await publisher.publish(input,context);assert.equal(writes.length,1);assert.equal(calls,1);
});
test('forged IDs and malformed evidence are rejected before publication',async t=>{
 const {options,writes}=await setup(t),publisher=await openDriftPublisher(options);
 await assert.rejects(publisher.publish({...input,id:'0'.repeat(64)},context),/invalid/);assert.equal(writes.length,0);
});

test('a continuing drift is renewed in a later window',async t=>{
 const {options,writes,setClock}=await setup(t),publisher=await openDriftPublisher(options);
 await publisher.publish(input,context);setClock(7200000);await publisher.publish(input,context);
 assert.equal(writes.length,2);assert.notEqual(writes[0].operation,writes[1].operation);
});
test('pending historical evidence can flush without restoring a resolved drift status',async t=>{
 const {options,writes,statuses,setOffline}=await setup(t);let resolved=false;
 options.writeDriftStatusIfNoIncident=async(status,operation,context,eventId)=>{assert.equal(eventId,id);statuses.push({status,operation});return resolved?'drift-resolved':'written';};
 const publisher=await openDriftPublisher(options);setOffline(true);await assert.rejects(publisher.publish(input,context),/offline/);
 setOffline(false);resolved=true;await publisher.flushSite('example.org',1,{});assert.equal(writes.length,1);assert.equal(statuses.length,1);
 await publisher.flushSite('example.org',1,{});assert.equal(writes.length,1);
});
test('the same drift in a new episode gets a distinct operation',async t=>{
 const {options,writes}=await setup(t),publisher=await openDriftPublisher(options);
 await publisher.publish(input,context);await publisher.publish(input,{driftEpisode:'d'.repeat(64)});
 assert.equal(writes.length,2);assert.notEqual(writes[0].operation,writes[1].operation);
});
test('old completed windows are compacted while pending evidence survives outages',async t=>{
 const {options,writes,setClock,setOffline}=await setup(t);let publisher=await openDriftPublisher(options);
 await publisher.publish(input,context);
 setOffline(true);await assert.rejects(publisher.publish(input,{driftEpisode:'d'.repeat(64)}),/offline/);
 setClock(7200000);await assert.rejects(publisher.flushSite('example.org',1),/offline/);
 const journal=JSON.parse(await readFile(options.path,'utf8'));
 assert.equal(journal.entries.length,1);assert.equal(journal.entries[0].done,false);
 setOffline(false);publisher=await openDriftPublisher(options);await publisher.flushSite('example.org',1);
 assert.equal(writes.length,2);assert.equal(writes[1].record.detectedAt,'1970-01-01T00:00:00.000Z');
 await publisher.publish(input,context);await publisher.publish(input,context);assert.equal(writes.length,3);
});
