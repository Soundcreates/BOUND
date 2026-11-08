#!/usr/bin/env node
// BOUND-managed ENSv2 wildcard records. These are resolver records, not owned subname tokens.
import {readFile, mkdir, writeFile, rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createPublicClient, createWalletClient, http, parseAbi, encodeFunctionData, decodeFunctionResult, namehash, toHex, isAddressEqual} from 'viem';
import {packetToBytes} from 'viem/ens';
import {privateKeyToAccount} from 'viem/accounts';
import {sepolia} from 'viem/chains';
import {ENSV2_SEPOLIA} from '../../shared/integrations/ens/src/addresses.ts';

export const PARENT='bound-v2.eth';
export const OBSERVATION_KEY='com.bound.frontend-observation.v1';
const resolverAbi=parseAbi(['function setText(bytes name,string key,string value)', 'function text(bytes32 node,string key) view returns (string)', 'function multicall(bytes[] calls) returns (bytes[])', 'function hasRootRoles(uint256 roleBitmap,address account) view returns (bool)']);
const universalAbi=parseAbi(['function findResolver(bytes name) view returns (address,bytes32,uint256)', 'function resolve(bytes name,bytes data) view returns (bytes,address)']);
const dns=name=>toHex(packetToBytes(name));
const filename=resolve('.bound/ens-financial-registry/plan.json');
const journalPath=resolve('.bound/ens-financial-registry/journal.json');

export function makePlan(registry, observations) {
  if (!Array.isArray(registry.sites) || registry.sites.length!==50 || !Array.isArray(observations.sites)) throw Error('expected exactly 50 registry sites and captured observations');
  const bySite=new Map(observations.sites.map(x=>[x.site,x]));
  if(bySite.size!==observations.sites.length)throw Error('duplicate observation host');
  const labels=new Set();
  const entries=registry.sites.map(site=>{
    const source=new URL(site.candidateUrl);
    if(source.protocol!=='https:' || source.hostname!==site.site || source.username || source.password || source.port)throw Error('invalid candidate HTTPS origin');
    source.search='';source.hash='';
    const label='site-'+createHash('sha256').update(site.site).digest('hex').slice(0,24);
    if(labels.has(label))throw Error('duplicate hostname or label');labels.add(label);
    const obs=bySite.get(site.site);if(!obs)throw Error(`missing observation for ${site.site}`);
    // Only publish same-origin script observations. A redirect to another host must be reviewed.
    const scripts=obs.finalSite===site.site ? (obs.scripts||[]).filter(s=>s.status==='observed' && /^sha256-[A-Za-z0-9+/]{43}=$/.test(s.hash) && typeof s.path==='string' && s.path.startsWith('/') && !s.path.startsWith('//')).map(s=>({path:s.path,sha256:s.hash})) : [];
    if(scripts.length>12)throw Error('too many observed scripts');
    const value=JSON.stringify({version:1,hostname:site.site,source:'BOUND public fetch; unverified, not a protocol attestation or trusted baseline',observedAt:obs.capturedAt,status:scripts.length?'observed':'unavailable',scripts});
    return {name:`${label}.${PARENT}`,site:site.site,company:site.name,url:source.href,observation:value};
  });
  return {version:1,chainId:11155111,parent:PARENT,source:'unreviewed public fetch',entries};
}

async function resolveFor(client,name){
 const [address]=await client.readContract({address:ENSV2_SEPOLIA.universalResolverV2,abi:universalAbi,functionName:'findResolver',args:[dns(name)]});
 if(!address || /^0x0{40}$/i.test(address))throw Error(`no resolver for ${name}`);
 return address;
}
async function readText(client,name,key){
 const payload=encodeFunctionData({abi:resolverAbi,functionName:'text',args:[namehash(name),key]});
 const [value]=await client.readContract({address:ENSV2_SEPOLIA.universalResolverV2,abi:universalAbi,functionName:'resolve',args:[dns(name),payload]});
 return decodeFunctionResult({abi:resolverAbi,functionName:'text',data:value});
}
async function readPlan(){
 const bytes=await readFile(filename);const plan=JSON.parse(bytes);
 if(plan.version!==1 || plan.parent!==PARENT || plan.chainId!==11155111 || !Array.isArray(plan.entries)||plan.entries.length!==50)throw Error('invalid prepared plan');
 const registry=JSON.parse(await readFile('fixtures/financial-registry/sites.json','utf8'));
 const obs=JSON.parse(await readFile('fixtures/financial-registry/observations.json','utf8'));
 if(JSON.stringify(makePlan(registry,obs))!==JSON.stringify(plan))throw Error('plan does not match local registry and observations; prepare again');
 return plan;
}
async function saveJournal(j){await mkdir(dirname(journalPath),{recursive:true,mode:0o700});const tmp=journalPath+'.tmp';await writeFile(tmp,JSON.stringify(j,null,2)+'\n',{mode:0o600});await rename(tmp,journalPath);}
async function main(){
 const mode=process.argv[2];if(!['--prepare','--check','--publish'].includes(mode)||process.argv.length!==3)throw Error('usage: node --env-file=.env --experimental-strip-types scripts/ens/registry-records.mjs --prepare|--check|--publish');
 if(mode==='--prepare'){
  const reg=JSON.parse(await readFile('fixtures/financial-registry/sites.json','utf8'));
  const obs=JSON.parse(await readFile('fixtures/financial-registry/observations.json','utf8'));
  const plan=makePlan(reg,obs);await mkdir(dirname(filename),{recursive:true,mode:0o700});await writeFile(filename,JSON.stringify(plan,null,2)+'\n',{mode:0o600});
  console.log(`Prepared ${plan.entries.length} resolver-record subnames under ${PARENT}; ${plan.entries.filter(e=>JSON.parse(e.observation).scripts.length).length} have unverified observed hashes. Plan: ${filename}`);return;
 }
 const plan=await readPlan();const rpc=process.env.SEPOLIA_RPC_URL;if(!rpc)throw Error('SEPOLIA_RPC_URL is required');
 const client=createPublicClient({chain:sepolia,transport:http(rpc),batch:{multicall:false}});
 if(await client.getChainId()!==11155111)throw Error('RPC is not Sepolia');
 const resolver=await resolveFor(client,PARENT);
 const code=await client.getCode({address:resolver});if(!code||code==='0x')throw Error('resolved contract has no code');
 let journal;try{journal=JSON.parse(await readFile(journalPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;journal={version:1,parent:PARENT,chainId:11155111,resolver,transactions:[]};}
 if(journal.parent!==PARENT || !isAddressEqual(journal.resolver,resolver))throw Error('journal or resolver differs; reconcile before publishing');
 if(journal.transactions.some(t=>t.state==='submitted'))throw Error('pending transaction in journal; reconcile its receipt before resuming');
 let account,wallet;if(mode==='--publish'){
  let key=process.env.CURATOR_PRIVATE_KEY;if(!key)throw Error('CURATOR_PRIVATE_KEY is required');if(!key.startsWith('0x'))key='0x'+key;
  account=privateKeyToAccount(key);wallet=createWalletClient({chain:sepolia,transport:http(rpc),account});
  if(!await client.readContract({address:resolver,abi:resolverAbi,functionName:'hasRootRoles',args:[16n,account.address]}))throw Error('configured curator lacks resolver root SET_TEXT permission');
  const balance=await client.getBalance({address:account.address});console.log(`Signer ${account.address}; Sepolia balance ${balance} wei; resolver ${resolver}`);
 }
 let already=0,needed=0;
 for(const entry of plan.entries){
  const currentResolver=await resolveFor(client,entry.name);if(!isAddressEqual(currentResolver,resolver))throw Error(`different resolver at ${entry.name}; refusing write`);
  let current;
  try{current=await Promise.all([readText(client,entry.name,'url'),readText(client,entry.name,OBSERVATION_KEY)]);}catch(error){throw Error(`unable to safely read ${entry.name}: ${error.shortMessage||error.message}`)}
  const target=[entry.url,entry.observation];
  if(current.every((v,i)=>v===target[i])){already++;continue;}
  // Do not overwrite records that someone else has written, including partial prior writes.
  if(current.some((v,i)=>v && v!==target[i]))throw Error(`existing different record at ${entry.name}; manual review required`);
  needed++;
  if(mode==='--check'){console.log(`PENDING ${entry.name} ${entry.site}`);continue;}
  const calls=target.map((value,i)=>encodeFunctionData({abi:resolverAbi,functionName:'setText',args:[dns(entry.name),i?'com.bound.frontend-observation.v1':'url',value]}));
  const {request}=await client.simulateContract({address:resolver,abi:resolverAbi,functionName:'multicall',args:[calls],account});
  const hash=await wallet.writeContract(request);const item={name:entry.name,site:entry.site,hash,state:'submitted'};journal.transactions.push(item);await saveJournal(journal);
  const receipt=await client.waitForTransactionReceipt({hash,timeout:120000});if(receipt.status!=='success')throw Error(`transaction reverted: ${hash}`);
  const [url,observation]=await Promise.all([readText(client,entry.name,'url'),readText(client,entry.name,OBSERVATION_KEY)]);
  if(url!==entry.url||observation!==entry.observation)throw Error(`readback mismatch for ${entry.name}, transaction ${hash}`);
  item.state='verified';item.block=String(receipt.blockNumber);await saveJournal(journal);
  console.log(`VERIFIED ${already+needed}/50 ${entry.name} ${entry.site} ${hash}`);
 }
 console.log(`Complete: ${already} already matched, ${needed} ${mode==='--publish'?'published and verified':'pending'}.`);
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(e.shortMessage||e.message);process.exitCode=1;});
