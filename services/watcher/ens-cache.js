import {createHash} from 'node:crypto';
import {ENS_CACHE_KEYS,validateRecord} from '../../packages/contracts/index.js';

const ADDRESS=/^0x[0-9a-f]{40}$/;
const HOUR=3600000;

// Mirrors curated ENS text records into watcher-owned Arkiv `ens_record`
// entities. The extension treats these as an availability/display cache only:
// a value that is not confirmed by a live ENS read never grants trust.
// The site-to-name mapping comes from configuration (curator-verified), never DNS.
export function createEnsCachePublisher({entries,readText,writeEnsRecord,now=Date.now,keys=ENS_CACHE_KEYS}){
 if(!Array.isArray(entries)||!entries.length||typeof readText!=='function'||typeof writeEnsRecord!=='function'||typeof now!=='function'||!Array.isArray(keys)||!keys.length||keys.some(key=>!ENS_CACHE_KEYS.includes(key)))throw new Error('invalid ENS cache configuration');
 const scopes=new Set();
 const pinned=entries.map(entry=>{
  if(!entry||typeof entry!=='object'||typeof entry.site!=='string'||!Number.isSafeInteger(entry.chainId)||entry.chainId<1||typeof entry.name!=='string'||typeof entry.resolver!=='string'||!ADDRESS.test(entry.resolver))throw new Error('invalid ENS cache entry');
  const scope=JSON.stringify([entry.site,entry.chainId]);if(scopes.has(scope))throw new Error('duplicate ENS cache entry');scopes.add(scope);
  return {site:entry.site,chainId:entry.chainId,name:entry.name,resolver:entry.resolver};
 });
 const published=new Map();
 async function publish(){
  const time=now();if(!Number.isSafeInteger(time)||time<0||time>8640000000000000)throw new Error('invalid ENS cache clock');
  const resolvedAt=new Date(Math.floor(time/HOUR)*HOUR).toISOString(),results=[];
  for(const entry of pinned){
   try{
    const records={};
    // All keys or nothing: a partial read must not overwrite a complete record.
    for(const recordKey of keys){
     const text=await readText({name:entry.name,resolver:entry.resolver,recordKey});
     if(typeof text!=='string')throw new Error('invalid ENS text');
     records[recordKey]=text;
    }
    const record={schemaVersion:1,kind:'ens_record',site:entry.site,chainId:entry.chainId,name:entry.name,resolver:entry.resolver,records,resolvedAt};
    if(!validateRecord(record))throw new Error('invalid ENS cache record');
    const id=createHash('sha256').update(JSON.stringify(['ens-cache-v1',record])).digest('hex');
    const scope=JSON.stringify([entry.site,entry.chainId]);
    if(published.get(scope)===id){results.push({site:entry.site,chainId:entry.chainId,state:'unchanged'});continue;}
    const result=await writeEnsRecord(record,id);
    if(result?.state!=='current')throw new Error('ENS cache record superseded or unverified');
    published.set(scope,id);results.push({site:entry.site,chainId:entry.chainId,state:'written'});
   }catch{results.push({site:entry.site,chainId:entry.chainId,state:'failed'});}
  }
  return results;
 }
 return {publish};
}

// Minimal JSON-RPC transport for watcher-side ENS reads (server traffic for
// curated names only; this is not a client privacy path).
export function createJsonRpc({url,fetchImpl=fetch,timeoutMs=10000}){
 let parsed;try{parsed=new URL(url);}catch{throw new Error('invalid ENS RPC URL');}
 if(parsed.protocol!=='https:'||parsed.username||parsed.password||typeof fetchImpl!=='function')throw new Error('invalid ENS RPC URL');
 let id=0;
 return async(method,params)=>{
  const requestId=++id;
  const response=await fetchImpl(parsed.toString(),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:requestId,method,params}),redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
  if(!response.ok)throw new Error('ENS RPC unavailable');
  const body=await response.json();
  if(!body||body.jsonrpc!=='2.0'||body.id!==requestId||Object.hasOwn(body,'error')||!Object.hasOwn(body,'result'))throw new Error('invalid ENS RPC response');
  return body.result;
 };
}
