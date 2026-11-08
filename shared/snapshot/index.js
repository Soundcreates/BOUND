import {ensNormalize,getAddress,keccak256} from 'ethers';
import {parseUniqueJSON,validateRoot,validateSnapshot,validateRootSnapshotPair} from '../contracts/index.js';

const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const validUnicode=value=>{
 for(let i=0;i<value.length;i++){
  const c=value.charCodeAt(i);
  if(c>=0xd800&&c<=0xdbff){const n=value.charCodeAt(++i);if(!(n>=0xdc00&&n<=0xdfff))return false;}
  else if(c>=0xdc00&&c<=0xdfff)return false;
 }
 return true;
};

// RFC 8785 ordering uses UTF-16 code units; JSON.stringify supplies ECMAScript
// number and string encoding. Only ordinary, accessor-free JSON is accepted.
export function canonicalizeJSON(input){
 const stack=new Set();
 function encode(value){
  if(value===null||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'){if(!Number.isFinite(value))throw new Error('invalid JSON number');return JSON.stringify(value);}
  if(typeof value==='string'){if(!validUnicode(value))throw new Error('invalid Unicode');return JSON.stringify(value);}
  if(!value||typeof value!=='object'||stack.has(value))throw new Error('invalid JSON value');
  stack.add(value);
  try{
   if(Array.isArray(value)){
    const keys=Reflect.ownKeys(value);
    if(keys.some(key=>typeof key==='symbol'||(key!=='length'&&!/^(0|[1-9][0-9]*)$/.test(key)))||keys.length!==value.length+1)throw new Error('invalid JSON array');
    const parts=[];
    for(let i=0;i<value.length;i++){const d=Object.getOwnPropertyDescriptor(value,String(i));if(!d||!Object.hasOwn(d,'value')||!d.enumerable)throw new Error('invalid JSON array');parts.push(encode(d.value));}
    return `[${parts.join(',')}]`;
   }
   const proto=Object.getPrototypeOf(value);
   if(proto!==Object.prototype&&proto!==null)throw new Error('invalid JSON object');
   const keys=Reflect.ownKeys(value);
   if(keys.some(key=>typeof key!=='string'||!validUnicode(key)))throw new Error('invalid JSON key');
   keys.sort();
   return `{${keys.map(key=>{const d=Object.getOwnPropertyDescriptor(value,key);if(!d||!Object.hasOwn(d,'value')||!d.enumerable)throw new Error('invalid JSON property');return `${JSON.stringify(key)}:${encode(d.value)}`;}).join(',')}}`;
  }finally{stack.delete(value);}
 }
 return encode(input);
}

export function compileSnapshot(input){
 const canonical=canonicalizeJSON(input),snapshot=parseUniqueJSON(canonical);
 if(!validateSnapshot(snapshot))throw new Error('invalid snapshot');
 const bytes=encoder.encode(canonical);
 return {snapshot,canonical,bytes,digest:keccak256(bytes)};
}

export function normalizeEnsScope(value){
 if(!exact(value,['chainId','name','resolver','recordKey'])||!Number.isSafeInteger(value.chainId)||value.chainId<1||typeof value.recordKey!=='string'||!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(value.recordKey))throw new Error('invalid ENS scope');
 let name,resolver;
 try{name=ensNormalize(value.name);resolver=getAddress(value.resolver).toLowerCase();}catch{throw new Error('invalid ENS scope');}
 if(!name||name!==value.name||resolver!==value.resolver)throw new Error('invalid ENS scope');
 return {chainId:value.chainId,name,resolver,recordKey:value.recordKey};
}
const cloneJSON=value=>parseUniqueJSON(canonicalizeJSON(value));
const freeze=value=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};
function readSnapshot(root,bytes,network){
 if(!validateRoot(root)||root.network!==network||!(bytes instanceof Uint8Array)||bytes.byteLength>1_000_000)throw new Error('invalid snapshot input');
 let text,snapshot;
 try{text=decoder.decode(bytes);snapshot=parseUniqueJSON(text);}catch{throw new Error('invalid snapshot bytes');}
 if(canonicalizeJSON(snapshot)!==text||!validateRootSnapshotPair(root,snapshot)||keccak256(bytes)!==root.digest)throw new Error('snapshot verification failed');
 return {text,snapshot};
}

// store.get/set must atomically persist one value per key. A single extension
// worker owns this verifier and serializes acceptance and cache reads.
export function createSnapshotVerifier({scope,network,store,now=()=>Date.now()}){
 const pinned=normalizeEnsScope(scope),storageKey=`bound.snapshot.v1:${canonicalizeJSON(pinned)}`;
 if(typeof network!=='string'||!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(network)||!store||typeof store.get!=='function'||typeof store.set!=='function'||typeof now!=='function')throw new Error('invalid snapshot verifier configuration');
 let queue=Promise.resolve();
 const serial=action=>{const result=queue.then(action);queue=result.catch(()=>{});return result;};
 const clock=()=>{const value=now();if(!Number.isSafeInteger(value)||value<0)throw new Error('invalid clock');return value;};
 async function load(){
  const state=await store.get(storageKey);
  if(state===null||state===undefined)return null;
  if(!exact(state,['version','scope','root','canonical'])||state.version!==1||canonicalizeJSON(normalizeEnsScope(state.scope))!==canonicalizeJSON(pinned)||typeof state.canonical!=='string')throw new Error('invalid snapshot cache');
  const root=cloneJSON(state.root),bytes=encoder.encode(state.canonical),parsed=readSnapshot(root,bytes,network);
  return {root,canonical:parsed.text,snapshot:parsed.snapshot};
 }
 async function accept(input){
  const root=cloneJSON(input?.root),source=normalizeEnsScope(input?.source);
  if(canonicalizeJSON(source)!==canonicalizeJSON(pinned))throw new Error('ENS scope mismatch');
  if(!(input?.bytes instanceof Uint8Array))throw new Error('invalid snapshot bytes');
  const bytes=new Uint8Array(input.bytes);
  return serial(async()=>{
   const parsed=readSnapshot(root,bytes,network),time=clock();
   if(Date.parse(parsed.snapshot.generatedAt)>time||Date.parse(parsed.snapshot.expiresAt)<=time)throw new Error('snapshot outside validity window');
   const prior=await load();
   if(prior&&(root.epoch<prior.root.epoch||(root.epoch===prior.root.epoch&&canonicalizeJSON(root)!==canonicalizeJSON(prior.root))))throw new Error('snapshot rollback or equivocation');
   await store.set(storageKey,{version:1,scope:cloneJSON(pinned),root:cloneJSON(root),canonical:parsed.text});
   return freeze({root:cloneJSON(root),snapshot:cloneJSON(parsed.snapshot),verifiedAt:time});
  });
 }
 function cached(){return serial(async()=>{const prior=await load();if(!prior)return null;const time=clock();if(Date.parse(prior.snapshot.generatedAt)>time||Date.parse(prior.snapshot.expiresAt)<=time)return null;return freeze({root:cloneJSON(prior.root),snapshot:cloneJSON(prior.snapshot),cached:true});});}
 return {accept,cached,storageKey};
}
