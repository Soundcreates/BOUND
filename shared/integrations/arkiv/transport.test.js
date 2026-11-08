import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createArkivTransport} from './transport.js';
test('restricted RPC sends credentials only in the header and validates replies',async()=>{
 let request;
 const transport=createArkivTransport({url:'https://rpc.example',accessKey:'private-test',fetchImpl:async(url,options)=>{request={url,options,body:JSON.parse(options.body)};return {ok:true,json:async()=>({jsonrpc:'2.0',id:1,result:'0x76edaf'})};}});
 assert.equal(await transport.rpc('eth_chainId',[]),'0x76edaf');assert.equal(request.options.headers['x-api-key'],'private-test');assert.equal(request.url.includes('private-test'),false);
 await assert.rejects(transport.rpc('eth_getBalance',[]),/unsupported/);
});
test('network and RPC failures never disclose endpoint credentials or raw responses',async()=>{
 const transport=createArkivTransport({url:'https://rpc.example',accessKey:'private-test',fetchImpl:async()=>{throw Error('private-test');}});
 await assert.rejects(transport.rpc('eth_chainId',[]),error=>error.message==='Arkiv RPC unavailable');
 const bad=createArkivTransport({url:'https://rpc.example',fetchImpl:async()=>({ok:true,json:async()=>({jsonrpc:'2.0',id:1,error:{message:'secret'}})})});
 await assert.rejects(bad.rpc('eth_chainId',[]),error=>error.message==='Arkiv RPC request failed');
});
