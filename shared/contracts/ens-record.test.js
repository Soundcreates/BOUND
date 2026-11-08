import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {validateRecord,validateBundle,ENS_CACHE_KEYS} from './index.js';

const record={schemaVersion:1,kind:'ens_record',site:'app.example.org',chainId:11155111,name:'example.eth',resolver:'0x'+'a'.repeat(40),records:{'bound.attest.v1':'{"schemaVersion":1}','bound.frontend.v1':''},resolvedAt:'2026-11-06T10:00:00.000Z'};

test('ens_record accepts a well-formed watcher ENS mirror',()=>{
 assert.equal(validateRecord(record),true);
 assert.deepEqual(ENS_CACHE_KEYS,['bound.attest.v1','bound.frontend.v1']);
});
test('ens_record rejects unknown keys, bad names, oversize values and extra fields',()=>{
 assert.equal(validateRecord({...record,records:{'bound.root.v1':''}}),false);
 assert.equal(validateRecord({...record,records:{}}),false);
 assert.equal(validateRecord({...record,records:{'bound.attest.v1':1}}),false);
 assert.equal(validateRecord({...record,records:{'bound.attest.v1':'x'.repeat(16385)}}),false);
 for(const name of ['','Example.eth','example','-a.eth','a..eth','a.eth.'])assert.equal(validateRecord({...record,name}),false,name);
 assert.equal(validateRecord({...record,resolver:'0x'+'A'.repeat(40)}),false);
 assert.equal(validateRecord({...record,resolvedAt:'yesterday'}),false);
 assert.equal(validateRecord({...record,trusted:true}),false);
});
test('watcher bundles may carry ens_record entities',()=>{
 const owner='0x'+'b'.repeat(40);
 assert.equal(validateBundle({schemaVersion:1,generatedAt:'2026-11-06T10:00:00Z',records:[{key:'0x'+'c'.repeat(64),owner,expiresAt:10,record}]},owner,5),true);
});
