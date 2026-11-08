import {decodeArkivPayload} from './rpc.js';
const created='0xb282d7c494b8899aa8015cd07be621530beb03409eb8c5e8fdc1411ba64356a5';
const patched='0xe986ee220b2d7947a009d9389d8400b2ac82d3b430a9f72700a0975d3d5a34fe';
const extended='0x10dc3526654c9ba4e2370b1bfcbc0de087d141a5694b3d3305d37df7e6705d4b';
const addr=/^0x[0-9a-f]{40}$/,hash=/^0x[0-9a-f]{64}$/,quantity=/^0x(?:0|[1-9a-f][0-9a-f]*)$/;
const number=value=>{if(typeof value!=='string'||!quantity.test(value))throw new Error('invalid RPC quantity');const result=Number(BigInt(value));if(!Number.isSafeInteger(result))throw new Error('invalid RPC quantity');return result;};
const normalized=value=>typeof value==='string'&&/^0x[0-9a-fA-F]{40}$/.test(value)?value.toLowerCase():null;

// Checks a trusted RPC's receipt, canonical block, event and current entity metadata.
// A confirmation count reduces reorg risk but is not a cryptographic state proof.
export function createArkivConfirmation({rpc,owner,target,chainId,schemaTag,confirmations=2}) {
 if(typeof rpc!=='function'||typeof owner!=='string'||!addr.test(owner)||typeof target!=='string'||!addr.test(target)||!Number.isSafeInteger(chainId)||chainId<1||typeof schemaTag!=='string'||!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(schemaTag)||!Number.isSafeInteger(confirmations)||confirmations<1)throw new Error('invalid confirmation configuration');
 return async txHash=>{
  if(typeof txHash!=='string'||!hash.test(txHash))throw new Error('invalid transaction hash');
  if(number(await rpc('eth_chainId',[]))!==chainId)throw new Error('unexpected Arkiv chain');
  const receipt=await rpc('eth_getTransactionReceipt',[txHash]);
  if(receipt===null)return {state:'pending'};
  if(!receipt||receipt.transactionHash!==txHash||normalized(receipt.from)!==owner||normalized(receipt.to)!==target||!hash.test(receipt.blockHash)||!Array.isArray(receipt.logs))throw new Error('invalid transaction receipt');
  if(receipt.status==='0x0')return {state:'reverted'};
  if(receipt.status!=='0x1')throw new Error('invalid transaction status');
  const mined=number(receipt.blockNumber),currentBlock=number(await rpc('eth_blockNumber',[]));
  if(currentBlock<mined||currentBlock-mined+1<confirmations)return {state:'pending'};
  const block=await rpc('eth_getBlockByNumber',[receipt.blockNumber,false]);
  if(!block||block.hash!==receipt.blockHash)return {state:'pending'};
  const ownerTopic='0x'+'0'.repeat(24)+owner.slice(2);
  const events=receipt.logs.filter(log=>log&&normalized(log.address)===target&&Array.isArray(log.topics)&&[created,patched,extended].includes(log.topics[0])&&log.topics[2]===ownerTopic&&log.removed!==true);
  if(events.length!==1||events[0].topics.length!==3||typeof events[0].topics[1]!=='string'||!hash.test(events[0].topics[1]))throw new Error('invalid Arkiv entity event');
  const event=events[0],entityKey=event.topics[1];
  if(event.topics[0]===created && (typeof event.data!=='string'||!/^0x[0-9a-f]{128}$/.test(event.data)))throw new Error('invalid Arkiv creation event');
  if(event.topics[0]===patched && event.data!=='0x')throw new Error('invalid Arkiv patch event');
  if(event.topics[0]===extended && (typeof event.data!=='string'||!/^0x[0-9a-f]{64}$/.test(event.data)||BigInt(event.data)>0xffffffffffffffffn))throw new Error('invalid Arkiv extension event');
  const entity=await rpc('arkiv_getEntity',[entityKey]);
  if(!entity||entity.key!==entityKey||normalized(entity.owner)!==owner)throw new Error('invalid Arkiv entity owner');
  const expiresAt=number(entity.expiresAt);
  if(expiresAt<=currentBlock)throw new Error('expired Arkiv entity');
  if(event.topics[0]===created && BigInt('0x'+event.data.slice(2,66))!==BigInt(expiresAt))throw new Error('inconsistent Arkiv expiry');
  if(event.topics[0]===extended && BigInt(event.data)>BigInt(expiresAt))throw new Error('inconsistent Arkiv expiry');
  const record=decodeArkivPayload(entity.attributes,schemaTag);
  return {state:'confirmed',transactionHash:txHash,currentBlock,entity:{key:entityKey,owner,expiresAt,record}};
 };
}
