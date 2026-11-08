const ALLOWED=new Set(['eth_chainId','eth_blockNumber','eth_getTransactionReceipt','eth_getBlockByNumber','eth_sendRawTransaction','arkiv_getEntity']);
// Public watcher transport only. It must not be used as a direct per-site client fallback.
export function createArkivTransport({url,accessKey,fetchImpl=fetch,timeoutMs=10000}) {
 let endpoint;try{endpoint=new URL(url);}catch{throw new Error('invalid Arkiv RPC configuration');}
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||(accessKey!==undefined&&typeof accessKey!=='string')||typeof fetchImpl!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw new Error('invalid Arkiv RPC configuration');
 async function rpc(method,params){
  if(!ALLOWED.has(method)||!Array.isArray(params))throw new Error('unsupported Arkiv RPC method');
  let response,body;
  try{response=await fetchImpl(endpoint.toString(),{method:'POST',headers:{'content-type':'application/json',...(accessKey?{'x-api-key':accessKey}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(timeoutMs)});if(!response.ok)throw new Error();body=await response.json();}catch{throw new Error('Arkiv RPC unavailable');}
  if(!body||body.jsonrpc!=='2.0'||body.id!==1||body.error||!Object.hasOwn(body,'result'))throw new Error('Arkiv RPC request failed');
  return body.result;
 }
 return {rpc};
}
