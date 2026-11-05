import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createArkivRpcReader } from './rpc.js';
const owner='0x'+'a'.repeat(40), foreign='0x'+'b'.repeat(40), key=n=>'0x'+n.toString(16).padStart(64,'0');
const payload={schemaVersion:1,kind:'baseline',site:'example.org',chainId:1,counterparties:[],calledContracts:[],updatedAt:'2026-01-01T00:00:00.000Z'};
const entity=(n,address=owner)=>({key:key(n),owner:address,expiresAt:'0x20',attributes:[{name:'arkiv.schema',type:'str',value:'bound.record.v1'},{name:'payload',type:'bytes',value:'0x'+Buffer.from(JSON.stringify(payload)).toString('hex')}]});
const response=result=>({ok:true,json:async()=>({jsonrpc:'2.0',id:1,result})});
test('keyset pagination filters owner and rechecks metadata', async () => {
  const requests=[]; const pages=[[entity(1),entity(2,foreign)],[entity(3)]];
  const fetchImpl=async (_url,opts)=>{const request=JSON.parse(opts.body); if (request.method === 'eth_chainId') return response('0x76edaf'); requests.push(request);return response({data:pages.shift(),blockNumber:'0xa'});};
  const reader=createArkivRpcReader({url:'https://rpc.example',schemaTag:'bound.record.v1',fetchImpl,pageSize:2});
  const rows=await reader.query({owner});
  assert.deepEqual(rows.map(r=>r.key),[key(1),key(3)]);
  assert.match(requests[0].params[0],/\$owner = addr\(0x[a]+\)/);
  assert.ok(requests[1].params[0].includes(`$key > key(${key(2)})`));
  assert.equal(rows[0].expiresAt,32);
});
test('rejects injected owners, inconsistent pagination and malformed payload', async () => {
  const good=(_url,opts)=>response(JSON.parse(opts.body).method === 'eth_chainId' ? '0x76edaf' : {data:[entity(1)],blockNumber:'0xa'});
  const reader=createArkivRpcReader({url:'https://rpc.example',schemaTag:'bound.record.v1',fetchImpl:good,pageSize:1,maxPages:2});
  await assert.rejects(reader.query({owner:"x') OR true"}),/owner/);
  await assert.rejects(reader.query({owner}),/pagination/);
  const bad=createArkivRpcReader({url:'https://rpc.example',schemaTag:'bound.record.v1',fetchImpl:async(_url,opts)=>response(JSON.parse(opts.body).method === 'eth_chainId' ? '0x76edaf' : {data:[{...entity(1),attributes:[{name:'arkiv.schema',type:'str',value:'bound.record.v1'},{name:'payload',type:'bytes',value:'0x'+Buffer.from('{"a":1,"a":2}').toString('hex')}]}],blockNumber:'0xa'})});
  await assert.rejects(bad.query({owner}),/payload/);
});
test('wrong network or page block changes fail closed', async () => {
  const wrong=createArkivRpcReader({url:'https://rpc.example',schemaTag:'bound.record.v1',fetchImpl:async()=>response('0x1')});
  await assert.rejects(wrong.query({owner}),/unexpected Arkiv chain/);
  let page=0;
  const unstable=createArkivRpcReader({url:'https://rpc.example',schemaTag:'bound.record.v1',pageSize:1,fetchImpl:async(_url,opts)=>{
    if (JSON.parse(opts.body).method === 'eth_chainId') return response('0x76edaf');
    page++; return response({data:[entity(page)],blockNumber:page === 1 ? '0xa' : '0xb'});
  }});
  await assert.rejects(unstable.query({owner}),/changed block/);
});
