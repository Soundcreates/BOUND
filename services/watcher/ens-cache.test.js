import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createEnsCachePublisher,createJsonRpc} from './ens-cache.js';

const resolver='0x'+'a'.repeat(40);
const entries=[{site:'app.example.org',chainId:11155111,name:'example.eth',resolver},{site:'b.example.org',chainId:11155111,name:'b-example.eth',resolver}];
const clock=()=>Date.parse('2026-11-06T10:42:00Z');

test('publishes one hour-floored ens_record per curated site with every key',async()=>{
 const writes=[];
 const publisher=createEnsCachePublisher({entries,now:clock,readText:async({name,recordKey})=>recordKey==='bound.attest.v1'?`attest:${name}`:'',writeEnsRecord:async(record,id)=>{writes.push({record,id});return {state:'current'};}});
 const results=await publisher.publish();
 assert.deepEqual(results.map(r=>r.state),['written','written']);
 assert.equal(writes[0].record.resolvedAt,'2026-11-06T10:00:00.000Z');
 assert.deepEqual(writes[0].record.records,{'bound.attest.v1':'attest:example.eth','bound.frontend.v1':''});
 assert.match(writes[0].id,/^[0-9a-f]{64}$/);
 assert.deepEqual((await publisher.publish()).map(r=>r.state),['unchanged','unchanged']);
 assert.equal(writes.length,2);
});
test('a failed key read skips that site without a partial write and keeps others',async()=>{
 const writes=[];
 const publisher=createEnsCachePublisher({entries,now:clock,readText:async({name,recordKey})=>{if(name==='example.eth'&&recordKey==='bound.frontend.v1')throw new Error('rpc down');return '';},writeEnsRecord:async record=>{writes.push(record);return {state:'current'};}});
 assert.deepEqual((await publisher.publish()).map(r=>r.state),['failed','written']);
 assert.deepEqual(writes.map(r=>r.site),['b.example.org']);
});
test('superseded writes are reported as failures and retried next run',async()=>{
 let state='superseded',calls=0;
 const publisher=createEnsCachePublisher({entries:[entries[0]],now:clock,readText:async()=>'',writeEnsRecord:async()=>{calls++;return {state};}});
 assert.deepEqual((await publisher.publish()).map(r=>r.state),['failed']);state='current';
 assert.deepEqual((await publisher.publish()).map(r=>r.state),['written']);assert.equal(calls,2);
});
test('rejects bad configuration and duplicate site scopes',()=>{
 const base={entries,readText:async()=>'',writeEnsRecord:async()=>({state:'current'})};
 assert.throws(()=>createEnsCachePublisher({...base,entries:[]}),/configuration/);
 assert.throws(()=>createEnsCachePublisher({...base,entries:[entries[0],entries[0]]}),/duplicate/);
 assert.throws(()=>createEnsCachePublisher({...base,entries:[{...entries[0],resolver:'0xbad'}]}),/entry/);
 assert.throws(()=>createEnsCachePublisher({...base,keys:['bound.root.v1']}),/configuration/);
});
test('JSON-RPC transport requires https and a matching response id',async()=>{
 assert.throws(()=>createJsonRpc({url:'http://rpc.example.org'}),/URL/);
 const rpc=createJsonRpc({url:'https://rpc.example.org',fetchImpl:async(_url,init)=>{const body=JSON.parse(init.body);return {ok:true,json:async()=>({jsonrpc:'2.0',id:body.id,result:'0xaa36a7'})};}});
 assert.equal(await rpc('eth_chainId',[]),'0xaa36a7');
 const bad=createJsonRpc({url:'https://rpc.example.org',fetchImpl:async()=>({ok:true,json:async()=>({jsonrpc:'2.0',id:99,result:'0x1'})})});
 await assert.rejects(bad('eth_chainId',[]),/invalid ENS RPC/);
});
