import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryBundle } from './index.js';
const owner = '0x' + 'a'.repeat(40), other = '0x' + 'b'.repeat(40), key = '0x' + '1'.repeat(64);
test('query constrains and rechecks owner and expiry', async () => {
  const record = { schemaVersion: 1, kind: 'baseline', site: 'example.com', chainId: 1, counterparties: [], calledContracts: [], updatedAt: '2026-01-01T00:00:00.000Z' };
  const entry = { key, owner, expiresAt: 11, record };
  const client = { query: async filter => { assert.deepEqual(filter, { owner }); return [entry, { ...entry, owner: other }, { ...entry, expiresAt: 10 }]; } };
  const bundle = await queryBundle({ client, owner, currentBlock: 10, now: () => 0 });
  assert.deepEqual(bundle.records, [entry]);
});
test('bundle includes a validated frontend record', async () => {
 const record={schemaVersion:1,kind:'frontend',site:'example.com',chainId:1,scripts:[],updatedAt:'2026-01-01T00:00:00.000Z'};
 const entry={key,owner,expiresAt:11,record};
 const bundle=await queryBundle({client:{query:async()=>[entry]},owner,currentBlock:10,now:()=>0});
 assert.deepEqual(bundle.records,[entry]);
});
