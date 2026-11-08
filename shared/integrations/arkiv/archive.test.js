import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openArkivArchive} from './archive.js';
import {encodeExtendEntity} from './codec.js';
const owner='0x'+'a'.repeat(40),target='0x'+'b'.repeat(40),key='0x'+'c'.repeat(64),blockHash='0x'+'d'.repeat(64),schemaTag='bound.record.v1';
const base={schemaVersion:1,kind:'baseline',site:'example.org',chainId:1,counterparties:[],calledContracts:[],updatedAt:'2026-01-01T00:00:00.000Z'};
test('composed archive creates then patches a baseline through one entity',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'bound-archive-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let row=null,requestForRaw=new Map(),records=[base,{...base,counterparties:['0x'+'1'.repeat(40)]}],sent=0,receipts=new Map();
 const idForRecord=['1'.repeat(64),'2'.repeat(64)];
 const fetchImpl=async(_url,options)=>{const request=JSON.parse(options.body);let result;
  switch(request.method){
   case 'eth_chainId':result='0x76edaf';break;
   case 'eth_blockNumber':result='0xb';break;
   case 'eth_getBlockByNumber':result={hash:blockHash};break;
   case 'arkiv_getEntity':result=row;break;
   case 'arkiv_query':{const expression=request.params[0];result={data:row&&expression.includes(`operation = str('${idForRecord[sent-1]}')`)?[row]:[],blockNumber:'0xb'};break;}
   case 'eth_getTransactionReceipt':result=receipts.get(request.params[0])??null;break;
   case 'eth_sendRawTransaction':{const raw=request.params[0],descriptor=requestForRaw.get(raw);assert.ok(descriptor);sent++;const current=records[sent-1],id=idForRecord[sent-1],lastTx='0x'+raw.slice(2).padStart(64,'0');row={key,owner,expiresAt:'0x65',attributes:[{name:'arkiv.schema',type:'str',value:schemaTag},{name:'operation',type:'str',value:id},{name:'payload',type:'bytes',value:'0x'+Buffer.from(JSON.stringify(current)).toString('hex')}]};const topic=sent===1?'0xb282d7c494b8899aa8015cd07be621530beb03409eb8c5e8fdc1411ba64356a5':'0xe986ee220b2d7947a009d9389d8400b2ac82d3b430a9f72700a0975d3d5a34fe';receipts.set(lastTx,{transactionHash:lastTx,status:'0x1',from:owner,to:target,blockNumber:'0xa',blockHash,logs:[{address:target,topics:[topic,key,'0x'+'0'.repeat(24)+owner.slice(2)],data:sent===1?'0x'+'0'.repeat(62)+'65'+'0'.repeat(64):'0x'}]});result=lastTx;break;}
   default:throw Error('unexpected RPC '+request.method);
  }
  return {ok:true,json:async()=>({jsonrpc:'2.0',id:1,result})};};
 let nonce=0;
 const archive=await openArkivArchive({url:'https://rpc.example',fetchImpl,owner,target,chainId:7794095,schemaTag,senderJournal:join(dir,'sender.json'),registryJournal:join(dir,'registry.json'),lifetimes:{observation:100,baseline:100,drift:100,incident:100,status:100},prepare:async request=>{const raw='0x'+(++nonce).toString(16).padStart(2,'0');requestForRaw.set(raw,request);return raw;},inspect:async raw=>{const request=requestForRaw.get(raw);return {...request,from:owner,to:target};},hash:async bytes=>'0x'+bytes.toString('hex').padStart(64,'0')});
 assert.equal((await archive.writeBaseline(base,idForRecord[0])).key,key);
 assert.equal((await archive.writeBaseline(records[1],idForRecord[1])).key,key);
 assert.equal(sent,2);assert.equal((await archive.writeBaseline(base,idForRecord[0])).state,'superseded');assert.equal(sent,2);
});
test('archive refuses overlapping journal files',async()=>{
 const options={url:'https://rpc.example',owner,target,chainId:7794095,schemaTag,senderJournal:'same.json',registryJournal:'./same.json',lifetimes:{observation:1,baseline:1,drift:1,incident:1,status:1}};
 await assert.rejects(openArkivArchive(options),/distinct/);
});
test('archive replaces a disappeared expired entity and recognizes old confirmed operations',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'bound-archive-rollover-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const keys=['0x'+'1'.repeat(64),'0x'+'2'.repeat(64)],ids=['3'.repeat(64),'4'.repeat(64)];
 const records=[base,{...base,counterparties:['0x'+'1'.repeat(40)]}],receipts=new Map(),requests=new Map();let block=11,row=null,sent=0;
 const hex=n=>'0x'+n.toString(16);
 const fetchImpl=async(_url,options)=>{const req=JSON.parse(options.body);let result;
  switch(req.method){
   case 'eth_chainId':result='0x76edaf';break;
   case 'eth_blockNumber':result=hex(block);break;
   case 'eth_getBlockByNumber':result={hash:blockHash};break;
   case 'arkiv_getEntity':result=row?.key===req.params[0]?row:null;break;
   case 'arkiv_query':result={data:row&&req.params[0].includes(`operation = str('${ids[sent-1]}')`)?[row]:[],blockNumber:hex(block)};break;
   case 'eth_getTransactionReceipt':result=receipts.get(req.params[0])??null;break;
   case 'eth_sendRawTransaction':{
    const raw=req.params[0],index=sent++,tx='0x'+raw.slice(2).padStart(64,'0'),expiry=block+10;assert.ok(requests.has(raw));
    row={key:keys[index],owner,expiresAt:hex(expiry),attributes:[{name:'arkiv.schema',type:'str',value:schemaTag},{name:'operation',type:'str',value:ids[index]},{name:'payload',type:'bytes',value:'0x'+Buffer.from(JSON.stringify(records[index])).toString('hex')}]};
    receipts.set(tx,{transactionHash:tx,status:'0x1',from:owner,to:target,blockNumber:hex(block-1),blockHash,logs:[{address:target,topics:['0xb282d7c494b8899aa8015cd07be621530beb03409eb8c5e8fdc1411ba64356a5',keys[index],'0x'+'0'.repeat(24)+owner.slice(2)],data:'0x'+expiry.toString(16).padStart(64,'0')+'0'.repeat(64)}]});result=tx;break;
   }
   default:throw Error('unexpected RPC');
  }
  return {ok:true,json:async()=>({jsonrpc:'2.0',id:1,result})};
 };
 let nonce=0;const archive=await openArkivArchive({url:'https://rpc.example',fetchImpl,owner,target,chainId:7794095,schemaTag,senderJournal:join(dir,'sender.json'),registryJournal:join(dir,'registry.json'),lifetimes:{observation:100,baseline:100,drift:100,incident:100,status:100},prepare:async request=>{const raw='0x'+(++nonce).toString(16).padStart(2,'0');requests.set(raw,request);return raw;},inspect:async raw=>({...requests.get(raw),from:owner,to:target}),hash:async bytes=>'0x'+bytes.toString('hex').padStart(64,'0')});t.after(()=>archive.close());
 assert.equal((await archive.writeBaseline(records[0],ids[0])).key,keys[0]);
 block=21;row=null;assert.equal((await archive.writeBaseline(records[1],ids[1])).key,keys[1]);
 assert.equal((await archive.writeBaseline(records[0],ids[0])).state,'superseded');assert.equal(sent,2);
});
test('archive renewal extends the registered entity and retains its key',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'bound-archive-renew-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const id='1'.repeat(64),receipts=new Map(),requests=new Map();let block=11,row=null,sent=0,delayExtensionReceipt=false;
 const hex=n=>'0x'+n.toString(16);
 const fetchImpl=async(_url,options)=>{const request=JSON.parse(options.body);let result;
  switch(request.method){
   case 'eth_chainId':result='0x76edaf';break;
   case 'eth_blockNumber':result=hex(block);break;
   case 'eth_getBlockByNumber':result={hash:blockHash};break;
   case 'arkiv_getEntity':result=row;break;
   case 'arkiv_query':result={data:row&&request.params[0].includes(`operation = str('${id}')`)?[row]:[],blockNumber:hex(block)};break;
   case 'eth_getTransactionReceipt':result=delayExtensionReceipt&&request.params[0]==='0x'+'0'.repeat(63)+'2'?null:receipts.get(request.params[0])??null;break;
   case 'eth_sendRawTransaction':{
    const raw=request.params[0],prepared=requests.get(raw),tx='0x'+raw.slice(2).padStart(64,'0');sent++;
    const expiry=sent===1?31:block+100;
    if(sent===1)row={key,owner,expiresAt:hex(expiry),attributes:[{name:'arkiv.schema',type:'str',value:schemaTag},{name:'operation',type:'str',value:id},{name:'payload',type:'bytes',value:'0x'+Buffer.from(JSON.stringify(base)).toString('hex')}]};
    else{assert.equal(prepared.data,encodeExtendEntity({entityKey:key,lifetimeBlocks:100}));row={...row,expiresAt:hex(expiry)};}
    const topic=sent===1?'0xb282d7c494b8899aa8015cd07be621530beb03409eb8c5e8fdc1411ba64356a5':'0x10dc3526654c9ba4e2370b1bfcbc0de087d141a5694b3d3305d37df7e6705d4b';
    const data='0x'+expiry.toString(16).padStart(64,'0')+(sent===1?'0'.repeat(64):'');
    receipts.set(tx,{transactionHash:tx,status:'0x1',from:owner,to:target,blockNumber:hex(block-1),blockHash,logs:[{address:target,topics:[topic,key,'0x'+'0'.repeat(24)+owner.slice(2)],data}]});result=tx;break;
   }
   default:throw Error('unexpected RPC');
  }
  return {ok:true,json:async()=>({jsonrpc:'2.0',id:1,result})};
 };
 let nonce=0;const options={url:'https://rpc.example',fetchImpl,owner,target,chainId:7794095,schemaTag,senderJournal:join(dir,'sender.json'),registryJournal:join(dir,'registry.json'),lifetimes:{observation:100,baseline:100,drift:100,incident:100,status:100},renewBeforeBlocks:10,prepare:async request=>{const raw='0x'+(++nonce).toString(16).padStart(2,'0');requests.set(raw,request);return raw;},inspect:async raw=>({...requests.get(raw),from:owner,to:target}),hash:async bytes=>'0x'+bytes.toString('hex').padStart(64,'0')};
 let archive=await openArkivArchive(options);t.after(()=>archive.close());
 await archive.writeBaseline(base,id);block=22;delayExtensionReceipt=true;await assert.rejects(archive.renew(),/pending/);
 assert.equal(sent,2);await archive.close();delayExtensionReceipt=false;archive=await openArkivArchive(options);
 assert.equal((await archive.writeBaseline(base,id)).key,key);assert.equal((await archive.readEntity(key)).expiresAt,122);await archive.renew();assert.equal(sent,2);
 block=40;row=null;await assert.rejects(archive.writeBaseline({...base,counterparties:['0x'+'1'.repeat(40)]},'5'.repeat(64)),/without verified expiry/);assert.equal(sent,2);
});
test('multiple same-hour guarded recoveries do not replay a superseded normal status',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'bound-archive-recovery-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const ref='0x'+'d'.repeat(64),normal={schemaVersion:1,kind:'status',site:'example.org',chainId:1,state:'normal',feedReference:ref,incidentReference:null,updatedAt:'2026-01-01T00:00:00.000Z'};
 const drift={...normal,state:'drift'},incident={...normal,state:'incident',incidentReference:'0x'+'e'.repeat(64)},records=[normal,drift,normal,incident,normal],ids=['0','1','2','3','4'].map(v=>v.repeat(64)),receipts=new Map(),requests=new Map();let row=null,sent=0;
 const fetchImpl=async(_url,options)=>{const request=JSON.parse(options.body);let result;
  switch(request.method){
   case 'eth_chainId':result='0x76edaf';break;
   case 'eth_blockNumber':result='0xb';break;
   case 'eth_getBlockByNumber':result={hash:blockHash};break;
   case 'arkiv_getEntity':result=row;break;
   case 'arkiv_query':result={data:row&&request.params[0].includes(`operation = str('${ids[0]}')`)?[row]:[],blockNumber:'0xb'};break;
   case 'eth_getTransactionReceipt':result=receipts.get(request.params[0])??null;break;
   case 'eth_sendRawTransaction':{
    const raw=request.params[0],index=sent++,tx='0x'+raw.slice(2).padStart(64,'0');assert.ok(requests.has(raw));
    row={key,owner,expiresAt:'0x65',attributes:[{name:'arkiv.schema',type:'str',value:schemaTag},{name:'operation',type:'str',value:ids[0]},{name:'payload',type:'bytes',value:'0x'+Buffer.from(JSON.stringify(records[index])).toString('hex')}]};
    const topic=index===0?'0xb282d7c494b8899aa8015cd07be621530beb03409eb8c5e8fdc1411ba64356a5':'0xe986ee220b2d7947a009d9389d8400b2ac82d3b430a9f72700a0975d3d5a34fe';
    receipts.set(tx,{transactionHash:tx,status:'0x1',from:owner,to:target,blockNumber:'0xa',blockHash,logs:[{address:target,topics:[topic,key,'0x'+'0'.repeat(24)+owner.slice(2)],data:index===0?'0x'+'0'.repeat(62)+'65'+'0'.repeat(64):'0x'}]});result=tx;break;
   }
   default:throw Error('unexpected RPC');
  }
  return {ok:true,json:async()=>({jsonrpc:'2.0',id:1,result})};
 };
 let nonce=0;const archive=await openArkivArchive({url:'https://rpc.example',fetchImpl,owner,target,chainId:7794095,schemaTag,senderJournal:join(dir,'sender.json'),registryJournal:join(dir,'registry.json'),lifetimes:{observation:100,baseline:100,drift:100,incident:100,status:100},prepare:async request=>{const raw='0x'+(++nonce).toString(16).padStart(2,'0');requests.set(raw,request);return raw;},inspect:async raw=>({...requests.get(raw),from:owner,to:target}),hash:async bytes=>'0x'+bytes.toString('hex').padStart(64,'0')});t.after(()=>archive.close());
 await archive.writeStatus(normal,ids[0]);await archive.writeStatus(drift,ids[1]);await assert.rejects(archive.writeRecoveryStatus(normal,ids[2]),/invalid Arkiv recovery/);
 const priorDrift=await archive.getStatusVersion(normal.site,normal.chainId);
 await archive.writeRecoveryStatus(normal,ids[2],priorDrift);await archive.writeRecoveryStatus(normal,ids[2],priorDrift);assert.equal(sent,3);
 await archive.writeStatus(incident,ids[3]);assert.equal((await archive.writeRecoveryStatus(normal,ids[2],priorDrift)).state,'superseded');
 await assert.rejects(archive.writeRecoveryStatus(normal,ids[4],priorDrift),/stale status recovery/);assert.equal(sent,4);
 const priorIncident=await archive.getStatusVersion(normal.site,normal.chainId);await archive.writeRecoveryStatus(normal,ids[2],priorIncident);assert.equal(sent,5);
});
test('frontend writer enforces kind and lifetime bounds',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'bound-frontend-archive-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const options={url:'https://rpc.example',owner,target,chainId:7794095,schemaTag,senderJournal:join(dir,'sender'),registryJournal:join(dir,'registry'),lifetimes:{observation:100,baseline:100,drift:100,incident:100,status:100,frontend:25},prepare:async()=>{},inspect:async()=>{},hash:async()=>{}};
 for(const lifetime of [0,25,7884001,1.5]) await assert.rejects(openArkivArchive({...options,lifetimes:{...options.lifetimes,frontend:lifetime}}),/invalid frontend lifetime/);
 const archive=await openArkivArchive({...options,lifetimes:{...options.lifetimes,frontend:100}});t.after(()=>archive.close());
 await assert.rejects(archive.writeFrontend(base,'1'.repeat(64)),/invalid Arkiv record kind/);
});
test('pending frontend send is quarantined on unsafe restart and cannot replay after recovery',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'bound-frontend-replay-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const record={schemaVersion:1,kind:'frontend',site:'example.org',chainId:1,scripts:[],updatedAt:'2026-01-01T00:00:00.000Z'};
 let safe=true,sent=0,prepared=0;const requests=new Map();
 const fetchImpl=async(_url,options)=>{const req=JSON.parse(options.body);let result;
  switch(req.method){
   case 'eth_chainId':result='0x76edaf';break;
   case 'eth_blockNumber':result='0xb';break;
   case 'arkiv_query':result={data:[],blockNumber:'0xb'};break;
   case 'eth_getTransactionReceipt':result=null;break;
   case 'eth_sendRawTransaction':sent++;result='0x'+'0'.repeat(63)+'1';break;
   default:throw Error('unexpected RPC '+req.method);
  }return {ok:true,json:async()=>({jsonrpc:'2.0',id:1,result})};};
 const options={url:'https://rpc.example',fetchImpl,owner,target,chainId:7794095,schemaTag,senderJournal:join(dir,'sender'),registryJournal:join(dir,'registry'),lifetimes:{observation:100,baseline:100,drift:100,incident:100,status:100},getFrontendSafety:async()=>({known:safe,rawDrift:!safe,incident:false}),prepare:async request=>{prepared++;requests.set('0x01',request);return '0x01';},inspect:async raw=>({...requests.get(raw),from:owner,to:target}),hash:async bytes=>'0x'+bytes.toString('hex').padStart(64,'0')};
 let archive=await openArkivArchive(options);t.after(()=>archive.close());
 await assert.rejects(archive.writeFrontend(record,'1'.repeat(64)),/pending/);assert.equal(sent,1);await archive.close();
 safe=false;archive=await openArkivArchive(options);
 await assert.rejects(archive.writeFrontend({...record,updatedAt:'2026-01-01T01:00:00.000Z'},'2'.repeat(64)),/quarantined/);
 assert.equal(sent,1);await archive.close();safe=true;archive=await openArkivArchive(options);
 await assert.rejects(archive.writeFrontend(record,'1'.repeat(64)),/quarantined/);
 await assert.rejects(archive.writeFrontend({...record,updatedAt:'2026-01-01T02:00:00.000Z'},'3'.repeat(64)),/quarantined/);
 assert.equal(sent,1);assert.equal(prepared,1);
});
test('never prepared quarantined frontend operation is retired durably',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'bound-frontend-retire-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const record={schemaVersion:1,kind:'frontend',site:'example.org',chainId:1,scripts:[],updatedAt:'2026-01-01T00:00:00.000Z'},id='1'.repeat(64);
 let safe=false,prepared=0;
 const options={url:'https://rpc.example',owner,target,chainId:7794095,schemaTag,senderJournal:join(dir,'sender'),registryJournal:join(dir,'registry'),lifetimes:{observation:100,baseline:100,drift:100,incident:100,status:100},getFrontendSafety:async()=>({known:safe,rawDrift:!safe,incident:false}),prepare:async()=>{prepared++;throw Error('unexpected preparation');},inspect:async()=>{},hash:async()=>{}};
 let archive=await openArkivArchive(options);t.after(()=>archive.close());
 await assert.rejects(archive.writeFrontend(record,id),/quarantined/);assert.equal(prepared,0);
 safe=true;assert.deepEqual(await archive.reconcileFrontend(record,id),{state:'absent'});
 await archive.close();archive=await openArkivArchive(options);
 await assert.rejects(archive.writeFrontend(record,id),/retired/);assert.equal(prepared,0);
});
