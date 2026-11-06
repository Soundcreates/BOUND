import {validateObservation,validateRecord} from '../../packages/contracts/index.js';

// Single-process per-site critical section shared by polling and incident transitions.
export function createStatusGate({isIncidentActive,isCurrentDrift,writeStatus}) {
 if(typeof isIncidentActive!=='function'||typeof isCurrentDrift!=='function'||typeof writeStatus!=='function')throw new Error('status gate adapters required');
 const queues=new Map();
 function run(site,chainId,callback){
  if(!validateObservation({site,chainId,value:'0x'+'0'.repeat(40),kind:'warned',reporterKey:'validation'})||typeof callback!=='function')return Promise.reject(new Error('invalid status gate scope'));
  const scope=JSON.stringify([site,chainId]),previous=queues.get(scope)??Promise.resolve();
  const result=previous.then(async()=>{
   let active=true;const pending=new Set();
   const guard=Object.freeze({writeDriftStatusIfNoIncident(source,id,eventId,episodeId){
    const record=structuredClone(source);
    const promise=(async()=>{
     if(!active)throw new Error('status gate transaction closed');
     if(!validateRecord(record)||record.kind!=='status'||record.state!=='drift'||record.site!==site||record.chainId!==chainId||typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(id)||typeof eventId!=='string'||!/^[0-9a-f]{64}$/.test(eventId)||typeof episodeId!=='string'||!/^[0-9a-f]{64}$/.test(episodeId))throw new Error('invalid status gate scope');
     const incident=await isIncidentActive(site,chainId);if(typeof incident!=='boolean')throw new Error('incident state unavailable');
     if(incident)return 'incident-active';
     const current=await isCurrentDrift(site,chainId,eventId,episodeId);if(typeof current!=='boolean')throw new Error('drift state unavailable');
     if(!current)return 'drift-resolved';
     const result=await writeStatus(record,id);if(!result||result.state!=='current')throw new Error('drift status superseded or unverified');
     return 'written';
    })();
    pending.add(promise);promise.catch(()=>{}).finally(()=>pending.delete(promise));return promise;
   }});
   try {const value=await callback(guard);const remaining=await Promise.allSettled([...pending]);const failure=remaining.find(item=>item.status==='rejected');if(failure)throw failure.reason;return value;}
   finally {active=false;await Promise.allSettled([...pending]);}
  });
  const tail=result.catch(()=>{});queues.set(scope,tail);tail.then(()=>{if(queues.get(scope)===tail)queues.delete(scope);});
  return result;
 }
 return {run};
}
