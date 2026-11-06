import {validateObservationBatch} from '../../packages/contracts/index.js';

export function createIntakeRouter({addressWatcher, frontendAggregator}) {
 return {async intake(batch) {
  if (!validateObservationBatch(batch)) return {schemaVersion:1,result:'rejected'};
  const addressEvents=batch.events.filter(event=>event.kind!=='frontend');
  const frontendEvents=batch.events.filter(event=>event.kind==='frontend');
  try {
   if (addressEvents.length && (await addressWatcher.intake({schemaVersion:1,events:addressEvents}))?.result!=='accepted') return {schemaVersion:1,result:'retry'};
   if (frontendEvents.length) await frontendAggregator.intake(frontendEvents);
   return {schemaVersion:1,result:'accepted'};
  } catch { return {schemaVersion:1,result:'retry'}; }
 }};
}
