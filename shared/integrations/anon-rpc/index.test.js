import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {keccak256} from 'ethers';
import {createAnonRpcTransport} from './index.js';

const bytes=new TextEncoder().encode('reviewed worker'),expectedHash=keccak256(bytes);
test('only a hash-matched worker receives supported requests',async()=>{
 let constructed=0,closed=false;
 const options={workerBytes:bytes,expectedHash,createWorker:async input=>{constructed++;assert.deepEqual(input,bytes);return {request:async p=>({jsonrpc:'2.0',id:p.id,result:'0x1'}),close:async()=>{closed=true;}};}};
 await assert.rejects(createAnonRpcTransport({...options,expectedHash:'0x'+'0'.repeat(64)}),/hash mismatch/);assert.equal(constructed,0);
 const transport=await createAnonRpcTransport(options);
 assert.deepEqual(await transport.request('eth_call',[{},'latest']),{status:'ok',result:'0x1'});
 await assert.rejects(transport.request('eth_sendTransaction',[{}]),/unsupported/);
 await transport.close();assert.equal(closed,true);assert.equal((await transport.request('eth_chainId',[])).status,'unavailable');
});
test('timeout, malformed responses and worker errors never trigger a fallback',async()=>{
 let calls=0;
 const timeout=await createAnonRpcTransport({workerBytes:bytes,expectedHash,budgetMs:10,createWorker:async()=>({request:async()=>{calls++;return new Promise(()=>{});},close:async()=>{}})});
 assert.deepEqual(await timeout.request('eth_chainId',[]),{status:'timeout',result:null});assert.equal(calls,1);await timeout.close();
 const bad=await createAnonRpcTransport({workerBytes:bytes,expectedHash,createWorker:async()=>({request:async()=>({jsonrpc:'2.0',id:999,result:'0x1'}),close:async()=>{}})});
 assert.equal((await bad.request('eth_chainId',[])).status,'unavailable');await bad.close();
});
