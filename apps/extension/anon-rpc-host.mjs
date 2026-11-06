const READS=new Set(["eth_chainId","eth_call","eth_getBalance","eth_getCode","eth_getStorageAt","eth_getTransactionCount","eth_getBlockByNumber","eth_getBlockByHash","eth_getTransactionReceipt","eth_getLogs","eth_getProof"]);
const ARKIV_READS=new Set(["eth_chainId","eth_blockNumber","arkiv_query"]);
export function createAnonRpcHost({getSettings,loadEngine,timeoutMs=1500}){
 if(typeof getSettings!=="function"||typeof loadEngine!=="function"||!Number.isSafeInteger(timeoutMs)||timeoutMs<1)throw new Error("Invalid anonymizing RPC host");
 let engine,loading;
 return async request=>{
  if(!request||typeof request.method!=="string"||!(request.network===undefined?READS:request.network==="arkiv"?ARKIV_READS:new Set()).has(request.method))return {error:"method_not_allowed"};
  if(request.params!==undefined&&!Array.isArray(request.params))return {error:"invalid_request"};
  let size;try{size=new TextEncoder().encode(JSON.stringify(request)).length;}catch{return {error:"invalid_request"};}
  if(size>262144)return {error:"invalid_request"};
  const settings=await Promise.resolve().then(getSettings).catch(()=>null);
  if(!settings?.anonBootstrapUrl||!settings?.anonRpcUrl||settings.anonWorkerId!=="nox"||(request.network==="arkiv"&&!settings.arkivRpcUrl))return {error:"anon_rpc_not_configured"};
  let timer;const controller=new AbortController();
  try{
   const result=await Promise.race([
    Promise.resolve().then(async()=>{if(!engine){loading??=Promise.resolve().then(loadEngine).finally(()=>{loading=null;});engine=await loading;}if(controller.signal.aborted)throw new Error("timeout");return engine.request(settings,structuredClone(request),{signal:controller.signal});}),
    new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error("timeout"));},timeoutMs);})
   ]);
   return {result};
  }catch{return {error:"anon_rpc_unavailable"};}finally{clearTimeout(timer);}
 };
}
export const anonRpc=createAnonRpcHost({getSettings:async()=>{const {boundSettings}=await chrome.storage.local.get("boundSettings");return boundSettings;},loadEngine:async()=>{const {createAnonEngine}=await import("./anon-rpc-bundle.js");return createAnonEngine();}});
