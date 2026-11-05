import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtemp,rm} from 'node:fs/promises';
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
