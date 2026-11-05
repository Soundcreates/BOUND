import {createHash} from 'node:crypto';
import {classifyDrift} from './drift.js';

// The reference is curated externally; polling never promotes current data to trust.
// publish must persist evidence/status and deduplicate the supplied id.
export function createDriftMonitor({readBaseline,poll,publish}) {
 if([readBaseline,poll,publish].some(fn=>typeof fn!=='function'))throw new Error('monitor adapters required');
 async function check(site,chainId) {
  if(typeof site!=='string'||!site||!Number.isSafeInteger(chainId)||chainId<1)throw new Error('invalid site or chain');
  const baseline=await readBaseline(site,chainId);
  if(!baseline)throw new Error('reference baseline unavailable');
  const current=await poll(site);
  const {changes,corroborated}=classifyDrift(baseline,current);
  if(!changes.length)return {state:'normal',corroborated:false};
  const evidence={site,chainId,changes,corroborated};
  const id=createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
  await publish({id,...evidence});
  return {state:'drift',corroborated,id};
 }
 return {check};
}
