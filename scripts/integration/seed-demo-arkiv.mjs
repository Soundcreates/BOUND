import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {FetchRequest,JsonRpcProvider,Wallet,keccak256} from 'ethers';
import {openArkivArchive} from '../../shared/integrations/arkiv/archive.js';
import {createArkivRpcReader} from '../../shared/integrations/arkiv/rpc.js';
import {createArkivSigner} from '../../shared/integrations/arkiv/signer.js';
import {createArkivReader} from '../../client/extension/arkiv-reader.mjs';
import {createDemoRecords,checkDemoRecords,DEMO_SCOPES} from './demo-arkiv.js';

const checkOnly=process.argv[2]==='--check';
if(process.argv.length>(checkOnly?3:2))throw new Error('usage: seed-demo-arkiv.mjs [--check]');
const chainId=7794095,target='0x4400000000000000000000000000000000000044';
const url=process.env.ARKIV_RPC_URL,owner=process.env.ARKIV_TEST_WRITER_ADDRESS?.toLowerCase();
if(Number(process.env.ARKIV_CHAIN_ID)!==chainId||!/^0x[0-9a-f]{40}$/.test(owner??'')||(process.env.ARKIV_SCHEMA_TAG??'bound.record.v1')!=='bound.record.v1')throw new Error('demo requires the Rabdi test writer and bound.record.v1 schema');
const stateDir=resolve('.bound/arkiv-demo'),manifestPath=resolve(stateDir,'manifest.json');
const request=new FetchRequest(url);
if(process.env.ARKIV_ACCESS_KEY)request.setHeader('x-api-key',process.env.ARKIV_ACCESS_KEY);
const provider=new JsonRpcProvider(request);
let archive;
async function retryRead(action){
 for(let attempt=0;;attempt++){
  try{return await action();}catch(error){
   if(attempt>=4||!/pagination changed block/.test(error.message))throw error;
   await new Promise(resolve=>setTimeout(resolve,300));
  }
 }
}
try{
 if(Number((await provider.getNetwork()).chainId)!==chainId)throw new Error('unexpected Arkiv chain');
 const reader=createArkivRpcReader({url,owner,accessKey:process.env.ARKIV_ACCESS_KEY,schemaTag:'bound.record.v1',expectedChainId:chainId});
 let manifest;
 try{manifest=JSON.parse(await readFile(manifestPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(checkOnly&&!manifest)throw new Error('seed the demo before checking it');
 if(!checkOnly){
  const privateKey=process.env.ARKIV_TEST_WRITER_PRIVATE_KEY;
  if(typeof privateKey!=='string'||!/^(?:0x)?[0-9a-fA-F]{64}$/.test(privateKey))throw new Error('dedicated test writer key required');
  const wallet=new Wallet(privateKey.startsWith('0x')?privateKey:`0x${privateKey}`);
  if(wallet.address.toLowerCase()!==owner||await provider.getBalance(owner)===0n)throw new Error('writer mismatch or no test funds');
  if(await provider.getTransactionCount(owner,'pending')!==await provider.getTransactionCount(owner,'latest'))throw new Error('reconcile pending writer transactions before seeding');
  await mkdir(stateDir,{recursive:true,mode:0o700});
  if(!manifest){
   const rows=await retryRead(()=>reader.query({owner}));
   if(rows.some(({record})=>DEMO_SCOPES.some(scope=>scope.site===record.site&&scope.chainId===record.chainId)))throw new Error('existing demo scopes found; restore their original journals rather than creating duplicates');
   manifest={version:1,owner,chainId,url,updatedAt:new Date(Math.floor(Date.now()/3600000)*3600000).toISOString()};
   await writeFile(manifestPath,JSON.stringify(manifest),{mode:0o600,flag:'wx'});
  }
 }
 if(manifest.version!==1||manifest.owner!==owner||manifest.chainId!==chainId||manifest.url!==url)throw new Error('demo manifest configuration mismatch');
 const expected=createDemoRecords(DEMO_SCOPES,manifest.updatedAt);
 if(!checkOnly){
  const wallet=new Wallet(process.env.ARKIV_TEST_WRITER_PRIVATE_KEY.startsWith('0x')?process.env.ARKIV_TEST_WRITER_PRIVATE_KEY:`0x${process.env.ARKIV_TEST_WRITER_PRIVATE_KEY}`);
  archive=await openArkivArchive({url,owner,target,chainId,schemaTag:'bound.record.v1',accessKey:process.env.ARKIV_ACCESS_KEY,senderJournal:resolve(stateDir,'sender.json'),registryJournal:resolve(stateDir,'registry.json'),lifetimes:{observation:604800,baseline:604800,drift:604800,incident:604800,status:604800},...createArkivSigner({wallet,provider,owner,target,chainId}),hash:keccak256,confirmTimeoutMs:120000,confirmPollMs:1000});
  for(const record of expected){
   const operationId=createHash('sha256').update(JSON.stringify(['bound-local-demo-v1',record])).digest('hex');
   const result=await archive[record.kind==='baseline'?'writeBaseline':'writeStatus'](record,operationId);
   if(result.state!=='current')throw new Error('demo record superseded');
   console.log(JSON.stringify({written:record.kind,site:record.site,chainId:record.chainId,key:result.key}));
  }
  await archive.renew();
 }
 const rows=await retryRead(()=>reader.query({owner}));
 checkDemoRecords(expected,rows);
 let cache={};
 const extensionReader=createArkivReader({getSettings:async()=>({arkivRpcUrl:url,watcherOwner:owner}),storage:{get:async()=>cache,set:async value=>{cache={...cache,...value};}},anonymousRequest:async()=>{throw new Error('anonymous browser transport is not part of this diagnostic');}});
 await retryRead(()=>extensionReader.refresh());
 checkDemoRecords(expected,cache.boundWatcherBundle.records);
 const journal=checkOnly?null:JSON.parse(await readFile(resolve(stateDir,'sender.json'),'utf8'));
 const evidence={result:'passed',network:'Rabdi',chainId,owner,checkedAt:new Date().toISOString(),extensionReader:'live-refresh-passed',anonymousTransportVerified:false,scopes:DEMO_SCOPES,records:rows.filter(row=>expected.some(record=>record.site===row.record.site&&record.chainId===row.record.chainId&&record.kind===row.record.kind)).map(({key,expiresAt,record})=>({key,expiresAt,site:record.site,chainId:record.chainId,kind:record.kind})),transactionHashes:journal?.entries.map(entry=>entry.transactionHash)??[]};
 if(!checkOnly)await writeFile(resolve(stateDir,'evidence.json'),JSON.stringify(evidence,null,2),{mode:0o600});
 console.log(JSON.stringify(evidence,null,2));
}finally{
 try{await archive?.close();}finally{provider.destroy();}
}
