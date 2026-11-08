import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {loadCuratorConfig} from '../../server/curator/src/env.ts';
import {loadCompileInput, compileSnapshot} from '../../server/curator/src/compile.ts';
import {readAndVerifyRoot} from '../../server/curator/src/read.ts';
import {publishSnapshot} from '../../server/curator/src/publish.ts';
import {makePublicClient, makeWalletClient, readRootRecord, canWriteRootKey, grantCuratorRole, RootReadError} from '@bound/integrations-ens';
import {privateKeyToAccount} from 'viem/accounts';
import {createArkivReader} from '../../client/extension/arkiv-reader.mjs';
import {createTrustEngine} from '../../client/extension/trust-engine.mjs';
import {readArkivEntity} from '../../shared/integrations/arkiv/read.js';
import {readPreconnectionSiteStatus} from '../../client/extension/decision-context.mjs';
import {DEMO_SCOPES} from './demo-arkiv.js';

const mode=process.argv[2];
if(!['--prepare','--publish','--check','--grant-root'].includes(mode)||process.argv.length!==3)throw new Error('usage: demo-snapshot.mjs --prepare|--publish|--check|--grant-root');
// Reuse existing dedicated test credentials without copying secrets into another file.
for(const [target,source] of Object.entries({BOUND_ARKIV_RPC_URL:'ARKIV_RPC_URL',BOUND_ARKIV_OWNER:'ARKIV_TEST_WRITER_ADDRESS',BOUND_ARKIV_PRIVATE_KEY:'ARKIV_TEST_WRITER_PRIVATE_KEY',BOUND_ARKIV_CHAIN_ID:'ARKIV_CHAIN_ID'}))process.env[target]??=process.env[source];
process.env.BOUND_ARKIV_SYSTEM_ADDRESS??='0x4400000000000000000000000000000000000044';
process.env.BOUND_ARKIV_SENDER_JOURNAL??=resolve('.bound/demo-snapshot/sender.json');
process.env.BOUND_ARKIV_REGISTRY_JOURNAL??=resolve('.bound/demo-snapshot/registry.json');
for(const name of ['BOUND_CURATOR_PRIVATE_KEY','BOUND_ARKIV_PRIVATE_KEY'])if(/^[0-9a-fA-F]{64}$/.test(process.env[name]??''))process.env[name]=`0x${process.env[name]}`;
let config=loadCuratorConfig();
if(config.arkiv.chainId!==7794095)throw new Error('demo snapshot requires Arkiv Rabdi testnet');
const client=makePublicClient(config.rpcUrl);
if(await client.getChainId()!==11155111)throw new Error('ENS endpoint must be Sepolia');
if(!await canWriteRootKey(client,config.ens,config.curatorAccount.address)&&/^(?:0x)?[0-9a-fA-F]{64}$/.test(process.env.CURATOR_PRIVATE_KEY??'')){
 const raw=process.env.CURATOR_PRIVATE_KEY;
 const alternate=privateKeyToAccount(raw.startsWith('0x')?raw:`0x${raw}`);
 if(await canWriteRootKey(client,config.ens,alternate.address)){
  process.env.BOUND_CURATOR_PRIVATE_KEY=raw.startsWith('0x')?raw:`0x${raw}`;
  config=loadCuratorConfig();
  console.log(JSON.stringify({selectedAuthorizedConfiguredCurator:alternate.address}));
 }
}
const directory=resolve('.bound/demo-snapshot');
await mkdir(directory,{recursive:true,mode:0o700});
let current=null;
try{await readRootRecord(client,config.ens);current=await readAndVerifyRoot(config);}
catch(error){if(!(error instanceof RootReadError)||!/empty root record/.test(error.message))throw error;}

async function verify(){
 const verified=await readAndVerifyRoot(config);
 let cache={};
 const anonymousRequest=async({method,params})=>{
  const response=await fetch(config.arkiv.url,{method:'POST',headers:{'content-type':'application/json',...(config.arkiv.accessKey?{'x-api-key':config.arkiv.accessKey}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error('Arkiv diagnostic read failed');
  return response.json();
 };
 const reader=createArkivReader({getSettings:async()=>({arkivRpcUrl:config.arkiv.url,watcherOwner:config.arkiv.owner}),storage:{get:async()=>cache,set:async value=>{cache={...cache,...value};}},anonymousRequest});
 const trust=createTrustEngine({getSettings:async()=>({ensRootName:config.ens.rootName,ensResolver:config.ens.resolverAddress,arkivRpcUrl:config.arkiv.url}),storage:{get:async()=>({}),set:async()=>{}},readRoot:async()=>verified.root,readArkivSnapshot:({key,owner})=>readArkivEntity({url:config.arkiv.url,accessKey:config.arkiv.accessKey,owner,chainId:config.arkiv.chainId,schemaTag:config.arkiv.schemaTag,entityKey:key}),log:(level,step,details)=>console.error(`[BOUND ENS] ${level.toUpperCase()} ${step}`,JSON.stringify(details))});
 const decisionSource=await trust.readVerifiedSnapshot();
 for(let attempt=0;;attempt++){
  try{await reader.refresh();break;}
  catch(error){if(attempt>=4||!/pagination changed block/.test(error.message))throw error;}
 }
 const statuses=[];
 for(const scope of DEMO_SCOPES){
  const result=await readPreconnectionSiteStatus({siteOrigin:`http://${scope.site}`,watcherOwner:config.arkiv.owner,adapters:{readVerifiedSnapshot:async()=>decisionSource,readWatcherBundle:()=>reader.readWatcherBundle()}});
  if(result.status!=='normal')throw new Error(`demo connection prerequisite failed for ${scope.site}: ${result.status}`);
  statuses.push(result);
 }
 const evidence={checkedAt:new Date().toISOString(),result:'passed',root:verified.root,statuses,transport:'direct RPC diagnostic',browserAndAnonymousTransportVerified:false};
 await writeFile(resolve(directory,'verification.json'),JSON.stringify(evidence,null,2),{mode:0o600});
 console.log(JSON.stringify(evidence,null,2));
}

if(mode==='--grant-root'){
 const raw=process.env.BOUND_OWNER_PRIVATE_KEY;
 if(!/^(?:0x)?[0-9a-fA-F]{64}$/.test(raw??''))throw new Error('set BOUND_OWNER_PRIVATE_KEY locally to the Sepolia resolver admin key; never share it in chat');
 const account=privateKeyToAccount(raw.startsWith('0x')?raw:`0x${raw}`);
 const hash=await grantCuratorRole(makeWalletClient(config.rpcUrl,account),config.ens.resolverAddress,config.curatorAccount.address);
 const receipt=await client.waitForTransactionReceipt({hash});
 if(receipt.status!=='success'||!await canWriteRootKey(client,config.ens,config.curatorAccount.address))throw new Error('root setter grant failed');
 console.log(JSON.stringify({rootRoleGranted:true,hash,curator:config.curatorAccount.address}));
}
else if(mode==='--check')await verify();
else {
 const seed=await loadCompileInput('fixtures/snapshots/demo-seed.compile-input.json');
 let input={...seed,rootName:config.ens.rootName,epoch:Math.max(seed.epoch,current?.root.epoch??0)+1,generatedAt:new Date(),validityDays:7};
 if(current){
  input.sites=Object.entries(current.snapshot.sites).flatMap(([host,chains])=>Object.entries(chains).map(([chain,entry])=>({host,chainId:Number(chain),trustedCounterparties:entry.trustedCounterparties,trustedContracts:entry.trustedContracts,deployers:entry.deployers,evidence:entry.evidence,...(entry.attestation?{attestationName:entry.attestation.name}:{})})));
  input.shared=Object.entries(current.snapshot.sharedContracts).map(([chain,entry])=>({chainId:Number(chain),contracts:entry.contracts,evidence:entry.evidence}));
 }
 const template=input.sites.find(site=>site.host==='app.uniswap.org'&&site.chainId===11155111);
 if(!template?.trustedContracts?.length)throw new Error('verified Sepolia Uniswap demo template unavailable');
 for(const scope of DEMO_SCOPES){
  if(!input.sites.some(site=>site.host===scope.site&&site.chainId===scope.chainId))input.sites.push({host:scope.site,chainId:scope.chainId,trustedContracts:template.trustedContracts,evidence:template.evidence.filter(item=>item.kind==='contract')});
 }
 const compiled=compileSnapshot(input);
 await writeFile(resolve(directory,'input.json'),JSON.stringify(input,null,2),{mode:0o600});
 await writeFile(resolve(directory,'snapshot.bin'),compiled.bytes,{mode:0o600});
 const authorized=await canWriteRootKey(client,config.ens,config.curatorAccount.address);
 console.log(JSON.stringify({mode,epoch:input.epoch,digest:compiled.digest,scopes:DEMO_SCOPES,curatorAuthorized:authorized}));
 if(mode==='--publish'){
  if(!authorized)throw new Error('curator lacks the scoped bound.root.v2 setter role; prepared files are ready, but no snapshot was published');
  const published=await publishSnapshot(config,compiled.snapshot,compiled);
  const receipt=await client.waitForTransactionReceipt({hash:published.txHash});
  if(receipt.status!=='success')throw new Error('ENS publication reverted');
  await writeFile(resolve(directory,'publication.json'),JSON.stringify(published,null,2),{mode:0o600});
  await verify();
 }
}
