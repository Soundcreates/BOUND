import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createArkivWriter} from './writer.js';

const owner='0x'+'a'.repeat(40), foreign='0x'+'b'.repeat(40), id='c'.repeat(64), key='0x'+'1'.repeat(64);
const record={schemaVersion:1,kind:'observation',site:'example.org',chainId:1,value:'0x'+'2'.repeat(40),reporterKey:'rotating-key',event:'counterparty'};
function setup(){
 const entities=new Map();let creates=0;
 const writer=createArkivWriter({owner,schemaTag:'bound.record.v1',currentBlock:async()=>100,
  findByOperationId:async({operationId})=>entities.get(operationId)??null,
  submitOnce:async input=>{creates++;entities.set(input.operationId,{key,owner,expiresAt:200,record:input.record});}});
 return {writer,entities,get creates(){return creates;}};
}
test('writer verifies public read-back and makes operation retries idempotent',async()=>{
 const fixture=setup();
 const first=await fixture.writer.write(record,id);assert.equal(first.owner,owner);assert.equal(first.expiresAt,200);assert.equal(fixture.creates,1);
 const retry=await fixture.writer.write(record,id);assert.deepEqual(retry,first);assert.equal(fixture.creates,1);
 await assert.rejects(fixture.writer.write({...record,value:'0x'+'3'.repeat(40)},id),/conflict/);
});
test('writer rejects foreign, expired and unconfirmed read-backs',async()=>{
 for(const entity of [
  {key,owner:foreign,expiresAt:200,record},
  {key,owner,expiresAt:100,record},
 ]){
  const writer=createArkivWriter({owner,schemaTag:'bound.record.v1',currentBlock:async()=>100,findByOperationId:async()=>entity,submitOnce:async()=>{throw Error('must not write');}});
  await assert.rejects(writer.write(record,id),/read-back/);
 }
 const writer=createArkivWriter({owner,schemaTag:'bound.record.v1',currentBlock:async()=>100,findByOperationId:async()=>null,submitOnce:async()=>{}});
 await assert.rejects(writer.write(record,id),/not confirmed/);
});
test('simultaneous duplicate writes submit once within a writer',async()=>{
 const fixture=setup();await Promise.all([fixture.writer.write(record,id),fixture.writer.write(record,id)]);assert.equal(fixture.creates,1);
});
test('readback comparison is independent of object key order',async()=>{
 const fixture=setup();await fixture.writer.write(record,id);
 const reordered=Object.fromEntries(Object.entries(record).reverse());
 await fixture.writer.write(reordered,id);assert.equal(fixture.creates,1);
});
