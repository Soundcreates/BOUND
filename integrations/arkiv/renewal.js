import {createHash,randomUUID} from 'node:crypto';
import {open,readFile,rename,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {parseUniqueJSON,validateRecord} from '../../packages/contracts/index.js';
const keyPattern=/^0x[0-9a-f]{64}$/;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(key=>Object.hasOwn(v,key));
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const validRecord=record=>validateRecord(record)&&['baseline','status','ens_record','frontend'].includes(record.kind);
const operationId=item=>digest(['expiry-extension',item.key,item.expiry,item.lifetime,item.record]);
const validPending=item=>exact(item,['id','key','record','expiry','lifetime'])&&keyPattern.test(item.key)&&validRecord(item.record)&&Number.isSafeInteger(item.expiry)&&item.expiry>=0&&Number.isSafeInteger(item.lifetime)&&item.lifetime>0&&item.lifetime<=7884000&&item.id===operationId(item);
async function persist(path,state){const temporary=`${path}.${randomUUID()}.tmp`;let file;try{file=await open(temporary,'wx',0o600);await file.writeFile(JSON.stringify(state),'utf8');await file.sync();await file.close();file=undefined;await rename(temporary,path);const directory=await open(dirname(path),'r');try{await directory.sync();}finally{await directory.close();}}finally{if(file)await file.close();await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}}

// The caller serializes this component with all archive writes and holds its
// journal lock. Intent is persisted before sender signs or broadcasts.
export async function openExpiryRenewer({path,owner,currentBlock,getEntity,listCurrent,extend,hasPending,recordExtension,lifetimes,renewBeforeBlocks}){
 if(typeof path!=='string'||!path||typeof owner!=='string'||!/^0x[0-9a-f]{40}$/.test(owner)||[currentBlock,getEntity,listCurrent,extend,hasPending,recordExtension].some(fn=>typeof fn!=='function')||!lifetimes||!Number.isSafeInteger(renewBeforeBlocks)||renewBeforeBlocks<1||['baseline','status'].some(kind=>!Number.isSafeInteger(lifetimes[kind])||lifetimes[kind]<=renewBeforeBlocks||lifetimes[kind]>7884000))throw new Error('invalid expiry renewal configuration');
 let state;try{state=parseUniqueJSON(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')state={version:1,owner,pending:null};else throw new Error('invalid expiry renewal journal',{cause:error});}
 if(!exact(state,['version','owner','pending'])||state.version!==1||state.owner!==owner||(state.pending!==null&&!validPending(state.pending)))throw new Error('invalid expiry renewal journal');
 let uncertain=false;
 async function save(pending){if(uncertain)throw new Error('expiry renewal journal uncertain; reopen required');const next={version:1,owner,pending};try{await persist(path,next);state=next;}catch(error){uncertain=true;throw error;}}
 async function blockNumber(){const block=await currentBlock();if(!Number.isSafeInteger(block)||block<0)throw new Error('invalid Arkiv block');return block;}
 function verify(entity,item,block){
  if(!entity||entity.key!==item.key||entity.owner!==owner||!Number.isSafeInteger(entity.expiresAt)||entity.expiresAt<=block||!validRecord(entity.record)||digest(entity.record)!==digest(item.record))throw new Error('expiry renewal entity unavailable or changed');
 }
 async function resume(){
  if(uncertain)throw new Error('expiry renewal journal uncertain; reopen required');
  const item=state.pending;if(!item)return;
  const entity=await getEntity(item.key),block=await blockNumber();verify(entity,item,block);
  const result=await extend(structuredClone(item.record),item.id,item.key,item.lifetime);
  const after=await blockNumber();verify(result,item,after);
  if(result.expiresAt<=item.expiry)throw new Error('Arkiv expiry was not extended');
  await recordExtension(item.key,structuredClone(item.record),result.expiresAt);
  await save(null);
 }
 async function renew(){
  await resume();const items=await listCurrent();if(!Array.isArray(items))throw new Error('invalid registry listing');
  let unavailable=false;
  for(const item of items){
   if(!exact(item,['key','record'])||!keyPattern.test(item.key)||!validRecord(item.record))throw new Error('invalid registry entry');
   const block=await blockNumber();let entity;
   try{entity=await getEntity(item.key);verify(entity,item,block);}catch{unavailable=true;continue;}
   if(entity.expiresAt-block>renewBeforeBlocks)continue;
   const pendingSender=await hasPending();if(typeof pendingSender!=='boolean'||pendingSender)throw new Error('another Arkiv transaction is pending');
   const pending={key:item.key,record:structuredClone(item.record),expiry:entity.expiresAt,lifetime:lifetimes[item.record.kind] ?? (item.record.kind==='frontend' ? lifetimes.baseline : undefined)};pending.id=operationId(pending);
   await save(pending);await resume();
  }
  if(unavailable)throw new Error('one or more Arkiv entities could not be renewed');
 }
 return {resume,renew};
}
