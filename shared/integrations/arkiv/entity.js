import {decodeArkivPayload} from './rpc.js';
const address=/^0x[0-9a-f]{40}$/,key=/^0x[0-9a-f]{64}$/,quantity=/^0x(?:0|[1-9a-f][0-9a-f]*)$/;
const integer=value=>{if(typeof value!=='string'||!quantity.test(value))throw new Error('invalid Arkiv quantity');const n=Number(BigInt(value));if(!Number.isSafeInteger(n))throw new Error('invalid Arkiv quantity');return n;};
export function createArkivEntityReader({rpc,owner,schemaTag,chainId}) {
 if(typeof rpc!=='function'||typeof owner!=='string'||!address.test(owner)||typeof schemaTag!=='string'||!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(schemaTag)||!Number.isSafeInteger(chainId)||chainId<1)throw new Error('invalid Arkiv entity reader configuration');
 async function currentBlock(){return integer(await rpc('eth_blockNumber',[]));}
 async function getEntity(entityKey,{includeExpired=false}={}){
  if(typeof entityKey!=='string'||!key.test(entityKey))throw new Error('invalid Arkiv entity key');
  if(typeof includeExpired!=='boolean')throw new Error('invalid Arkiv entity read option');
  if(integer(await rpc('eth_chainId',[]))!==chainId)throw new Error('unexpected Arkiv chain');
  const row=await rpc('arkiv_getEntity',[entityKey]);if(row===null)return null;
  if(!row||row.key!==entityKey||typeof row.owner!=='string'||row.owner.toLowerCase()!==owner||!/^0x[0-9a-fA-F]{40}$/.test(row.owner))throw new Error('invalid Arkiv entity owner');
  const expiresAt=integer(row.expiresAt),block=await currentBlock();
  // Arkiv's JSON-RPC returns null for expired entities. Keep the explicit
  // option for adapters that can expose historical entities, but never claim
  // that a missing RPC result means an expired entity.
  if(expiresAt<=block&&!includeExpired)throw new Error('expired Arkiv entity');
  return {key:entityKey,owner,expiresAt,record:decodeArkivPayload(row.attributes,schemaTag)};
 }
 return {currentBlock,getEntity};
}
