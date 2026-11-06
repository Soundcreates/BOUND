import {importPublicKey,sealReport} from "../../integrations/report-crypto/index.mjs";
import {INTAKE_KEY} from "./score-settings.mjs";
import { validateObservation } from '../../packages/contracts/index.js';
const ADDRESS=/^0x[0-9a-f]{40}$/;
function endpoint(value){
 if(typeof value!=="string")throw new Error("Watcher endpoint is not configured");
 let url;try{url=new URL(value);}catch{throw new Error("Invalid watcher endpoint");}
 if((url.protocol!=="https:"&&!(url.protocol==="http:"&&["localhost","127.0.0.1","[::1]"].includes(url.hostname)))||url.username||url.password||url.search||url.hash||url.pathname!=="/v1/observations")throw new Error("Invalid watcher endpoint");
 return url.toString();
}
export function toIntakeEvent(record){
 if(!record||typeof record!=="object"||typeof record.site!=="string"||typeof record.chain!=="string"||typeof record.reporterKey!=="string"||!record.reporterKey||record.reporterKey.length>128)throw new Error("Invalid queued observation");
 if(!/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(record.chain))throw new Error("Invalid observation chain");
 let chainId;try{chainId=BigInt(record.chain);}catch{throw new Error("Invalid observation chain");}
 if(chainId<1n||chainId>BigInt(Number.MAX_SAFE_INTEGER))throw new Error("Invalid observation chain");
 let url;try{url=new URL(`https://${record.site}`);}catch{throw new Error("Invalid observation site");}
 if(url.host!==record.site||url.username||url.password||url.pathname!=="/"||url.search||url.hash)throw new Error("Invalid observation site");
 if(record.kind==="frontend"){
  const event={site:record.site,kind:"frontend",chainId:Number(chainId),reporterKey:record.reporterKey,path:record.path,hash:record.hash};
  if(!validateObservation(event))throw new Error("Invalid queued frontend observation");
  return event;
 }
 // A site-only warning cannot identify a counterparty for the watcher. Never
 // invent one; the local warning history still records the event.
 if(record.kind==="warned"&&record.value===undefined)return null;
 if(!ADDRESS.test(record.value)||!["observation","warned"].includes(record.kind)||(record.observationKind!==undefined&&(record.kind!=="observation"||record.observationKind!=="called-contract")))throw new Error("Invalid queued observation");
 return {site:record.site,kind:record.kind==="warned"?"warned":record.observationKind??"counterparty",value:record.value,chainId:Number(chainId),reporterKey:record.reporterKey};
}
export function encodeObservationBatch(records){
 if(!Array.isArray(records)||!records.length||records.length>100)throw new Error("Invalid observation batch count");
 const events=records.map(toIntakeEvent).filter(Boolean);
 const body=JSON.stringify({schemaVersion:1,events});
 if(new TextEncoder().encode(body).length>60000)throw new Error("Observation batch exceeds 60000 bytes");
 return body;
}
// Batches are sealed to the aggregator's pinned public key (HPKE, P-256). There is
// no plaintext fallback: without a key the batch stays queued and nothing is sent.
export function createWatcherSender({getConfig=storedSettings,fetchImpl=fetch,publicKey=null}={}){
 if(typeof getConfig!=="function"||typeof fetchImpl!=="function"||(publicKey!==null&&typeof publicKey!=="string"))throw new Error("Invalid watcher sender configuration");
 let imported=null;
 const key=()=>imported??=importPublicKey(publicKey).catch(error=>{imported=null;throw error;});
 return async(records,{signal}={})=>{
  if(!Array.isArray(records)||!records.length||records.length>100)throw new Error("Invalid observation batch");
  const body=encodeObservationBatch(records), events=JSON.parse(body).events; if(!events.length)return;
  if(!publicKey)throw new Error("Aggregator key not configured");
  const config=await getConfig(),url=endpoint(config?.watcherUrl);
  const envelope=await sealReport(await key(),{schemaVersion:1,events});
  const response=await fetchImpl(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(envelope),redirect:"error",credentials:"omit",signal});
  if(!response.ok)throw new Error("Watcher unavailable");
  const length=response.headers?.get?.("content-length");if(length!==null&&length!==undefined&&(!/^\d+$/.test(length)||Number(length)>4096))throw new Error("Watcher response too large");
  let payload;if(response.body?.getReader){
   const reader=response.body.getReader(),parts=[];let size=0;
   try{for(;;){const {done,value}=await reader.read();if(done)break;if(!(value instanceof Uint8Array)||(size+=value.length)>4096){await reader.cancel();throw new Error("Watcher response too large");}parts.push(value);}}finally{reader.releaseLock();}
   const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
   payload=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  }else payload=await response.json();
  if(!payload||typeof payload!=="object"||Array.isArray(payload)||Object.keys(payload).sort().join(",")!=="result,schemaVersion"||payload.schemaVersion!==1||payload.result!=="accepted")throw new Error("Watcher did not accept the batch");
 };
}
async function storedSettings(){const {boundSettings}=await chrome.storage.local.get("boundSettings");return boundSettings;}
// The aggregator's public key is pinned at build time; it is never read from settings.
const PINNED_KEY=INTAKE_KEY?.publicKey??null;
export async function isObservationConfigured(publicKey=PINNED_KEY){try{if(!publicKey)return false;await importPublicKey(publicKey);endpoint((await storedSettings())?.watcherUrl);return true;}catch{return false;}}
export const sendObservationBatch=createWatcherSender({publicKey:PINNED_KEY});
