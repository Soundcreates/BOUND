import {validateObservation,validateRecord} from '../../packages/contracts/index.js';
import {createIncidentComposer} from './incident.js';
import {openIncidentLifecycle} from './lifecycle.js';
const hash=/^0x[0-9a-f]{64}$/,ref=/^[0-9a-f]{64}$/;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));

// Static feeds are trusted watcher configuration, not supplied by the page.
export async function openWatcherIncidents({path,now=Date.now,feeds,canRecover,hash:hashBytes,writeEvidence,archive}) {
 if(!Array.isArray(feeds)||!feeds.length||!archive||typeof archive.writeIncident!=='function'||typeof archive.writeStatus!=='function')throw new Error('incident binding configuration required');
 const byScope=new Map();
 for(const source of feeds){
  const feed=structuredClone(source);
  if(!exact(feed,['site','chainId','feedReference','evidenceReferences'])||!validateObservation({site:feed.site,chainId:feed.chainId,value:'0x'+'0'.repeat(40),kind:'warned',reporterKey:'validation'})||typeof feed.feedReference!=='string'||!hash.test(feed.feedReference)||!Array.isArray(feed.evidenceReferences)||feed.evidenceReferences.length>100||!feed.evidenceReferences.every((v,i)=>typeof v==='string'&&ref.test(v)&&(!i||feed.evidenceReferences[i-1]<v)))throw new Error('invalid incident feed');
  const key=JSON.stringify([feed.site,feed.chainId]);if(byScope.has(key))throw new Error('duplicate incident feed');byScope.set(key,feed);
 }
 let lifecycle;
 const writeStatus=async(status,id)=>{
  let result;
  if(status.state==='normal'&&typeof archive.writeRecoveryStatus==='function'){
   if(typeof archive.getStatusVersion!=='function')throw new Error('recovery status version unavailable');
   const version=await archive.getStatusVersion(status.site,status.chainId);result=await archive.writeRecoveryStatus(status,id,version);
  }else result=await archive.writeStatus(status,id);
  if(result?.state==='current')return;
  if(result?.state==='superseded' && status.state==='incident' && status.incidentReference===null && /^[0-9a-f]{64}-pending$/.test(id) && typeof archive.readEntity==='function' && typeof archive.findIncidentByOperationId==='function') {
   const [current,incident]=await Promise.all([archive.readEntity(result.key),archive.findIncidentByOperationId(id.slice(0,64))]);
   const value=current?.record;
   if(value&&validateRecord(value)&&value.kind==='status'&&value.state==='incident'&&value.site===status.site&&value.chainId===status.chainId&&value.feedReference===status.feedReference&&value.updatedAt===status.updatedAt&&typeof value.incidentReference==='string'&&incident?.key===value.incidentReference&&incident.record&&validateRecord(incident.record)&&incident.record.kind==='incident'&&incident.record.site===status.site&&incident.record.chainId===status.chainId)return;
  }
  throw new Error('incident status superseded or unverified');
 };
 const composer=createIncidentComposer({hash:hashBytes,writeEvidence,markActive:async({site,chainId})=>{if(!lifecycle?.isActive(site,chainId))throw new Error('incident state not durable');},writeIncident:(record,id)=>archive.writeIncident(record,id),writeStatus});
 lifecycle=await openIncidentLifecycle({path,now,canRecover,publishIncident:(input,options)=>composer.publish(input,options),writeNormalStatus:writeStatus});
 const handleTriggers=(site,chainId,triggers)=>{
  const feed=byScope.get(JSON.stringify([site,chainId]));if(!feed)throw new Error('incident feed unavailable');
  return lifecycle.handle({...feed,triggers});
 };
 return {handleTriggers,isIncidentActive:lifecycle.isActive};
}
