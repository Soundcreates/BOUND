import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {validateRecord} from '../../shared/contracts/index.js';
import {createDemoRecords,checkDemoRecords,DEMO_SCOPES} from './demo-arkiv.js';

const updatedAt='2026-11-06T12:00:00.000Z';
test('demo records match exact loopback hosts and dApp chains, not the storage chain',()=>{
 const records=createDemoRecords(DEMO_SCOPES,updatedAt);
 assert.equal(records.length,DEMO_SCOPES.length*2);
 assert.ok(records.every(validateRecord));
 assert.ok(records.every(record=>record.chainId===11155111));
 assert.ok(records.every(record=>record.kind==='baseline'?record.counterparties.length===0&&record.calledContracts.length===0:record.state==='normal'&&record.incidentReference===null));
 assert.ok(records.some(record=>record.site==='127.0.0.1:8000'));
 assert.ok(records.some(record=>record.site==='localhost:8000'));
 assert.deepEqual(records,createDemoRecords(DEMO_SCOPES,updatedAt));
});
test('demo seeding rejects public domains, paths, duplicate scopes and invalid chains',()=>{
 for(const scopes of [[{site:'app.uniswap.org',chainId:1}],[{site:'localhost:8000/path',chainId:1}],[DEMO_SCOPES[0],DEMO_SCOPES[0]],[{site:'localhost:8000',chainId:0}]])assert.throws(()=>createDemoRecords(scopes,updatedAt));
 assert.throws(()=>createDemoRecords([],updatedAt));
 assert.throws(()=>createDemoRecords(DEMO_SCOPES,'not-a-date'));
});
test('readback requires exactly one matching payload per domain, chain and kind',()=>{
 const records=createDemoRecords(DEMO_SCOPES,updatedAt),rows=records.map(record=>({record}));
 assert.doesNotThrow(()=>checkDemoRecords(records,rows));
 assert.throws(()=>checkDemoRecords(records,rows.slice(1)),/missing, duplicate or changed/);
 assert.throws(()=>checkDemoRecords(records,[...rows,rows[0]]),/missing, duplicate or changed/);
 const changed=structuredClone(rows);changed[0].record.chainId=1;
 assert.throws(()=>checkDemoRecords(records,changed),/missing, duplicate or changed/);
 const drift=structuredClone(rows);drift[1].record.state='drift';
 assert.throws(()=>checkDemoRecords(records,drift),/missing, duplicate or changed/);
});
