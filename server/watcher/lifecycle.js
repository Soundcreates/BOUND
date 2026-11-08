import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {open,readFile,rename,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {parseUniqueJSON,validateObservation,validateRecord} from '../../shared/contracts/index.js';
const h64=/^[0-9a-f]{64}$/,hash=/^0x[0-9a-f]{64}$/;
const exact=(v,ks)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===ks.length&&ks.every(k=>Object.hasOwn(v,k));
const refs=values=>Array.isArray(values)&&values.length<=100&&values.every((v,i)=>typeof v==='string'&&h64.test(v)&&(!i||values[i-1]<v));
const validTrigger=t=>exact(t,['counterparty','trigger'])&&typeof t.counterparty==='string'&&/^0x[0-9a-f]{40}$/.test(t.counterparty)&&['drift+warned','K-same-counterparty-warned'].includes(t.trigger);
const incidentValid=(item,episode)=>exact(item,['incidentId','counterparty','trigger','publicationHour','evidenceReferences','published','entityKey'])&&typeof item.incidentId==='string'&&h64.test(item.incidentId)&&validTrigger({counterparty:item.counterparty,trigger:item.trigger})&&typeof item.publicationHour==='string'&&/^\d{4}-\d\d-\d\dT\d\d:00:00\.000Z$/.test(item.publicationHour)&&validateRecord({schemaVersion:1,kind:'status',site:episode.site,chainId:episode.chainId,state:'incident',feedReference:episode.feedReference,incidentReference:null,updatedAt:item.publicationHour})&&refs(item.evidenceReferences)&&typeof item.published==='boolean'&&(item.published?typeof item.entityKey==='string'&&hash.test(item.entityKey):item.entityKey===null);
const episodeValid=e=>exact(e,['site','chainId','feedReference','active','incidents'])&&validateObservation({site:e.site,chainId:e.chainId,value:'0x'+'0'.repeat(40),kind:'warned',reporterKey:'validation'})&&typeof e.feedReference==='string'&&hash.test(e.feedReference)&&typeof e.active==='boolean'&&Array.isArray(e.incidents)&&e.incidents.length>0&&e.incidents.every(i=>incidentValid(i,e))&&(e.active||e.incidents.every(i=>i.published))&&new Set(e.incidents.map(i=>i.counterparty)).size===e.incidents.length;
function validState(state){if(!exact(state,['version','lastNow','episodes'])||state.version!==1||!Number.isSafeInteger(state.lastNow)||state.lastNow<0||!Array.isArray(state.episodes)||!state.episodes.every(episodeValid))return false;const active=state.episodes.filter(e=>e.active).map(e=>JSON.stringify([e.site,e.chainId]));const ids=state.episodes.flatMap(e=>e.incidents.map(i=>i.incidentId));return new Set(active).size===active.length&&new Set(ids).size===ids.length;}
async function persist(path,state){const temp=`${path}.${randomUUID()}.tmp`;let file;try{file=await open(temp,'wx',0o600);await file.writeFile(JSON.stringify(state),'utf8');await file.sync();await file.close();file=undefined;await rename(temp,path);const dir=await open(dirname(path),'r');try{await dir.sync();}finally{await dir.close();}}finally{if(file)await file.close();await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}}

// Single-process lifecycle journal; publishing adapters must deduplicate incident IDs.
export async function openIncidentLifecycle({path,now=Date.now,canRecover,publishIncident,writeNormalStatus}) {
 if(typeof path!=='string'||!path||[now,canRecover,publishIncident,writeNormalStatus].some(fn=>typeof fn!=='function'))throw new Error('invalid lifecycle configuration');
 let state;try{state=parseUniqueJSON(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')state={version:1,lastNow:0,episodes:[]};else throw new Error('invalid incident journal',{cause:error});}
 if(!validState(state))throw new Error('invalid incident journal');
 let queue=Promise.resolve(),uncertain=false;const transitioning=new Set();
 const serial=fn=>{const result=queue.then(()=>{if(uncertain)throw new Error('incident journal uncertain; reopen required');return fn();});queue=result.catch(()=>{});return result;};
 const scope=(site,chainId)=>JSON.stringify([site,chainId]);
 const isActive=(site,chainId)=>uncertain||transitioning.has(scope(site,chainId))||state.episodes.some(e=>e.active&&e.site===site&&e.chainId===chainId);
 async function save(next){if(JSON.stringify(next).length>1000000||!validState(next))throw new Error('invalid or full incident journal');try{await persist(path,next);state=next;}catch(error){uncertain=true;throw error;}}
 const handle=source=>{const input=structuredClone(source);return serial(async()=>{
  if(!exact(input,['site','chainId','feedReference','evidenceReferences','triggers'])||typeof input.feedReference!=='string'||!hash.test(input.feedReference)||!refs(input.evidenceReferences)||!Array.isArray(input.triggers)||input.triggers.length>100||!input.triggers.every(validTrigger)||!validateObservation({site:input.site,chainId:input.chainId,value:'0x'+'0'.repeat(40),kind:'warned',reporterKey:'validation'}))throw new Error('invalid incident lifecycle input');
  const time=now();if(!Number.isSafeInteger(time)||time<state.lastNow||time>8640000000000000)throw new Error('invalid incident clock');
  const publicationHour=new Date(Math.floor(time/3600000)*3600000).toISOString(),name=scope(input.site,input.chainId);
  let index=state.episodes.findIndex(e=>e.active&&e.site===input.site&&e.chainId===input.chainId);
  if(index===-1&&!input.triggers.length)return {active:false};
  if(index!==-1&&state.episodes[index].feedReference!==input.feedReference)throw new Error('incident feed changed');
  const chosen=new Map();for(const item of input.triggers){const old=chosen.get(item.counterparty);if(!old||item.trigger==='drift+warned')chosen.set(item.counterparty,item.trigger);}
  const additions=[...chosen].sort(([a],[b])=>a<b?-1:a>b?1:0).filter(([counterparty])=>index===-1||!state.episodes[index].incidents.some(i=>i.counterparty===counterparty)).map(([counterparty,trigger])=>({incidentId:randomBytes(32).toString('hex'),counterparty,trigger,publicationHour,evidenceReferences:input.evidenceReferences,published:false,entityKey:null}));
  if(index===-1||additions.length){
   transitioning.add(name);
   const episodes=structuredClone(state.episodes);
   if(index===-1){episodes.push({site:input.site,chainId:input.chainId,feedReference:input.feedReference,active:true,incidents:additions});index=episodes.length-1;}else episodes[index].incidents.push(...additions);
   await save({version:1,lastNow:time,episodes});transitioning.delete(name);
  }
  for(let n=0;n<state.episodes[index].incidents.length;n++){
   const episode=state.episodes[index],item=episode.incidents[n];if(item.published)continue;
   const result=await publishIncident({incidentId:item.incidentId,site:episode.site,chainId:episode.chainId,counterparty:item.counterparty,trigger:item.trigger,publicationHour:item.publicationHour,feedReference:episode.feedReference,evidenceReferences:structuredClone(item.evidenceReferences)},{statusMode:n===0?'primary':'record-only'});
   if(!result||typeof result.entityKey!=='string'||!hash.test(result.entityKey))throw new Error('invalid incident publication');
   const episodes=structuredClone(state.episodes);episodes[index].incidents[n].published=true;episodes[index].incidents[n].entityKey=result.entityKey;await save({version:1,lastNow:time,episodes});
  }
  if(!input.triggers.length){
   const ready=await canRecover(input.site,input.chainId,{incidentId:state.episodes[index].incidents[0].incidentId});if(typeof ready!=='boolean')throw new Error('incident recovery unavailable');
   if(ready){const episode=state.episodes[index];const status={schemaVersion:1,kind:'status',site:episode.site,chainId:episode.chainId,state:'normal',feedReference:episode.feedReference,incidentReference:null,updatedAt:publicationHour};if(!validateRecord(status))throw new Error('invalid recovery status');const id=createHash('sha256').update(JSON.stringify(['recovery',episode.incidents[0].incidentId,publicationHour])).digest('hex');await writeNormalStatus(status,id);const episodes=structuredClone(state.episodes);episodes[index].active=false;await save({version:1,lastNow:time,episodes});return {active:false};}
  }
  return {active:true};
 });};
 return {handle,isActive};
}
