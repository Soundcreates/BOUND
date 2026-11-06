import {keccak256,toUtf8Bytes} from 'ethers';
import {ALREADY_SIGNED_METHODS,READ_ONLY_METHODS,parseUniqueJSON} from '../contracts/index.js';
import {canonicalizeJSON} from '../snapshot/index.js';

const readMethods=new Set([...READ_ONLY_METHODS,...ALREADY_SIGNED_METHODS]);
const freeze=value=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};
const cancel=()=>Object.assign(new Error('User rejected the request'),{code:4001});
export function captureRequest(input){
 const text=canonicalizeJSON(input);if(text.length>262144)throw new Error('request too large');
 const request=parseUniqueJSON(text);
 if(!request||typeof request!=='object'||Array.isArray(request)||typeof request.method!=='string'||request.method.length<1||request.method.length>128||(request.params!==undefined&&!Array.isArray(request.params)))throw new Error('invalid request');
 return {request:freeze(request),digest:keccak256(toUtf8Bytes(text))};
}
const validOrigin=value=>{try{const url=new URL(value);return url.origin===value&&url.protocol==='https:'&&!url.username&&!url.password;}catch{return false;}};

// Call only from the service worker with browser-derived sender/navigation data.
// UI decisions are accepted once from the exact extension window that was opened.
export function createPendingRequests({extensionOrigin,warningPath='/warning.html',openWindow,closeWindow=async()=>{},now=()=>Date.now(),randomId=()=>crypto.randomUUID(),ttlMs=120000}){
 if(typeof extensionOrigin!=='string'||!/^chrome-extension:\/\/[a-p]{32}$/.test(extensionOrigin)||typeof warningPath!=='string'||!/^\/[a-z0-9._/-]+$/.test(warningPath)||typeof openWindow!=='function'||typeof closeWindow!=='function'||typeof now!=='function'||typeof randomId!=='function'||!Number.isSafeInteger(ttlMs)||ttlMs<1000||ttlMs>300000)throw new Error('invalid pending-request configuration');
 const pending=new Map();
 async function open({request,tabId,frameId,documentId,topOrigin,frameOrigin,chainId,accounts,decision}){
  if(!Number.isSafeInteger(tabId)||tabId<0||!Number.isSafeInteger(frameId)||frameId<0||typeof documentId!=='string'||!documentId||!validOrigin(topOrigin)||!validOrigin(frameOrigin)||typeof chainId!=='string'||!/^0x[0-9a-f]+$/.test(chainId)||!Array.isArray(accounts)||accounts.some(a=>typeof a!=='string'||!/^0x[0-9a-f]{40}$/.test(a))||!decision||typeof decision!=='object')throw new Error('invalid browser context');
  const captured=captureRequest(request),id=randomId(),created=now();
  if(typeof id!=='string'||id.length<16||id.length>128||pending.has(id)||!Number.isSafeInteger(created))throw new Error('invalid pending request');
  const entry={id,...captured,tabId,frameId,documentId,topOrigin,frameOrigin,chainId,accounts:[...accounts],decision:structuredClone(decision),expiresAt:created+ttlMs,windowId:null};
  pending.set(id,entry);
  let windowId;try{windowId=await openWindow(id);}catch{pending.delete(id);throw new Error('warning window unavailable');}
  if(!Number.isSafeInteger(windowId)||windowId<0||!pending.has(id)){pending.delete(id);if(Number.isSafeInteger(windowId))await closeWindow(windowId);throw new Error('request invalidated');}
  entry.windowId=windowId;return {id,digest:entry.digest};
 }
 function matching(id,sender){
  const entry=pending.get(id),time=now();
  if(!entry||!Number.isSafeInteger(time)||time>=entry.expiresAt){if(entry)pending.delete(id);throw new Error('request expired or missing');}
  if(!sender||sender.url!==`${extensionOrigin}${warningPath}`||sender.windowId!==entry.windowId||entry.windowId===null)throw new Error('untrusted warning sender');
  return entry;
 }
 function details(id,sender){const entry=matching(id,sender);return structuredClone({id:entry.id,request:entry.request,topOrigin:entry.topOrigin,frameOrigin:entry.frameOrigin,chainId:entry.chainId,decision:entry.decision,expiresAt:entry.expiresAt});}
 function resolve(id,sender,{action,confirmation}={}){
  const entry=matching(id,sender);
  if(!['continue','cancel'].includes(action)||(action==='continue'&&entry.decision.verdict==='escalated'&&confirmation!=='CONTINUE'))throw new Error('invalid warning decision');
  pending.delete(id);
  return {action,tabId:entry.tabId,frameId:entry.frameId,documentId:entry.documentId,digest:entry.digest,chainId:entry.chainId,accounts:[...entry.accounts]};
 }
 function invalidate({tabId,frameId}={}){for(const [id,entry] of pending)if((tabId===undefined||entry.tabId===tabId)&&(frameId===undefined||entry.frameId===frameId)){pending.delete(id);if(entry.windowId!==null)void closeWindow(entry.windowId);}}
 return {open,details,resolve,invalidate};
}

// The decision callback is a trusted extension-controlled capability. A page
// message alone must never be passed to this function as an allow decision.
export function installProviderGate(provider,{decide,deadlineMs=120000}){
 if(!provider||typeof provider.request!=='function'||typeof decide!=='function'||!Number.isSafeInteger(deadlineMs)||deadlineMs<1||deadlineMs>300000)throw new Error('invalid provider gate');
 const originals=new Map(),request=provider.request,events=['chainChanged','accountsChanged','disconnect'];let generation=0;
 const onChange=()=>{generation++;};
 if(typeof provider.on==='function')for(const event of events)provider.on(event,onChange);
 async function gate(input){
  let captured;try{captured=captureRequest(input);}catch{throw cancel();}
  if(readMethods.has(captured.request.method))return request.call(provider,captured.request);
  const before=generation;
  let chain,accounts;
  try{[chain,accounts]=await Promise.all([request.call(provider,{method:'eth_chainId',params:[]}),request.call(provider,{method:'eth_accounts',params:[]})]);}catch{throw cancel();}
  if(before!==generation||typeof chain!=='string'||!/^0x[0-9a-fA-F]+$/.test(chain)||!Array.isArray(accounts)||accounts.some(value=>typeof value!=='string'||!/^0x[0-9a-fA-F]{40}$/.test(value)))throw cancel();
  chain=chain.toLowerCase();accounts=accounts.map(value=>value.toLowerCase());
  let timer;
  try{
   const decision=await Promise.race([Promise.resolve().then(()=>decide({request:captured.request,digest:captured.digest,chainId:chain,accounts:[...accounts]})),new Promise(resolve=>{timer=setTimeout(()=>resolve('cancel'),deadlineMs);})]);
   if(decision!=='continue'||before!==generation)throw cancel();
   const [afterChain,afterAccounts]=await Promise.all([request.call(provider,{method:'eth_chainId',params:[]}),request.call(provider,{method:'eth_accounts',params:[]})]);
   if(before!==generation||typeof afterChain!=='string'||afterChain.toLowerCase()!==chain||!Array.isArray(afterAccounts)||afterAccounts.map(value=>typeof value==='string'?value.toLowerCase():null).join(',')!==accounts.join(','))throw cancel();
   return await request.call(provider,captured.request);
  }finally{clearTimeout(timer);}
 }
 function legacy(first,second){
  if(typeof first==='string')return gate({method:first,params:second??[]});
  if(!first||typeof first!=='object')throw new TypeError('invalid legacy request');
  const payload=captureRequest(first).request,callback=typeof second==='function'?second:null;
  const work=gate({method:payload.method,params:payload.params??[]});
  if(!callback)return work;
  work.then(result=>callback(null,{jsonrpc:payload.jsonrpc??'2.0',id:payload.id??null,result}),error=>callback(error,null));
 }
 const replacements={request:gate};if(typeof provider.send==='function')replacements.send=legacy;if(typeof provider.sendAsync==='function')replacements.sendAsync=legacy;
 try{
  for(const [name,replacement] of Object.entries(replacements)){
   const descriptor=Object.getOwnPropertyDescriptor(provider,name);
   if(descriptor&&(!Object.hasOwn(descriptor,'value')||(!descriptor.writable&&!descriptor.configurable)))throw new Error('unpatchable provider');
   originals.set(name,descriptor);
   Object.defineProperty(provider,name,{value:replacement,writable:true,configurable:true,enumerable:descriptor?.enumerable??true});
  }
 }catch(error){for(const [name,descriptor] of originals){try{if(descriptor)Object.defineProperty(provider,name,descriptor);else delete provider[name];}catch{}}if(typeof provider.removeListener==='function')for(const event of events)provider.removeListener(event,onChange);throw error;}
 return {uninstall(){for(const [name,descriptor] of originals){if(descriptor)Object.defineProperty(provider,name,descriptor);else delete provider[name];}if(typeof provider.removeListener==='function')for(const event of events)provider.removeListener(event,onChange);}};
}
