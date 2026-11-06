import { AnonRpcWorker } from "@anon-rpc/browser-extension-harness";

// The Sepolia specifier is taken from Dev2's pinned known-workers list. The
// harness fetches and hash-verifies its bundle before it runs in a sandbox.
const SPECIFIER="0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A";
const BOOTSTRAP_METHODS=new Set(["eth_chainId","eth_call","eth_getCode"]);
function httpsUrl(value){const url=new URL(value);if(url.protocol!=="https:"||url.username||url.password||url.hash||url.search)throw new Error("Invalid RPC endpoint");return url.toString();}
function rpcResponse(body,id){if(!body||typeof body!=="object"||Array.isArray(body)||body.jsonrpc!=="2.0"||body.id!==id||Object.hasOwn(body,"error")||!Object.hasOwn(body,"result"))throw new Error("Invalid RPC response");return body.result;}

export function createAnonEngine({fetchImpl=fetch,makeWorker=options=>new AnonRpcWorker(options)}={}){
 let worker=null,key=null,starting=null,nextId=0;
 async function bootstrap(url,method,params){
  if(!BOOTSTRAP_METHODS.has(method))throw new Error("Bootstrap method not allowed");
  const id=++nextId,response=await fetchImpl(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id,method,params:params??[]}),credentials:"omit",redirect:"error",signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error("Bootstrap unavailable");return rpcResponse(await response.json(),id);
 }
 async function getWorker(settings,network){
  const bootstrapUrl=httpsUrl(settings.anonBootstrapUrl),destination=httpsUrl(network==="arkiv"?settings.arkivRpcUrl:settings.anonRpcUrl);
  if(settings.anonWorkerId!=="nox")throw new Error("Unsupported anonymizing worker");
  const config=settings.anonWorkerConfig??null;
  if(config!==null&&(typeof config!=="object"||Array.isArray(config)||JSON.stringify(config).length>8192))throw new Error("Invalid worker configuration");
  const wanted=JSON.stringify([bootstrapUrl,config]);
  if(worker&&key===wanted)return {worker,destination};
  if(starting){await starting;if(worker&&key===wanted)return {worker,destination};}
  starting=(async()=>{
   if(await bootstrap(bootstrapUrl,"eth_chainId",[])!=="0xaa36a7")throw new Error("Unexpected bootstrap chain");
   worker?.close();worker=null;key=null;
   const candidate=makeWorker({address:SPECIFIER,config,preExisting:{rpcProvider:{request:({method,params})=>bootstrap(bootstrapUrl,method,params)}}});
   try{await candidate.ready;}catch(error){candidate.close();throw error;}
   worker=candidate;key=wanted;
  })();
  try{await starting;}finally{starting=null;}
  return {worker,destination};
 }
 async function request(settings,request,{signal}={}){
  const {worker:ready,destination}=await getWorker(settings,request.network),id=++nextId;
  if(signal?.aborted)throw new Error("Anonymized RPC timed out");
  const response=await ready.fetch(destination,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id,method:request.method,params:request.params??[]}),signal:signal??AbortSignal.timeout(1500)});
  if(!response.ok)throw new Error("Anonymized RPC unavailable");return rpcResponse(await response.json(),id);
 }
 return {request,close(){worker?.close();worker=null;key=null;}};
}
