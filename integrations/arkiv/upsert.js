import {createHash,randomUUID} from 'node:crypto';
import {open,readFile,rename,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {parseUniqueJSON,validateRecord} from '../../packages/contracts/index.js';
const address=/^0x[0-9a-f]{40}$/,key=/^0x[0-9a-f]{64}$/,idPattern=/^[a-zA-Z0-9_-]{1,128}$/;
const exact=(v,ks)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===ks.length&&ks.every(k=>Object.hasOwn(v,k));
const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;
const digest=v=>createHash('sha256').update(JSON.stringify(sort(v))).digest('hex');
const validRecord=r=>validateRecord(r)&&['baseline','status','ens_record'].includes(r.kind);
const scope=r=>JSON.stringify([r.kind,r.site,r.chainId]);
const oldKeys=['id','record','fingerprint','action','entityKey','resultKey','done'];
const validOperation=op=>exact(op,[...oldKeys,'expiresAt','rollover'])&&typeof op.id==='string'&&idPattern.test(op.id)&&validRecord(op.record)&&op.fingerprint===digest(op.record)&&['create','patch'].includes(op.action)&&(op.action==='create'?op.entityKey===null:typeof op.entityKey==='string'&&key.test(op.entityKey))&&typeof op.done==='boolean'&&(op.done?typeof op.resultKey==='string'&&key.test(op.resultKey):op.resultKey===null)&&(op.expiresAt===null||(op.done&&Number.isSafeInteger(op.expiresAt)&&op.expiresAt>=0))&&(op.rollover===null||(op.action==='create'&&exact(op.rollover,['previousKey','expiresAt','observedBlock'])&&key.test(op.rollover.previousKey)&&Number.isSafeInteger(op.rollover.expiresAt)&&op.rollover.expiresAt>=0&&Number.isSafeInteger(op.rollover.observedBlock)&&op.rollover.observedBlock>=op.rollover.expiresAt));
function validState(state,owner){
 if(!exact(state,['version','owner','operations'])||state.version!==2||state.owner!==owner||!Array.isArray(state.operations)||!state.operations.every(validOperation)||new Set(state.operations.map(op=>op.id)).size!==state.operations.length)return false;
 const last=new Map();
 for(const op of state.operations){const name=scope(op.record),previous=last.get(name);if(previous&&(!previous.done||(op.action==='patch'?(op.entityKey!==previous.resultKey||op.rollover!==null):(op.rollover===null||op.rollover.previousKey!==previous.resultKey))))return false;if(!previous&&(op.action!=='create'||op.rollover!==null))return false;last.set(name,op);}
 return true;
}
async function persist(path,state){const temp=`${path}.${randomUUID()}.tmp`;let file;try{file=await open(temp,'wx',0o600);await file.writeFile(JSON.stringify(state),'utf8');await file.sync();await file.close();file=undefined;await rename(temp,path);const dir=await open(dirname(path),'r');try{await dir.sync();}finally{await dir.close();}}finally{if(file)await file.close();await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}}
const statusRank=r=>r.state==='normal'?0:r.state==='drift'?1:r.incidentReference===null?2:3;

// One process owns this file and the watcher key. Adapters must be crash-safe and idempotent by operation ID.
export async function openArkivUpsert({path,owner,currentBlock,getEntity,create,patch,reconcileSuperseded=async()=>{}}) {
 if(typeof path!=='string'||!path||typeof owner!=='string'||!address.test(owner)||[currentBlock,getEntity,create,patch,reconcileSuperseded].some(f=>typeof f!=='function'))throw new Error('invalid upsert configuration');
 let state;try{state=parseUniqueJSON(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')state={version:2,owner,operations:[]};else throw new Error('invalid upsert journal',{cause:error});}
 if(exact(state,['version','owner','operations'])&&state.version===1&&Array.isArray(state.operations)&&state.operations.every(op=>exact(op,oldKeys))){state={...state,version:2,operations:state.operations.map(op=>({...op,expiresAt:null,rollover:null}))};}
 if(!validState(state,owner))throw new Error('invalid upsert journal');
 let queue=Promise.resolve(),uncertain=false;
 const serial=fn=>{const result=queue.then(()=>{if(uncertain)throw new Error('upsert journal uncertain; reopen required');return fn();});queue=result.catch(()=>{});return result;};
 async function save(operations){const next={version:2,owner,operations};if(!validState(next,owner)||JSON.stringify(next).length>1000000)throw new Error('invalid or full upsert journal');try{await persist(path,next);state=next;}catch(error){uncertain=true;throw error;}}
 async function verify(entity,record,expectedKey){
  const block=await currentBlock();
  if(!Number.isSafeInteger(block)||block<0||!entity||typeof entity.key!=='string'||!key.test(entity.key)||(expectedKey&&entity.key!==expectedKey)||entity.owner!==owner||!Number.isSafeInteger(entity.expiresAt)||entity.expiresAt<=block||!validRecord(entity.record)||digest(entity.record)!==digest(record))throw new Error('unverified Arkiv upsert readback');
  return structuredClone(entity);
 }
 async function execute(index){
  const op=state.operations[index];if(op.done)return;
  if(op.rollover){
   const previous=state.operations.slice(0,index).filter(item=>scope(item.record)===scope(op.record)).at(-1);
   if(!previous||!previous.done||previous.resultKey!==op.rollover.previousKey)throw new Error('invalid Arkiv rollover history');
   const entity=await getEntity(previous.resultKey,{includeExpired:true}),block=await currentBlock();
   if(!Number.isSafeInteger(block)||block<op.rollover.expiresAt)throw new Error('Arkiv rollover expiry no longer established');
   if(entity&&(entity.key!==previous.resultKey||entity.owner!==owner||!Number.isSafeInteger(entity.expiresAt)||entity.expiresAt<0||entity.expiresAt>block||!validRecord(entity.record)||digest(entity.record)!==previous.fingerprint))throw new Error('Arkiv rollover entity changed or is live');
  }
  const result=op.action==='create'?await create(structuredClone(op.record),op.id):await patch(structuredClone(op.record),op.id,op.entityKey);
  const entity=await verify(result,op.record,op.entityKey);
  if(op.rollover&&entity.key===op.rollover.previousKey)throw new Error('Arkiv rollover reused expired entity key');
  const operations=state.operations.slice();operations[index]={...op,resultKey:entity.key,expiresAt:entity.expiresAt,done:true};await save(operations);
 }
 const write=(source,id,{recoverFrom}={})=>{
  const record=structuredClone(source);
  return serial(async()=>{
  if(!validRecord(record)||typeof id!=='string'||!idPattern.test(id)||(recoverFrom!==undefined&&(record.kind!=='status'||record.state!=='normal'||(recoverFrom!==null&&(typeof recoverFrom!=='string'||!idPattern.test(recoverFrom))))))throw new Error('invalid Arkiv upsert');
  let prior=state.operations.find(op=>op.id===id);
  if(prior&&prior.fingerprint!==digest(record))throw new Error('Arkiv upsert operation conflict');
  const name=scope(record);
  const pending=state.operations.findIndex(op=>scope(op.record)===name&&!op.done);
  if(pending!==-1)await execute(pending);
  prior=state.operations.find(op=>op.id===id);
  const latest=state.operations.filter(op=>scope(op.record)===name&&op.done).at(-1);
  if(prior){
   if(latest.id!==id){const entity=await verify(await getEntity(latest.resultKey),latest.record,latest.resultKey);await reconcileSuperseded({operationId:id,record:structuredClone(prior.record),entity:structuredClone(entity),previousKey:prior.resultKey});return {state:'superseded',key:prior.resultKey};}
   const entity=await verify(await getEntity(prior.resultKey),record,prior.resultKey);return {state:'current',...entity};
  }
  if(recoverFrom!==undefined&&(latest?.id??null)!==recoverFrom)throw new Error('stale status recovery');
  let rollover=null;
  if(latest){
   if(record.kind==='status'){
    const now=Date.parse(record.updatedAt),previous=Date.parse(latest.record.updatedAt);
    const recovery=record.state==='normal'&&latest.record.state!=='normal'&&recoverFrom===latest.id;
    if(now<previous||(now===previous&&statusRank(record)<statusRank(latest.record)&&!recovery)||(now===previous&&statusRank(record)===statusRank(latest.record)&&digest(record)!==latest.fingerprint))throw new Error('stale status');
   }
   if(record.kind==='ens_record'&&Date.parse(record.resolvedAt)<Date.parse(latest.record.resolvedAt))throw new Error('stale ENS cache record');
   const entity=await getEntity(latest.resultKey,{includeExpired:true});
   const block=await currentBlock();if(!Number.isSafeInteger(block)||block<0)throw new Error('invalid Arkiv block');
   if(entity){
    if(entity.key!==latest.resultKey||entity.owner!==owner||!Number.isSafeInteger(entity.expiresAt)||entity.expiresAt<0||!validRecord(entity.record)||digest(entity.record)!==latest.fingerprint)throw new Error('unverified Arkiv upsert readback');
    if(entity.expiresAt<=block)rollover={previousKey:latest.resultKey,expiresAt:entity.expiresAt,observedBlock:block};
   }else{
    if(latest.expiresAt===null||latest.expiresAt>block)throw new Error('missing Arkiv entity without verified expiry');
    rollover={previousKey:latest.resultKey,expiresAt:latest.expiresAt,observedBlock:block};
   }
  }
  const op={id,record,fingerprint:digest(record),action:latest&&!rollover?'patch':'create',entityKey:latest&&!rollover?latest.resultKey:null,resultKey:null,done:false,expiresAt:null,rollover};
  await save([...state.operations,op]);await execute(state.operations.length-1);
  const finished=state.operations.at(-1);return {state:'current',...(await verify(await getEntity(finished.resultKey),record,finished.resultKey))};
  });
 };
 const listCurrent=()=>serial(()=>{
  const latest=new Map();for(const op of state.operations)latest.set(scope(op.record),op);
  return [...latest.values()].filter(op=>op.done).map(op=>({key:op.resultKey,record:structuredClone(op.record)}));
 });
 const latestStatus=(site,chainId)=>serial(()=>{
  const found=state.operations.filter(op=>op.done&&op.record.kind==='status'&&op.record.site===site&&op.record.chainId===chainId).at(-1);
  return found?{id:found.id,record:structuredClone(found.record)}:null;
 });
 const recordExtension=(entityKey,source,expiresAt)=>{const record=structuredClone(source);return serial(async()=>{
  if(typeof entityKey!=='string'||!key.test(entityKey)||!validRecord(record)||!Number.isSafeInteger(expiresAt)||expiresAt<0)throw new Error('invalid Arkiv expiry update');
  const name=scope(record),index=state.operations.findLastIndex(op=>scope(op.record)===name),op=state.operations[index];
  if(!op||!op.done||op.resultKey!==entityKey||op.fingerprint!==digest(record)||(op.expiresAt!==null&&expiresAt<op.expiresAt))throw new Error('Arkiv expiry update conflicts with registry');
  if(op.expiresAt===expiresAt)return;
  const operations=state.operations.slice();operations[index]={...op,expiresAt};await save(operations);
 });};
 return {write,listCurrent,latestStatus,recordExtension};
}
