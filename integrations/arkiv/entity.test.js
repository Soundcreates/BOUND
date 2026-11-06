import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createArkivEntityReader} from './entity.js';
const owner='0x'+'a'.repeat(40),key='0x'+'b'.repeat(64),record={schemaVersion:1,kind:'baseline',site:'example.org',chainId:1,counterparties:[],calledContracts:[],updatedAt:'2026-01-01T00:00:00.000Z'};
const entity={key,owner,expiresAt:'0x20',attributes:[{name:'arkiv.schema',type:'str',value:'bound.record.v1'},{name:'payload',type:'bytes',value:'0x'+Buffer.from(JSON.stringify(record)).toString('hex')}]};
test('entity reader checks chain, owner, expiry and payload',async()=>{
 let row=entity;const rpc=async method=>({eth_chainId:'0x76edaf',eth_blockNumber:'0xa',arkiv_getEntity:row}[method]);
 const reader=createArkivEntityReader({rpc,owner,schemaTag:'bound.record.v1',chainId:7794095});
 assert.deepEqual((await reader.getEntity(key)).record,record);
 row={...entity,owner:'0x'+'c'.repeat(40)};await assert.rejects(reader.getEntity(key),/owner/);
 row={...entity,expiresAt:'0xa'};await assert.rejects(reader.getEntity(key),/expired/);
 assert.equal((await reader.getEntity(key,{includeExpired:true})).expiresAt,10);
 row={...entity,expiresAt:'0xa',owner:'0x'+'c'.repeat(40)};await assert.rejects(reader.getEntity(key,{includeExpired:true}),/owner/);
 row=null;assert.equal(await reader.getEntity(key),null);
});
