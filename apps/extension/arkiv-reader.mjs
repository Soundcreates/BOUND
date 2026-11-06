import {parseUniqueJSON,validateRecord} from "../../packages/contracts/index.js";
import {normalizeSettings} from "./settings.mjs";
const ADDRESS=/^0x[0-9a-f]{40}$/,KEY=/^0x[0-9a-f]{64}$/,QUANTITY=/^0x(?:0|[1-9a-f][0-9a-f]*)$/;
const CACHE_MS=5*60_000,DECISION_MS=30_000,LIMIT=5,MAX_PAGES=1000,MAX_RESPONSE=1_000_000;
function quantity(value){if(typeof value!=="string"||!QUANTITY.test(value))throw new Error("Invalid Arkiv quantity");const n=Number(BigInt(value));if(!Number.isSafeInteger(n))throw new Error("Invalid Arkiv quantity");return n;}
function decode(attributes){
 if(!Array.isArray(attributes))throw new Error("Invalid Arkiv attributes");
 const tag=attributes.filter(item=>item?.name==="arkiv.schema"),payload=attributes.filter(item=>item?.name==="payload");
 if(tag.length!==1||tag[0].type!=="str"||tag[0].value!=="bound.record.v1"||payload.length!==1||payload[0].type!=="bytes"||typeof payload[0].value!=="string"||!/^0x(?:[0-9a-f]{2})*$/.test(payload[0].value)||payload[0].value.length>262146)throw new Error("Invalid Arkiv payload");
 const hex=payload[0].value.slice(2),bytes=new Uint8Array(hex.length/2);for(let i=0;i<bytes.length;i++)bytes[i]=parseInt(hex.slice(i*2,i*2+2),16);
 const record=parseUniqueJSON(new TextDecoder("utf-8",{fatal:true}).decode(bytes));if(!validateRecord(record))throw new Error("Invalid Arkiv record");return record;
}
async function boundedText(response){
 if(!response.ok)throw new Error("Arkiv unavailable");const declared=response.headers?.get?.("content-length");if(declared!==null&&declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>MAX_RESPONSE))throw new Error("Arkiv response too large");
 if(!response.body?.getReader){const text=await response.text();if(text.length>MAX_RESPONSE)throw new Error("Arkiv response too large");return text;}
 const reader=response.body.getReader(),parts=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;if(!(value instanceof Uint8Array)||(size+=value.length)>MAX_RESPONSE){await reader.cancel();throw new Error("Arkiv response too large");}parts.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return new TextDecoder("utf-8",{fatal:true}).decode(bytes);
}
function checkedSettings(input){const settings=normalizeSettings(input);if(!settings.arkivRpcUrl||!ADDRESS.test(settings.watcherOwner))throw new Error("Arkiv settings incomplete");return settings;}
async function queryAll(request,owner){
 let cursor=null,block=null;const records=[];
 for(let page=0;page<MAX_PAGES;page++){
  const expression=`$owner = addr(${owner}) AND arkiv.schema = str('bound.record.v1')${cursor?` AND $key > key(${cursor})`:""} ORDER BY $key ASC`;
  const result=await request("arkiv_query",[expression,{select:{key:true,owner:true,expiresAt:true,attributes:true},limit:`0x${LIMIT.toString(16)}`}]);
  if(!result||!Array.isArray(result.data)||result.data.length>LIMIT)throw new Error("Invalid Arkiv query");
  const current=quantity(result.blockNumber);if(block!==null&&block!==current)throw new Error("Arkiv pagination changed block");block=current;
  for(const row of result.data){
   if(!row||typeof row.key!=="string"||!KEY.test(row.key)||(cursor&&row.key<=cursor))throw new Error("Invalid Arkiv pagination");cursor=row.key;
   if(typeof row.owner!=="string"||!ADDRESS.test(row.owner))throw new Error("Invalid Arkiv owner");if(row.owner!==owner)continue;
   const expiresAt=quantity(row.expiresAt);if(expiresAt<=block)continue;
   const record=decode(row.attributes);if(["baseline","status","drift"].includes(record.kind))records.push({key:row.key,owner:row.owner,expiresAt,record});
  }
  if(result.data.length<LIMIT)return {records,block};
 }
 throw new Error("Arkiv pagination limit reached");
}
function mapRecords(cache,currentBlock,time){
 const freshUntil=Math.min(cache.fetchedAt+CACHE_MS,time+DECISION_MS),expiresAt=new Date(freshUntil).toISOString(),output=[];
 const eligible=cache.records.filter(entry=>entry.owner===cache.owner&&KEY.test(entry.key)&&Number.isSafeInteger(entry.expiresAt)&&entry.expiresAt>currentBlock&&validateRecord(entry.record));
 for(const entry of eligible){
  const record=entry.record,common={owner:entry.owner,site:record.site,chain:String(record.chainId),expiresAt};
  if(record.kind==="baseline")output.push({...common,kind:"baseline",observed:[...new Set([...record.counterparties,...record.calledContracts])].sort(),witnessed:[]});
  else if(record.kind==="status"){
   output.push({...common,kind:"status",status:record.state==="incident"?"active":record.state==="normal"?"normal":"drift"});
   if(record.state==="drift"){
    const evidence=eligible.filter(item=>item.record.kind==="drift"&&item.record.site===record.site&&item.record.chainId===record.chainId&&item.record.detectedAt===record.updatedAt);
    if(evidence.length===1&&evidence[0].record.corroborated===true)output.push({...common,kind:"drift",corroborated:true,active:true});
   }
  }
 }
 return output;
}
export function createArkivReader({getSettings,storage,anonymousRequest,fetchImpl=fetch,now=Date.now}){
 if(typeof getSettings!=="function"||!storage||typeof storage.get!=="function"||typeof storage.set!=="function"||typeof anonymousRequest!=="function"||typeof fetchImpl!=="function")throw new Error("Invalid Arkiv reader");
 async function directRequest(settings,method,params){
  const response=await fetchImpl(settings.arkivRpcUrl,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),credentials:"omit",redirect:"error",signal:AbortSignal.timeout(5000)});
  const body=parseUniqueJSON(await boundedText(response));if(!body||body.jsonrpc!=="2.0"||body.id!==1||Object.hasOwn(body,"error")||!Object.hasOwn(body,"result"))throw new Error("Invalid Arkiv RPC response");return body.result;
 }
 async function anon(method,params){const response=await anonymousRequest({network:"arkiv",method,params});if(!response||Object.hasOwn(response,"error")||!Object.hasOwn(response,"result"))throw new Error("Anonymized Arkiv unavailable");return response.result;}
 async function refresh(){
  const settings=checkedSettings(await getSettings());if(quantity(await directRequest(settings,"eth_chainId",[]))!==settings.arkivChainId)throw new Error("Unexpected Arkiv chain");
  const result=await queryAll((method,params)=>directRequest(settings,method,params),settings.watcherOwner),time=now();
  if(!Number.isSafeInteger(time)||time<0)throw new Error("Invalid cache clock");
  await storage.set({boundWatcherBundle:{version:1,owner:settings.watcherOwner,url:settings.arkivRpcUrl,fetchedAt:time,...result}});
 }
 async function currentBlock(settings){
  const [chain,block]=await Promise.all([anon("eth_chainId",[]),anon("eth_blockNumber",[])]);
  if(quantity(chain)!==settings.arkivChainId)throw new Error("Unexpected Arkiv chain");return quantity(block);
 }
 async function readWatcherBundle(){
  const settings=checkedSettings(await getSettings()),cache=(await storage.get("boundWatcherBundle")).boundWatcherBundle,time=now();
  if(!cache||cache.version!==1||cache.owner!==settings.watcherOwner||cache.url!==settings.arkivRpcUrl||!Number.isSafeInteger(cache.fetchedAt)||cache.fetchedAt>time||time-cache.fetchedAt>=CACHE_MS||!Number.isSafeInteger(cache.block)||!Array.isArray(cache.records))throw new Error("Watcher bundle unavailable or stale");
  const block=await currentBlock(settings);if(block<cache.block)throw new Error("Arkiv block moved backwards");return mapRecords(cache,block,time);
 }
 async function readSiteStatusViaAnonRpc({site}){
  const settings=checkedSettings(await getSettings());if(quantity(await anon("eth_chainId",[]))!==settings.arkivChainId)throw new Error("Unexpected Arkiv chain");
  const result=await queryAll(anon,settings.watcherOwner),time=now();
  return mapRecords({owner:settings.watcherOwner,fetchedAt:time,records:result.records},result.block,time).filter(item=>item.site===site);
 }
 async function readUncuratedViaAnonRpc({site,chain}){
  return (await readSiteStatusViaAnonRpc({site})).filter(item=>item.chain===chain);
 }
 return {refresh,readWatcherBundle,readSiteStatusViaAnonRpc,readUncuratedViaAnonRpc};
}
