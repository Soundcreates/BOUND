import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {Wallet,Transaction} from 'ethers';
import {createArkivSigner} from './signer.js';
const wallet=new Wallet('0x'+'12'.repeat(32)),owner=wallet.address.toLowerCase(),target='0x'+'34'.repeat(20),chainId=7794095;
const request={owner,target,chainId,value:'0x0',data:'0x1234'};
const provider={getNetwork:async()=>({chainId:BigInt(chainId)}),getTransactionCount:async()=>7,estimateGas:async()=>101n,getFeeData:async()=>({maxFeePerGas:20n,maxPriorityFeePerGas:2n})};
test('signer limits transactions to the configured writer and inspects the actual signature',async()=>{
 const signer=createArkivSigner({wallet,provider,owner,target,chainId});
 const raw=await signer.prepare(request),tx=Transaction.from(raw);
 assert.equal(tx.nonce,7);assert.equal(tx.gasLimit,122n);assert.equal(tx.chainId,BigInt(chainId));
 assert.deepEqual(signer.inspect(raw),{from:owner,to:target,chainId,value:'0x0',data:'0x1234'});
 await assert.rejects(signer.prepare({...request,target:owner}),/scope/);
});
test('signer fails closed on wrong network or unusable fee data',async()=>{
 const signer=createArkivSigner({wallet,provider:{...provider,getNetwork:async()=>({chainId:1n})},owner,target,chainId});
 await assert.rejects(signer.prepare(request),/chain/);
 const noFees=createArkivSigner({wallet,provider:{...provider,getFeeData:async()=>({})},owner,target,chainId});
 await assert.rejects(noFees.prepare(request),/fees/);
});
