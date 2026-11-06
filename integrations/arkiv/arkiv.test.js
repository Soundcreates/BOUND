import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { queryBundle } from './index.js';
const owner='0x'+'a'.repeat(40), foreign='0x'+'b'.repeat(40), key='0x'+'1'.repeat(64);
const record={schemaVersion:1,kind:'baseline',site:'example.org',chainId:1,counterparties:[],calledContracts:[],updatedAt:'2026-01-01T00:00:00.000Z'};
test('bundle query requests owner and rechecks owner, expiry and payload', async () => {
  let filter;
  const client={query:async options => { filter=options; return [
    {key,owner,expiresAt:11,record},
    {key:'0x'+'2'.repeat(64),owner:foreign,expiresAt:11,record},
    {key:'0x'+'3'.repeat(64),owner,expiresAt:10,record},
    {key:'0x'+'4'.repeat(64),owner,expiresAt:11,record:{...record,wallet:'private'}}
  ]; }};
  const result=await queryBundle({client,owner,currentBlock:10,now:()=>0});
  assert.deepEqual(filter,{owner}); assert.equal(result.records.length,1); assert.equal(result.records[0].key,key);
});
test('malformed query output fails instead of fabricating a bundle', async () => {
  await assert.rejects(queryBundle({client:{query:async()=>null},owner,currentBlock:10,now:()=>0}), /invalid query response/);
});
