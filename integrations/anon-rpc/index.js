import {keccak256} from 'ethers';
import {canonicalizeJSON} from '../../packages/snapshot/index.js';
import {parseUniqueJSON} from '../../packages/contracts/index.js';

const READS=new Set(['eth_chainId','eth_blockNumber','eth_call','eth_getCode','eth_getBalance','eth_getTransactionCount','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getBlockByNumber','eth_getBlockByHash','eth_getLogs','arkiv_query','arkiv_getEntity']);
const digest=/^0x[0-9a-f]{64}$/;

// The caller supplies a sandboxed, independently reviewed anonymizing worker.
// Hash matching establishes worker identity; it does not prove anonymity.
export async function createAnonRpcTransport({workerBytes,expectedHash,createWorker,hashBytes=keccak256,budgetMs=1500,maxConcurrent=16}){
 if(!(workerBytes instanceof Uint8Array)||workerBytes.length===0||workerBytes.length>5_000_000||typeof expectedHash!=='string'||!digest.test(expectedHash)||typeof createWorker!=='function'||typeof hashBytes!=='function'||!Number.isSafeInteger(budgetMs)||budgetMs<1||budgetMs>1500||!Number.isSafeInteger(maxConcurrent)||maxConcurrent<1||maxConcurrent>128)throw new Error('invalid Anon-RPC configuration');
 const bytes=new Uint8Array(workerBytes);
 if(await hashBytes(bytes)!==expectedHash)throw new Error('Anon-RPC worker hash mismatch');
 const worker=await createWorker(bytes);
 if(!worker||typeof worker.request!=='function'||typeof worker.close!=='function')throw new Error('invalid Anon-RPC worker');
 let closed=false,nextId=0;const pending=new Set();
 async function request(method,params){
  if(closed||pending.size>=maxConcurrent)return {status:'unavailable',result:null};
  if(typeof method!=='string'||!READS.has(method)||!Array.isArray(params))throw new Error('unsupported Anon-RPC request');
  const requestText=canonicalizeJSON({jsonrpc:'2.0',id:++nextId,method,params});
  if(requestText.length>32768||!Number.isSafeInteger(nextId))throw new Error('invalid Anon-RPC request');
  const payload=parseUniqueJSON(requestText),controller=new AbortController();pending.add(controller);
  let timer;
  try{
   const stopped=new Promise(resolve=>controller.signal.addEventListener('abort',()=>resolve({kind:closed?'closed':'timeout'}),{once:true}));
   timer=setTimeout(()=>controller.abort(),budgetMs);
   const task=Promise.resolve().then(()=>worker.request(payload,{signal:controller.signal})).then(value=>({kind:'response',value}),()=>({kind:'failure'}));
   const outcome=await Promise.race([task,stopped]);
   if(outcome.kind==='timeout')return {status:'timeout',result:null};
   if(outcome.kind!=='response')return {status:'unavailable',result:null};
   let response;try{const text=canonicalizeJSON(outcome.value);if(text.length>131072)throw Error();response=parseUniqueJSON(text);}catch{return {status:'unavailable',result:null};}
   if(!response||typeof response!=='object'||Array.isArray(response)||response.jsonrpc!=='2.0'||response.id!==payload.id||Object.hasOwn(response,'error')||!Object.hasOwn(response,'result')||Object.keys(response).some(key=>!['jsonrpc','id','result'].includes(key)))return {status:'unavailable',result:null};
   return {status:'ok',result:response.result};
  }finally{clearTimeout(timer);pending.delete(controller);}
 }
 async function close(){if(closed)return;closed=true;for(const controller of pending)controller.abort();await worker.close();}
 return {request,close,workerHash:expectedHash};
}
