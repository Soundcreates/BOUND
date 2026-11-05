import {validateObservation,validateRecord} from '../../packages/contracts/index.js';
const hex32=/^[0-9a-f]{64}$/, digest32=/^0x[0-9a-f]{64}$/;
const exact=(v,keys)=>v && typeof v==='object' && !Array.isArray(v) && Object.keys(v).length===keys.length && keys.every(key=>Object.hasOwn(v,key));
// All writers must persist/deduplicate incidentId across uncertain outcomes.
// markActive updates durable local state before any external publication.
export function createIncidentComposer({markActive,hash,upload,writeIncident,writeStatus}) {
 if([markActive,hash,upload,writeIncident,writeStatus].some(f=>typeof f!=='function'))throw new Error('incident adapters required');
 async function publish(input) {
  input=structuredClone(input);
  if(!exact(input,['incidentId','site','chainId','counterparty','trigger','publicationHour','feedReference','evidenceReferences']) || typeof input.incidentId!=='string' || !hex32.test(input.incidentId) || !validateObservation({site:input.site,chainId:input.chainId,value:input.counterparty,kind:'warned',reporterKey:'validation'}) || !['drift+warned','K-same-counterparty-warned'].includes(input.trigger) || typeof input.publicationHour!=='string' || !/^\d{4}-\d\d-\d\dT\d\d:00:00\.000Z$/.test(input.publicationHour) || typeof input.feedReference!=='string' || !digest32.test(input.feedReference) || !Array.isArray(input.evidenceReferences) || !input.evidenceReferences.every((r,i)=>typeof r==='string' && hex32.test(r) && (!i || input.evidenceReferences[i-1]<r)))throw new Error('invalid incident input');
  const record={schemaVersion:1,kind:'incident',site:input.site,chainId:input.chainId,trigger:input.trigger,severity:'high',counterparty:input.counterparty,reportDigest:'0x'+'0'.repeat(64),swarmReference:'0'.repeat(64),createdAt:input.publicationHour};
  if(!validateRecord(record))throw new Error('invalid incident input');
  const report={schemaVersion:1,incidentId:input.incidentId,site:input.site,chainId:input.chainId,counterparty:input.counterparty,trigger:input.trigger,evidenceReferences:input.evidenceReferences};
  await markActive({site:input.site,chainId:input.chainId,incidentId:input.incidentId});
  const pendingStatus={schemaVersion:1,kind:'status',site:input.site,chainId:input.chainId,state:'incident',feedReference:input.feedReference,incidentReference:null,updatedAt:input.publicationHour};
  if(!validateRecord(pendingStatus))throw new Error('invalid incident status');
  await writeStatus(pendingStatus,`${input.incidentId}-pending`);
  const bytes=Buffer.from(JSON.stringify(report),'utf8');
  const expected=await hash(Buffer.from(bytes));
  if(typeof expected!=='string'||!digest32.test(expected))throw new Error('invalid report digest');
  const stored=await upload(Buffer.from(bytes),{incidentId:input.incidentId});
  if(!stored || typeof stored.reference!=='string' || !hex32.test(stored.reference) || stored.digest!==expected)throw new Error('invalid report reference or digest');
  record.reportDigest=expected;record.swarmReference=stored.reference;
  const entityKey=await writeIncident(record,input.incidentId);
  if(typeof entityKey!=='string'||!digest32.test(entityKey))throw new Error('invalid incident entity key');
  const status={schemaVersion:1,kind:'status',site:input.site,chainId:input.chainId,state:'incident',feedReference:input.feedReference,incidentReference:entityKey,updatedAt:input.publicationHour};
  if(!validateRecord(status))throw new Error('invalid incident status');
  await writeStatus(status,`${input.incidentId}-published`);
  return {entityKey,reportDigest:expected,swarmReference:stored.reference};
 }
 return {publish};
}
