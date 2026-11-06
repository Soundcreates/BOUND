import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createArkivTransport} from './transport.js';
import {createArkivRpcReader} from './rpc.js';
import {createArkivConfirmation} from './confirm.js';
import {createArkivEntityReader} from './entity.js';
import {openArkivSender} from './sender.js';
import {openArkivUpsert} from './upsert.js';
import {openExpiryRenewer} from './renewal.js';
import {createArkivWriter} from './writer.js';
import {encodeCreateRecord,encodePatchRecord,encodeExtendEntity} from './codec.js';
import {acquireJournalLocks} from './journal-lock.js';
const kinds=['observation','baseline','drift','incident','status'];
const quantity=/^0x(?:0|[1-9a-f][0-9a-f]*)$/;
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
// This composition requires a trusted signer and a transaction decoder that recovers the signer.
// Confirm the configured system target and SDK compatibility before using it on a live network.
export async function openArkivArchive({url,accessKey,fetchImpl,owner,target,chainId,schemaTag,senderJournal,registryJournal,lifetimes,prepare,inspect,hash,confirmTimeoutMs=0,confirmPollMs=1000,renewBeforeBlocks}) {
 if(!lifetimes||kinds.some(kind=>!Number.isSafeInteger(lifetimes[kind])||lifetimes[kind]<1||lifetimes[kind]>7884000))throw new Error('explicit Arkiv lifetimes required');
 if(typeof senderJournal!=='string'||!senderJournal||typeof registryJournal!=='string'||!registryJournal||resolve(senderJournal)===resolve(registryJournal))throw new Error('distinct Arkiv journal paths required');
 const renewalJournal=resolve(registryJournal)+'.renewal';
 if(resolve(senderJournal)===renewalJournal)throw new Error('distinct Arkiv journal paths required');
 const renewalThreshold=renewBeforeBlocks??Math.max(1,Math.floor(Math.min(lifetimes.baseline,lifetimes.status)/4));
 if(!Number.isSafeInteger(renewalThreshold)||renewalThreshold<1||renewalThreshold>=Math.min(lifetimes.baseline,lifetimes.status))throw new Error('invalid expiry renewal threshold');
 const journalLocks=await acquireJournalLocks([resolve(senderJournal),resolve(registryJournal),renewalJournal]);
 try {
 const recordLifetimes=Object.fromEntries(kinds.map(kind=>[kind,lifetimes[kind]]));
 const transport=createArkivTransport({url,accessKey,fetchImpl});
 const reader=createArkivRpcReader({url,accessKey,fetchImpl,schemaTag,expectedChainId:chainId});
 const entities=createArkivEntityReader({rpc:transport.rpc,owner,schemaTag,chainId});
 const confirm=createArkivConfirmation({rpc:transport.rpc,owner,target,chainId,schemaTag});
 const sender=await openArkivSender({path:senderJournal,owner,chainId,target,prepare,inspect,hash,confirmTimeoutMs,confirmPollMs,
  buildCall:async(record,id,context)=>context.extendBlocks?encodeExtendEntity({entityKey:context.entityKey,lifetimeBlocks:context.extendBlocks}):context.entityKey?encodePatchRecord({record,operationId:id,entityKey:context.entityKey}):encodeCreateRecord({record,operationId:id,schemaTag,lifetimeBlocks:recordLifetimes[record.kind]}),
  getChainId:async()=>{const value=await transport.rpc('eth_chainId',[]);if(typeof value!=='string'||!quantity.test(value))throw new Error('invalid Arkiv chain');const n=Number(BigInt(value));if(!Number.isSafeInteger(n))throw new Error('invalid Arkiv chain');return n;},
  broadcast:raw=>transport.rpc('eth_sendRawTransaction',[raw]),confirm});
 const writer=createArkivWriter({owner,schemaTag,findByOperationId:reader.findByOperationId,currentBlock:entities.currentBlock,submitOnce:({operationId,record})=>sender.write(operationId,record),reconcileExisting:({operationId,record,entity})=>sender.reconcileExisting(operationId,record,entity)});
 const upsert=await openArkivUpsert({path:registryJournal,owner,currentBlock:entities.currentBlock,getEntity:entities.getEntity,create:(record,id)=>writer.write(record,id),patch:(record,id,entityKey)=>sender.write(id,record,{entityKey}),reconcileSuperseded:({operationId,record,entity,previousKey})=>previousKey===entity.key?sender.reconcileExisting(operationId,record,entity,{allowRecordChanged:true}):sender.assertConfirmed(operationId,record)});
 const renewal=await openExpiryRenewer({path:renewalJournal,owner,currentBlock:entities.currentBlock,getEntity:entities.getEntity,listCurrent:upsert.listCurrent,recordExtension:upsert.recordExtension,extend:(record,id,entityKey,extendBlocks)=>sender.write(id,record,{entityKey,extendBlocks}),hasPending:sender.hasPending,lifetimes:recordLifetimes,renewBeforeBlocks:renewalThreshold});
 let queue=Promise.resolve(),closing;
 function serial(action){if(closing)return Promise.reject(new Error('Arkiv archive closed'));const result=queue.then(action);queue=result.catch(()=>{});return result;}
 const write=action=>serial(async()=>{await renewal.resume();return action();});
 const requireKind=(record,kind)=>{if(!record||record.kind!==kind)throw new Error('invalid Arkiv record kind');};
 return {
  writeObservation(record,id){const captured=structuredClone(record);return write(()=>{requireKind(captured,'observation');return writer.write(captured,id);});},
  writeDrift(record,id){const captured=structuredClone(record);return write(()=>{requireKind(captured,'drift');return writer.write(captured,id);});},
  writeIncident(record,id){const captured=structuredClone(record);return write(async()=>{requireKind(captured,'incident');return (await writer.write(captured,id)).key;});},
  writeBaseline(record,id){const captured=structuredClone(record);return write(()=>{requireKind(captured,'baseline');return upsert.write(captured,id);});},
  writeStatus(record,id){const captured=structuredClone(record);return write(()=>{requireKind(captured,'status');return upsert.write(captured,id);});},
  getStatusVersion:(site,chainId)=>serial(async()=>(await upsert.latestStatus(site,chainId))?.id??null),
  // Recovery must use a version captured by the guarded caller when it made
  // the decision, so a delayed call cannot clear a newer committed incident.
  writeRecoveryStatus(record,id,expectedVersion){const captured=structuredClone(record);return write(async()=>{
   requireKind(captured,'status');if(captured.state!=='normal'||typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(id)||(expectedVersion!==null&&(typeof expectedVersion!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(expectedVersion))))throw new Error('invalid Arkiv recovery status');
   const previous=await upsert.latestStatus(captured.site,captured.chainId);
   if(previous&&previous.id===expectedVersion&&JSON.stringify(canonical(previous.record))===JSON.stringify(canonical(captured)))return upsert.write(captured,previous.id);
   // Bind a repeated same-hour normal state to its actual predecessor, so a
   // later incident followed by recovery is not mistaken for the first one.
   const transitionId=createHash('sha256').update(JSON.stringify(['recovery-status',id,expectedVersion])).digest('hex');
   return upsert.write(captured,transitionId,{recoverFrom:expectedVersion});
  });},
  renew:()=>serial(()=>renewal.renew()),
  async query({owner:requestedOwner}){if(requestedOwner!==owner)throw new Error('invalid Arkiv owner');return reader.query({owner});},
  readEntity:key=>entities.getEntity(key),
  async findIncidentByOperationId(operationId){const entity=await reader.findByOperationId({owner,operationId});if(entity&&entity.record.kind!=='incident')throw new Error('invalid incident operation');return entity;},
  currentBlock:entities.currentBlock,
  close(){if(!closing)closing=queue.then(()=>journalLocks.close());return closing;}
 };
 } catch(error) { await journalLocks.close(); throw error; }
}
