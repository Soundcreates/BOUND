import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createWatcher} from '../../services/watcher/index.js';
import {openOutbox} from '../../services/watcher/outbox.js';
import {openDurableWatcher} from '../../services/watcher/durable.js';
import {createObservationPipeline} from '../../services/watcher/pipeline.js';
import {queryBundle} from '../../integrations/arkiv/index.js';

// Local fakes exercise composition only; they do not satisfy a live integration gate.
test('intake to fake Arkiv observation to baseline bundle with owner verification', async t => {
  const dir=await mkdtemp(join(tmpdir(),'bound-flow-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const owner='0x'+'a'.repeat(40), foreign='0x'+'b'.repeat(40), address='0x'+'1'.repeat(40), attacker='0x'+'2'.repeat(40);
  const entries=[], ids=new Set();
  const outbox=await openOutbox({path:join(dir,'queue.json'),deliver:async (record,id)=>{
    if (ids.has(id)) return; ids.add(id);
    entries.push({key:'0x'+(entries.length+1).toString(16).padStart(64,'0'),owner,expiresAt:101,record});
  }});
  let active=false;
  const watcher=createWatcher({windowMs:3600000,k:3,now:()=>0,isIncidentActive:async()=>active,hasCorroboratedDrift:async()=>false,writeObservation:async record=>{
    const id=createHash('sha256').update(JSON.stringify(record)).digest('hex'); await outbox.enqueue(id,record);
  }});
  const event=(value,kind)=>({site:'example.org',chainId:1,value,kind,reporterKey:'test-key'});
  assert.equal((await watcher.intake({schemaVersion:1,events:[event(address,'counterparty')]})).result,'accepted');
  await outbox.flush(); assert.equal(entries.length,1); assert.equal(entries[0].record.kind,'observation');
  await watcher.intake({schemaVersion:1,events:[event(attacker,'counterparty'),event(attacker,'warned')]});
  active=true; await watcher.intake({schemaVersion:1,events:[event('0x'+'3'.repeat(40),'counterparty')]});
  const baseline=watcher.baseline('example.org',1);
  assert.deepEqual(baseline.counterparties,[address]);
  entries.push({key:'0x'+'f'.repeat(64),owner,expiresAt:101,record:baseline});
  entries.push({key:'0x'+'e'.repeat(64),owner:foreign,expiresAt:101,record:{...baseline,counterparties:[attacker]}});
  const bundle=await queryBundle({client:{query:async ({owner:requested})=>{assert.equal(requested,owner);return entries;}},owner,currentBlock:100,now:()=>0});
  assert.equal(bundle.records.length,1); assert.deepEqual(bundle.records[0].record.counterparties,[address]);
  for (const publicRecord of entries.map(x=>x.record)) {
    for (const key of ['wallet','amount','transactionHash','requestDigest','choice','timestamp']) assert.equal(Object.hasOwn(publicRecord,key),false);
  }
});

test('durable watcher retries fake Arkiv writes and rebuilds baseline after restart', async t => {
  const {openDurableWatcher}=await import('../../services/watcher/durable.js');
  const dir=await mkdtemp(join(tmpdir(),'bound-restart-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const owner='0x'+'a'.repeat(40), site='example.org', address='0x'+'1'.repeat(40), entries=[],seen=new Set();
  let offline=true;
  const options={path:join(dir,'journal.json'),windowMs:3600000,retentionMs:7200000,k:3,now:()=>0,isIncidentActive:async()=>false,hasCorroboratedDrift:async()=>false,writeObservation:async(record,id)=>{
    if (offline) throw new Error('fake Arkiv offline');
    if (seen.has(id)) return; seen.add(id);
    entries.push({key:'0x'+(entries.length+1).toString(16).padStart(64,'0'),owner,expiresAt:101,record});
  }};
  let watcher=await openDurableWatcher(options);
  await watcher.intake({schemaVersion:1,events:[{site,chainId:1,value:address,kind:'counterparty',reporterKey:'test-key'}]});
  await assert.rejects(watcher.flush(),/offline/);
  assert.deepEqual((await watcher.baseline(site,1)).counterparties,[]);
  watcher=await openDurableWatcher(options);offline=false;await watcher.flush();
  watcher=await openDurableWatcher(options);
  const baseline=await watcher.baseline(site,1);
  entries.push({key:'0x'+'f'.repeat(64),owner,expiresAt:101,record:baseline});
  const bundle=await queryBundle({client:{query:async()=>entries},owner,currentBlock:100,now:()=>0});
  assert.equal(entries.filter(entry=>entry.record.kind==='observation').length,1);
  assert.deepEqual(bundle.records[0].record.counterparties,[address]);
});

test('durable intake publishes an hourly baseline and refreshes an owner-checked bundle', async t => {
  const dir=await mkdtemp(join(tmpdir(),'bound-hourly-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const owner='0x'+'a'.repeat(40),foreign='0x'+'b'.repeat(40),site='example.org';
  const warned='0x'+'1'.repeat(40),benign='0x'+'2'.repeat(40),activeOnly='0x'+'3'.repeat(40);
  const entries=[],operations=new Map();
  const archive={
    async writeObservation(record,id){if(!operations.has(id)){const entry={key:'0x'+(entries.length+1).toString(16).padStart(64,'0'),owner,expiresAt:600,record};operations.set(id,entry);entries.push(entry);}},
    async writeBaseline(record,id){if(!operations.has(id)){const entry={key:'0x'+(entries.length+1).toString(16).padStart(64,'0'),owner,expiresAt:600,record};operations.set(id,entry);entries.push(entry);}},
    async query({owner:requested}){assert.equal(requested,owner);return [...entries,{key:'0x'+'f'.repeat(64),owner:foreign,expiresAt:600,record:{schemaVersion:1,kind:'baseline',site,chainId:1,counterparties:[warned],calledContracts:[],updatedAt:'2026-01-01T00:00:00.000Z'}}];},
  };
  let active=false;
  const watcher=await openDurableWatcher({path:join(dir,'watcher.json'),windowMs:3600000,retentionMs:7200000,k:3,now:()=>3600123,
    isIncidentActive:async()=>active,hasCorroboratedDrift:async()=>false,writeObservation:archive.writeObservation});
  await watcher.intake({schemaVersion:1,events:[
    {site,chainId:1,value:warned,kind:'counterparty',reporterKey:'rotating-a'},
    {site,chainId:1,value:warned,kind:'warned',reporterKey:'rotating-a'},
    {site,chainId:1,value:benign,kind:'counterparty',reporterKey:'rotating-a'},
  ]});
  active=true;
  await watcher.intake({schemaVersion:1,events:[{site,chainId:1,value:activeOnly,kind:'counterparty',reporterKey:'rotating-a'}]});
  const pipeline=createObservationPipeline({watcher,archive,owner,currentBlock:async()=>500,now:()=>3600123});
  const {published,bundle}=await pipeline.runHourly();
  assert.equal(published.length,1);
  assert.deepEqual(bundle.records.map(entry=>entry.record.kind),['baseline']);
  assert.deepEqual(bundle.records[0].record.counterparties,[benign]);
  assert.equal(entries.filter(entry=>entry.record.kind==='observation').length,3);
  assert.equal(entries.find(entry=>entry.record.kind==='baseline').owner,owner);
});

test('HTTP intake persists and delivers after a simulated watcher restart', async t => {
  const {openDurableWatcher}=await import('../../services/watcher/durable.js');
  const {createIntakeServer}=await import('../../services/watcher/http.js');
  const dir=await mkdtemp(join(tmpdir(),'bound-http-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const origin='chrome-extension://'+'a'.repeat(32), site='example.org', value='0x'+'1'.repeat(40), delivered=[];
  const options={path:join(dir,'journal.json'),windowMs:3600000,retentionMs:7200000,k:3,now:()=>0,isIncidentActive:async()=>false,hasCorroboratedDrift:async()=>false,writeObservation:async(record,id)=>delivered.push({record,id})};
  let watcher=await openDurableWatcher(options);
  const server=createIntakeServer({watcher,allowedOrigins:[origin]});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
  const body=JSON.stringify({schemaVersion:1,events:[{site,chainId:1,value,kind:'counterparty',reporterKey:'key'}]});
  const response=await fetch(`http://127.0.0.1:${server.address().port}/v1/observations`,{method:'POST',headers:{origin,'content-type':'application/json'},body});
  assert.equal(response.status,202);assert.equal(delivered.length,0);
  watcher=await openDurableWatcher(options);await watcher.flush();
  assert.equal(delivered.length,1);assert.deepEqual((await watcher.baseline(site,1)).counterparties,[value]);
});

test('fake incident pipeline retains public warning when report upload fails',async t=>{
 const {createIncidentComposer}=await import('../../services/watcher/incident.js');
 const {keccak256}=await import('../../packages/contracts/keccak-reference.js');
 const dir=await mkdtemp(join(tmpdir(),'bound-incident-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const owner='0x'+'a'.repeat(40),site='example.org',counterparty='0x'+'1'.repeat(40),entries=[];
 let active=false;
 const watcher=await openDurableWatcher({path:join(dir,'watcher.json'),windowMs:3600000,retentionMs:7200000,k:3,now:()=>0,isIncidentActive:async()=>active,hasCorroboratedDrift:async()=>false,writeObservation:async()=>{}});
 await watcher.intake({schemaVersion:1,events:['a','b','c'].map(reporterKey=>({site,chainId:1,value:counterparty,kind:'warned',reporterKey}))});await watcher.flush();
 const [trigger]=await watcher.triggers(site,1);assert.equal(trigger.trigger,'K-same-counterparty-warned');
 const composer=createIncidentComposer({markActive:async()=>{active=true;},hash:bytes=>keccak256(bytes),upload:async()=>{throw Error('fake Swarm offline');},writeIncident:async()=>{throw Error('unexpected incident write');},writeStatus:async record=>entries.push({key:'0x'+'b'.repeat(64),owner,expiresAt:11,record})});
 await assert.rejects(composer.publish({incidentId:'1'.repeat(64),site,chainId:1,counterparty,trigger:trigger.trigger,publicationHour:'2026-01-01T00:00:00.000Z',feedReference:'0x'+'d'.repeat(64),evidenceReferences:[]}),/offline/);
 const bundle=await queryBundle({client:{query:async()=>entries},owner,currentBlock:10,now:()=>0});
 assert.equal(active,true);assert.equal(bundle.records[0].record.state,'incident');assert.equal(bundle.records[0].record.incidentReference,null);
 await watcher.intake({schemaVersion:1,events:[{site,chainId:1,value:'0x'+'2'.repeat(40),kind:'counterparty',reporterKey:'d'}]});
 assert.deepEqual((await watcher.baseline(site,1)).counterparties,[]);
});

test('Arkiv codec, journal, transport and receipt checker compose with a fake signer and RPC',async t=>{
 const {openArkivSender}=await import('../../integrations/arkiv/sender.js');
 const {createArkivTransport}=await import('../../integrations/arkiv/transport.js');
 const {createArkivConfirmation}=await import('../../integrations/arkiv/confirm.js');
 const {encodeCreateRecord}=await import('../../integrations/arkiv/codec.js');
 const dir=await mkdtemp(join(tmpdir(),'bound-arkiv-stack-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const owner='0x'+'a'.repeat(40),target='0x'+'b'.repeat(40),tx='0x'+'c'.repeat(64),key='0x'+'d'.repeat(64),blockHash='0x'+'e'.repeat(64),topic='0xb282d7c494b8899aa8015cd07be621530beb03409eb8c5e8fdc1411ba64356a5';
 const record={schemaVersion:1,kind:'observation',site:'example.org',chainId:1,value:'0x'+'1'.repeat(40),reporterKey:'test-key',event:'warned'};
 let broadcast=false,prepared;
 const entity={key,owner,expiresAt:'0x65',attributes:[{name:'arkiv.schema',type:'str',value:'bound.record.v1'},{name:'payload',type:'bytes',value:'0x'+Buffer.from(JSON.stringify(record)).toString('hex')}]};
 const receipt={transactionHash:tx,status:'0x1',from:owner,to:target,blockNumber:'0xa',blockHash,logs:[{address:target,topics:[topic,key,'0x'+'0'.repeat(24)+owner.slice(2)],data:'0x'+'0'.repeat(62)+'65'+'0'.repeat(64),removed:false}]};
 const transport=createArkivTransport({url:'https://rpc.example',fetchImpl:async(_url,options)=>{
  const {method}=JSON.parse(options.body);
  const values={eth_chainId:'0x76edaf',eth_getTransactionReceipt:broadcast?receipt:null,eth_blockNumber:'0xb',eth_getBlockByNumber:{hash:blockHash},arkiv_getEntity:entity,eth_sendRawTransaction:tx};
  if(method==='eth_sendRawTransaction')broadcast=true;
  return {ok:true,json:async()=>({jsonrpc:'2.0',id:1,result:values[method]})};
 }});
 const confirm=createArkivConfirmation({rpc:transport.rpc,owner,target,chainId:7794095,schemaTag:'bound.record.v1'});
 const sender=await openArkivSender({path:join(dir,'sender.json'),owner,chainId:7794095,target,buildCall:async(record,id)=>encodeCreateRecord({record,operationId:id,schemaTag:'bound.record.v1',lifetimeBlocks:100}),prepare:async input=>{prepared=input;return '0xdeadbeef';},inspect:async()=>({from:owner,to:target,chainId:7794095,value:'0x0',data:prepared.data}),hash:async()=>tx,getChainId:async()=>Number(BigInt(await transport.rpc('eth_chainId',[]))),broadcast:async raw=>transport.rpc('eth_sendRawTransaction',[raw]),confirm});
 const result=await sender.write('local-event',record);assert.equal(broadcast,true);assert.equal(result.key,key);assert.deepEqual(result.record,record);
});
