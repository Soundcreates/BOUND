import {randomBytes,randomUUID} from 'node:crypto';
import {open,readFile,rename,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {parseUniqueJSON,validateObservation} from '../../packages/contracts/index.js';
const id=/^[0-9a-f]{64}$/;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const validSite=(site,chainId)=>validateObservation({site,chainId,value:'0x'+'0'.repeat(40),kind:'warned',reporterKey:'validation'});
const validResult=result=>exact(result,['state','corroborated','id'])&&((result.state==='normal'&&result.corroborated===false&&result.id===null)||(result.state==='drift'&&typeof result.corroborated==='boolean'&&typeof result.id==='string'&&id.test(result.id)));
const validEntry=e=>exact(e,['site','chainId','state','corroborated','id','episodeId','checkedAt','stale'])&&validSite(e.site,e.chainId)&&typeof e.stale==='boolean'&&((e.state==='unknown'&&e.corroborated===false&&e.id===null&&e.episodeId===null&&e.checkedAt===null&&e.stale)||(validResult({state:e.state,corroborated:e.corroborated,id:e.id})&&(e.state==='normal'?e.episodeId===null:typeof e.episodeId==='string'&&id.test(e.episodeId))&&Number.isSafeInteger(e.checkedAt)&&e.checkedAt>=0));
async function persist(path,state){const temp=`${path}.${randomUUID()}.tmp`;let file;try{file=await open(temp,'wx',0o600);await file.writeFile(JSON.stringify(state),'utf8');await file.sync();await file.close();file=undefined;await rename(temp,path);const dir=await open(dirname(path),'r');try{await dir.sync();}finally{await dir.close();}}finally{if(file)await file.close();await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}}

// Single-process local infrastructure state, not an Arkiv trust source.
export async function openDriftState({path,now=Date.now,maxAgeMs}){
 if(typeof path!=='string'||!path||typeof now!=='function'||!Number.isSafeInteger(maxAgeMs)||maxAgeMs<1)throw new Error('invalid drift state configuration');
 let state;try{state=parseUniqueJSON(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')state={version:1,maxAgeMs,lastNow:0,entries:[]};else throw new Error('invalid drift state',{cause:error});}
 if(!exact(state,['version','maxAgeMs','lastNow','entries'])||state.version!==1||state.maxAgeMs!==maxAgeMs||!Number.isSafeInteger(state.lastNow)||state.lastNow<0||!Array.isArray(state.entries)||!state.entries.every(e=>validEntry(e)&&(e.checkedAt===null||e.checkedAt<=state.lastNow))||new Set(state.entries.map(e=>JSON.stringify([e.site,e.chainId]))).size!==state.entries.length)throw new Error('invalid drift state or configuration');
 let queue=Promise.resolve(),uncertain=false,maxTime=state.lastNow;
 const serial=fn=>{const result=queue.then(()=>{if(uncertain)throw new Error('drift state uncertain; reopen required');return fn();});queue=result.catch(()=>{});return result;};
 const clock=()=>{const value=now();if(!Number.isSafeInteger(value)||value<maxTime||value>8640000000000000)throw new Error('invalid drift clock');maxTime=value;return value;};
 async function save(entries,time){const next={version:1,maxAgeMs,lastNow:time,entries};if(JSON.stringify(next).length>1000000)throw new Error('drift state full');try{await persist(path,next);state=next;}catch(error){uncertain=true;throw error;}}
 const write=(site,chainId,source)=>serial(async()=>{
  if(!validSite(site,chainId)||(source!==null&&!validResult(source)))throw new Error('invalid drift observation');
  const time=clock(),entries=structuredClone(state.entries),index=entries.findIndex(e=>e.site===site&&e.chainId===chainId),prior=index<0?null:entries[index];
  const item=source===null?prior?{...prior,stale:true}:{site,chainId,state:'unknown',corroborated:false,id:null,episodeId:null,checkedAt:null,stale:true}:{site,chainId,...source,episodeId:source.state==='drift'?(prior?.state==='drift'&&prior.id===source.id?prior.episodeId:randomBytes(32).toString('hex')):null,checkedAt:time,stale:false};
  if(index<0)entries.push(item);else entries[index]=item;await save(entries,time);return structuredClone(item);
 });
 const markSuccess=(site,chainId,result)=>write(site,chainId,structuredClone(result));
 const markUnavailable=(site,chainId)=>write(site,chainId,null);
 const read=(site,chainId)=>serial(()=>{
  if(!validSite(site,chainId))throw new Error('invalid drift site');const time=clock(),entry=state.entries.find(e=>e.site===site&&e.chainId===chainId);
  if(!entry)return {state:'unknown',corroborated:false,id:null,episodeId:null,checkedAt:null,stale:true};
  return {state:entry.state,corroborated:entry.corroborated,id:entry.id,episodeId:entry.episodeId,checkedAt:entry.checkedAt,stale:entry.stale||entry.checkedAt===null||time-entry.checkedAt>=maxAgeMs};
 });
 const hasCorroboratedDrift=async(site,chainId)=>{const status=await read(site,chainId);if(status.stale||status.state==='unknown')throw new Error('drift unavailable');return status.corroborated;};
 return {markSuccess,markUnavailable,read,hasCorroboratedDrift};
}
