import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {keccak256} from 'ethers';
import {createSwarmAdapter} from './index.js';

const bytes=new TextEncoder().encode('BOUND snapshot'),ref='a'.repeat(64),postage='b'.repeat(64),hash=keccak256(bytes);
const response=data=>new Response(data,{status:200});
test('upload uses the postage header and two gateways verify the anchored digest',async()=>{
 const requests=[];
 const swarm=createSwarmAdapter({uploadUrl:'https://bee.example',gatewayUrls:['https://one.example','https://two.example'],postageBatchId:postage,fetchImpl:async(url,options)=>{requests.push({url,options});return options.method==='POST'?response(JSON.stringify({reference:ref})):response(bytes);}});
 assert.deepEqual(await swarm.put(bytes),{reference:ref,digest:hash});
 assert.deepEqual(await swarm.verifyIndependent(ref,hash),bytes);
 assert.equal(requests[0].options.headers['swarm-postage-batch-id'],postage);assert.equal(requests[0].options.redirect,'error');
});
test('tampered, oversized, encrypted-reference and non-independent paths fail closed',async()=>{
 const swarm=createSwarmAdapter({uploadUrl:'https://bee.example',gatewayUrls:['https://one.example','https://one.example/other'],postageBatchId:postage,maxBytes:8,fetchImpl:async()=>response('tampered')});
 await assert.rejects(swarm.getVerified(ref,hash),/digest mismatch/);
 await assert.rejects(swarm.getVerified('a'.repeat(128),hash),/reference/);
 await assert.rejects(swarm.verifyIndependent(ref,hash),/independent/);
 await assert.rejects(swarm.put(bytes),/payload/);
 const oversized=createSwarmAdapter({uploadUrl:'https://bee.example',gatewayUrls:['https://one.example'],postageBatchId:postage,maxBytes:3,fetchImpl:async()=>response('large')});
 await assert.rejects(oversized.getVerified(ref,hash),/too large/);
});
test('malformed upload results and endpoint credentials are rejected',async()=>{
 assert.throws(()=>createSwarmAdapter({uploadUrl:'https://user:secret@bee.example',gatewayUrls:['https://one.example'],postageBatchId:postage}),/endpoint/);
 const swarm=createSwarmAdapter({uploadUrl:'https://bee.example',gatewayUrls:['https://one.example'],postageBatchId:postage,fetchImpl:async()=>response('{"reference":"bad"}')});
 await assert.rejects(swarm.put(bytes),/upload response/);
});
test('host-stamped gateway upload requires no node batch and verifies exact read-back',async()=>{
 const requests=[];
 const swarm=createSwarmAdapter({uploadUrl:'https://api.gateway.example',gatewayUrls:['https://read.example'],stampedByHost:true,fetchImpl:async(url,options)=>{requests.push({url,options});return options.method==='POST'?response(JSON.stringify({reference:ref})):response(bytes);}});
 assert.deepEqual(await swarm.put(bytes),{reference:ref,digest:hash});
 assert.deepEqual(requests[0].options.headers,{'content-type':'application/octet-stream'});
 assert.equal(requests.length,2);assert.equal(requests[1].url,`https://api.gateway.example/bytes/${ref}`);
 assert.equal(requests[0].options.credentials,'omit');
});
test('gateway substitution and ambiguous postage fail closed; readers require no upload credentials',async()=>{
 const base={uploadUrl:'https://api.gateway.example',gatewayUrls:['https://read.example']};
 assert.throws(()=>createSwarmAdapter(base),/postage/);
 assert.throws(()=>createSwarmAdapter({...base,stampedByHost:true,postageBatchId:postage}),/postage/);
 const bad=createSwarmAdapter({...base,stampedByHost:true,fetchImpl:async(url,options)=>options.method==='POST'?response(JSON.stringify({reference:ref})):response('gateway shell')});
 await assert.rejects(bad.put(bytes),/read-back mismatch/);
 const reader=createSwarmAdapter({gatewayUrls:base.gatewayUrls,fetchImpl:async()=>response(bytes)});
 assert.deepEqual(await reader.getVerified(ref,hash),bytes);
 await assert.rejects(reader.put(bytes),/read-only/);
});
