import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {acquireJournalLocks} from '../../integrations/arkiv/journal-lock.js';
import {openDriftPublisher} from './drift-publisher.js';
import {openWatchedDrift} from './drift-binding.js';
import {openWatcherIncidents} from './incident-binding.js';
import {createGuardedWatcherFlows,guardedDriftStatus} from './guarded-flows.js';
import {createWatcherService} from './service.js';

// One application instance owns all four journals and serializes every status
// transition for a site. Network, signing and recovery policy remain explicit.
export async function openWatcherApplication({paths,feeds,archive,hash,writeEvidence,readBaseline,poll,canRecover,now=Date.now,maxDriftAgeMs,renewalWindowMs,windowMs,retentionMs,k,allowedOrigins,intervals,onFailure}) {
 const names=['watcher','drift','publication','incidents'];
 if(!paths||names.some(name=>typeof paths[name]!=='string'||!paths[name])||typeof canRecover!=='function')throw new Error('watcher application configuration required');
 const journals=names.map(name=>resolve(paths[name]));
 if(new Set(journals).size!==journals.length)throw new Error('watcher journal paths must be distinct');
 if(!Array.isArray(feeds)||!feeds.length||!archive||typeof archive.writeDrift!=='function'||typeof archive.writeEvidence!=='function')throw new Error('watcher feeds and Arkiv evidence archive required');
 feeds=structuredClone(feeds);
 const locks=await acquireJournalLocks(journals);
 try {
  const sites=feeds.map(({site,chainId})=>({site,chainId}));
  const publisher=await openDriftPublisher({path:journals[2],now,renewalWindowMs,feeds:feeds.map(({site,chainId,feedReference})=>({site,chainId,feedReference})),hash,writeEvidence,writeDrift:(record,id)=>archive.writeDrift(record,id),writeDriftStatusIfNoIncident:guardedDriftStatus});
  const drift=await openWatchedDrift({path:journals[1],now,maxAgeMs:maxDriftAgeMs,readBaseline,poll,publish:publisher.publish});
  let service;
  const incidents=await openWatcherIncidents({path:journals[3],now,feeds,hash,writeEvidence,archive,canRecover:async(site,chainId,episode)=>{
   const status=await drift.readStatus(site,chainId);
   if(status.stale||status.state!=='normal')return false;
   if(!service||!(await service.watcher.recoveryQuiet(site,chainId)))return false;
   return (await canRecover(site,chainId,episode))===true;
  }});
  const guarded=createGuardedWatcherFlows({monitor:drift.monitor,publisher,readDriftStatus:drift.readStatus,incidents,archive,publishNormal:async(site,chainId)=>{
   const feed=feeds.find(f=>f.site===site&&f.chainId===chainId),time=now();
   if(!feed||!Number.isSafeInteger(time)||time<0||time>8640000000000000)throw new Error('normal status configuration unavailable');
   const updatedAt=new Date(Math.floor(time/3600000)*3600000).toISOString();
   const status={schemaVersion:1,kind:'status',site,chainId,state:'normal',feedReference:feed.feedReference,incidentReference:null,updatedAt};
   const id=createHash('sha256').update(JSON.stringify(['normal-poll',status])).digest('hex');
   let result;if(typeof archive.writeRecoveryStatus==='function'){
    if(typeof archive.getStatusVersion!=='function')throw new Error('recovery status version unavailable');
    const version=await archive.getStatusVersion(site,chainId);result=await archive.writeRecoveryStatus(status,id,version);
   }else result=await archive.writeStatus(status,id);
   if(result?.state!=='current')throw new Error('normal status superseded or unverified');
  }});
  service=await createWatcherService({journalPath:journals[0],windowMs,retentionMs,k,now,sites,allowedOrigins,monitor:guarded.monitor,isIncidentActive:guarded.isIncidentActive,hasCorroboratedDrift:drift.hasCorroboratedDrift,handleTriggers:guarded.handleTriggers,archive,intervals,onFailure});
  let closing;
  const active=fn=>(...args)=>closing?Promise.reject(new Error('watcher application closed')):fn(...args);
  return {start:active(service.start),runtime:{runPoll:active(service.runtime.runPoll),runFlush:active(service.runtime.runFlush),runBaseline:active(service.runtime.runBaseline),...(service.runtime.runRenew?{runRenew:active(service.runtime.runRenew)}:{})},readDriftStatus:active(drift.readStatus),close(){
   if(!closing)closing=(async()=>{await service.stop();await locks.close();})();
   return closing;
  }};
 } catch(error){await locks.close();throw error;}
}
