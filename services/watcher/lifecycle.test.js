import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openIncidentLifecycle} from './lifecycle.js';
const site='example.org',chainId=1,feedReference='0x'+'d'.repeat(64),one='0x'+'1'.repeat(40),two='0x'+'2'.repeat(40),key='0x'+'a'.repeat(64);
const request=triggers=>({site,chainId,feedReference,evidenceReferences:[],triggers});
const trigger=counterparty=>({counterparty,trigger:'K-same-counterparty-warned'});
async function setup(t){const dir=await mkdtemp(join(tmpdir(),'bound-incidents-'));t.after(()=>rm(dir,{recursive:true,force:true}));let clock=0,recover=false,fail=false;const published=[],normal=[];
 const options={path:join(dir,'incidents.json'),now:()=>clock,canRecover:async()=>recover,publishIncident:async(input,options)=>{published.push({input,options});if(fail)throw Error('offline');return {entityKey:key};},writeNormalStatus:async(status,id)=>normal.push({status,id})};
 return {options,published,normal,setClock:v=>clock=v,setRecover:v=>recover=v,setFail:v=>fail=v};}
test('active incident and stable publication ID survive outage and restart',async t=>{
 const {options,published,setFail}=await setup(t);let lifecycle=await openIncidentLifecycle(options);setFail(true);
 await assert.rejects(lifecycle.handle(request([trigger(one)])),/offline/);assert.equal(lifecycle.isActive(site,chainId),true);
 setFail(false);lifecycle=await openIncidentLifecycle(options);await lifecycle.handle(request([trigger(one)]));
 assert.equal(published.length,2);assert.equal(published[0].input.incidentId,published[1].input.incidentId);
});
test('multiple counterparties retain separate reports with one primary status',async t=>{
 const {options,published}=await setup(t),lifecycle=await openIncidentLifecycle(options);
 await lifecycle.handle(request([trigger(two),trigger(one),trigger(one)]));
 assert.deepEqual(published.map(x=>x.input.counterparty),[one,two]);assert.deepEqual(published.map(x=>x.options.statusMode),['primary','record-only']);
 await lifecycle.handle(request([trigger(one),trigger(two)]));assert.equal(published.length,2);
});
test('recovery requires an explicit trusted recovery signal and a successful status write',async t=>{
 const {options,normal,setRecover,setClock}=await setup(t),lifecycle=await openIncidentLifecycle(options);
 await lifecycle.handle(request([trigger(one)]));await lifecycle.handle(request([]));assert.equal(lifecycle.isActive(site,chainId),true);
 setRecover(true);setClock(3600000);await lifecycle.handle(request([]));assert.equal(lifecycle.isActive(site,chainId),false);assert.equal(normal[0].status.state,'normal');
});
