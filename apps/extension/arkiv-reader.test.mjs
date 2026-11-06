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
 f.data.boundWatcherBundle.verifiedAt=null;
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
test("a typical seeded bundle fits in one anonymous page without exposing the site in the query",async()=>{
 const f=fixture(Array.from({length:12},(_,i)=>row(i===0?status:{...baseline,site:`other${i}.example`},i+1)));
 const records=await f.reader.readSiteStatusViaAnonRpc({site});
 assert.equal(records.length,1);
 const queries=f.anonymous.filter(item=>item.method==='arkiv_query');
 assert.equal(queries.length,1);assert.equal(queries[0].params[1].limit,'0x20');
 assert.ok(!JSON.stringify(queries[0]).includes(site));
});
test("owner-checked baseline exposes observed addresses without treating them as witnesses",async()=>{
 const observed="0x"+"1".repeat(40),called="0x"+"2".repeat(40);
 const f=fixture([row({...baseline,counterparties:[observed],calledContracts:[called]},1)]);await f.reader.refresh();
 const [record]=await f.reader.readWatcherBundle();
 assert.deepEqual(record.observed,[observed,called]);assert.deepEqual(record.witnessed,[]);
});
test("watcher ENS cache records are looked up locally, owner-checked and freshness-bounded",async()=>{
 const ens={schemaVersion:1,kind:"ens_record",site,chainId,name:"example.eth",resolver:"0x"+"e".repeat(40),records:{"bound.attest.v1":""},resolvedAt:hour};
 const f=fixture([row(ens,1),row({...ens,name:"forged.eth"},2,other),row({...ens,site:"other.example"},3)]);await f.reader.refresh();
 const before=f.anonymous.length+f.direct.length;
 const found=await f.reader.readEnsRecord({site,chain:String(chainId)});
 assert.equal(found.name,"example.eth");assert.equal(found.owner,owner);assert.deepEqual(found.records,{"bound.attest.v1":""});
 assert.equal(f.anonymous.length+f.direct.length,before,"lookup must not make a per-site request");
 assert.equal(await f.reader.readEnsRecord({site,chain:"1"}),null);
 assert.ok(!(await f.reader.readWatcherBundle()).some(item=>item.kind==="ens_record"),"ENS cache rows never enter the decision bundle");
 const stale=fixture([row({...ens,resolvedAt:"2026-11-05T23:00:00.000Z"},1)]);await stale.reader.refresh();
 assert.equal(await stale.reader.readEnsRecord({site,chain:String(chainId)}),null);
 const expired=fixture([row(ens,1,owner,10)]);await expired.reader.refresh();
 assert.equal(await expired.reader.readEnsRecord({site,chain:String(chainId)}),null);
 const duplicate=fixture([row(ens,1),row({...ens,name:"second.eth"},2)]);await duplicate.reader.refresh();
 assert.equal(await duplicate.reader.readEnsRecord({site,chain:String(chainId)}),null,"ambiguous rows are ignored");
});

test("concurrent refreshes join one whole-bundle download",async()=>{
 const f=fixture([]);await Promise.all([f.reader.refresh(),f.reader.refresh(),f.reader.refresh()]);
 assert.equal(f.direct.filter(r=>r.method==="arkiv_query").length,1);
});
test("community freshness boundaries and block verification reuse",async()=>{
 const f=fixture([]);await f.reader.refresh();await f.reader.verifyBundleBlock();await f.reader.verifyBundleBlock();
 assert.equal(f.anonymous.length,2);
 const read=at=>f.reader.readCommunityCache({site,chain:chainId,now:at});
 assert.equal((await read(time)).state,"fresh");
 assert.equal((await read(time+30_000)).state,"unavailable");
 assert.equal((await read(time+300_000)).state,"stale");
 assert.equal((await read(time+3_600_000)).state,"unavailable");
 assert.equal((await read(time-1)).state,"unavailable");
});
test("ensure budget leaves refresh running and background completion fills cache",async()=>{
 let release;const wait=new Promise(resolve=>{release=resolve;});const data={};let calls=0;
 const storage={get:async key=>({[key]:data[key]}),set:async value=>Object.assign(data,value)};
 const reader=createArkivReader({getSettings:async()=>settings,storage,now:()=>time,anonymousRequest:async r=>({result:r.method==="eth_chainId"?"0x76edaf":"0xb"}),fetchImpl:async(_u,o)=>{const r=JSON.parse(o.body);if(r.method==="arkiv_query"){calls++;await wait;}return {ok:true,text:async()=>JSON.stringify({jsonrpc:"2.0",id:1,result:r.method==="eth_chainId"?"0x76edaf":{data:[],blockNumber:"0xa"}})};}});
 assert.equal((await reader.ensureCommunity({site,chain:chainId,budgetMs:1})).state,"unavailable");
 const joined=reader.refresh();release();await joined;
 // Join the verification begun by ensureCommunity as well.
 await reader.verifyBundleBlock();assert.equal((await reader.readCommunityCache({site,chain:chainId})).state,"fresh");assert.equal(calls,1);
});
test("v1 cache triggers refresh and mismatched settings cannot use it",async()=>{
 const f=fixture([]);f.data.boundWatcherBundle={version:1,owner,url:settings.arkivRpcUrl,fetchedAt:time,block:10,records:[]};
 assert.equal((await f.reader.readCommunityCache({site,chain:chainId})).state,"unavailable");
 await f.reader.ensureCommunity({site,chain:chainId});assert.equal(f.data.boundWatcherBundle.version,2);
 f.data.boundWatcherBundle.owner=other;assert.equal((await f.reader.readCommunityCache({site,chain:chainId})).state,"unavailable");
});

test("settings change prevents an in-flight refresh from writing",async()=>{
 let current=settings,release;const wait=new Promise(resolve=>{release=resolve;}),data={};
 const storage={get:async key=>({[key]:data[key]}),set:async v=>Object.assign(data,v)};
 const reader=createArkivReader({getSettings:async()=>current,storage,anonymousRequest:async()=>({result:"0xb"}),fetchImpl:async(_u,o)=>{const r=JSON.parse(o.body);if(r.method==="arkiv_query")await wait;return {ok:true,text:async()=>JSON.stringify({jsonrpc:"2.0",id:1,result:r.method==="eth_chainId"?"0x76edaf":{data:[],blockNumber:"0xa"}})};}});
 const pending=reader.refresh();await new Promise(resolve=>setImmediate(resolve));current={...settings,watcherOwner:other};release();await assert.rejects(pending,/settings changed/);assert.equal(data.boundWatcherBundle,undefined);
});
test("changed pagination block restarts once then rejects",async()=>{
 let pages=0;const storage={get:async()=>({}),set:async()=>{throw Error("unexpected write");}};
 const reader=createArkivReader({getSettings:async()=>settings,storage,anonymousRequest:async()=>({}),fetchImpl:async(_u,o)=>{const r=JSON.parse(o.body);const result=r.method==="eth_chainId"?"0x76edaf":{data:Array.from({length:32},(_,i)=>row(baseline,i+1)),blockNumber:++pages%2?"0xa":"0xb"};return {ok:true,text:async()=>JSON.stringify({jsonrpc:"2.0",id:1,result})};}});
 await assert.rejects(reader.refresh(),/pagination changed block/);assert.equal(pages,4);
});
test("aggregate response bytes are bounded",async()=>{
 let pages=0;const storage={get:async()=>({}),set:async()=>{throw Error("unexpected write");}};
 const reader=createArkivReader({getSettings:async()=>settings,storage,anonymousRequest:async()=>({}),fetchImpl:async(_u,o)=>{const r=JSON.parse(o.body);const result=r.method==="eth_chainId"?"0x76edaf":{data:Array.from({length:32},(_,i)=>row(baseline,pages*32+i+1)),blockNumber:"0xa"};pages++;return {ok:true,text:async()=>JSON.stringify({jsonrpc:"2.0",id:1,result,padding:"x".repeat(900000)})};}});
 await assert.rejects(reader.refresh(),/response too large/);
});
test("pagination limit rejects an endless full result",async()=>{
 let page=0;const storage={get:async()=>({}),set:async()=>{throw Error("unexpected write");}};
 const reader=createArkivReader({getSettings:async()=>settings,storage,anonymousRequest:async()=>({}),fetchImpl:async(_u,o)=>{const r=JSON.parse(o.body);const result=r.method==="eth_chainId"?"0x76edaf":{data:Array.from({length:32},(_,i)=>row(baseline,page*32+i+1)),blockNumber:"0xa"};if(r.method!=="eth_chainId")page++;return {ok:true,text:async()=>JSON.stringify({jsonrpc:"2.0",id:1,result})};}});
 await assert.rejects(reader.refresh(),/pagination limit/);assert.equal(page,256);
});

test("community mapping rejects orphan, recovered, duplicate and mismatched drift signals",async()=>{
 const front={schemaVersion:1,kind:"frontend",site,chainId,scripts:[],updatedAt:hour};
 const incident={schemaVersion:1,kind:"incident",site,chainId,trigger:"drift+warned",severity:"high",counterparty:owner,reportDigest:ref,reportReference:"d".repeat(64),createdAt:hour};
 const key="0x"+(3).toString(16).padStart(64,"0");
 async function read(rows){const f=fixture(rows);await f.reader.refresh();await f.reader.verifyBundleBlock();return f.reader.readCommunityCache({site,chain:chainId});}
 assert.equal((await read([row(front,1),row({...status,state:"incident",incidentReference:key},2),row(incident,3)])).activeIncident,true);
 assert.equal((await read([row(front,1),row({...status,state:"incident",incidentReference:ref},2),row(incident,3)])).activeIncident,false);
 assert.equal((await read([row(front,1),row({...status,state:"normal"},2),row(incident,3)])).activeIncident,false);
 assert.equal((await read([row(front,1),row(status,2),row({...drift,detectedAt:"2026-11-06T23:00:00.000Z"},3)])).corroboratedDrift,false);
 assert.equal((await read([row(front,1),row(status,2),row(status,3)])).ambiguous,true);
});
test("concurrent anonymous status reads for different sites share one whole-owner query",async()=>{
 const otherSite="other.example",otherStatus={...status,site:otherSite,state:"normal"};
 const f=fixture([row(status,1),row(drift,2),row(otherStatus,3)]);
 const [first,second]=await Promise.all([f.reader.readSiteStatusViaAnonRpc({site}),f.reader.readSiteStatusViaAnonRpc({site:otherSite})]);
 assert.equal(f.anonymous.filter(item=>item.method==="arkiv_query").length,1);
 assert.ok(first.length>0&&first.every(item=>item.site===site));
 assert.deepEqual(second.map(item=>[item.site,item.kind,item.status]),[[otherSite,"status","normal"]]);
 // A later call after the flight settled issues a fresh query instead of reusing stale data.
 await f.reader.readSiteStatusViaAnonRpc({site});
 assert.equal(f.anonymous.filter(item=>item.method==="arkiv_query").length,2);
});

test("refresh preserves verified watermark and stale display through failed or stalled verification",async()=>{
 let clock=time,queryBlock=100,verifyBlock=100,offline=false,stall=false,release;
 const waiting=new Promise(resolve=>{release=resolve;});
 const data={},storage={get:async key=>({[key]:data[key]}),set:async value=>Object.assign(data,structuredClone(value))};
 const front={schemaVersion:1,kind:"frontend",site,chainId,scripts:[],updatedAt:hour};
 const reader=createArkivReader({getSettings:async()=>settings,storage,now:()=>clock,fetchImpl:async(_u,o)=>{const r=JSON.parse(o.body);return {ok:true,text:async()=>JSON.stringify({jsonrpc:"2.0",id:1,result:r.method==="eth_chainId"?"0x76edaf":{data:[row(front,1,owner,1000),row({...status,state:"normal"},2,owner,1000)],blockNumber:`0x${queryBlock.toString(16)}`}})};},anonymousRequest:async r=>{if(offline)throw Error("offline");if(stall)await waiting;return {result:r.method==="eth_chainId"?"0x76edaf":`0x${verifyBlock.toString(16)}`};}});
 await reader.refresh();await reader.verifyBundleBlock();clock+=300000;
 queryBlock=10;await assert.rejects(reader.refresh(),/backwards/);verifyBlock=11;
 await assert.rejects(reader.verifyBundleBlock(),/superseded|backwards/);assert.equal((await reader.readCommunityCache({site,chain:chainId})).state,"stale");
 queryBlock=101;await reader.refresh();offline=true;await assert.rejects(reader.verifyBundleBlock());
 assert.equal((await reader.readCommunityCache({site,chain:chainId})).frontend.kind,"frontend");
 offline=false;stall=true;assert.equal((await reader.ensureCommunity({site,chain:chainId,budgetMs:1})).state,"stale");
 verifyBlock=102;release();await reader.verifyBundleBlock();assert.equal((await reader.readCommunityCache({site,chain:chainId})).state,"fresh");assert.equal(data.boundWatcherBundle.block,102);
});

test("negative status survives frontend and status ambiguity and reporting requires a unique normal scope",async()=>{
 const front={schemaVersion:1,kind:"frontend",site,chainId,scripts:[],updatedAt:hour};
 async function read(rows){const f=fixture(rows);await f.reader.refresh();await f.reader.verifyBundleBlock();return f.reader.readCommunityCache({site,chain:chainId});}
 for(const rows of [[row(status,1)],[row(front,1),row(front,2),row(status,3)],[row(front,1),row(status,2),row({...status,state:"normal"},3)]]){const result=await read(rows);assert.equal(result.rawDrift,true);assert.equal(result.communityReportingSafe,false);}
 assert.equal((await read([row(front,1)])).communityReportingSafe,false);
 assert.equal((await read([row(front,1),row({...status,state:"normal"},2)])).communityReportingSafe,true);
});


test("block watermark prevents expired records returning after a reader restart",async()=>{
 let clock=time,block=100;const data={},storage={get:async key=>({[key]:data[key]}),set:async value=>Object.assign(data,structuredClone(value))};
 const make=()=>createArkivReader({getSettings:async()=>settings,storage,now:()=>clock,fetchImpl:async(_u,o)=>{const r=JSON.parse(o.body);return {ok:true,text:async()=>JSON.stringify({jsonrpc:"2.0",id:1,result:r.method==="eth_chainId"?"0x76edaf":{data:[row(baseline,1,owner,175)],blockNumber:"0x64"}})};},anonymousRequest:async r=>({result:r.method==="eth_chainId"?"0x76edaf":`0x${block.toString(16)}`})});
 let reader=make();await reader.refresh();await reader.verifyBundleBlock();assert.equal((await reader.readWatcherBundle()).length,1);
 clock+=30000;block=200;assert.deepEqual(await reader.readWatcherBundle(),[]);
 clock+=30000;block=150;await assert.rejects(reader.readWatcherBundle(),/backwards/);
 reader=make();await assert.rejects(reader.readWatcherBundle(),/backwards/);
});

test("unverified bundles never become stale display data",async()=>{
 const f=fixture([row(status,1)]);await f.reader.refresh();
 for(const age of [0,299999,300000,3599999,3600000])assert.equal((await f.reader.readCommunityCache({site,chain:chainId,now:time+age})).state,"unavailable");
 await f.reader.verifyBundleBlock();
 assert.equal((await f.reader.readCommunityCache({site,chain:chainId,now:time+299999})).state,"unavailable");
 assert.equal((await f.reader.readCommunityCache({site,chain:chainId,now:time+300000})).state,"stale");
 assert.equal((await f.reader.readCommunityCache({site,chain:chainId,now:time+3599999})).state,"stale");
 assert.equal((await f.reader.readCommunityCache({site,chain:chainId,now:time+3600000})).state,"unavailable");
});
