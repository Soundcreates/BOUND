import {decodeSnapshotBytes} from "../../packages/snapshot/src/digest.ts";
import {parseRootRecord,encodeRootRecord,parseAttestation} from "../../packages/snapshot/src/root-record.ts";
import {readRootRecord,readAttestation} from "../../integrations/ens/src/resolver-client.ts";
import {createPublicClient,custom,toFunctionSelector} from "viem";
import {sepolia} from "viem/chains";
import {normalizeSettings} from "./settings.mjs";

const MAX_BYTES=8*1024*1024,REFRESH_MS=5*60_000;
const textDecoder=new TextDecoder("utf-8",{fatal:true}),textEncoder=new TextEncoder();
const exact=(value,keys)=>value&&typeof value==="object"&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const arkivRootKeys=["arkivKey","arkivOwner","digest","epoch","network","schemaVersion"];
const swarmRootKeys=["digest","epoch","network","schemaVersion","swarmRef"];
function validRoot(value){
 if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid root");
 if("swarmRef" in value){
  if(!exact(value,swarmRootKeys))throw new Error("Invalid root");
  return parseRootRecord(encodeRootRecord(value));
 }
 if(!exact(value,arkivRootKeys))throw new Error("Invalid root");
 return parseRootRecord(encodeRootRecord(value));
}
function scope(settings){
 if(!settings.ensRootName||!settings.ensResolver)throw new Error("Trust settings incomplete");
 if(settings.arkivRpcUrl){
  return {chainId:settings.ensChainId,name:settings.ensRootName,resolver:settings.ensResolver,network:settings.network,recordKey:"bound.root.v2"};
 }
 if(settings.swarmGateways&&settings.swarmGateways.length>=2){
  return {chainId:settings.ensChainId,name:settings.ensRootName,resolver:settings.ensResolver,network:settings.network,recordKey:"bound.root.v1"};
 }
 throw new Error("Trust settings incomplete");
}
// Audit logging. log(level,step,details) is a no-op unless the caller injects one
// (the extension does, in trust-adapter.mjs). Every value logged here is public
// on-chain data; no page URLs, wallet data or secrets are passed to it.
const noLog=()=>{};
const SELECTORS={[toFunctionSelector("findResolver(bytes)")]:"UniversalResolverV2.findResolver(bytes)",[toFunctionSelector("resolve(bytes,bytes)")]:"UniversalResolverV2.resolve(bytes,bytes)"};
function describeCall(method,params){
 if(method!=="eth_call")return {method};
 const call=params?.[0]??{},selector=typeof call.data==="string"?call.data.slice(0,10):null;
 return {method,to:call.to,selector,function:SELECTORS[selector]??"unknown",block:params?.[1]??"latest"};
}
async function bytesFrom(response){
 if(!response.ok)throw new Error("Gateway unavailable");const declared=response.headers?.get?.("content-length");
 if(declared!==null&&declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>MAX_BYTES))throw new Error("Snapshot too large");
 if(!response.body?.getReader){const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>MAX_BYTES)throw new Error("Snapshot too large");return bytes;}
 const reader=response.body.getReader(),parts=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;if(!(value instanceof Uint8Array)||(length+=value.length)>MAX_BYTES){await reader.cancel();throw new Error("Snapshot too large");}parts.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;
}
async function fetchSnapshot(gateways,reference,fetchImpl){
 const selected=gateways.slice(0,2);if(new Set(selected.map(value=>new URL(value).origin)).size!==2)throw new Error("At least two distinct gateway origins required");
 const results=await Promise.allSettled(selected.map(async url=>({url,bytes:await bytesFrom(await fetchImpl(`${url.replace(/\/+$/,"")}/bzz/${reference}/`,{headers:{accept:"application/octet-stream"}}))})));
 const successful=results.filter(value=>value.status==="fulfilled").map(value=>value.value);
 if(successful.length===0)throw new Error("All Swarm gateways failed");
 const referenceBytes=successful[0].bytes;
 for(let i=1;i<successful.length;i++){
  const other=successful[i].bytes;
  if(referenceBytes.length!==other.length||referenceBytes.some((byte,index)=>byte!==other[index]))throw new Error("Swarm gateways disagreed");
 }
 return referenceBytes;
}
function checkSnapshot(root,bytes,anchor,now,{allowExpired=false,log=noLog,context="live"}={}){
 if(!(bytes instanceof Uint8Array)||bytes.length===0||bytes.length>MAX_BYTES)throw new Error("Arkiv snapshot too large");
 let decoded;
 try{decoded=decodeSnapshotBytes(bytes);}
 catch(error){log("warn",`digest check (${context}): snapshot bytes rejected before hashing`,{reason:error.message,bytes:bytes.length});throw error;}
 const snapshot=decoded.snapshot;
 // decoded.digest is keccak256 recomputed here, locally, over the exact bytes
 // received. root.digest is the value read from the ENS text record.
 const match=decoded.digest===root.digest;
 log(match?"info":"warn",`digest check (${context}): ${match?"MATCH":"MISMATCH"}`,{ensRootDigest:root.digest,recomputedKeccak256:decoded.digest,bytesHashed:bytes.length,ensEpoch:root.epoch,snapshotEpoch:snapshot.epoch});
 if(decoded.digest!==root.digest||snapshot.epoch!==root.epoch||snapshot.network!==root.network||snapshot.network!==anchor.network||snapshot.rootName!==anchor.name||Date.parse(snapshot.generatedAt)>now||(!allowExpired&&Date.parse(snapshot.expiresAt)<=now))throw new Error("Snapshot verification failed");
 return snapshot;
}
function decisionSnapshot(snapshot){
 const sharedContracts=Object.fromEntries(Object.entries(snapshot.sharedContracts).map(([chain,value])=>[chain,value.contracts]));
 const sites=Object.fromEntries(Object.entries(snapshot.sites).map(([site,chains])=>[site,Object.fromEntries(Object.entries(chains).map(([chain,value])=>[chain,{trustedCounterparties:value.trustedCounterparties,trustedContracts:value.trustedContracts,deployers:value.deployers,source:"Verified curator snapshot"}]))]));
 return {schemaVersion:snapshot.schemaVersion,epoch:snapshot.epoch,generatedAt:snapshot.generatedAt,expiresAt:snapshot.expiresAt,network:snapshot.network,sharedContracts,sites};
}
async function defaultReadRoot(settings,anonymousRequest,log=noLog){
 if(typeof anonymousRequest!=="function")throw new Error("Anonymous ENS reads are unavailable");
 const client=createPublicClient({chain:sepolia,transport:custom({request:async({method,params})=>{
  const call=describeCall(method,params),started=Date.now();
  log("info","ENS RPC request (anonymous RPC)",call);
  const response=await anonymousRequest({method,params:params??[]});
  const elapsedMs=Date.now()-started;
  if(response?.error||!Object.hasOwn(response??{},"result")){log("warn","ENS RPC failed",{...call,elapsedMs,error:response?.error??"no result"});throw new Error("Anonymous ENS read unavailable");}
  const result=response.result;
  log("info","ENS RPC response",{...call,elapsedMs,resultBytes:typeof result==="string"&&result.startsWith("0x")?(result.length-2)/2:null,result:typeof result==="string"&&result.length<=80?result:undefined});
  return result;
 }})});
 if(await client.getChainId()!==settings.ensChainId)throw new Error("Unexpected ENS chain");
 return readRootRecord(client,{chainId:settings.ensChainId,rootName:settings.ensRootName,resolverAddress:settings.ensResolver});
}
// ensCache (optional): two-tier lookup cache from ens-cache.mjs. readEnsRecord
// (optional): watcher Arkiv ens_record lookup used only as unconfirmed fallback.
export function createTrustEngine({getSettings,storage,readRoot=defaultReadRoot,fetchImpl,now=Date.now,refreshMs=REFRESH_MS,anonymousRequest,readArkivSnapshot,readProtocolAttestation=readAttestation,ensCache=null,readEnsRecord=null,ensLiveTimeoutMs=1_200,log=noLog}){
 if(ensCache!==null&&typeof ensCache?.lookup!=="function")throw new Error("Invalid ENS cache");
 if(typeof log!=="function")throw new Error("Invalid trust engine logger");
 if(typeof getSettings!=="function"||!storage||typeof storage.get!=="function"||typeof storage.set!=="function"||typeof readRoot!=="function"||(typeof readArkivSnapshot!=="function"&&typeof fetchImpl!=="function"&&typeof defaultReadRoot!=="function")||typeof now!=="function"||!Number.isSafeInteger(refreshMs)||refreshMs<0)throw new Error("Invalid trust engine configuration");
 let queue=Promise.resolve(),activeRead=null;const issued=new WeakMap();
 const serial=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
 async function read(){
  const settings=normalizeSettings(await getSettings()),anchor=scope(settings),key=`bound.trust.v2:${JSON.stringify(anchor)}`,time=now();
  if(!Number.isSafeInteger(time)||time<0)throw new Error("Invalid trust clock");
  const saved=(await storage.get(key))[key];let cached=null;
  if(saved!==undefined){
   if(!exact(saved,["version","root","canonical","verifiedAt"])||saved.version!==1||typeof saved.canonical!=="string"||!Number.isSafeInteger(saved.verifiedAt)||saved.verifiedAt<0||saved.verifiedAt>time)throw new Error("Invalid trust cache");
   const root=validRoot(saved.root),snapshot=checkSnapshot(root,textEncoder.encode(saved.canonical),anchor,time,{allowExpired:true,log,context:"stored cache re-check"});
   cached={root,snapshot,canonical:saved.canonical,verifiedAt:saved.verifiedAt};
  }
  const issue=value=>{issued.set(value,{anchor:JSON.stringify(anchor),snapshot:structuredClone(value.sourceSnapshot)});return value;};
  const asResult=value=>issue({root:value.root,snapshot:decisionSnapshot(value.snapshot),sourceSnapshot:value.snapshot,cached:true,verifiedAt:value.verifiedAt});
  if(cached&&time-cached.verifiedAt<refreshMs&&Date.parse(cached.snapshot.expiresAt)>time){
   log("info","NO ENS QUERY: serving snapshot verified earlier (within refresh window)",{verifiedAt:new Date(cached.verifiedAt).toISOString(),ageSeconds:Math.round((time-cached.verifiedAt)/1000),refreshSeconds:Math.round(refreshMs/1000),ensRootDigest:cached.root.digest,epoch:cached.root.epoch});
   return asResult(cached);
  }
  try{
   const live=readRoot===defaultReadRoot;
   log("info","ENS root query start",{name:anchor.name,recordKey:anchor.recordKey,pinnedResolver:anchor.resolver,chainId:anchor.chainId,transport:live?"anonymous RPC (this engine queries ENS)":"injected readRoot (ENS read done by caller, not this engine)"});
   const root=validRoot(await (live?defaultReadRoot(settings,anonymousRequest,log):readRoot(settings)));
   log("info","ENS root record decoded",{name:anchor.name,recordKey:anchor.recordKey,...root});
   if(root.network!==anchor.network)throw new Error("Wrong network");
   if(cached&&(root.epoch<cached.root.epoch||(root.epoch===cached.root.epoch&&JSON.stringify(root)!==JSON.stringify(cached.root))))throw new Error("Snapshot rollback or equivocation");
   let bytes;
   if(root.swarmRef){
    const fetcher=fetchImpl??fetch;
    bytes=await fetchSnapshot(settings.swarmGateways,root.swarmRef,fetcher);
   }else if(root.arkivKey&&typeof readArkivSnapshot==="function"){
    const archived=await readArkivSnapshot({key:root.arkivKey,owner:root.arkivOwner});
    log("info","Arkiv snapshot entity fetched (pointer taken from ENS root)",{requestedKey:root.arkivKey,requestedOwner:root.arkivOwner,found:!!archived,key:archived?.key,owner:archived?.owner,kind:archived?.record?.kind,epoch:archived?.record?.epoch,arkivMetadataDigest:archived?.record?.digest,canonicalChars:typeof archived?.record?.canonical==="string"?archived.record.canonical.length:null});
    if(!archived||archived.key!==root.arkivKey||archived.owner!==root.arkivOwner||archived.record?.kind!=="trust_snapshot"||archived.record.digest!==root.digest||archived.record.epoch!==root.epoch||archived.record.network!==root.network||typeof archived.record.canonical!=="string")throw new Error("Arkiv snapshot entity does not match ENS root");
    bytes=textEncoder.encode(archived.record.canonical);
   }else{
    throw new Error("No snapshot reader available for root");
   }
   const snapshot=checkSnapshot(root,bytes,anchor,time,{log,context:"live ENS root vs snapshot bytes"});
   const canonical=textDecoder.decode(bytes);await storage.set({[key]:{version:1,root,canonical,verifiedAt:time}});
   log("info","trust snapshot VERIFIED from live read",{name:anchor.name,epoch:root.epoch,digest:root.digest,expiresAt:snapshot.expiresAt,sites:Object.keys(snapshot.sites).length});
   return issue({root,snapshot:decisionSnapshot(snapshot),sourceSnapshot:snapshot,cached:false,verifiedAt:time});
  }catch(error){
   if(cached&&Date.parse(cached.snapshot.expiresAt)>time){log("warn","live ENS/Arkiv verification FAILED; serving earlier verified snapshot",{reason:error.message,verifiedAt:new Date(cached.verifiedAt).toISOString(),epoch:cached.root.epoch,digest:cached.root.digest});return asResult(cached);}
   log("error","live ENS/Arkiv verification FAILED; no usable cached snapshot",{reason:error.message});
   throw error;
  }
 }
 async function readAttestationLive(anchor,name){
  const network=await anonymousRequest({method:"eth_chainId",params:[]});if(network?.result!==`0x${anchor.chainId.toString(16)}`)throw new Error("Unexpected ENS chain");
  let transportFailed=false;
  const client=createPublicClient({chain:sepolia,transport:custom({request:async({method,params})=>{const call={ensName:name,...describeCall(method,params)};log("info","ENS attestation RPC request (anonymous RPC)",call);let response;try{response=await anonymousRequest({method,params:params??[]});}catch(error){transportFailed=true;log("warn","ENS attestation RPC failed",{...call,error:error?.message});throw error;}if(response?.error||!Object.hasOwn(response??{},"result")){transportFailed=true;log("warn","ENS attestation RPC failed",{...call,error:response?.error??"no result"});throw new Error("Anonymous RPC unavailable");}log("info","ENS attestation RPC response",{...call,resultBytes:typeof response.result==="string"?(response.result.length-2)/2:null});return response.result;}})});
  try{return {value:await readProtocolAttestation(client,name)};}
  catch(error){if(transportFailed)throw error;log("info","ENS attestation: no valid record (live answer)",{ensName:name,reason:error?.message});return {value:null};}
 }
 function attestationFromArkiv(entry,name){
  if(!entry||entry.name!==name||typeof entry.records?.["bound.attest.v1"]!=="string")return null;
  const text=entry.records["bound.attest.v1"];if(text==="")return {value:null};
  try{return {value:parseAttestation(text)};}catch{return {value:null};}
 }
 async function readProtocolAttestations({site,chain,verifiedSource}){
  const none=source=>({rows:[],source});
  if(!verifiedSource||!issued.has(verifiedSource)||typeof anonymousRequest!=="function")return none("unavailable");
  const proof=issued.get(verifiedSource),anchor=scope(normalizeSettings(await getSettings()));if(proof.anchor!==JSON.stringify(anchor)||Date.parse(proof.snapshot.expiresAt)<=now())return none("unavailable");
  const name=proof.snapshot.sites[site]?.[chain]?.attestation?.name;if(!name)return none("not_configured");
  const lookup=ensCache
   ?await ensCache.lookup({key:JSON.stringify(["bound.attest.v1",anchor,name]),readLive:()=>readAttestationLive(anchor,name),readArkiv:async()=>typeof readEnsRecord==="function"?attestationFromArkiv(await readEnsRecord({site,chain}),name):null,timeoutMs:ensLiveTimeoutMs})
   :{source:"live",value:(await readAttestationLive(anchor,name)).value};
  log(lookup.source==="live"||lookup.source==="memory"?"info":"warn","protocol attestation lookup",{site,chain,ensName:name,source:lookup.source,meaning:{live:"read from ENS now via anonymous RPC",memory:"earlier live ENS read by this extension (L1 cache)",arkiv_unconfirmed:"watcher copy only; NOT ENS-proven, grants no trust",unavailable:"ENS read failed"}[lookup.source],inconsistent:!!lookup.inconsistent,addresses:lookup.value?.addresses?.[chain]??null});
  const result=rows=>({rows,source:lookup.source,...(lookup.inconsistent?{inconsistent:true}:{})});
  if(lookup.source!=="live"&&lookup.source!=="memory")return result([]);
  const attestation=lookup.value;if(!attestation)return result([]);
  const expires=Date.parse(attestation.expiresAt);if(attestation.site!==site||!Number.isFinite(expires)||expires<=now())return result([]);
  if(Date.parse(proof.snapshot.expiresAt)<=now()||proof.anchor!==JSON.stringify(scope(normalizeSettings(await getSettings()))))return result([]);
  return result((attestation.addresses[chain]??[]).map(address=>({address,site,chain})));
 }
 async function readProtocolAttestationsViaAnonRpc(query){return (await readProtocolAttestations(query)).rows;}
 return {
  readVerifiedSnapshot:()=>serial(()=>{if(!activeRead)activeRead=read().finally(()=>{activeRead=null;});return activeRead;}),
  readProtocolAttestations,
  readProtocolAttestationsViaAnonRpc
 };
}
