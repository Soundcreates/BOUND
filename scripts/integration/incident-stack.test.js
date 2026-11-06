import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openArkivArchive} from '../../integrations/arkiv/archive.js';
import {queryBundle} from '../../integrations/arkiv/index.js';
import {createWatcherService} from '../../services/watcher/service.js';
import {openWatcherIncidents} from '../../services/watcher/incident-binding.js';
import {keccak256} from '../../packages/contracts/keccak-reference.js';
const readWord=(b,o)=>Number(BigInt('0x'+b.subarray(o,o+32).toString('hex')));
function decodeCall(data){
 const outer=Buffer.from(data.slice(10),'hex'),array=readWord(outer,0),op=array+32+readWord(outer,array+32),type=readWord(outer,op),at=op+readWord(outer,op+32),body=outer.subarray(at+32,at+32+readWord(outer,at)),tuple=readWord(body,0);
 const entityKey=type===2?'0x'+body.subarray(tuple,tuple+32).toString('hex'):null;
 const attrs=type===1?tuple+readWord(body,tuple+128):tuple+readWord(body,tuple+32),length=readWord(body,attrs),values=[];
 for(let i=0;i<length;i++){const pos=attrs+32+readWord(body,attrs+32+i*32),name=body.subarray(pos,pos+32).toString().replace(/\0+$/,''),typeId=readWord(body,pos+32),valueAt=pos+readWord(body,pos+64),bytes=body.subarray(valueAt+32,valueAt+32+readWord(body,valueAt));values.push({name,type:typeId===7?'bytes':'str',value:typeId===7?'0x'+bytes.toString('hex'):bytes.toString('utf8')});}
 return {type,entityKey,values};
}
test('fake full watcher incident survives status update and returns to normal',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'bound-incident-stack-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const owner='0x'+'a'.repeat(40),target='0x'+'b'.repeat(40),blockHash='0x'+'c'.repeat(64),schemaTag='bound.record.v1',origin='chrome-extension://'+'a'.repeat(32),site='example.org',counterparty='0x'+'1'.repeat(40);
 const rows=new Map(),requests=new Map(),receipts=new Map();let nonce=0,clock=0,recover=false;
 const fetchImpl=async(_url,options)=>{const request=JSON.parse(options.body);let result;
  switch(request.method){
   case 'eth_chainId':result='0x76edaf';break;
   case 'eth_blockNumber':result='0xb';break;
   case 'eth_getBlockByNumber':result={hash:blockHash};break;
   case 'eth_getTransactionReceipt':result=receipts.get(request.params[0])??null;break;
   case 'arkiv_getEntity':result=rows.get(request.params[0])??null;break;
   case 'arkiv_query':{const match=request.params[0].match(/operation = str\('([^']+)'\)/);result={data:[...rows.values()].filter(row=>!match||row.attributes.some(a=>a.name==='operation'&&a.value===match[1])).sort((a,b)=>a.key.localeCompare(b.key)),blockNumber:'0xb'};break;}
   case 'eth_sendRawTransaction':{
    const raw=request.params[0],prepared=requests.get(raw),decoded=decodeCall(prepared.data),created=decoded.type===1,key=created?'0x'+(rows.size+1).toString(16).padStart(64,'0'):decoded.entityKey,tx='0x'+raw.slice(2).padStart(64,'0');
    assert.ok(created||rows.has(key));const prior=created?[]:rows.get(key).attributes.filter(old=>!decoded.values.some(value=>value.name===old.name));
    rows.set(key,{key,owner,expiresAt:'0x65',attributes:[...prior,...decoded.values]});
    const topic=created?'0xb282d7c494b8899aa8015cd07be621530beb03409eb8c5e8fdc1411ba64356a5':'0xe986ee220b2d7947a009d9389d8400b2ac82d3b430a9f72700a0975d3d5a34fe';
    receipts.set(tx,{transactionHash:tx,status:'0x1',from:owner,to:target,blockNumber:'0xa',blockHash,logs:[{address:target,topics:[topic,key,'0x'+'0'.repeat(24)+owner.slice(2)],data:created?'0x'+'0'.repeat(62)+'65'+'0'.repeat(64):'0x',removed:false}]});result=tx;break;
   }
   default:throw Error('unexpected fake RPC '+request.method);
  }
  return {ok:true,json:async()=>({jsonrpc:'2.0',id:1,result})};};
 const archive=await openArkivArchive({url:'https://rpc.example',fetchImpl,owner,target,chainId:7794095,schemaTag,senderJournal:join(dir,'sender.json'),registryJournal:join(dir,'registry.json'),lifetimes:{observation:100,baseline:100,drift:100,incident:100,status:100},prepare:async request=>{const raw='0x'+(++nonce).toString(16).padStart(2,'0');requests.set(raw,request);return raw;},inspect:async raw=>({...requests.get(raw),from:owner,to:target}),hash:async bytes=>'0x'+bytes.toString('hex').padStart(64,'0')});
 const incidents=await openWatcherIncidents({path:join(dir,'incidents.json'),now:()=>clock,feeds:[{site,chainId:1,feedReference:'0x'+'d'.repeat(64),evidenceReferences:[]}],canRecover:async()=>recover,hash:bytes=>keccak256(bytes),upload:async bytes=>({reference:'f'.repeat(64),digest:keccak256(bytes)}),archive});
 const service=await createWatcherService({journalPath:join(dir,'watcher.json'),windowMs:3600000,retentionMs:7200000,k:3,now:()=>clock,sites:[{site,chainId:1}],allowedOrigins:[origin],monitor:{check:async()=>{}},handleTriggers:incidents.handleTriggers,isIncidentActive:incidents.isIncidentActive,hasCorroboratedDrift:async()=>false,archive,intervals:{poll:100000,flush:100000,baseline:100000}});
 const address=await service.start({port:0});t.after(()=>service.stop());
 const events=['a','b','c'].map(reporterKey=>({site,chainId:1,value:counterparty,kind:'warned',reporterKey}));
 const response=await fetch(`http://127.0.0.1:${address.port}/v1/observations`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({schemaVersion:1,events})});assert.equal(response.status,202);
 await service.runtime.runFlush();assert.equal(incidents.isIncidentActive(site,1),true);
 let bundle=await queryBundle({client:archive,owner,currentBlock:11,now:()=>clock});
 assert.equal(bundle.records.filter(e=>e.record.kind==='incident').length,1);assert.ok(bundle.records.find(e=>e.record.kind==='status').record.incidentReference);
 clock=3600000;recover=true;await service.runtime.runFlush();assert.equal(incidents.isIncidentActive(site,1),false);
 bundle=await queryBundle({client:archive,owner,currentBlock:11,now:()=>clock});assert.equal(bundle.records.find(e=>e.record.kind==='status').record.state,'normal');assert.equal(bundle.records.filter(e=>e.record.kind==='incident').length,1);
});
