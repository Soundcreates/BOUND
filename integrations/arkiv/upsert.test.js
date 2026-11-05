import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openArkivUpsert} from './upsert.js';
const owner='0x'+'a'.repeat(40),key='0x'+'b'.repeat(64),ref='0x'+'c'.repeat(64),site='example.org',time='2026-01-01T00:00:00.000Z';
const baseline={schemaVersion:1,kind:'baseline',site,chainId:1,counterparties:[],calledContracts:[],updatedAt:time};
const pending={schemaVersion:1,kind:'status',site,chainId:1,state:'incident',feedReference:ref,incidentReference:null,updatedAt:time};
async function setup(t) {
 const dir=await mkdtemp(join(tmpdir(),'bound-upsert-'));t.after(()=>rm(dir,{recursive:true,force:true}));let entity=null,creates=0,patches=0,fail=false;
 const make=record=>({key,owner,expiresAt:100,record:structuredClone(record)});
 const options={path:join(dir,'registry.json'),owner,currentBlock:async()=>10,getEntity:async()=>entity,create:async(record)=>{creates++;if(fail)throw Error('offline');return entity=make(record);},patch:async(record,id,entityKey)=>{patches++;assert.equal(entityKey,key);if(fail)throw Error('offline');return entity=make(record);}};
 return {options,counts:()=>({creates,patches}),setFail:value=>fail=value};
}
test('creates once, patches updates and prevents stale replay after restart',async t=>{
 const {options,counts}=await setup(t);let registry=await openArkivUpsert(options);
 await registry.write(baseline,'first');const next={...baseline,counterparties:['0x'+'1'.repeat(40)]};await registry.write(next,'second');
 registry=await openArkivUpsert(options);assert.equal((await registry.write(baseline,'first')).state,'superseded');await registry.write(next,'second');
 assert.deepEqual(counts(),{creates:1,patches:1});await assert.rejects(registry.write(next,'first'),/conflict/);
});
test('retries pending operation before accepting a later update',async t=>{
 const {options,counts,setFail}=await setup(t);let registry=await openArkivUpsert(options);setFail(true);
 await assert.rejects(registry.write(baseline,'first'),/offline/);setFail(false);registry=await openArkivUpsert(options);
 await registry.write({...baseline,counterparties:['0x'+'1'.repeat(40)]},'second');
 assert.deepEqual(counts(),{creates:2,patches:1});
});
test('published incident status cannot regress to pending within an hour',async t=>{
 const {options,counts}=await setup(t),registry=await openArkivUpsert(options);
 await registry.write(pending,'incident-pending');const published={...pending,incidentReference:ref};await registry.write(published,'incident-published');
 assert.equal((await registry.write(pending,'incident-pending')).state,'superseded');
 await assert.rejects(registry.write(pending,'another-pending'),/stale status/);
 assert.deepEqual(counts(),{creates:1,patches:1});
});
