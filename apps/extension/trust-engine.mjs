import {decodeSnapshotBytes} from "../../packages/snapshot/src/digest.ts";
import {parseRootRecord,encodeRootRecord,parseAttestation} from "../../packages/snapshot/src/root-record.ts";
import {readRootRecord,readAttestation} from "../../integrations/ens/src/resolver-client.ts";
import {createPublicClient,custom} from "viem";
import {sepolia} from "viem/chains";
import {normalizeSettings} from "./settings.mjs";

const MAX_BYTES=61_440,REFRESH_MS=5*60_000;
const textDecoder=new TextDecoder("utf-8",{fatal:true}),textEncoder=new TextEncoder();
const exact=(value,keys)=>value&&typeof value==="object"&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const rootKeys=["arkivKey","arkivOwner","digest","epoch","network","schemaVersion"];
function validRoot(value){if(!exact(value,rootKeys))throw new Error("Invalid root");return parseRootRecord(encodeRootRecord(value));}
function scope(settings){
 if(!settings.ensRootName||!settings.ensResolver||!settings.arkivRpcUrl)throw new Error("Trust settings incomplete");
 return {chainId:settings.ensChainId,name:settings.ensRootName,resolver:settings.ensResolver,network:settings.network,recordKey:"bound.root.v2"};
}
function checkSnapshot(root,bytes,anchor,now,{allowExpired=false}={}){
 if(!(bytes instanceof Uint8Array)||bytes.length===0||bytes.length>MAX_BYTES)throw new Error("Arkiv snapshot too large");
 const decoded=decodeSnapshotBytes(bytes),snapshot=decoded.snapshot;
 if(decoded.digest!==root.digest||snapshot.epoch!==root.epoch||snapshot.network!==root.network||snapshot.network!==anchor.network||snapshot.rootName!==anchor.name||Date.parse(snapshot.generatedAt)>now||(!allowExpired&&Date.parse(snapshot.expiresAt)<=now))throw new Error("Snapshot verification failed");
 return snapshot;
}
function decisionSnapshot(snapshot){
 const sharedContracts=Object.fromEntries(Object.entries(snapshot.sharedContracts).map(([chain,value])=>[chain,value.contracts]));
 const sites=Object.fromEntries(Object.entries(snapshot.sites).map(([site,chains])=>[site,Object.fromEntries(Object.entries(chains).map(([chain,value])=>[chain,{trustedCounterparties:value.trustedCounterparties,trustedContracts:value.trustedContracts,deployers:value.deployers,source:"Verified curator snapshot"}]))]));
 return {schemaVersion:snapshot.schemaVersion,epoch:snapshot.epoch,generatedAt:snapshot.generatedAt,expiresAt:snapshot.expiresAt,network:snapshot.network,sharedContracts,sites};
}
async function defaultReadRoot(settings,anonymousRequest){
 if(typeof anonymousRequest!=="function")throw new Error("Anonymous ENS reads are unavailable");
 const client=createPublicClient({chain:sepolia,transport:custom({request:async({method,params})=>{
  const response=await anonymousRequest({method,params:params??[]});
  if(response?.error||!Object.hasOwn(response??{},"result"))throw new Error("Anonymous ENS read unavailable");
  return response.result;
 }})});
 if(await client.getChainId()!==settings.ensChainId)throw new Error("Unexpected ENS chain");
 return readRootRecord(client,{chainId:settings.ensChainId,rootName:settings.ensRootName,resolverAddress:settings.ensResolver});
}
// ensCache (optional): two-tier lookup cache from ens-cache.mjs. readEnsRecord
// (optional): watcher Arkiv ens_record lookup used only as unconfirmed fallback.
export function createTrustEngine({getSettings,storage,readRoot=defaultReadRoot,now=Date.now,refreshMs=REFRESH_MS,anonymousRequest,readArkivSnapshot,readProtocolAttestation=readAttestation,ensCache=null,readEnsRecord=null,ensLiveTimeoutMs=1_200}){
 if(ensCache!==null&&typeof ensCache?.lookup!=="function")throw new Error("Invalid ENS cache");
 if(typeof getSettings!=="function"||!storage||typeof storage.get!=="function"||typeof storage.set!=="function"||typeof readRoot!=="function"||typeof readArkivSnapshot!=="function"||typeof now!=="function"||!Number.isSafeInteger(refreshMs)||refreshMs<0)throw new Error("Invalid trust engine configuration");
 let queue=Promise.resolve(),activeRead=null;const issued=new WeakMap();
 const serial=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
 async function read(){
  const settings=normalizeSettings(await getSettings()),anchor=scope(settings),key=`bound.trust.v2:${JSON.stringify(anchor)}`,time=now();
  if(!Number.isSafeInteger(time)||time<0)throw new Error("Invalid trust clock");
  const saved=(await storage.get(key))[key];let cached=null;
  if(saved!==undefined){
   if(!exact(saved,["version","root","canonical","verifiedAt"])||saved.version!==1||typeof saved.canonical!=="string"||!Number.isSafeInteger(saved.verifiedAt)||saved.verifiedAt<0||saved.verifiedAt>time)throw new Error("Invalid trust cache");
   const root=validRoot(saved.root),snapshot=checkSnapshot(root,textEncoder.encode(saved.canonical),anchor,time,{allowExpired:true});
   cached={root,snapshot,canonical:saved.canonical,verifiedAt:saved.verifiedAt};
  }
  const issue=value=>{issued.set(value,{anchor:JSON.stringify(anchor),snapshot:structuredClone(value.sourceSnapshot)});return value;};
  const asResult=value=>issue({root:value.root,snapshot:decisionSnapshot(value.snapshot),sourceSnapshot:value.snapshot,cached:true,verifiedAt:value.verifiedAt});
  if(cached&&time-cached.verifiedAt<refreshMs&&Date.parse(cached.snapshot.expiresAt)>time)return asResult(cached);
  try{
   const root=validRoot(await (readRoot===defaultReadRoot?defaultReadRoot(settings,anonymousRequest):readRoot(settings)));
   if(root.network!==anchor.network)throw new Error("Wrong network");
   if(cached&&(root.epoch<cached.root.epoch||(root.epoch===cached.root.epoch&&JSON.stringify(root)!==JSON.stringify(cached.root))))throw new Error("Snapshot rollback or equivocation");
   const archived=await readArkivSnapshot({key:root.arkivKey,owner:root.arkivOwner});
   if(!archived||archived.key!==root.arkivKey||archived.owner!==root.arkivOwner||archived.record?.kind!=="trust_snapshot"||archived.record.digest!==root.digest||archived.record.epoch!==root.epoch||archived.record.network!==root.network||typeof archived.record.canonical!=="string")throw new Error("Arkiv snapshot entity does not match ENS root");
   const bytes=textEncoder.encode(archived.record.canonical),snapshot=checkSnapshot(root,bytes,anchor,time);
   const canonical=textDecoder.decode(bytes);await storage.set({[key]:{version:1,root,canonical,verifiedAt:time}});
   return issue({root,snapshot:decisionSnapshot(snapshot),sourceSnapshot:snapshot,cached:false,verifiedAt:time});
  }catch(error){if(cached&&Date.parse(cached.snapshot.expiresAt)>time)return asResult(cached);throw error;}
 }
 async function readVerifiedSnapshot(){
  // A page-load refresh and an immediate wallet request should share the same
  // read instead of queueing duplicate anonymous bootstrap work.
  if(!activeRead)activeRead=serial(read);
  const pending=activeRead;
  let value;try{value=await pending;}finally{if(activeRead===pending)activeRead=null;}
  const anchor=scope(normalizeSettings(await getSettings()));if(issued.get(value)?.anchor!==JSON.stringify(anchor))throw new Error("Trust settings changed");return value;
 }
 // Live read of the protocol's own ENS attestation. Resolves {value} where value
 // is the parsed attestation, or null for a live "no valid record" answer; throws
 // when the anonymous transport failed, so an outage is never cached as absence.
 async function readAttestationLive(anchor,name){
  const network=await anonymousRequest({method:"eth_chainId",params:[]});if(network?.result!==`0x${anchor.chainId.toString(16)}`)throw new Error("Unexpected ENS chain");
  let transportFailed=false;
  const client=createPublicClient({chain:sepolia,transport:custom({request:async({method,params})=>{let response;try{response=await anonymousRequest({method,params:params??[]});}catch(error){transportFailed=true;throw error;}if(response?.error||!Object.hasOwn(response??{},"result")){transportFailed=true;throw new Error("Anonymous RPC unavailable");}return response.result;}})});
  try{return {value:await readProtocolAttestation(client,name)};}
  catch(error){if(transportFailed)throw error;return {value:null};}
 }
 function attestationFromArkiv(entry,name){
  if(!entry||entry.name!==name||typeof entry.records?.["bound.attest.v1"]!=="string")return null;
  const text=entry.records["bound.attest.v1"];if(text==="")return {value:null};
  try{return {value:parseAttestation(text)};}catch{return {value:null};}
 }
 // Returns {rows, source}. Only "live" and "memory" (an earlier live read by this
 // extension) may produce trust rows. "arkiv_unconfirmed" is watcher-asserted and
 // yields no rows; it is reported so the warning can say what was seen.
 async function readProtocolAttestations({site,chain,verifiedSource}){
  const none=source=>({rows:[],source});
  if(!verifiedSource||!issued.has(verifiedSource)||typeof anonymousRequest!=="function")return none("unavailable");
  const proof=issued.get(verifiedSource),anchor=scope(normalizeSettings(await getSettings()));if(proof.anchor!==JSON.stringify(anchor)||Date.parse(proof.snapshot.expiresAt)<=now())return none("unavailable");
  const name=proof.snapshot.sites[site]?.[chain]?.attestation?.name;if(!name)return none("not_configured");
  const lookup=ensCache
   ?await ensCache.lookup({key:JSON.stringify(["bound.attest.v1",anchor,name]),readLive:()=>readAttestationLive(anchor,name),readArkiv:async()=>typeof readEnsRecord==="function"?attestationFromArkiv(await readEnsRecord({site,chain}),name):null,timeoutMs:ensLiveTimeoutMs})
   :{source:"live",value:(await readAttestationLive(anchor,name)).value};
  const result=rows=>({rows,source:lookup.source,...(lookup.inconsistent?{inconsistent:true}:{})});
  if(lookup.source!=="live"&&lookup.source!=="memory")return result([]);
  const attestation=lookup.value;if(!attestation)return result([]);
  const expires=Date.parse(attestation.expiresAt);if(attestation.site!==site||!Number.isFinite(expires)||expires<=now())return result([]);
  if(Date.parse(proof.snapshot.expiresAt)<=now()||proof.anchor!==JSON.stringify(scope(normalizeSettings(await getSettings()))))return result([]);
  return result((attestation.addresses[chain]??[]).map(address=>({address,site,chain})));
 }
 async function readProtocolAttestationsViaAnonRpc(query){return (await readProtocolAttestations(query)).rows;}
 return {readVerifiedSnapshot,readProtocolAttestations,readProtocolAttestationsViaAnonRpc};
}
