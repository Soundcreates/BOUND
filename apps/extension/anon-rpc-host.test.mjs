import test from "node:test";
import assert from "node:assert/strict";
import {createAnonRpcHost} from "./anon-rpc-host.mjs";
const settings={anonWorkerId:"nox",anonBootstrapUrl:"https://bootstrap.example",anonRpcUrl:"https://rpc.example"};
test("host rejects write methods and never falls back when unconfigured",async()=>{
 let loads=0;const host=createAnonRpcHost({getSettings:async()=>null,loadEngine:async()=>{loads++;}});
 assert.deepEqual(await host({method:"eth_sendTransaction"}),{error:"method_not_allowed"});
 assert.deepEqual(await host({method:"eth_call"}),{error:"anon_rpc_not_configured"});assert.equal(loads,0);
});
test("configured read uses only the anonymizing engine and respects the deadline",async()=>{
 const calls=[];let loads=0;const host=createAnonRpcHost({getSettings:async()=>settings,loadEngine:async()=>{loads++;return {request:async(config,request)=>{calls.push({config,request});return "0x1";}};}});
 assert.deepEqual(await host({method:"eth_chainId",params:[]}),{result:"0x1"});assert.equal(loads,1);assert.equal(calls[0].config.anonWorkerId,"nox");
 const timed=createAnonRpcHost({getSettings:async()=>settings,loadEngine:async()=>({request:()=>new Promise(()=>{})}),timeoutMs:5});
 assert.deepEqual(await timed({method:"eth_call",params:[]}),{error:"anon_rpc_unavailable"});
});
test("default deadline allows a slow worker initialization",async()=>{
 const host=createAnonRpcHost({getSettings:async()=>settings,loadEngine:async()=>({request:async()=>{await new Promise(resolve=>setTimeout(resolve,1600));return '0x1';}})});
 assert.deepEqual(await host({method:'eth_chainId',params:[]}),{result:'0x1'});
});
