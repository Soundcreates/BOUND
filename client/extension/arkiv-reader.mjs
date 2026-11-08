import {parseUniqueJSON,validateRecord} from "../../shared/contracts/index.js";
import {normalizeSettings} from "./settings.mjs";
const ADDRESS=/^0x[0-9a-f]{40}$/,KEY=/^0x[0-9a-f]{64}$/,QUANTITY=/^0x(?:0|[1-9a-f][0-9a-f]*)$/;
// A larger bounded page avoids several sequential mixnet round trips and the
// accompanying risk that the chain advances between pages.
const CACHE_MS=5*60_000,DECISION_MS=30_000,ENS_BUNDLE_MS=60*60_000,ENS_RECORD_MS=24*60*60_000,LIMIT=32,MAX_PAGES=256,MAX_RESPONSE=1_000_000;
function quantity(value){if(typeof value!=="string"||!QUANTITY.test(value))throw new Error("Invalid Arkiv quantity");const n=Number(BigInt(value));if(!Number.isSafeInteger(n))throw new Error("Invalid Arkiv quantity");return n;}
function decode(attributes){
 if(!Array.isArray(attributes))throw new Error("Invalid Arkiv attributes");
 const tag=attributes.filter(item=>item?.name==="arkiv.schema"),payload=attributes.filter(item=>item?.name==="payload");
 if(tag.length!==1||tag[0].type!=="str"||tag[0].value!=="bound.record.v1"||payload.length!==1||payload[0].type!=="bytes"||typeof payload[0].value!=="string"||!/^0x(?:[0-9a-f]{2})*$/.test(payload[0].value)||payload[0].value.length>262146)throw new Error("Invalid Arkiv payload");
 const hex=payload[0].value.slice(2),bytes=new Uint8Array(hex.length/2);for(let i=0;i<bytes.length;i++)bytes[i]=parseInt(hex.slice(i*2,i*2+2),16);
 const record=parseUniqueJSON(new TextDecoder("utf-8",{fatal:true}).decode(bytes));if(!validateRecord(record))throw new Error("Invalid Arkiv record");return record;
}
async function boundedText(response,budget){
 if(!response.ok)throw new Error("Arkiv unavailable");const declared=response.headers?.get?.("content-length");if(declared!==null&&declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>MAX_RESPONSE))throw new Error("Arkiv response too large");
 if(!response.body?.getReader){const text=await response.text();const size=new TextEncoder().encode(text).length;if(size>MAX_RESPONSE||(budget&&(budget.bytes+=size)>8_000_000))throw new Error("Arkiv response too large");return text;}
 const reader=response.body.getReader(),parts=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;if(!(value instanceof Uint8Array)||(size+=value.length)>MAX_RESPONSE){await reader.cancel();throw new Error("Arkiv response too large");}parts.push(value);}}finally{reader.releaseLock();}
 if(budget&&(budget.bytes+=size)>8_000_000)throw new Error("Arkiv response too large");
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return new TextDecoder("utf-8",{fatal:true}).decode(bytes);
}
function checkedSettings(input){const settings=normalizeSettings(input);if(!settings.arkivRpcUrl||!ADDRESS.test(settings.watcherOwner))throw new Error("Arkiv settings incomplete");return settings;}
// Only the kinds decisions use. Observations are never read here, so their number
// (they grow with every report) cannot push the listing over many pages.
const READ_KINDS=["baseline","status","drift","ens_record","frontend","incident"];
const KIND_FILTER=`(${READ_KINDS.map(kind=>`kind = str('${kind}')`).join(" OR ")})`;
// Rabdi makes a block every ~2s; a listing that spans a new block is restarted
// rather than failing, so one block landing mid-read does not drop watcher data.
async function queryAll(request,owner,limits={pages:0,restarts:0},kinds=READ_KINDS){
 let cursor=null,block=null;const records=[];
 const filter=kinds===READ_KINDS ? KIND_FILTER : `(${kinds.map(kind=>`kind = str('${kind}')`).join(' OR ')})`;
 while(limits.pages++<(limits.maxPages??MAX_PAGES)){
  const expression=`$owner = addr(${owner}) AND arkiv.schema = str('bound.record.v1') AND ${filter}${cursor?` AND $key > key(${cursor})`:""} ORDER BY $key ASC`;
  const result=await request("arkiv_query",[expression,{select:{key:true,owner:true,expiresAt:true,attributes:true},limit:`0x${LIMIT.toString(16)}`}]);
  if(!result||!Array.isArray(result.data)||result.data.length>LIMIT)throw new Error("Invalid Arkiv query");
  const current=quantity(result.blockNumber);if(block!==null&&block!==current){if(limits.restarts++===0)return queryAll(request,owner,limits,kinds);throw new Error("Arkiv pagination changed block");}block=current;
  for(const row of result.data){
   if(!row||typeof row.key!=="string"||!KEY.test(row.key)||(cursor&&row.key<=cursor))throw new Error("Invalid Arkiv pagination");cursor=row.key;
   if(typeof row.owner!=="string"||!ADDRESS.test(row.owner))throw new Error("Invalid Arkiv owner");if(row.owner!==owner)continue;
   const expiresAt=quantity(row.expiresAt);if(expiresAt<=block)continue;
   const record=decode(row.attributes);if(kinds.includes(record.kind))records.push({key:row.key,owner:row.owner,expiresAt,record});
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
export function summarizeIncidentHistory(entries,site,chain,now=Date.now()){
 const filtered=entries.filter(({record})=>record.site===site&&String(record.chainId)===chain);
 const incidents=filtered.filter(({record})=>record.kind==='incident'&&Date.parse(record.createdAt)<=now).map(({record})=>({time:record.createdAt,severity:record.severity})).sort((a,b)=>b.time.localeCompare(a.time));
 const warnings=filtered.filter(({record})=>record.kind==='observation'&&record.event==='warned'&&record.observedAt&&Date.parse(record.observedAt)<=now).map(({record})=>({time:record.observedAt,score:record.score})).sort((a,b)=>b.time.localeCompare(a.time));
 return {state:'available',incidents:incidents.slice(0,5),warnings:warnings.slice(0,5)};
}
export function createArkivReader({getSettings,storage,anonymousRequest,fetchImpl=fetch,now=Date.now}){
 if(typeof getSettings!=="function"||!storage||typeof storage.get!=="function"||typeof storage.set!=="function"||typeof anonymousRequest!=="function"||typeof fetchImpl!=="function")throw new Error("Invalid Arkiv reader");
 async function directRequest(settings,method,params,signal,budget){
  const response=await fetchImpl(settings.arkivRpcUrl,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params}),credentials:"omit",redirect:"error",signal});
  const body=parseUniqueJSON(await boundedText(response,budget));if(!body||body.jsonrpc!=="2.0"||body.id!==1||Object.hasOwn(body,"error")||!Object.hasOwn(body,"result"))throw new Error("Invalid Arkiv RPC response");return body.result;
 }
 async function anon(method,params){const response=await anonymousRequest({network:"arkiv",method,params});if(!response||Object.hasOwn(response,"error")||!Object.hasOwn(response,"result"))throw new Error("Anonymized Arkiv unavailable");return response.result;}
 const flights=new Map();
 const keyOf=s=>JSON.stringify([s.arkivRpcUrl,s.arkivChainId,s.watcherOwner]);
 function refresh(){
  // Install the flight before settings or network operations can yield.
  const flight=(async()=>{
   const settings=checkedSettings(await getSettings()),key=keyOf(settings);
   const existing=flights.get(key);if(existing&&existing!==flight)return existing;
   flights.set(key,flight);
   const controller=new AbortController(),budget={bytes:0};let timer;
   const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error("Arkiv refresh deadline exceeded"));},30_000);});
   let result;try{result=await Promise.race([(async()=>{if(quantity(await directRequest(settings,"eth_chainId",[],controller.signal,budget))!==settings.arkivChainId)throw new Error("Unexpected Arkiv chain");return queryAll((method,params)=>directRequest(settings,method,params,controller.signal,budget),settings.watcherOwner);})(),deadline]);}finally{clearTimeout(timer);}
   const time=now();
   if(!Number.isSafeInteger(time)||time<0)throw new Error("Invalid cache clock");
   if(keyOf(checkedSettings(await getSettings()))!==key)throw new Error("Arkiv settings changed");
   const previous=(await storage.get("boundWatcherBundle")).boundWatcherBundle,watermarks=(await storage.get("boundWatcherBlockWatermarks")).boundWatcherBlockWatermarks;
   const watermark=watermarks?.[key];
   if((Number.isSafeInteger(watermark)&&result.block<watermark)||(previous?.version===2&&previous.owner===settings.watcherOwner&&previous.url===settings.arkivRpcUrl&&previous.chainId===settings.arkivChainId&&Number.isSafeInteger(previous.verifiedAt)&&Number.isSafeInteger(previous.block)&&result.block<previous.block))throw new Error("Arkiv block moved backwards");
   const bundle={version:2,owner:settings.watcherOwner,url:settings.arkivRpcUrl,chainId:settings.arkivChainId,fetchedAt:time,verifiedAt:null,...result};
   const retain=previous?.version===2&&previous.owner===settings.watcherOwner&&previous.url===settings.arkivRpcUrl&&previous.chainId===settings.arkivChainId&&Number.isSafeInteger(previous.verifiedAt);
   await storage.set(retain?{boundWatcherPendingBundle:bundle}:{boundWatcherBundle:bundle,boundWatcherPendingBundle:null});
   return {ok:true,fetchedAt:time};
  })();
  flight.finally(()=>{for(const [key,value] of flights)if(value===flight)flights.delete(key);}).catch(()=>{});
  return flight;
 }
 let watermarkWrite=Promise.resolve();
 async function observeBlock(settings,block){
  const key=keyOf(settings);
  const operation=watermarkWrite.then(async()=>{
   const watermarks=(await storage.get("boundWatcherBlockWatermarks")).boundWatcherBlockWatermarks||{};
   if(Number.isSafeInteger(watermarks[key])&&block<watermarks[key])throw new Error("Arkiv block moved backwards");
   if(keyOf(checkedSettings(await getSettings()))!==key)throw new Error("Arkiv settings changed");
   await storage.set({boundWatcherBlockWatermarks:{...watermarks,[key]:block}});
  });
  watermarkWrite=operation.catch(()=>{});await operation;return block;
 }
 async function currentBlock(settings){
  const [chain,block]=await Promise.all([anon("eth_chainId",[]),anon("eth_blockNumber",[])]);
  if(quantity(chain)!==settings.arkivChainId)throw new Error("Unexpected Arkiv chain");return observeBlock(settings,quantity(block));
 }
 let verifyFlight;
 async function verifyBundleBlock(){
  if(verifyFlight)return verifyFlight;
  const flight=(async()=>{
   const settings=checkedSettings(await getSettings()),key=keyOf(settings),pending=(await storage.get("boundWatcherPendingBundle")).boundWatcherPendingBundle,stored=(await storage.get("boundWatcherBundle")).boundWatcherBundle,time=now();
   const matches=c=>c?.version===2&&c.owner===settings.watcherOwner&&c.url===settings.arkivRpcUrl&&c.chainId===settings.arkivChainId;
   const cache=matches(pending)?pending:stored;
   if(!cache||cache.version!==2||cache.owner!==settings.watcherOwner||cache.url!==settings.arkivRpcUrl||cache.chainId!==settings.arkivChainId||!Number.isSafeInteger(cache.block))throw new Error("Watcher bundle unavailable");
   if(Number.isSafeInteger(cache.verifiedAt)&&time>=cache.verifiedAt&&time-cache.verifiedAt<DECISION_MS)return {block:cache.block,verifiedAt:cache.verifiedAt};
   const watermarks=(await storage.get("boundWatcherBlockWatermarks")).boundWatcherBlockWatermarks||{};
   if(matches(pending)&&Number.isSafeInteger(watermarks[key])&&cache.block<watermarks[key])throw new Error("Arkiv verification superseded");
   const block=await currentBlock(settings),verifiedAt=now();
   if(block<cache.block||keyOf(checkedSettings(await getSettings()))!==key)throw new Error("Arkiv verification superseded");
   const latest=(await storage.get(matches(pending)?"boundWatcherPendingBundle":"boundWatcherBundle"))[matches(pending)?"boundWatcherPendingBundle":"boundWatcherBundle"];
   if(JSON.stringify(latest)!==JSON.stringify(cache))throw new Error("Arkiv bundle changed");
   await storage.set({boundWatcherBundle:{...cache,block,verifiedAt},boundWatcherPendingBundle:null});return {block,verifiedAt};
  })();verifyFlight=flight;try{return await flight;}finally{if(verifyFlight===flight)verifyFlight=null;}
 }
 const unavailable=()=>({state:"unavailable",fetchedAt:null,ageMs:null,verifiedAt:null,block:null,frontend:null,rawDrift:false,corroboratedDrift:false,activeIncident:false,ambiguous:false,communityReportingSafe:false});
 async function readCommunityCache({site,chain,now:requestedTime}){
  const time=requestedTime===undefined?now():requestedTime;
  try{
   const settings=checkedSettings(await getSettings()),cache=(await storage.get("boundWatcherBundle")).boundWatcherBundle;
   if(!Number.isSafeInteger(time)||!cache||cache.version!==2||cache.owner!==settings.watcherOwner||cache.url!==settings.arkivRpcUrl||cache.chainId!==settings.arkivChainId||!Number.isSafeInteger(cache.fetchedAt)||cache.fetchedAt>time||time-cache.fetchedAt>=ENS_BUNDLE_MS||!Number.isSafeInteger(cache.block)||!Array.isArray(cache.records))return unavailable();
   const ageMs=time-cache.fetchedAt,verified=Number.isSafeInteger(cache.verifiedAt)&&cache.verifiedAt<=time&&time-cache.verifiedAt<DECISION_MS;
   if(!Number.isSafeInteger(cache.verifiedAt)||cache.verifiedAt<0||cache.verifiedAt>time||(ageMs<CACHE_MS&&!verified))return unavailable();
   const watermarks=(await storage.get("boundWatcherBlockWatermarks")).boundWatcherBlockWatermarks||{},block=Math.max(cache.block,watermarks[keyOf(settings)]??cache.block);
   const entries=cache.records.filter(e=>e?.owner===cache.owner&&KEY.test(e.key)&&Number.isSafeInteger(e.expiresAt)&&e.expiresAt>block&&validateRecord(e.record)&&(!e.record.updatedAt||Date.parse(e.record.updatedAt)<=time)&&(!e.record.detectedAt||Date.parse(e.record.detectedAt)<=time)&&(!e.record.createdAt||Date.parse(e.record.createdAt)<=time)&&e.record.site===site&&String(e.record.chainId)===String(chain));
   const fronts=entries.filter(e=>e.record.kind==="frontend"),statuses=entries.filter(e=>e.record.kind==="status"),drifts=entries.filter(e=>e.record.kind==="drift"),incidents=entries.filter(e=>e.record.kind==="incident");
   const ambiguous=fronts.length!==1||statuses.length!==1,frontend=fronts.length===1&&Date.parse(fronts[0].record.updatedAt)<=time?{...fronts[0].record,scripts:fronts[0].record.scripts.filter(row=>Date.parse(row.lastSeen)<=time&&time-Date.parse(row.lastSeen)<172800000)}:null,status=statuses.length===1?statuses[0].record:null;
   return {state:ageMs<CACHE_MS?"fresh":"stale",fetchedAt:cache.fetchedAt,ageMs,verifiedAt:cache.verifiedAt,block,frontend,rawDrift:statuses.some(e=>e.record.state==="drift"),corroboratedDrift:statuses.length===1&&status?.state==="drift"&&drifts.length===1&&drifts[0].record.detectedAt===status.updatedAt&&drifts[0].record.corroborated===true,activeIncident:statuses.length===1&&status?.state==="incident"&&incidents.length===1&&status.incidentReference===incidents[0].key,ambiguous,communityReportingSafe:!ambiguous&&status?.state==="normal"};
  }catch{return unavailable();}
 }
 async function ensureCommunity({site,chain,budgetMs=1500}){
  const before=await readCommunityCache({site,chain});if(before.state==="fresh")return before;
  const work=(async()=>{const settings=checkedSettings(await getSettings()),cache=(await storage.get("boundWatcherBundle")).boundWatcherBundle,time=now();
   if(cache?.version===2&&cache.owner===settings.watcherOwner&&cache.url===settings.arkivRpcUrl&&cache.chainId===settings.arkivChainId&&Number.isSafeInteger(cache.fetchedAt)&&cache.fetchedAt<=time&&time-cache.fetchedAt<CACHE_MS)await verifyBundleBlock();else {await refresh();await verifyBundleBlock();}})();
  let timer;try{await Promise.race([work.catch(()=>{}),new Promise(resolve=>{timer=setTimeout(resolve,Math.max(0,budgetMs));})]);}finally{clearTimeout(timer);}return readCommunityCache({site,chain});
 }
 async function readWatcherBundle(){
  const settings=checkedSettings(await getSettings()),time=now();let cache=(await storage.get("boundWatcherBundle")).boundWatcherBundle;
  if(!cache||cache.version!==2||cache.fetchedAt>time||time-cache.fetchedAt>=CACHE_MS){await refresh();cache=(await storage.get("boundWatcherBundle")).boundWatcherBundle;}
  if(!cache||cache.version!==2||cache.chainId!==settings.arkivChainId||cache.owner!==settings.watcherOwner||cache.url!==settings.arkivRpcUrl||!Number.isSafeInteger(cache.fetchedAt)||cache.fetchedAt>time||time-cache.fetchedAt>=CACHE_MS||!Number.isSafeInteger(cache.block)||!Array.isArray(cache.records))throw new Error("Watcher bundle unavailable or stale");
  await verifyBundleBlock();
  const latest=(await storage.get("boundWatcherBundle")).boundWatcherBundle,watermarks=(await storage.get("boundWatcherBlockWatermarks")).boundWatcherBlockWatermarks||{};
  if(!latest||latest.owner!==settings.watcherOwner||latest.url!==settings.arkivRpcUrl||latest.chainId!==settings.arkivChainId)throw new Error("Watcher bundle changed");
  return mapRecords(latest,Math.max(latest.block,watermarks[keyOf(settings)]??latest.block),time);
 }
 // The anonymous fallback downloads the whole owner's records, so concurrent
 // callers for different sites share one query and filter locally.
 const anonOwnerFlights=new Map();
 function anonOwnerRecords(settings){
  const key=JSON.stringify([settings.arkivChainId,settings.watcherOwner]);
  let flight=anonOwnerFlights.get(key);
  if(!flight){
   flight=(async()=>{
    if(quantity(await anon("eth_chainId",[]))!==settings.arkivChainId)throw new Error("Unexpected Arkiv chain");
    const result=await queryAll(anon,settings.watcherOwner);await observeBlock(settings,result.block);return {result,time:now()};
   })();
   anonOwnerFlights.set(key,flight);
   flight.finally(()=>{if(anonOwnerFlights.get(key)===flight)anonOwnerFlights.delete(key);}).catch(()=>{});
  }
  return flight;
 }
 async function readSiteStatusViaAnonRpc({site}){
  const settings=checkedSettings(await getSettings());
  const {result,time}=await anonOwnerRecords(settings);
  return mapRecords({owner:settings.watcherOwner,fetchedAt:time,records:result.records},result.block,time).filter(item=>item.site===site);
 }
 // Watcher-asserted ENS text records from the already-downloaded bundle. Local
 // lookup only (no per-site request). Display/availability data: never trust.
 async function readEnsRecord({site,chain}){
  const settings=checkedSettings(await getSettings()),cache=(await storage.get("boundWatcherBundle")).boundWatcherBundle,time=now();
  if(!cache||cache.version!==2||cache.chainId!==settings.arkivChainId||cache.owner!==settings.watcherOwner||cache.url!==settings.arkivRpcUrl||!Number.isSafeInteger(cache.fetchedAt)||cache.fetchedAt>time||time-cache.fetchedAt>=ENS_BUNDLE_MS||!Number.isSafeInteger(cache.block)||!Array.isArray(cache.records))return null;
  const watermarks=(await storage.get("boundWatcherBlockWatermarks")).boundWatcherBlockWatermarks||{},block=Math.max(cache.block,watermarks[keyOf(settings)]??cache.block);
  const matches=cache.records.filter(entry=>entry?.owner===cache.owner&&KEY.test(entry.key)&&Number.isSafeInteger(entry.expiresAt)&&entry.expiresAt>block&&validateRecord(entry.record)&&entry.record.kind==="ens_record"&&entry.record.site===site&&String(entry.record.chainId)===chain);
  if(matches.length!==1)return null;
  const record=matches[0].record,resolvedAt=Date.parse(record.resolvedAt);
  if(!Number.isFinite(resolvedAt)||resolvedAt>time||time-resolvedAt>=ENS_RECORD_MS)return null;
  return {owner:matches[0].owner,site:record.site,chain,name:record.name,resolver:record.resolver,records:{...record.records},resolvedAt:record.resolvedAt};
 }
 async function readTrustSnapshot({key,owner}){
  const settings=checkedSettings(await getSettings());
  if(typeof key!=="string"||!KEY.test(key)||typeof owner!=="string"||!ADDRESS.test(owner))throw new Error("Invalid ENS Arkiv pointer");
  const block=await currentBlock(settings),row=await anon("arkiv_getEntity",[key]);
  if(!row||row.key!==key||typeof row.owner!=="string"||row.owner.toLowerCase()!==owner)throw new Error("Arkiv snapshot owner mismatch");
  const expiresAt=quantity(row.expiresAt);if(expiresAt<=block)throw new Error("Arkiv snapshot entity expired");
  const record=decode(row.attributes);
  if(record.kind!=="trust_snapshot")throw new Error("Arkiv entity is not a trust snapshot");
  return {key,owner,expiresAt,record};
 }
 async function readUncuratedViaAnonRpc({site,chain}){
  return (await readSiteStatusViaAnonRpc({site})).filter(item=>item.chain===chain);
 }
 async function readIncidentHistory({site,chain}){
  const settings=checkedSettings(await getSettings());
  if(typeof site!=='string'||typeof chain!=='string'||!/^[1-9]\d*$/.test(chain))throw new Error('Invalid history scope');
  if(quantity(await anon('eth_chainId',[]))!==settings.arkivChainId)throw new Error('Unexpected Arkiv chain');
  const result=await queryAll(anon,settings.watcherOwner,{pages:0,restarts:0,maxPages:8},['incident','observation']);
  await observeBlock(settings,result.block);
  return summarizeIncidentHistory(result.records,site,chain,now());
 }
 return {refresh,verifyBundleBlock,readCommunityCache,ensureCommunity,readWatcherBundle,readSiteStatusViaAnonRpc,readUncuratedViaAnonRpc,readEnsRecord,readTrustSnapshot,readIncidentHistory};
}
