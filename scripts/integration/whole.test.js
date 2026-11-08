import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openArkivArchive} from '../../shared/integrations/arkiv/archive.js';
import {openDurableWatcher} from '../../server/watcher/durable.js';
import {createIntakeServer} from '../../server/watcher/http.js';
import {createObservationPipeline} from '../../server/watcher/pipeline.js';

const readWord=(buffer,offset)=>Number(BigInt('0x'+buffer.subarray(offset,offset+32).toString('hex')));
function attributesFromCall(data){
 const outer=Buffer.from(data.slice(10),'hex'),array=readWord(outer,0),operation=array+32+readWord(outer,array+32),type=readWord(outer,operation);
 const encoded=operation+readWord(outer,operation+32),body=outer.subarray(encoded+32,encoded+32+readWord(outer,encoded)),tuple=readWord(body,0);
 const base=type===1?tuple+readWord(body,tuple+128):tuple+readWord(body,tuple+32),length=readWord(body,base),attrs=[];
 for(let i=0;i<length;i++) {const item=base+32+readWord(body,base+32+i*32),name=body.subarray(item,item+32).toString().replace(/\0+$/,''),typeId=readWord(body,item+32),position=item+readWord(body,item+64),bytes=body.subarray(position+32,position+32+readWord(body,position));attrs.push({name,type:typeId===7?'bytes':'str',value:typeId===7?'0x'+bytes.toString('hex'):bytes.toString('utf8')});}
 return {type,attrs};
}
test('HTTP to durable watcher to fake Arkiv baseline bundle uses the composed adapters',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'bound-whole-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const owner='0x'+'a'.repeat(40),target='0x'+'b'.repeat(40),blockHash='0x'+'c'.repeat(64),schemaTag='bound.record.v1',origin='chrome-extension://'+'a'.repeat(32),rows=new Map(),requests=new Map(),receipts=new Map();let nonce=0;
 const fetchImpl=async(_url,options)=>{const request=JSON.parse(options.body);let result;
  switch(request.method){
   case 'eth_chainId':result='0x76edaf';break;
   case 'eth_blockNumber':result='0xb';break;
   case 'eth_getBlockByNumber':result={hash:blockHash};break;
   case 'eth_getTransactionReceipt':result=receipts.get(request.params[0])??null;break;
   case 'arkiv_getEntity':result=rows.get(request.params[0])??null;break;
   case 'arkiv_query':{const expression=request.params[0],match=expression.match(/operation = str\('([^']+)'\)/);result={data:[...rows.values()].filter(row=>!match||row.attributes.some(a=>a.name==='operation'&&a.value===match[1])).sort((a,b)=>a.key.localeCompare(b.key)),blockNumber:'0xb'};break;}
   case 'eth_sendRawTransaction':{
    const raw=request.params[0],prepared=requests.get(raw),{type,attrs}=attributesFromCall(prepared.data),id=attrs.find(a=>a.name==='operation').value;
    assert.equal(type,1);const key='0x'+(rows.size+1).toString(16).padStart(64,'0'),tx='0x'+raw.slice(2).padStart(64,'0');
    rows.set(key,{key,owner,expiresAt:'0x65',attributes:attrs});receipts.set(tx,{transactionHash:tx,status:'0x1',from:owner,to:target,blockNumber:'0xa',blockHash,logs:[{address:target,topics:['0xb282d7c494b8899aa8015cd07be621530beb03409eb8c5e8fdc1411ba64356a5',key,'0x'+'0'.repeat(24)+owner.slice(2)],data:'0x'+'0'.repeat(62)+'65'+'0'.repeat(64),removed:false}]});assert.ok(id);result=tx;break;
   }
   default:throw Error('unexpected fake RPC '+request.method);
  }
  return {ok:true,json:async()=>({jsonrpc:'2.0',id:1,result})};};
 const archive=await openArkivArchive({url:'https://rpc.example',fetchImpl,owner,target,chainId:7794095,schemaTag,senderJournal:join(dir,'sender.json'),registryJournal:join(dir,'registry.json'),lifetimes:{observation:100,baseline:100,drift:100,incident:100,status:100},prepare:async request=>{const raw='0x'+(++nonce).toString(16).padStart(2,'0');requests.set(raw,request);return raw;},inspect:async raw=>({...requests.get(raw),from:owner,to:target}),hash:async raw=>'0x'+raw.toString('hex').padStart(64,'0')});
 const watcher=await openDurableWatcher({path:join(dir,'watcher.json'),windowMs:3600000,retentionMs:7200000,k:3,now:()=>3600123,isIncidentActive:async()=>false,hasCorroboratedDrift:async()=>false,writeObservation:archive.writeObservation});
 const server=createIntakeServer({watcher,allowedOrigins:[origin]});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const site='example.org',value='0x'+'1'.repeat(40),body=JSON.stringify({schemaVersion:1,events:[{site,chainId:1,value,kind:'counterparty',reporterKey:'fixture-key'}]});
 const response=await fetch(`http://127.0.0.1:${server.address().port}/v1/observations`,{method:'POST',headers:{origin,'content-type':'application/json'},body});assert.equal(response.status,202);assert.equal(rows.size,0);
 const pipeline=createObservationPipeline({watcher,archive,owner,currentBlock:archive.currentBlock,now:()=>3600123});const {bundle}=await pipeline.runHourly();
 assert.equal(rows.size,2);assert.equal(bundle.records.length,1);assert.equal(bundle.records[0].record.kind,'baseline');assert.deepEqual(bundle.records[0].record.counterparties,[value]);
});
