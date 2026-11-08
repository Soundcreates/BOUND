import {keccak256} from 'ethers';
import {parseUniqueJSON} from '../../contracts/index.js';

const reference=/^[0-9a-f]{64}$/,digest=/^0x[0-9a-f]{64}$/;
function endpoint(value){
 let url;try{url=new URL(value);}catch{throw new Error('invalid Swarm endpoint');}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new Error('invalid Swarm endpoint');
 url.pathname=`${url.pathname.replace(/\/+$/,'')}/`;
 return url;
}
async function boundedBytes(response,limit){
 const header=response.headers?.get?.('content-length');
 if(header!==null&&header!==undefined&&(!/^\d+$/.test(header)||Number(header)>limit))throw new Error('Swarm response too large');
 if(!response.body?.getReader){const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>limit)throw new Error('Swarm response too large');return bytes;}
 const reader=response.body.getReader(),parts=[];let length=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;if(!(value instanceof Uint8Array)||(length+=value.length)>limit){await reader.cancel();throw new Error('Swarm response too large');}parts.push(value);}}
 finally{reader.releaseLock();}
 const result=new Uint8Array(length);let offset=0;for(const part of parts){result.set(part,offset);offset+=part.length;}return result;
}

// The digest is independently anchored in ENS or an incident record. A Swarm
// reference alone does not authenticate gateway responses.
export function createSwarmAdapter({uploadUrl,gatewayUrls,postageBatchId,fetchImpl=fetch,maxBytes=1_000_000,timeoutMs=10000}){
 const upload=endpoint(uploadUrl);
 if(!Array.isArray(gatewayUrls)||gatewayUrls.length<1||gatewayUrls.length>8||typeof postageBatchId!=='string'||!reference.test(postageBatchId)||typeof fetchImpl!=='function'||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>8_000_000||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw new Error('invalid Swarm configuration');
 const gateways=gatewayUrls.map(endpoint);
 async function request(url,options,limit){
  try{const response=await fetchImpl(url.toString(),{...options,redirect:'error',signal:AbortSignal.timeout(timeoutMs)});if(!response.ok)throw new Error('HTTP failure');return await boundedBytes(response,limit);}
  catch(error){if(error.message==='Swarm response too large')throw error;throw new Error('Swarm unavailable');}
 }
 async function put(source){
  if(!(source instanceof Uint8Array)||source.length===0||source.length>maxBytes)throw new Error('invalid Swarm payload');
  const bytes=new Uint8Array(source);
  const body=await request(new URL('bytes',upload),{method:'POST',headers:{'content-type':'application/octet-stream','swarm-postage-batch-id':postageBatchId},body:bytes},8192);
  let response;try{response=parseUniqueJSON(new TextDecoder('utf-8',{fatal:true}).decode(body));}catch{throw new Error('invalid Swarm upload response');}
  if(!response||typeof response!=='object'||Array.isArray(response)||Object.keys(response).length!==1||typeof response.reference!=='string'||!reference.test(response.reference))throw new Error('invalid Swarm upload response');
  return {reference:response.reference,digest:keccak256(bytes)};
 }
 async function getVerified(ref,expectedDigest,index=0){
  if(typeof ref!=='string'||!reference.test(ref)||typeof expectedDigest!=='string'||!digest.test(expectedDigest)||!Number.isSafeInteger(index)||index<0||index>=gateways.length)throw new Error('invalid Swarm reference or digest');
  const bytes=await request(new URL(`bytes/${ref}`,gateways[index]),{method:'GET'},maxBytes);
  if(keccak256(bytes)!==expectedDigest)throw new Error('Swarm digest mismatch');
  return bytes;
 }
 async function verifyIndependent(ref,expectedDigest){
  if(gateways.length<2||gateways[0].origin===gateways[1].origin)throw new Error('independent Swarm gateways required');
  const [first,second]=await Promise.all([getVerified(ref,expectedDigest,0),getVerified(ref,expectedDigest,1)]);
  if(first.length!==second.length||first.some((byte,index)=>byte!==second[index]))throw new Error('Swarm gateway mismatch');
  return first;
 }
 return {put,getVerified,verifyIndependent};
}
