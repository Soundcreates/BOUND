import {Transaction} from 'ethers';

// The writer key must be dedicated to this single archive process. Pending
// transactions are reconciled by the sender before another nonce is signed.
export function createArkivSigner({wallet,provider,owner,target,chainId}){
 if(!wallet||typeof wallet.signTransaction!=='function'||typeof wallet.address!=='string'||wallet.address.toLowerCase()!==owner||!/^0x[0-9a-f]{40}$/.test(owner)||!/^0x[0-9a-f]{40}$/.test(target)||!Number.isSafeInteger(chainId)||chainId<1||!provider||['getNetwork','getTransactionCount','estimateGas','getFeeData'].some(name=>typeof provider[name]!=='function'))throw new Error('invalid Arkiv signer configuration');
 let queue=Promise.resolve();
 function prepare(request){
  const result=queue.then(async()=>{
   if(!request||request.owner!==owner||request.target!==target||request.chainId!==chainId||request.value!=='0x0'||typeof request.data!=='string'||!/^0x(?:[0-9a-f]{2})+$/.test(request.data))throw new Error('transaction outside Arkiv signer scope');
   if(Number((await provider.getNetwork()).chainId)!==chainId)throw new Error('unexpected Arkiv chain');
   const [nonce,gas,fees]=await Promise.all([provider.getTransactionCount(owner,'pending'),provider.estimateGas({from:owner,to:target,value:0n,data:request.data}),provider.getFeeData()]);
   if(!Number.isSafeInteger(nonce)||nonce<0||typeof gas!=='bigint'||gas<=0n||!fees)throw new Error('invalid transaction parameters');
   const transaction={chainId,nonce,to:target,value:0n,data:request.data,gasLimit:(gas*120n+99n)/100n};
   if(typeof fees.maxFeePerGas==='bigint'&&typeof fees.maxPriorityFeePerGas==='bigint'&&fees.maxFeePerGas>=fees.maxPriorityFeePerGas&&fees.maxPriorityFeePerGas>=0n)Object.assign(transaction,{type:2,maxFeePerGas:fees.maxFeePerGas,maxPriorityFeePerGas:fees.maxPriorityFeePerGas});
   else if(typeof fees.gasPrice==='bigint'&&fees.gasPrice>0n)transaction.gasPrice=fees.gasPrice;
   else throw new Error('Arkiv transaction fees unavailable');
   return wallet.signTransaction(transaction);
  });queue=result.catch(()=>{});return result;
 }
 function inspect(raw){const tx=Transaction.from(raw);return {from:tx.from?.toLowerCase(),to:tx.to?.toLowerCase(),chainId:Number(tx.chainId),value:`0x${tx.value.toString(16)}`,data:tx.data};}
 return {prepare,inspect};
}
