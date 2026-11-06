#!/usr/bin/env node
// Resumable ENSv2 Sepolia registration. The secret is private local state, not a wallet key.
import {mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';
import {getAddress, isAddress, parseAbi, zeroAddress} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {ENSV2_SEPOLIA, ethRegistrarAbi, makePublicClient, makeWalletClient, isLabelAvailable, registerPrice, commitRegistration, finishRegistration, findResolver} from '@bound/integrations-ens';

const [operation,label]=process.argv.slice(2);
if(!['prepare','status','commit','register'].includes(operation)||!label||process.argv.length!==4||!/^[a-z0-9](?:[a-z0-9-]{1,60}[a-z0-9])$/.test(label))throw new Error('Usage: node --env-file=.env --experimental-strip-types scripts/ens/register-name.mjs prepare|status|commit|register <lowercase-label-without-.eth>');
const rpc=process.env.BOUND_SEPOLIA_RPC_URL;
if(!rpc)throw new Error('Set BOUND_SEPOLIA_RPC_URL in your local .env');
const client=makePublicClient(rpc), directory=resolve('.bound/ens-registration'),path=resolve(directory,`${label}.json`);
const erc20=parseAbi(['function balanceOf(address) view returns (uint256)','function allowance(address,address) view returns (uint256)']);
const clean=(key)=>typeof key==='string'&&/^(?:0x)?[0-9a-fA-F]{64}$/.test(key)?(key.startsWith('0x')?key:`0x${key}`):null;
const ownerKey=clean(process.env.BOUND_OWNER_PRIVATE_KEY);
const account=ownerKey?privateKeyToAccount(ownerKey):null;
const addr=(value,name)=>{if(!value||!isAddress(value)||getAddress(value)===zeroAddress)throw new Error(`Set ${name} to a nonzero address`);return getAddress(value);};
const chain=await client.getChainId();
if(chain!==11155111)throw new Error('Refusing: RPC is not Sepolia');
const registrarCode=await client.getCode({address:ENSV2_SEPOLIA.ethRegistrar});
if(!registrarCode||registrarCode==='0x')throw new Error('ENSv2 registrar has no code on this RPC');

async function save(state){
 const temp=`${path}.${randomBytes(6).toString('hex')}.tmp`;
 await writeFile(temp,JSON.stringify(state,null,2)+'\n',{mode:0o600,flag:'wx'});
 await rename(temp,path);
}
async function load(){
 const state=JSON.parse(await readFile(path,'utf8'));
 if(state.version!==1||state.label!==label||state.chainId!==11155111||!/^0x[0-9a-f]{64}$/.test(state.secret)||!isAddress(state.owner)||!isAddress(state.resolver)||!isAddress(state.paymentToken)||!/^\d+$/.test(state.durationSeconds))throw new Error('Invalid registration state');
 return state;
}
function params(state){return {label,owner:state.owner,secret:state.secret,subregistry:zeroAddress,resolver:state.resolver,durationSeconds:BigInt(state.durationSeconds),paymentToken:state.paymentToken,referrer:`0x${'00'.repeat(32)}`};}
async function commitment(state){const p=params(state);return client.readContract({address:ENSV2_SEPOLIA.ethRegistrar,abi:ethRegistrarAbi,functionName:'makeCommitment',args:[p.label,p.owner,p.secret,p.subregistry,p.resolver,p.durationSeconds,p.referrer]});}
async function timing(state){
 const id=await commitment(state);
 const [at,min,max,block]=await Promise.all([
  client.readContract({address:ENSV2_SEPOLIA.ethRegistrar,abi:ethRegistrarAbi,functionName:'commitmentAt',args:[id]}),
  client.readContract({address:ENSV2_SEPOLIA.ethRegistrar,abi:ethRegistrarAbi,functionName:'MIN_COMMITMENT_AGE'}),
  client.readContract({address:ENSV2_SEPOLIA.ethRegistrar,abi:ethRegistrarAbi,functionName:'MAX_COMMITMENT_AGE'}),client.getBlock()]);
 return {id,at,min,max,now:block.timestamp};
}
async function payment(state){
 const duration=BigInt(state.durationSeconds),price=await registerPrice(client,label,duration,state.paymentToken);
 const [balance,allowance]=await Promise.all([
  client.readContract({address:state.paymentToken,abi:erc20,functionName:'balanceOf',args:[state.owner]}),
  client.readContract({address:state.paymentToken,abi:erc20,functionName:'allowance',args:[state.owner,ENSV2_SEPOLIA.ethRegistrar]})]);
 return {price,balance,allowance};
}
function writer(state){if(!account||account.address.toLowerCase()!==state.owner.toLowerCase())throw new Error('BOUND_OWNER_PRIVATE_KEY must match the prepared owner');return makeWalletClient(rpc,account);}

if(operation==='prepare'){
 const owner=addr(process.env.BOUND_OWNER_ADDRESS||account?.address,'BOUND_OWNER_ADDRESS');
 const resolver=addr(process.env.BOUND_REGISTRATION_RESOLVER,'BOUND_REGISTRATION_RESOLVER');
 const token=addr(process.env.BOUND_PAYMENT_TOKEN,'BOUND_PAYMENT_TOKEN');
 const duration=BigInt(process.env.BOUND_DURATION_SECONDS||'31536000');
 if(duration<1n||duration>2n**64n-1n)throw new Error('Invalid registration duration');
 if(!await isLabelAvailable(client,label))throw new Error(`${label}.eth is already registered`);
 const [resolverCode,tokenCode]=await Promise.all([client.getCode({address:resolver}),client.getCode({address:token})]);
 if(!resolverCode||resolverCode==='0x'||!tokenCode||tokenCode==='0x')throw new Error('Resolver or payment token has no code on Sepolia');
 if(resolver.toLowerCase()===ENSV2_SEPOLIA.permissionedResolverImpl.toLowerCase())throw new Error('Choose a dedicated resolver proxy, not the shared implementation');
 const state={version:1,chainId:chain,label,owner,resolver,paymentToken:token,durationSeconds:duration.toString(),secret:`0x${randomBytes(32).toString('hex')}`,phase:'prepared'};
 const cost=await payment(state);
 await mkdir(directory,{recursive:true,mode:0o700});
 await writeFile(path,JSON.stringify(state,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({name:`${label}.eth`,network:'Sepolia',owner,resolver,paymentToken:token,priceBaseUnits:cost.price.toString(),balanceBaseUnits:cost.balance.toString(),allowanceBaseUnits:cost.allowance.toString(),stateFile:path,next:'Check test-token balance and allowance, then run commit.'},null,2));
}else{
 const state=await load(), t=await timing(state);
 if(operation==='status'){
  const available=await isLabelAvailable(client,label);
  console.log(JSON.stringify({name:`${label}.eth`,available,phase:state.phase,committed:t.at>0n,eligible:t.at>0n&&t.now>=t.at+t.min&&t.now<=t.at+t.max,minimumAgeSeconds:t.min.toString(),maximumAgeSeconds:t.max.toString(),commitTx:state.commitTx??null,registerTx:state.registerTx??null},null,2));
 }else if(operation==='commit'){
  const wallet=writer(state);
  if(!await isLabelAvailable(client,label))throw new Error('Name is already registered; inspect status before proceeding');
  if(t.at>0n){console.log(JSON.stringify({alreadyCommitted:true,commitment:t.id}));}
  else{
   if(state.phase!=='prepared')throw new Error('Prior commit submission is uncertain or expired; inspect the wallet transaction and local state before retrying');
   const cost=await payment(state);if(cost.balance<cost.price||cost.allowance<cost.price)throw new Error('Insufficient test-token balance or registrar allowance');
   state.phase='commit-submitting';await save(state);
   const result=await commitRegistration(wallet,client,params(state));
   state.commitTx=result.txHash;state.phase='commit-submitted';await save(state);
   const receipt=await client.waitForTransactionReceipt({hash:result.txHash});if(receipt.status!=='success')throw new Error('Commit transaction reverted');
   state.phase='committed';await save(state);
   console.log(JSON.stringify({commitTx:result.txHash,minAgeSeconds:result.minAgeSeconds.toString(),next:'Run status, then register when eligible.'}));
  }
 }else{
  const wallet=writer(state);
  if(!await isLabelAvailable(client,label)){
   const {resolver}=await findResolver(client,`${label}.eth`);
   console.log(JSON.stringify({alreadyRegistered:true,resolver,expectedResolver:state.resolver}));
  }else{
   if(state.phase==='register-submitting'||state.phase==='register-submitted')throw new Error('Prior registration submission is uncertain; inspect the wallet transaction and local state before retrying');
   if(!t.at||t.now<t.at+t.min||t.now>t.at+t.max)throw new Error('Commitment is missing, too young, or expired; run status');
   const cost=await payment(state);if(cost.balance<cost.price||cost.allowance<cost.price)throw new Error('Insufficient test-token balance or registrar allowance');
   const p=params(state);
   await client.simulateContract({address:ENSV2_SEPOLIA.ethRegistrar,abi:ethRegistrarAbi,functionName:'register',args:[p.label,p.owner,p.secret,p.subregistry,p.resolver,p.durationSeconds,p.paymentToken,p.referrer],account:state.owner});
   state.phase='register-submitting';await save(state);
   const tx=await finishRegistration(wallet,p);state.phase='register-submitted';state.registerTx=tx;await save(state);
   const receipt=await client.waitForTransactionReceipt({hash:tx});if(receipt.status!=='success')throw new Error('Registration transaction reverted');
   const {resolver}=await findResolver(client,`${label}.eth`);
   if(resolver.toLowerCase()!==state.resolver.toLowerCase())throw new Error('Registered name does not resolve to the prepared resolver');
   state.phase='registered';await save(state);
   console.log(JSON.stringify({name:`${label}.eth`,transaction:tx,resolver,network:'Sepolia'}));
  }
 }
}
