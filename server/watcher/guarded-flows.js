import {createStatusGate} from './status-gate.js';

// Pass this function to openDriftPublisher as its guarded status adapter.
export async function guardedDriftStatus(status,id,context,eventId,episodeId) {
 if(!context||!context.statusGuard||typeof context.statusGuard.writeDriftStatusIfNoIncident!=='function')throw new Error('drift status guard unavailable');
 return context.statusGuard.writeDriftStatusIfNoIncident(status,id,eventId,episodeId);
}

// Every poll observation/publication and incident lifecycle transition for a
// site must go through these wrappers for the single-process guarantee to hold.
export function createGuardedWatcherFlows({monitor,publisher,readDriftStatus,incidents,archive,publishNormal=null}) {
 if(!monitor||typeof monitor.check!=='function'||!publisher||typeof publisher.flushSite!=='function'||typeof readDriftStatus!=='function'||!incidents||typeof incidents.handleTriggers!=='function'||typeof incidents.isIncidentActive!=='function'||!archive||typeof archive.writeStatus!=='function')throw new Error('guarded watcher adapters required');
 if(publishNormal!==null&&typeof publishNormal!=='function')throw new Error('invalid normal status publisher');
 const gate=createStatusGate({isIncidentActive:incidents.isIncidentActive,isCurrentDrift:async(site,chainId,id,episodeId)=>{const status=await readDriftStatus(site,chainId);if(!status||status.stale||status.state==='unknown')throw new Error('drift state unavailable');return status.state==='drift'&&status.id===id&&status.episodeId===episodeId;},writeStatus:(status,id)=>archive.writeStatus(status,id)});
 return {
  monitor:{check:(site,chainId)=>gate.run(site,chainId,async statusGuard=>{const context={statusGuard};const result=await monitor.check(site,chainId,context);try{await publisher.flushSite(site,chainId,context);if(result?.state==='normal'&&publishNormal){const active=await incidents.isIncidentActive(site,chainId);if(typeof active!=='boolean')throw new Error('incident state unavailable');if(!active)await publishNormal(site,chainId);}}catch(cause){const error=new Error('drift publication unavailable',{cause});error.code='DRIFT_PUBLICATION_UNAVAILABLE';throw error;}return result;})},
  handleTriggers:(site,chainId,triggers)=>gate.run(site,chainId,()=>incidents.handleTriggers(site,chainId,triggers)),
  isIncidentActive:incidents.isIncidentActive
 };
}
