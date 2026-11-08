import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openArkivSender} from './sender.js';
const owner='0x'+'a'.repeat(40),target='0x'+'b'.repeat(40),txHash='0x'+'c'.repeat(64),entityKey='0x'+'d'.repeat(64);
const record={schemaVersion:1,kind:'observation',site:'example.org',chainId:1,value:'0x'+'1'.repeat(40),reporterKey:'key',event:'warned'};
async function setup(t) {
 const dir=await mkdtemp(join(tmpdir(),'bound-sender-'));t.after(()=>rm(dir,{recursive:true,force:true}));let prepared=0,sent=0,online=false;
 const options={path:join(dir,'journal.json'),owner,chainId:7794095,target,buildCall:async()=> '0x1234',prepare:async()=>{prepared++;return '0xdeadbeef';},inspect:async()=>({from:owner,to:target,chainId:7794095,value:'0x0',data:'0x1234'}),hash:async()=>txHash,getChainId:async()=>7794095,broadcast:async()=>{sent++;},confirm:async()=>online?{state:'confirmed',transactionHash:txHash,entity:{key:entityKey,owner,expiresAt:101,record},currentBlock:100}:{state:'pending'}};
 return {options,counts:()=>({prepared,sent}),online:()=>online=true};
}
test('uncertain submission reuses the same signed bytes across restart',async t=>{
 const {options,counts,online}=await setup(t);let writer=await openArkivSender(options);
 await assert.rejects(writer.write('event-1',record),/pending/);assert.deepEqual(counts(),{prepared:1,sent:1});
 online();writer=await openArkivSender(options);assert.equal((await writer.write('event-1',record)).key,entityKey);assert.deepEqual(counts(),{prepared:1,sent:1});
 await assert.rejects(writer.write('event-1',{...record,value:'0x'+'2'.repeat(40)}),/conflict/);
});
test('an unresolved prepared transaction blocks new signing across restart',async t=>{
 const {options,counts,online}=await setup(t);let sender=await openArkivSender(options);
 await assert.rejects(sender.write('event-1',record),/pending/);
 sender=await openArkivSender(options);await assert.rejects(sender.write('event-2',record),/earlier Arkiv transaction pending/);
 assert.equal(counts().prepared,1);online();await sender.write('event-1',record);
 await sender.write('event-2',record);assert.equal(counts().prepared,2);
});
test('historical reconciliation requires the same locally confirmed operation',async t=>{
 const {options,online}=await setup(t),sender=await openArkivSender(options);
 await assert.rejects(sender.assertConfirmed('missing',record),/not confirmed/);
 await assert.rejects(sender.write('event-1',record),/pending/);
 await assert.rejects(sender.assertConfirmed('event-1',record),/not confirmed/);
 online();await sender.write('event-1',record);await sender.assertConfirmed('event-1',record);
 await assert.rejects(sender.assertConfirmed('event-1',{...record,value:'0x'+'2'.repeat(40)}),/not confirmed/);
});
test('extension context requires an entity and a bounded lifetime',async t=>{
 const {options}=await setup(t);let context;options.buildCall=async(_record,_id,value)=>{context=value;return '0x1234';};
 const sender=await openArkivSender(options);
 await assert.rejects(sender.write('bad',record,{extendBlocks:100}),/invalid Arkiv write/);
 await assert.rejects(sender.write('bad',record,{entityKey,extendBlocks:7884001}),/invalid Arkiv write/);
 await assert.rejects(sender.write('good',record,{entityKey,extendBlocks:100}),/pending/);
 assert.deepEqual(context,{entityKey,extendBlocks:100});
});
test('refuses wrong chain, signer, calldata, or unverified readback',async t=>{
 const {options,counts}=await setup(t);
 let writer=await openArkivSender({...options,getChainId:async()=>1});await assert.rejects(writer.write('event-1',record),/chain/);assert.equal(counts().sent,0);
 writer=await openArkivSender({...options,inspect:async()=>({from:owner,to:target,chainId:7794095,value:'0x0',data:'0xabcd'})});await assert.rejects(writer.write('event-2',record),/transaction/);assert.equal(counts().sent,0);
});
test('confirmed receipts need matching owner, payload and unexpired entity',async t=>{
 const {options,counts}=await setup(t);
 options.confirm=async()=>({state:'confirmed',transactionHash:txHash,entity:{key:entityKey,owner:'0x'+'e'.repeat(40),expiresAt:101,record},currentBlock:100});
 const writer=await openArkivSender(options);await assert.rejects(writer.write('event-1',record),/unverified/);assert.equal(counts().sent,0);
});
test('lost broadcast acknowledgement reconciles without creating a new transaction',async t=>{
 const {options,counts}=await setup(t);let committed=false;
 options.broadcast=async()=>{committed=true;throw Error('response lost');};
 options.confirm=async()=>committed?{state:'confirmed',transactionHash:txHash,entity:{key:entityKey,owner,expiresAt:101,record},currentBlock:100}:{state:'pending'};
 const writer=await openArkivSender(options);
 assert.equal((await writer.write('event-1',record)).key,entityKey);assert.equal(counts().prepared,1);
});
test('captures record and patch context before asynchronous preparation',async t=>{
 const {options}=await setup(t);let observed;
 options.buildCall=async(value,id,context)=>{observed={value,context};return '0x1234';};
 const writer=await openArkivSender(options),input=structuredClone(record),context={entityKey};
 const result=writer.write('event-1',input,context);input.value='0x'+'2'.repeat(40);context.entityKey='0x'+'3'.repeat(64);
 await assert.rejects(result,/pending/);assert.equal(observed.value.value,record.value);assert.equal(observed.context.entityKey,entityKey);
});
test('patch confirmation must return the intended entity key',async t=>{
 const {options,counts}=await setup(t);options.confirm=async()=>({state:'confirmed',transactionHash:txHash,entity:{key:entityKey,owner,expiresAt:101,record},currentBlock:100});
 const writer=await openArkivSender(options);
 await assert.rejects(writer.write('event-1',record,{entityKey:'0x'+'e'.repeat(64)}),/readback/);assert.equal(counts().sent,0);
});

test('existing operation reconciles a confirmed receipt and clears signed bytes',async t=>{
 const {options,counts,online}=await setup(t);let sender=await openArkivSender(options);
 await assert.rejects(sender.write('event-1',record),/pending/);
 online();sender=await openArkivSender(options);
 const entity={key:entityKey,owner,expiresAt:101,record};
 assert.equal((await sender.reconcileExisting('event-1',record,entity)).key,entityKey);
 assert.deepEqual(counts(),{prepared:1,sent:1});
 const journal=JSON.parse(await readFile(options.path,'utf8'));
 assert.equal(journal.entries[0].state,'confirmed');assert.equal(journal.entries[0].rawTransaction,null);
});
