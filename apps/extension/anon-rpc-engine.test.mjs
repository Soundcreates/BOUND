import test from "node:test";
import assert from "node:assert/strict";
import {createAnonEngine} from "./anon-rpc-engine.mjs";
const settings={anonWorkerId:"nox",anonBootstrapUrl:"https://bootstrap.example",anonRpcUrl:"https://rpc.example"};
test("worker bootstrap is pinned and sensitive reads use worker fetch",async()=>{
 const direct=[],anonymous=[];let boots=0;
 const engine=createAnonEngine({fetchImpl:async(url,options)=>{direct.push({url,request:JSON.parse(options.body)});const id=direct.at(-1).request.id;return {ok:true,json:async()=>({jsonrpc:"2.0",id,result:"0xaa36a7"})};},makeWorker:options=>{boots++;assert.equal(options.address,"0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A");return {ready:Promise.resolve(),close(){},fetch:async(url,init)=>{anonymous.push({url,request:JSON.parse(init.body)});return {ok:true,json:async()=>({jsonrpc:"2.0",id:anonymous.at(-1).request.id,result:"0xabc"})};}};}});
 assert.equal(await engine.request(settings,{method:"eth_getCode",params:["0x"+"1".repeat(40),"latest"]}),"0xabc");
 await engine.request(settings,{method:"eth_chainId",params:[]});assert.equal(boots,1);assert.deepEqual(direct.map(item=>item.request.method),["eth_chainId"]);assert.equal(anonymous[0].request.method,"eth_getCode");
});
test("wrong bootstrap chain and malformed worker responses never fall back",async()=>{
 let boots=0;const engine=createAnonEngine({fetchImpl:async(_url,options)=>({ok:true,json:async()=>({jsonrpc:"2.0",id:JSON.parse(options.body).id,result:"0x1"})}),makeWorker:()=>{boots++;}});
 await assert.rejects(engine.request(settings,{method:"eth_call"}),/chain/);assert.equal(boots,0);
});
