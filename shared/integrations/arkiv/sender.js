import {createHash,randomUUID} from 'node:crypto';
import {open,readFile,rename,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {parseUniqueJSON,validateRecord} from '../../contracts/index.js';
const address=/^0x[0-9a-f]{40}$/,hash32=/^0x[0-9a-f]{64}$/,hex=/^0x(?:[0-9a-f]{2})+$/;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;
const fingerprint=record=>createHash('sha256').update(JSON.stringify(sort(record))).digest('hex');
const validEntry=e=>exact(e,['id','fingerprint','callData','rawTransaction','transactionHash','state'])&&typeof e.id==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(e.id)&&/^[0-9a-f]{64}$/.test(e.fingerprint)&&typeof e.callData==='string'&&hex.test(e.callData)&&typeof e.transactionHash==='string'&&hash32.test(e.transactionHash)&&['prepared','confirmed'].includes(e.state)&&(e.state==='prepared'?typeof e.rawTransaction==='string'&&hex.test(e.rawTransaction):e.rawTransaction===null);
async function persist(path,state){const temp=`${path}.${randomUUID()}.tmp`;let file;try{file=await open(temp,'wx',0o600);await file.writeFile(JSON.stringify(state),'utf8');await file.sync();await file.close();file=undefined;await rename(temp,path);const dir=await open(dirname(path),'r');try{await dir.sync();}finally{await dir.close();}}finally{if(file)await file.close();await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}}

// The supplied signer/decoder, codec, RPC and receipt reader are trusted adapters.
// Persist signed bytes before broadcasting so retries never create a new transaction.
export async function openArkivSender({path,owner,chainId,target,buildCall,prepare,inspect,hash,getChainId,broadcast,confirm,confirmTimeoutMs=0,confirmPollMs=1000}) {
 if(typeof path!=='string'||!path||typeof owner!=='string'||!address.test(owner)||typeof target!=='string'||!address.test(target)||!Number.isSafeInteger(chainId)||chainId<1||[buildCall,prepare,inspect,hash,getChainId,broadcast,confirm].some(fn=>typeof fn!=='function')||!Number.isSafeInteger(confirmTimeoutMs)||confirmTimeoutMs<0||confirmTimeoutMs>300000||!Number.isSafeInteger(confirmPollMs)||confirmPollMs<10||confirmPollMs>10000)throw new Error('invalid sender configuration');
 const config={owner,chainId,target};let state,missing=false;
 try{state=parseUniqueJSON(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT'){state={version:1,config,entries:[]};missing=true;}else throw new Error('invalid sender journal',{cause:error});}
 if(!exact(state,['version','config','entries'])||state.version!==1||!exact(state.config,['owner','chainId','target'])||state.config.owner!==owner||state.config.chainId!==chainId||state.config.target!==target||!Array.isArray(state.entries)||!state.entries.every(validEntry)||new Set(state.entries.map(e=>e.id)).size!==state.entries.length)throw new Error('invalid sender journal or configuration');
 if(missing)await persist(path,state);
 let queue=Promise.resolve(),uncertain=false;
 const serial=action=>{const result=queue.then(()=>{if(uncertain)throw new Error('sender journal uncertain; reopen required');return action();});queue=result.catch(()=>{});return result;};
 async function save(entries){const next={version:1,config,entries};if(JSON.stringify(next).length>1000000)throw new Error('sender journal full');try{await persist(path,next);state=next;}catch(error){uncertain=true;throw error;}}
 async function validateTransaction(raw,callData,txHash){
  if(typeof raw!=='string'||!hex.test(raw)||raw.length>262146||await hash(Buffer.from(raw.slice(2),'hex'))!==txHash)throw new Error('invalid signed transaction');
  const decoded=await inspect(raw);
  if(!decoded||decoded.from!==owner||decoded.to!==target||decoded.chainId!==chainId||decoded.value!=='0x0'||decoded.data!==callData)throw new Error('invalid signed transaction');
 }
 async function verifiedResult(result,entry,record,expectedKey){
  if(!result||result.state==='pending')return null;
  if(result.state==='reverted')throw new Error('Arkiv transaction reverted');
  const entity=result.entity;
  if(result.state!=='confirmed'||result.transactionHash!==entry.transactionHash||!Number.isSafeInteger(result.currentBlock)||result.currentBlock<0||!entity||typeof entity.key!=='string'||!hash32.test(entity.key)||(expectedKey!==undefined&&entity.key!==expectedKey)||entity.owner!==owner||!Number.isSafeInteger(entity.expiresAt)||entity.expiresAt<=result.currentBlock||!validateRecord(entity.record)||fingerprint(entity.record)!==entry.fingerprint||fingerprint(record)!==entry.fingerprint)throw new Error('unverified Arkiv readback');
  return {key:entity.key,owner:entity.owner,expiresAt:entity.expiresAt,record:structuredClone(entity.record)};
 }
 const write=(id,source,sourceContext={})=>{
  const record=structuredClone(source),context=structuredClone(sourceContext);
  return serial(async()=>{
  if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(id)||!validateRecord(record)||!context||typeof context!=='object'||Array.isArray(context)||Object.keys(context).some(key=>!['entityKey','extendBlocks'].includes(key))||(context.entityKey!==undefined&&(typeof context.entityKey!=='string'||!hash32.test(context.entityKey)))||(context.extendBlocks!==undefined&&(!context.entityKey||!Number.isSafeInteger(context.extendBlocks)||context.extendBlocks<1||context.extendBlocks>7884000)))throw new Error('invalid Arkiv write');
  if(await getChainId()!==chainId)throw new Error('unexpected Arkiv chain');
  const callData=await buildCall(structuredClone(record),id,structuredClone(context));
  if(typeof callData!=='string'||!hex.test(callData)||callData.length>262146)throw new Error('invalid Arkiv calldata');
  let index=state.entries.findIndex(e=>e.id===id),entry=state.entries[index];
  if(entry&&(entry.fingerprint!==fingerprint(record)||entry.callData!==callData))throw new Error('Arkiv operation id conflict');
  if(!entry){
   // A prepared transaction may not have reached the RPC. Creating a second
   // transaction after restart could reuse its nonce; reconcile it first.
   if(state.entries.some(item=>item.state==='prepared'))throw new Error('earlier Arkiv transaction pending; reconcile before a new operation');
   const raw=await prepare({owner,chainId,target,value:'0x0',data:callData});
   if(typeof raw!=='string'||!hex.test(raw)||raw.length>262146)throw new Error('invalid signed transaction');
   const transactionHash=await hash(Buffer.from(raw.slice(2),'hex'));
   if(typeof transactionHash!=='string'||!hash32.test(transactionHash))throw new Error('invalid signed transaction hash');
   await validateTransaction(raw,callData,transactionHash);
   entry={id,fingerprint:fingerprint(record),callData,rawTransaction:raw,transactionHash,state:'prepared'};
   await save([...state.entries,entry]);index=state.entries.length-1;
  }
  if(entry.state==='prepared')await validateTransaction(entry.rawTransaction,callData,entry.transactionHash);
  let result=await verifiedResult(await confirm(entry.transactionHash),entry,record,context.entityKey);
  if(!result && entry.state==='prepared'){
   try{await broadcast(entry.rawTransaction);}catch{/* ambiguous broadcast: reconcile this same transaction */}
   result=await verifiedResult(await confirm(entry.transactionHash),entry,record,context.entityKey);
   const deadline=Date.now()+confirmTimeoutMs;
   while(!result&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,Math.min(confirmPollMs,deadline-Date.now())));result=await verifiedResult(await confirm(entry.transactionHash),entry,record,context.entityKey);}
  }
  if(!result)throw new Error('Arkiv transaction pending');
  if(entry.state!=='confirmed'){const entries=state.entries.slice();entries[index]={...entry,rawTransaction:null,state:'confirmed'};await save(entries);}
  return result;
  });
 };
 const reconcileExisting=(id,source,expectedEntity,{allowRecordChanged=false}={})=>{
  const record=structuredClone(source),entity=structuredClone(expectedEntity);
  return serial(async()=>{
   const index=state.entries.findIndex(item=>item.id===id);
   if(index<0)return null;
   const entry=state.entries[index];
   if(entry.fingerprint!==fingerprint(record))throw new Error('Arkiv operation ID conflict');
   if(entry.state==='prepared')await validateTransaction(entry.rawTransaction,entry.callData,entry.transactionHash);
   const deadline=Date.now()+confirmTimeoutMs;
   const checked=async()=>{
    const confirmed=await confirm(entry.transactionHash);
    if(!allowRecordChanged)return verifiedResult(confirmed,entry,record,entity?.key);
    if(!confirmed||confirmed.state==='pending')return null;
    if(confirmed.state==='reverted')throw new Error('Arkiv transaction reverted');
    const current=confirmed.entity;
    if(confirmed.state!=='confirmed'||confirmed.transactionHash!==entry.transactionHash||!Number.isSafeInteger(confirmed.currentBlock)||!current||current.key!==entity?.key||current.owner!==owner||!Number.isSafeInteger(current.expiresAt)||current.expiresAt<=confirmed.currentBlock||!validateRecord(current.record))throw new Error('unverified Arkiv historical operation receipt');
    return {key:current.key,owner:current.owner,expiresAt:current.expiresAt,record:structuredClone(current.record)};
   };
   let result=await checked();
   while(!result&&Date.now()<deadline){await new Promise(resolve=>setTimeout(resolve,Math.min(confirmPollMs,deadline-Date.now())));result=await checked();}
   if(!result)throw new Error('Arkiv transaction pending');
   if(!entity||result.key!==entity.key||result.owner!==entity.owner||result.expiresAt!==entity.expiresAt||fingerprint(result.record)!==fingerprint(entity.record))throw new Error('Arkiv existing operation receipt mismatch');
   if(entry.state!=='confirmed'){const entries=state.entries.slice();entries[index]={...entry,rawTransaction:null,state:'confirmed'};await save(entries);}
   return result;
  });
 };
 // After a verified entity expires and is replaced, its receipt can no longer
 // be checked against a live entity. Only an already confirmed local entry may
 // be reconciled this way; prepared or absent entries remain unresolved.
 const assertConfirmed=(id,source)=>{const record=structuredClone(source);return serial(()=>{
  const entry=state.entries.find(item=>item.id===id);
  if(!entry||entry.state!=='confirmed'||entry.fingerprint!==fingerprint(record))throw new Error('historical Arkiv transaction not confirmed');
 });};
 const provenance=id=>serial(()=>{
  if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(id))throw new Error('invalid Arkiv operation id');
  const entry=state.entries.find(item=>item.id===id);return entry?entry.state:'absent';
 });
 const hasPending=()=>serial(()=>state.entries.some(item=>item.state==='prepared'));
 return {write,reconcileExisting,assertConfirmed,hasPending,provenance};
}
