import {decodeSnapshotBytes} from "../../packages/snapshot/src/digest.ts";
import {parseRootRecord,encodeRootRecord} from "../../packages/snapshot/src/root-record.ts";
import {readRootRecord,readAttestation} from "../../integrations/ens/src/resolver-client.ts";
import {createPublicClient,custom} from "viem";
import {sepolia} from "viem/chains";
import {normalizeSettings} from "./settings.mjs";

const MAX_BYTES=8*1024*1024,REFRESH_MS=5*60_000;
const textDecoder=new TextDecoder("utf-8",{fatal:true}),textEncoder=new TextEncoder();
const exact=(value,keys)=>value&&typeof value==="object"&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const rootKeys=["digest","epoch","network","schemaVersion","swarmRef"];
function validRoot(value){if(!exact(value,rootKeys))throw new Error("Invalid root");return parseRootRecord(encodeRootRecord(value));}
function scope(settings){
 if(!settings.ensRootName||!settings.ensResolver||settings.swarmGateways.length<2)throw new Error("Trust settings incomplete");
 return {chainId:settings.ensChainId,name:settings.ensRootName,resolver:settings.ensResolver,network:settings.network,recordKey:"bound.root.v1"};
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
 const selected=gateways.slice(0,2);if(new Set(selected.map(value=>new URL(value).origin)).size!==2)throw new Error("Independent gateways required");
 const responses=await Promise.all(selected.map(base=>fetchImpl(new URL(`bytes/${reference}`,base.endsWith("/")?base:base+"/").toString(),{credentials:"omit",redirect:"error",signal:AbortSignal.timeout(5000)}).then(bytesFrom)));
 if(responses[0].length!==responses[1].length||responses[0].some((value,index)=>value!==responses[1][index]))throw new Error("Gateway disagreement");return responses[0];
}
function checkSnapshot(root,bytes,anchor,now,{allowExpired=false}={}){
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
export function createTrustEngine({getSettings,storage,readRoot=defaultReadRoot,fetchImpl=fetch,now=Date.now,refreshMs=REFRESH_MS,anonymousRequest,readProtocolAttestation=readAttestation}){
 if(typeof getSettings!=="function"||!storage||typeof storage.get!=="function"||typeof storage.set!=="function"||typeof readRoot!=="function"||typeof fetchImpl!=="function"||typeof now!=="function"||!Number.isSafeInteger(refreshMs)||refreshMs<0)throw new Error("Invalid trust engine configuration");
 let queue=Promise.resolve();const issued=new WeakMap();
 const serial=fn=>{const result=queue.then(fn);queue=result.catch(()=>{});return result;};
 async function read(){
  const settings=normalizeSettings(await getSettings()),anchor=scope(settings),key=`bound.trust.v1:${JSON.stringify(anchor)}`,time=now();
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
   const bytes=await fetchSnapshot(settings.swarmGateways,root.swarmRef,fetchImpl),snapshot=checkSnapshot(root,bytes,anchor,time);
   const canonical=textDecoder.decode(bytes);await storage.set({[key]:{version:1,root,canonical,verifiedAt:time}});
   return issue({root,snapshot:decisionSnapshot(snapshot),sourceSnapshot:snapshot,cached:false,verifiedAt:time});
  }catch(error){if(cached&&Date.parse(cached.snapshot.expiresAt)>time)return asResult(cached);throw error;}
 }
 async function readVerifiedSnapshot(){const value=await serial(read);const anchor=scope(normalizeSettings(await getSettings()));if(issued.get(value)?.anchor!==JSON.stringify(anchor))throw new Error("Trust settings changed");return value;}
 async function readProtocolAttestationsViaAnonRpc({site,chain,verifiedSource}){
  if(!verifiedSource||!issued.has(verifiedSource)||typeof anonymousRequest!=="function")return [];
  const proof=issued.get(verifiedSource),anchor=scope(normalizeSettings(await getSettings()));if(proof.anchor!==JSON.stringify(anchor)||Date.parse(proof.snapshot.expiresAt)<=now())return [];
  const name=proof.snapshot.sites[site]?.[chain]?.attestation?.name;if(!name)return [];
  const network=await anonymousRequest({method:"eth_chainId",params:[]});if(network?.result!==`0x${anchor.chainId.toString(16)}`)return [];
  const client=createPublicClient({chain:sepolia,transport:custom({request:async({method,params})=>{const response=await anonymousRequest({method,params:params??[]});if(response?.error||!Object.hasOwn(response??{},"result"))throw new Error("Anonymous RPC unavailable");return response.result;}})});
  const attestation=await readProtocolAttestation(client,name);
  const expires=Date.parse(attestation.expiresAt);if(attestation.site!==site||!Number.isFinite(expires)||expires<=now())return [];
  if(Date.parse(proof.snapshot.expiresAt)<=now()||proof.anchor!==JSON.stringify(scope(normalizeSettings(await getSettings()))))return [];
  return (attestation.addresses[chain]??[]).map(address=>({address,site,chain}));
 }
 return {readVerifiedSnapshot,readProtocolAttestationsViaAnonRpc};
}
