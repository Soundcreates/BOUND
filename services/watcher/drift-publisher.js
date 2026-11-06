import {createHash,randomUUID} from 'node:crypto';
import {open,readFile,rename,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {parseUniqueJSON,validateObservation,validateRecord} from '../../packages/contracts/index.js';
const hex=/^[0-9a-f]{64}$/,hash32=/^0x[0-9a-f]{64}$/;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const scope=(site,chainId)=>JSON.stringify([site,chainId]);
const validFeed=f=>exact(f,['site','chainId','feedReference'])&&validateObservation({site:f.site,chainId:f.chainId,value:'0x'+'0'.repeat(40),kind:'warned',reporterKey:'validation'})&&typeof f.feedReference==='string'&&hash32.test(f.feedReference);
const evidenceOf=v=>({site:v.site,chainId:v.chainId,changes:v.changes,corroborated:v.corroborated});
function validInput(v){
 if(!exact(v,['id','site','chainId','changes','corroborated'])||typeof v.id!=='string'||!hex.test(v.id)||v.id!==hash(evidenceOf(v)))return false;
 return validateRecord({schemaVersion:1,kind:'drift',site:v.site,chainId:v.chainId,changes:v.changes,corroborated:v.corroborated,evidenceReference:'0'.repeat(64),detectedAt:'1970-01-01T00:00:00.000Z'});
}
async function persist(path,state){const temp=`${path}.${randomUUID()}.tmp`;let file;try{file=await open(temp,'wx',0o600);await file.writeFile(JSON.stringify(state),'utf8');await file.sync();await file.close();file=undefined;await rename(temp,path);const dir=await open(dirname(path),'r');try{await dir.sync();}finally{await dir.close();}}finally{if(file)await file.close();await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}}
function validEntry(entry,feeds){
 return exact(entry,['event','episodeId','window','publicationHour','feedReference','done'])&&validInput(entry.event)&&typeof entry.episodeId==='string'&&hex.test(entry.episodeId)&&Number.isSafeInteger(entry.window)&&entry.window>=0&&typeof entry.publicationHour==='string'&&/^\d{4}-\d\d-\d\dT\d\d:00:00\.000Z$/.test(entry.publicationHour)&&typeof entry.feedReference==='string'&&hash32.test(entry.feedReference)&&feeds.get(scope(entry.event.site,entry.event.chainId))===entry.feedReference&&typeof entry.done==='boolean';
}
// The status callback must serialize with incident state updates and must never downgrade an active incident.
export async function openDriftPublisher({path,now=Date.now,renewalWindowMs,feeds,hash:hashBytes,writeEvidence,writeDrift,writeDriftStatusIfNoIncident}) {
 if(typeof path!=='string'||!path||typeof now!=='function'||!Number.isSafeInteger(renewalWindowMs)||renewalWindowMs<1||!Array.isArray(feeds)||!feeds.length||[hashBytes,writeEvidence,writeDrift,writeDriftStatusIfNoIncident].some(fn=>typeof fn!=='function'))throw new Error('invalid drift publisher configuration');
 const byScope=new Map();for(const source of feeds){const feed=structuredClone(source);if(!validFeed(feed)||byScope.has(scope(feed.site,feed.chainId)))throw new Error('invalid drift feed');byScope.set(scope(feed.site,feed.chainId),feed.feedReference);}
 let state;try{state=parseUniqueJSON(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')state={version:2,renewalWindowMs,lastNow:0,entries:[]};else throw new Error('invalid drift publication journal',{cause:error});}
 if(!exact(state,['version','renewalWindowMs','lastNow','entries'])||state.version!==2||state.renewalWindowMs!==renewalWindowMs||!Number.isSafeInteger(state.lastNow)||state.lastNow<0||!Array.isArray(state.entries)||!state.entries.every(entry=>validEntry(entry,byScope))||new Set(state.entries.map(entry=>JSON.stringify([entry.event.id,entry.episodeId,entry.window]))).size!==state.entries.length)throw new Error('invalid drift publication journal or configuration');
 let queue=Promise.resolve(),uncertain=false;
 const serial=fn=>{const result=queue.then(()=>{if(uncertain)throw new Error('drift publication journal uncertain; reopen required');return fn();});queue=result.catch(()=>{});return result;};
 async function save(entries,time){const next={version:2,renewalWindowMs,lastNow:time,entries};if(JSON.stringify(next).length>1000000)throw new Error('drift publication journal full');try{await persist(path,next);state=next;}catch(error){uncertain=true;throw error;}}
 // Completed operations only need deduplication within their renewal window.
 // Pending entries must survive indefinitely so outages cannot discard evidence.
 async function compact(time){const window=Math.floor(time/renewalWindowMs);const entries=state.entries.filter(entry=>!entry.done||entry.window>=window);if(entries.length!==state.entries.length)await save(entries,time);}
 async function deliver(index,time,context){
  const entry=state.entries[index],event=entry.event;if(entry.done)return;
  const operationId=hash(['drift-record',event.id,entry.episodeId,entry.window]),statusId=hash(['drift-status',event.id,entry.episodeId,entry.window]);
  const report={schemaVersion:1,site:event.site,chainId:event.chainId,changes:event.changes,corroborated:event.corroborated};
  const bytes=Buffer.from(JSON.stringify(report),'utf8'),expected=await hashBytes(Buffer.from(bytes));
  if(typeof expected!=='string'||!hash32.test(expected))throw new Error('invalid drift evidence digest');
  const evidence={schemaVersion:1,kind:'evidence',site:event.site,chainId:event.chainId,digest:expected,payload:bytes.toString('utf8'),createdAt:entry.publicationHour};
  if(!validateRecord(evidence))throw new Error('invalid drift evidence payload');
  const stored=await writeEvidence(evidence,operationId);
  if(!stored||typeof stored.key!=='string'||!/^0x[0-9a-f]{64}$/.test(stored.key)||typeof stored.owner!=='string')throw new Error('invalid Arkiv evidence entity');
  const record={schemaVersion:1,kind:'drift',...evidenceOf(event),evidenceReference:stored.key.slice(2),detectedAt:entry.publicationHour};
  if(!validateRecord(record))throw new Error('invalid drift record');
  await writeDrift(record,operationId);
  const status={schemaVersion:1,kind:'status',site:event.site,chainId:event.chainId,state:'drift',feedReference:entry.feedReference,incidentReference:null,updatedAt:entry.publicationHour};
  if(!validateRecord(status))throw new Error('invalid drift status');
  const outcome=await writeDriftStatusIfNoIncident(status,statusId,context,event.id,entry.episodeId);
  if(!['written','incident-active','drift-resolved'].includes(outcome))throw new Error('drift status guard unavailable');
  const entries=state.entries.slice();entries[index]={...entry,done:true};await save(entries,time);
 }
 const publish=(source,sourceContext={})=>{const event=structuredClone(source),context={...sourceContext};return serial(async()=>{
  if(!validInput(event)||!context||typeof context.driftEpisode!=='string'||!hex.test(context.driftEpisode))throw new Error('invalid drift evidence or episode');
  const feedReference=byScope.get(scope(event.site,event.chainId));if(!feedReference)throw new Error('drift feed unavailable');
  const time=now();if(!Number.isSafeInteger(time)||time<state.lastNow||time>8640000000000000)throw new Error('invalid drift publication clock');
  await compact(time);
  const window=Math.floor(time/renewalWindowMs);
  for(let i=0;i<state.entries.length;i++)if(state.entries[i].event.id===event.id&&!state.entries[i].done)await deliver(i,time,context);
  let index=state.entries.findIndex(entry=>entry.event.id===event.id&&entry.episodeId===context.driftEpisode&&entry.window===window);
  if(index===-1){const entry={event,episodeId:context.driftEpisode,window,publicationHour:new Date(Math.floor(time/3600000)*3600000).toISOString(),feedReference,done:false};await save([...state.entries,entry],time);index=state.entries.length-1;}
  await deliver(index,time,context);return {state:'complete'};
 });};
 const flushSite=(site,chainId,context={})=>serial(async()=>{
  if(!validateObservation({site,chainId,value:'0x'+'0'.repeat(40),kind:'warned',reporterKey:'validation'})||!byScope.has(scope(site,chainId)))throw new Error('invalid drift feed');
  const time=now();if(!Number.isSafeInteger(time)||time<state.lastNow||time>8640000000000000)throw new Error('invalid drift publication clock');
  await compact(time);
  for(let i=0;i<state.entries.length;i++)if(!state.entries[i].done&&state.entries[i].event.site===site&&state.entries[i].event.chainId===chainId)await deliver(i,time,context);
 });
 return {publish,flushSite};
}
