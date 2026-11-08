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
test('reconciles a superseded create transaction against the current entity',async t=>{
 const {options}=await setup(t);let reconciled;
 options.reconcileSuperseded=async input=>{reconciled=input;};
 let registry=await openArkivUpsert(options);
 await registry.write(baseline,'first');
 const next={...baseline,counterparties:['0x'+'1'.repeat(40)]};await registry.write(next,'second');
 registry=await openArkivUpsert(options);assert.equal((await registry.write(baseline,'first')).state,'superseded');
 assert.equal(reconciled.operationId,'first');assert.deepEqual(reconciled.record,baseline);assert.deepEqual(reconciled.entity.record,next);
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
test('guarded same-hour recovery is ordered against the last status and cannot replay over a newer incident',async t=>{
 const {options}=await setup(t),registry=await openArkivUpsert(options);
 const published={...pending,incidentReference:ref},normal={...pending,state:'normal',incidentReference:null};
 await registry.write(published,'incident-1');
 await assert.rejects(registry.write(normal,'unapproved'),/stale status/);
 await assert.rejects(registry.write(normal,'bad-token',{recoverFrom:'old'}),/stale status recovery/);
 assert.equal((await registry.write(normal,'recovery-1',{recoverFrom:'incident-1'})).state,'current');
 const nextIncident={...pending,incidentReference:'0x'+'d'.repeat(64)};
 await registry.write(nextIncident,'incident-2');
 assert.equal((await registry.write(normal,'recovery-1',{recoverFrom:'incident-1'})).state,'superseded');
 await assert.rejects(registry.write(normal,'stale-recovery',{recoverFrom:'incident-1'}),/stale status recovery/);
});
test('pending recovery is reconciled before a later incident and cannot overwrite it on retry',async t=>{
 const {options}=await setup(t);let entity,fail=false;const writes=[];
 options.create=async record=>entity={key,owner,expiresAt:100,record:structuredClone(record)};
 options.getEntity=async()=>entity;
 options.patch=async record=>{writes.push(record.state);entity={...entity,record:structuredClone(record)};if(fail){fail=false;throw Error('lost acknowledgement');}return entity;};
 const normal={...pending,state:'normal',incidentReference:null},first={...pending,incidentReference:ref},later={...pending,incidentReference:'0x'+'d'.repeat(64)};
 let registry=await openArkivUpsert(options);await registry.write(first,'incident-1');fail=true;
 await assert.rejects(registry.write(normal,'recovery-1',{recoverFrom:'incident-1'}),/lost acknowledgement/);
 registry=await openArkivUpsert(options);await registry.write(later,'incident-2');
 assert.equal(entity.record.state,'incident');assert.equal((await registry.write(normal,'recovery-1',{recoverFrom:'incident-1'})).state,'superseded');
 assert.deepEqual(writes,['normal','normal','incident']);
});
test('lost create acknowledgement reuses the pending operation after restart',async t=>{
 const {options}=await setup(t);let committed=null,creates=0;
 options.create=async record=>{if(!committed){creates++;committed={key,owner,expiresAt:100,record:structuredClone(record)};throw Error('lost response');}return committed;};
 options.getEntity=async()=>committed;
 let registry=await openArkivUpsert(options);await assert.rejects(registry.write(baseline,'first'),/lost response/);
 registry=await openArkivUpsert(options);assert.equal((await registry.write(baseline,'first')).key,key);assert.equal(creates,1);
});
test('foreign or modified current entity blocks patching',async t=>{
 const {options,counts}=await setup(t);const registry=await openArkivUpsert(options);await registry.write(baseline,'first');
 options.getEntity=async()=>({key,owner:'0x'+'d'.repeat(40),expiresAt:100,record:baseline});
 // The coordinator captures its adapters at construction; reopen with the changed reader.
 const restarted=await openArkivUpsert(options);
 await assert.rejects(restarted.write({...baseline,counterparties:['0x'+'1'.repeat(40)]},'second'),/unverified/);
 assert.equal(counts().patches,0);
});
test('upsert captures the input before queued asynchronous work',async t=>{
 const {options}=await setup(t),registry=await openArkivUpsert(options),record=structuredClone(baseline);
 const result=registry.write(record,'first');record.counterparties.push('0x'+'1'.repeat(40));
 assert.deepEqual((await result).record.counterparties,[]);
});
test('expired entity rolls over once and old operations remain superseded across restart',async t=>{
 const {options}=await setup(t);let block=10,attempts=0,offline=false;const entities=new Map(),reconciled=[];
 const keys=['0x'+'1'.repeat(64),'0x'+'2'.repeat(64)];
 options.currentBlock=async()=>block;options.getEntity=async key=>entities.get(key)??null;
 options.create=async record=>{if(offline)throw Error('offline');const created={key:keys[attempts++],owner,expiresAt:block+10,record:structuredClone(record)};entities.set(created.key,created);return created;};
 options.reconcileSuperseded=async result=>reconciled.push(result);
 let registry=await openArkivUpsert(options);await registry.write(baseline,'first');
 block=20;const next={...baseline,counterparties:['0x'+'1'.repeat(40)]};offline=true;
 await assert.rejects(registry.write(next,'second'),/offline/);offline=false;registry=await openArkivUpsert(options);
 assert.equal((await registry.write(next,'second')).key,keys[1]);assert.equal(attempts,2);
 assert.equal((await registry.write(baseline,'first')).state,'superseded');assert.equal(reconciled[0].previousKey,keys[0]);
});
test('a missing entity cannot roll over before its last verified expiry',async t=>{
 const {options,counts}=await setup(t);const registry=await openArkivUpsert(options);await registry.write(baseline,'first');
 options.getEntity=async()=>null;const reopened=await openArkivUpsert(options);
 await assert.rejects(reopened.write({...baseline,counterparties:['0x'+'1'.repeat(40)]},'second'),/without verified expiry/);
 assert.deepEqual(counts(),{creates:1,patches:0});
});
test('a disappeared entity can roll over after its recorded expiry',async t=>{
 const {options}=await setup(t);let block=10,created=0;const keys=['0x'+'1'.repeat(64),'0x'+'2'.repeat(64)];let current;
 options.currentBlock=async()=>block;options.create=async record=>current={key:keys[created++],owner,expiresAt:block+10,record:structuredClone(record)};
 options.getEntity=async key=>key===current?.key?current:null;
 let registry=await openArkivUpsert(options);await registry.write(baseline,'first');
 block=20;current=null;registry=await openArkivUpsert(options);
 assert.equal((await registry.write({...baseline,counterparties:['0x'+'1'.repeat(40)]},'second')).key,keys[1]);
});
test('pending rollover rechecks expiry and content after restart before creating',async t=>{
 const {options}=await setup(t);let block=10,entity,createCalls=0,offline=false;
 options.currentBlock=async()=>block;options.getEntity=async()=>entity;
 options.create=async record=>{createCalls++;if(offline)throw Error('offline');return entity={key,owner,expiresAt:20,record:structuredClone(record)};};
 let registry=await openArkivUpsert(options);await registry.write(baseline,'first');block=20;offline=true;
 const next={...baseline,counterparties:['0x'+'1'.repeat(40)]};await assert.rejects(registry.write(next,'second'),/offline/);
 offline=false;entity={...entity,expiresAt:30};registry=await openArkivUpsert(options);
 await assert.rejects(registry.write(next,'second'),/changed or is live/);assert.equal(createCalls,2);
 entity={...entity,expiresAt:20,owner:'0x'+'f'.repeat(40)};
 await assert.rejects(registry.write(next,'second'),/changed or is live/);assert.equal(createCalls,2);
});
test('legacy journal without an expiry cannot recreate a missing entity',async t=>{
 const {options,counts}=await setup(t),registry=await openArkivUpsert(options);await registry.write(baseline,'first');
 const {readFile,writeFile}=await import('node:fs/promises');const saved=JSON.parse(await readFile(options.path,'utf8'));
 saved.version=1;for(const op of saved.operations){delete op.expiresAt;delete op.rollover;}await writeFile(options.path,JSON.stringify(saved));
 options.getEntity=async()=>null;options.currentBlock=async()=>1000;
 const migrated=await openArkivUpsert(options);await assert.rejects(migrated.write({...baseline,counterparties:['0x'+'1'.repeat(40)]},'second'),/without verified expiry/);
 assert.equal(counts().creates,1);
});
test('legacy journal upgrades safely when the current entity remains live',async t=>{
 const {options,counts}=await setup(t),registry=await openArkivUpsert(options);await registry.write(baseline,'first');
 const {readFile,writeFile}=await import('node:fs/promises');const saved=JSON.parse(await readFile(options.path,'utf8'));
 saved.version=1;for(const op of saved.operations){delete op.expiresAt;delete op.rollover;}await writeFile(options.path,JSON.stringify(saved));
 const migrated=await openArkivUpsert(options);await migrated.write({...baseline,counterparties:['0x'+'1'.repeat(40)]},'second');
 assert.deepEqual(counts(),{creates:1,patches:1});assert.equal(JSON.parse(await readFile(options.path,'utf8')).version,2);
});
test('ENS cache records upsert per site and refuse an older resolution',async t=>{
 const {options,counts}=await setup(t),registry=await openArkivUpsert(options);
 const record={schemaVersion:1,kind:'ens_record',site,chainId:1,name:'example.eth',resolver:'0x'+'d'.repeat(40),records:{'bound.attest.v1':''},resolvedAt:'2026-01-01T01:00:00.000Z'};
 await registry.write(record,'ens-first');
 const later={...record,records:{'bound.attest.v1':'{"x":1}'},resolvedAt:'2026-01-01T02:00:00.000Z'};
 assert.equal((await registry.write(later,'ens-second')).state,'current');
 await assert.rejects(registry.write({...record,resolvedAt:'2026-01-01T00:00:00.000Z'},'ens-old'),/stale ENS cache record/);
 assert.deepEqual(counts(),{creates:1,patches:1});
});
test('frontend records upsert and reject an older publication',async t=>{
 const {options,counts}=await setup(t);options.getFrontendSafety=async()=>({known:true,rawDrift:false,incident:false});const registry=await openArkivUpsert(options);
 const record={schemaVersion:1,kind:'frontend',site,chainId:1,scripts:[],updatedAt:'2026-01-01T01:00:00.000Z'};
 await registry.write(record,'frontend-first');
 await registry.write({...record,updatedAt:'2026-01-01T02:00:00.000Z'},'frontend-second');
 await assert.rejects(registry.write(record,'frontend-old'),/stale frontend/);
 assert.deepEqual(counts(),{creates:1,patches:1});
});
test('frontend safety fails closed and quarantine survives restart',async t=>{
 const {options,counts}=await setup(t);const record={schemaVersion:1,kind:'frontend',site,chainId:1,scripts:[],updatedAt:'2026-01-01T01:00:00.000Z'};
 let registry=await openArkivUpsert(options);await assert.rejects(registry.write(record,'first'),/quarantined/);assert.equal(counts().creates,0);
 options.getFrontendSafety=async()=>({known:true,rawDrift:false,incident:false});registry=await openArkivUpsert(options);
 await assert.rejects(registry.write({...record,updatedAt:'2026-01-01T02:00:00.000Z'},'second'),/quarantined/);assert.equal(counts().creates,0);
});

test('ordinary normal status is version bound and cannot clear a risk racing its decision',async t=>{
 const {options}=await setup(t),registry=await openArkivUpsert(options);
 const normal={...pending,state:'normal'},risk={...pending,updatedAt:'2026-01-01T01:00:00.000Z'};
 await registry.write(normal,'normal-1'); const version=(await registry.latestStatus(site,1)).id;
 await registry.write(risk,'risk-1');
 await assert.rejects(registry.write({...normal,updatedAt:'2026-01-01T02:00:00.000Z'},'normal-2',{expectedVersion:version}),/stale status version/);
 await assert.rejects(registry.write({...normal,updatedAt:'2026-01-01T02:00:00.000Z'},'normal-3',{expectedVersion:'risk-1'}),/recovery approval/);
 assert.equal((await registry.latestStatus(site,1)).record.state,'incident');
});
