import {createHash} from 'node:crypto';
import {classifyDrift} from './drift.js';

// The reference is curated externally; polling never promotes current data to trust.
// publish must persist evidence/status and deduplicate the supplied id.
export function createDriftMonitor({readBaseline,poll,publish,onObservation=async()=>{},onPollFailure=async()=>{}}) {
 if([readBaseline,poll,publish,onObservation,onPollFailure].some(fn=>typeof fn!=='function'))throw new Error('monitor adapters required');
 async function check(site,chainId,context={}) {
  if(typeof site!=='string'||!site||!Number.isSafeInteger(chainId)||chainId<1)throw new Error('invalid site or chain');
  let result;
  try {
   const baseline=await readBaseline(site,chainId);
   if(!baseline)throw new Error('reference baseline unavailable');
   const current=await poll(site);
   result=classifyDrift(baseline,current);
  } catch(error) {await onPollFailure(site,chainId);throw error;}
  const {changes,corroborated}=result;
  if(!changes.length){await onObservation(site,chainId,{state:'normal',corroborated:false,id:null});return {state:'normal',corroborated:false};}
  const evidence={site,chainId,changes,corroborated};
  const id=createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
  const observation=await onObservation(site,chainId,{state:'drift',corroborated,id});
  const publishContext=observation?.episodeId?{...context,driftEpisode:observation.episodeId}:context;
  try { await publish({id,...evidence},publishContext); } catch (cause) { const error=new Error('drift publication unavailable',{cause});error.code='DRIFT_PUBLICATION_UNAVAILABLE';throw error; }
  return {state:'drift',corroborated,id};
 }
 return {check};
}
