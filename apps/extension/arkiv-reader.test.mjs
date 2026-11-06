import test from "node:test";
import assert from "node:assert/strict";
import {createArkivReader} from "./arkiv-reader.mjs";
const owner="0x"+"a".repeat(40),other="0x"+"b".repeat(40),site="example.org",chainId=11155111,time=Date.parse("2026-11-07T00:00:00Z"),hour="2026-11-07T00:00:00.000Z";
const settings={arkivRpcUrl:"https://arkiv.example",watcherOwner:owner},ref="0x"+"c".repeat(64);
const baseline={schemaVersion:1,kind:"baseline",site,chainId,counterparties:[],calledContracts:[],updatedAt:hour};
const status={schemaVersion:1,kind:"status",site,chainId,state:"drift",feedReference:ref,incidentReference:null,updatedAt:hour};
const drift={schemaVersion:1,kind:"drift",site,chainId,changes:[{kind:"ns",before:["ns1.example"],after:["ns2.example"]}],corroborated:true,evidenceReference:"d".repeat(64),detectedAt:hour};
const row=(record,n,own=owner,expiry=100)=>({key:"0x"+n.toString(16).padStart(64,"0"),owner:own,expiresAt:"0x"+expiry.toString(16),attributes:[{name:"arkiv.schema",type:"str",value:"bound.record.v1"},{name:"payload",type:"bytes",value:"0x"+Buffer.from(JSON.stringify(record)).toString("hex")}]});
function fixture(rows){
 const data={},direct=[],anonymous=[];const result={data:rows,blockNumber:"0xa"};
 const storage={get:async key=>({[key]:data[key]}),set:async values=>Object.assign(data,structuredClone(values))};
 const fetchImpl=async(_url,options)=>{const request=JSON.parse(options.body);direct.push(request);return {ok:true,text:async()=>JSON.stringify({jsonrpc:"2.0",id:1,result:request.method==="eth_chainId"?"0x76edaf":result})};};
 const anonymousRequest=async request=>{anonymous.push(request);return {result:request.method==="eth_chainId"?"0x76edaf":request.method==="eth_blockNumber"?"0xb":result};};
 return {reader:createArkivReader({getSettings:async()=>settings,storage,anonymousRequest,fetchImpl,now:()=>time}),direct,anonymous,data};
}
test("bulk refresh rechecks owner and uses an anonymous current block for decisions",async()=>{
 const f=fixture([row(baseline,1),row(status,2),row(drift,3),row(baseline,4,other)]);await f.reader.refresh();
 const records=await f.reader.readWatcherBundle();assert.equal(records.filter(item=>item.kind==="baseline").length,1);
 assert.equal(records.find(item=>item.kind==="status").status,"drift");assert.equal(records.find(item=>item.kind==="drift").corroborated,true);
 assert.ok(f.direct.every(item=>!JSON.stringify(item).includes(site)));assert.deepEqual(f.anonymous.map(item=>item.method).sort(),["eth_blockNumber","eth_chainId"]);
});
test("ambiguous drift evidence cannot create a corroborated signal",async()=>{
 const f=fixture([row(status,1),row(drift,2),row({...drift,corroborated:false},3)]);await f.reader.refresh();
 assert.equal((await f.reader.readWatcherBundle()).some(item=>item.kind==="drift"),false);
});
test("unavailable anonymous block or expired owner records never become a baseline",async()=>{
 const f=fixture([row(baseline,1,owner,11)]);await f.reader.refresh();assert.deepEqual(await f.reader.readWatcherBundle(),[]);
 const reader=createArkivReader({getSettings:async()=>settings,storage:{get:async()=>f.data,set:async()=>{}},anonymousRequest:async()=>({error:"offline"}),fetchImpl:async()=>{},now:()=>time});
 await assert.rejects(reader.readWatcherBundle(),/Anonymized Arkiv unavailable/);
});
test("uncurated site queries travel through the anonymizing worker",async()=>{
 const f=fixture([row(baseline,1),row({...baseline,site:"other.example"},2)]);
 const records=await f.reader.readUncuratedViaAnonRpc({site,chain:String(chainId)});assert.equal(records.length,1);assert.equal(f.direct.length,0);assert.ok(f.anonymous.some(item=>item.method==="arkiv_query"));
});
test("page-load site status uses the anonymous worker and filters exact hosts",async()=>{
 const f=fixture([row(status,1),row({...status,site:"other.example"},2)]);
 const records=await f.reader.readSiteStatusViaAnonRpc({site});
 assert.equal(records.filter(record=>record.kind==="status").length,1);
 assert.ok(records.every(record=>record.site===site));assert.equal(f.direct.length,0);
 assert.ok(f.anonymous.some(item=>item.method==="arkiv_query"));
});
test("owner-checked baseline exposes observed addresses without treating them as witnesses",async()=>{
 const observed="0x"+"1".repeat(40),called="0x"+"2".repeat(40);
 const f=fixture([row({...baseline,counterparties:[observed],calledContracts:[called]},1)]);await f.reader.refresh();
 const [record]=await f.reader.readWatcherBundle();
 assert.deepEqual(record.observed,[observed,called]);assert.deepEqual(record.witnessed,[]);
});
