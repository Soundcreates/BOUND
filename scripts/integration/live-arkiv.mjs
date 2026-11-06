import {randomBytes} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {JsonRpcProvider,Transaction,Wallet,keccak256} from 'ethers';
import {openArkivArchive} from '../../integrations/arkiv/archive.js';
import {createArkivRpcReader} from '../../integrations/arkiv/rpc.js';

const CHAIN_ID=7794095;
const SYSTEM='0x4400000000000000000000000000000000000044';
const schemaTag=process.env.ARKIV_SCHEMA_TAG||'bound.record.v1';
const rpcUrl=process.env.ARKIV_RPC_URL;
const configuredChain=Number(process.env.ARKIV_CHAIN_ID);
const privateKey=process.env.ARKIV_TEST_WRITER_PRIVATE_KEY;
const configuredOwner=process.env.ARKIV_TEST_WRITER_ADDRESS?.toLowerCase();
if(configuredChain!==CHAIN_ID||!rpcUrl||!privateKey||!configuredOwner)throw new Error('live Arkiv requires the configured Rabdi testnet and writer credentials');
if(!/^(0x)?[0-9a-fA-F]{64}$/.test(privateKey))throw new Error('invalid writer key format');
if(!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(schemaTag))throw new Error('invalid Arkiv schema tag');

const key=privateKey.startsWith('0x')?privateKey:`0x${privateKey}`;
const wallet=new Wallet(key);
if(wallet.address.toLowerCase()!==configuredOwner)throw new Error('writer key does not match configured writer address');
const provider=new JsonRpcProvider(rpcUrl,CHAIN_ID,{staticNetwork:true});
const network=await provider.getNetwork();
if(Number(network.chainId)!==CHAIN_ID)throw new Error('unexpected Arkiv chain');
const systemCode=await provider.getCode(SYSTEM);
if(systemCode!=='0x')throw new Error('documented Arkiv system address has unexpected bytecode');
const balance=await provider.getBalance(wallet.address);
if(balance===0n)throw new Error('configured Arkiv test writer has no balance');

let nonce=await provider.getTransactionCount(wallet.address,'pending');
async function prepare({owner,chainId,target,value,data}){
 if(owner.toLowerCase()!==configuredOwner||chainId!==CHAIN_ID||target!==SYSTEM||value!=='0x0')throw new Error('refusing transaction outside the configured Rabdi writer boundary');
 const request={from:owner,to:target,value:0n,data};
 const [gasEstimate,fees]=await Promise.all([provider.estimateGas(request),provider.getFeeData()]);
 const gasLimit=gasEstimate*120n/100n;
 const tx={type:2,chainId:CHAIN_ID,nonce:nonce++,to:target,value:0n,data,gasLimit};
 if(fees.maxFeePerGas!==null&&fees.maxPriorityFeePerGas!==null){tx.maxFeePerGas=fees.maxFeePerGas;tx.maxPriorityFeePerGas=fees.maxPriorityFeePerGas;}
 else if(fees.gasPrice!==null){delete tx.type;tx.gasPrice=fees.gasPrice;}
 else throw new Error('Arkiv RPC did not provide transaction fees');
 return wallet.signTransaction(tx);
}
async function inspect(raw){
 const tx=Transaction.from(raw);
 return {from:tx.from?.toLowerCase(),to:tx.to?.toLowerCase(),chainId:Number(tx.chainId),value:`0x${tx.value.toString(16)}`,data:tx.data};
}
const hash=bytes=>keccak256(bytes);
const stateDir=resolve('.bound/arkiv-live');
await mkdir(stateDir,{recursive:true,mode:0o700});
const archive=await openArkivArchive({
 url:rpcUrl,accessKey:process.env.ARKIV_ACCESS_KEY,owner:configuredOwner,target:SYSTEM,chainId:CHAIN_ID,schemaTag,
 senderJournal:resolve(stateDir,'sender.json'),registryJournal:resolve(stateDir,'registry.json'),
 lifetimes:{observation:40,baseline:7200,drift:7200,incident:7200,status:7200},prepare,inspect,hash,confirmTimeoutMs:120000,confirmPollMs:1500
});
const confirmations=[];
try {
 const manifestPath=resolve(stateDir,'scenario.json');
 let scenario;
 try{scenario=JSON.parse(await readFile(manifestPath,'utf8'));}
 catch(error){
  if(error.code!=='ENOENT')throw new Error('invalid live Arkiv scenario journal',{cause:error});
  let prior;
  try{prior=JSON.parse(await readFile(resolve(stateDir,'registry.json'),'utf8'));}catch(readError){if(readError.code!=='ENOENT')throw new Error('invalid live Arkiv registry journal',{cause:readError});}
  const pending=prior?.operations?.find(operation=>!operation.done&&operation.record?.kind==='baseline'&&operation.record.site.startsWith('phase0-'));
  const tag=pending?pending.record.site.slice('phase0-'.length,-'.example.org'.length):randomBytes(6).toString('hex');
  const site=`phase0-${tag}.example.org`;
  const chainId=CHAIN_ID;
  const base=pending?.record??{schemaVersion:1,kind:'baseline',site,chainId,counterparties:[],calledContracts:[],updatedAt:new Date().toISOString()};
  const updated={...base,counterparties:['0x'+'1'.repeat(40)],updatedAt:new Date(Date.parse(base.updatedAt)+1000).toISOString()};
  const observation={schemaVersion:1,kind:'observation',site,chainId,value:'0x'+'2'.repeat(40),reporterKey:`phase0-${tag}`,event:'counterparty'};
  scenario={site,tag,base,baselineId:pending?.id??randomBytes(32).toString('hex'),updated,patchId:randomBytes(32).toString('hex'),observation,observationId:randomBytes(32).toString('hex')};
  await writeFile(manifestPath,JSON.stringify(scenario,null,2),{encoding:'utf8',mode:0o600,flag:'wx'});
 }
 const {site,base,baselineId,updated,patchId,observation,observationId}=scenario;
 const senderJournal=JSON.parse(await readFile(resolve(stateDir,'sender.json'),'utf8'));
 const transactionFor=id=>senderJournal.entries.find(entry=>entry.id===id)?.transactionHash;
 const first=await archive.writeBaseline(base,baselineId);
 confirmations.push({kind:'baseline-create',key:first.key,owner:configuredOwner,transactionHash:transactionFor(baselineId)});
 const second=await archive.writeBaseline(updated,patchId);
 if(second.key!==first.key||second.record.counterparties[0]!==updated.counterparties[0])throw new Error('Arkiv patch readback mismatch');
 confirmations.push({kind:'baseline-patch',key:second.key,owner:second.owner,expiresAt:second.expiresAt,transactionHash:transactionFor(patchId)});
 const foreign='0x'+'f'.repeat(40);
 let foreignRejected=false;
 try{await archive.query({owner:foreign});}catch(error){foreignRejected=error.message==='invalid Arkiv owner';}
 if(!foreignRejected)throw new Error('foreign-owner query was not rejected');
 const foreignReader=createArkivRpcReader({url:rpcUrl,accessKey:process.env.ARKIV_ACCESS_KEY,schemaTag,expectedChainId:CHAIN_ID});
 const foreignRows=await foreignReader.query({owner:foreign});
 if(foreignRows.some(item=>item.key===first.key))throw new Error('foreign owner query returned the watcher entity');
 confirmations.push({kind:'foreign-owner-query',excludedWatcherEntity:true});

 let expiryEvidence=scenario.expiry;
 if(!expiryEvidence){
  const journal=JSON.parse(await readFile(resolve(stateDir,'sender.json'),'utf8'));
  const entry=journal.entries.find(item=>item.id===observationId);
  if(entry){
   const receipt=await provider.getTransactionReceipt(entry.transactionHash);
   const ownerTopic='0x'+'0'.repeat(24)+configuredOwner.slice(2);
   const event=receipt?.logs.find(log=>log.address.toLowerCase()===SYSTEM.toLowerCase()&&log.topics?.[0]==='0xb282d7c494b8899aa8015cd07be621530beb03409eb8c5e8fdc1411ba64356a5'&&log.topics?.[2]===ownerTopic);
   if(!event||!/^0x[0-9a-f]{128}$/.test(event.data))throw new Error('could not recover the live observation receipt');
   expiryEvidence={key:event.topics[1],expiresAt:Number(BigInt(`0x${event.data.slice(2,66)}`)),visibleBeforeExpiry:false};
  }else{
   const expiring=await archive.writeObservation(observation,observationId);
   const visible=(await archive.query({owner:configuredOwner})).some(item=>item.key===expiring.key&&item.record.kind==='observation'&&item.owner===configuredOwner);
   if(!visible)throw new Error('Arkiv owner-filtered observation readback missing');
   expiryEvidence={key:expiring.key,expiresAt:expiring.expiresAt,visibleBeforeExpiry:true};
  }
  // The prior run reached the expiry assertion only after the pre-expiry query succeeded.
  if(expiryEvidence.expiresAt<await archive.currentBlock())expiryEvidence.visibleBeforeExpiry=true;
  scenario.expiry=expiryEvidence;
  await writeFile(manifestPath,JSON.stringify(scenario,null,2),{encoding:'utf8',mode:0o600});
 }
 confirmations.push({kind:'expiring-observation',key:expiryEvidence.key,owner:configuredOwner,expiresAt:expiryEvidence.expiresAt,transactionHash:transactionFor(observationId),visibleBeforeExpiry:expiryEvidence.visibleBeforeExpiry});

 const deadline=Date.now()+180000;
 let afterExpiry=[];
 do {
  if(Date.now()>deadline)throw new Error('Arkiv expiry did not arrive within three minutes');
  await new Promise(resolve=>setTimeout(resolve,2000));
  afterExpiry=await archive.query({owner:configuredOwner});
 }while(await archive.currentBlock()<=expiryEvidence.expiresAt||afterExpiry.some(item=>item.key===expiryEvidence.key));
 let directEntityExpired=false;
 try{directEntityExpired=(await archive.readEntity(expiryEvidence.key))===null;}catch(error){directEntityExpired=error.message==='expired Arkiv entity';}
 if(!directEntityExpired)throw new Error('expired Arkiv entity remained readable');
 confirmations.push({kind:'expiry',key:expiryEvidence.key,expiredAtBlock:expiryEvidence.expiresAt,excludedFromQuery:true,directEntityUnavailable:true});
 console.log(JSON.stringify({result:'passed',network:'Rabdi',chainId:CHAIN_ID,systemAddress:SYSTEM,writer:configuredOwner,site,checks:confirmations}));
} finally {
 await archive.close();
 await provider.destroy();
}
