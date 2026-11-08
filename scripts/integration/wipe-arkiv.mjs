// Deletes every Arkiv entity owned by the BOUND writer, for a clean end-to-end re-check.
//
//   node --env-file=.env scripts/integration/wipe-arkiv.mjs                 # dry run (default)
//   node --env-file=.env scripts/integration/wipe-arkiv.mjs --kind observation
//   node --env-file=.env scripts/integration/wipe-arkiv.mjs --execute --confirm <owner address>
//
// The dry run lists the entities, backs them up, and simulates each delete with
// eth_estimateGas, so a wrong encoding or a non-owned entity shows up before
// anything is sent. Nothing is deleted without --execute and --confirm set to
// the configured owner address.
//
// Deleting is irreversible. After a full wipe the ENS root still points at the
// deleted trust snapshot, so the extension scores every request grey until the
// curator republishes a snapshot and the demo baselines/statuses are reseeded.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {FetchRequest,JsonRpcProvider,Wallet} from 'ethers';
import {encodeDeleteEntity} from '../../shared/integrations/arkiv/codec.js';

const KINDS=['observation','baseline','drift','incident','status','evidence','trust_snapshot','ens_record'];
const args=process.argv.slice(2);
const flag=name=>{const i=args.indexOf(name);if(i<0)return undefined;const v=args[i+1];if(v===undefined||v.startsWith('--'))throw new Error(`${name} needs a value`);return v;};
for(const a of args)if(a.startsWith('--')&&!['--execute','--confirm','--kind'].includes(a))throw new Error(`unknown option ${a}`);
const execute=args.includes('--execute');
const confirm=flag('--confirm')?.toLowerCase();
const kind=flag('--kind');
if(kind!==undefined&&!KINDS.includes(kind))throw new Error(`--kind must be one of ${KINDS.join(', ')}`);

const env=name=>process.env[`BOUND_${name}`]??process.env[name];
const url=env('ARKIV_RPC_URL'),accessKey=process.env.ARKIV_ACCESS_KEY||undefined;
const owner=env('ARKIV_OWNER')?.toLowerCase();
const chainId=Number(env('ARKIV_CHAIN_ID')??7794095);
const target=(env('ARKIV_SYSTEM_ADDRESS')??'0x4400000000000000000000000000000000000044').toLowerCase();
const privateKey=env('ARKIV_PRIVATE_KEY');
if(!url||!/^0x[0-9a-f]{40}$/.test(owner??'')||!Number.isSafeInteger(chainId))throw new Error('set BOUND_ARKIV_RPC_URL, BOUND_ARKIV_OWNER and BOUND_ARKIV_CHAIN_ID');
if(execute&&confirm!==owner)throw new Error(`--execute also needs --confirm ${owner} (the owner whose entities will be deleted)`);

const request=new FetchRequest(url);
if(accessKey)request.setHeader('x-api-key',accessKey);
const provider=new JsonRpcProvider(request,chainId,{staticNetwork:true});
if(Number((await provider.getNetwork()).chainId)!==chainId)throw new Error('unexpected Arkiv chain');

async function listEntities(){
 const rows=[];let cursor=null,block=null;
 for(let page=0;page<100;page++){
  const expression=`$owner = addr(${owner})${kind?` AND kind = str('${kind}')`:''}${cursor?` AND $key > key(${cursor})`:''} ORDER BY $key ASC`;
  const result=await provider.send('arkiv_query',[expression,{select:{key:true,owner:true,expiresAt:true,attributes:true},limit:'0x64'}]);
  if(!result||!Array.isArray(result.data))throw new Error('invalid Arkiv query response');
  const current=Number(BigInt(result.blockNumber));
  if(block!==null&&block!==current){rows.length=0;cursor=null;block=null;page=-1;continue;} // chain moved mid-listing: restart
  block=current;
  for(const e of result.data){
   if(typeof e.owner!=='string'||e.owner.toLowerCase()!==owner)throw new Error(`query returned entity ${e.key} with a different owner`);
   const attributes=Object.fromEntries((e.attributes??[]).map(a=>[a.name,a.value]));
   let record=null;try{record=JSON.parse(Buffer.from(attributes.payload.slice(2),'hex').toString('utf8'));}catch{}
   rows.push({key:e.key.toLowerCase(),expiresAt:Number(BigInt(e.expiresAt)),kind:attributes.kind??null,attributes,record});
   cursor=e.key;
  }
  if(result.data.length<100)return {rows,block};
 }
 throw new Error('too many entities to list');
}

const {rows,block}=await listEntities();
console.log(`${rows.length} entit${rows.length===1?'y':'ies'} owned by ${owner}${kind?` with kind ${kind}`:''} at block ${block}`);
for(const r of rows)console.log(`  ${r.key}  ${String(r.kind).padEnd(14)} ${r.record?.site??''}`);
if(!rows.length)process.exit(0);

const backupDir=resolve('.bound/arkiv-backups');
await mkdir(backupDir,{recursive:true,mode:0o700});
const backupPath=resolve(backupDir,`${new Date().toISOString().replace(/[:.]/g,'-')}${execute?'-before-delete':'-dry-run'}.json`);
await writeFile(backupPath,JSON.stringify({savedAt:new Date().toISOString(),block,owner,chainId,kind:kind??null,rows},null,1),{mode:0o600});
console.log(`backup written to ${backupPath}`);

// Simulate every delete first; any revert stops the run before a transaction is sent.
for(const r of rows){
 try{await provider.estimateGas({from:owner,to:target,value:0n,data:encodeDeleteEntity({entityKey:r.key})});}
 catch(error){throw new Error(`delete of ${r.key} would revert; nothing was deleted: ${error.shortMessage??error.message}`);}
}
console.log(`simulated ${rows.length} delete${rows.length===1?'':'s'}: all would succeed`);
if(!execute){console.log(`dry run only. To delete, run again with: --execute --confirm ${owner}`);process.exit(0);}

if(!/^(?:0x)?[0-9a-fA-F]{64}$/.test(privateKey??''))throw new Error('BOUND_ARKIV_PRIVATE_KEY is required to delete');
const wallet=new Wallet(privateKey.startsWith('0x')?privateKey:`0x${privateKey}`,provider);
if(wallet.address.toLowerCase()!==owner)throw new Error('BOUND_ARKIV_PRIVATE_KEY does not derive BOUND_ARKIV_OWNER');
if(await provider.getTransactionCount(owner,'pending')!==await provider.getTransactionCount(owner,'latest'))throw new Error('the writer has pending transactions; stop other BOUND writers (intake, curator, seed) and retry');

let deleted=0;
for(const r of rows){
 const tx=await wallet.sendTransaction({to:target,value:0n,data:encodeDeleteEntity({entityKey:r.key}),chainId});
 const receipt=await tx.wait(1,120000);
 if(!receipt||receipt.status!==1)throw new Error(`delete of ${r.key} failed in ${tx.hash}; ${deleted} deleted so far`);
 deleted++;
 console.log(`deleted ${r.key} (${r.kind}) in ${tx.hash}`);
}
const remaining=(await listEntities()).rows.filter(r=>rows.some(x=>x.key===r.key));
if(remaining.length)throw new Error(`${remaining.length} entit${remaining.length===1?'y is':'ies are'} still present after deletion: ${remaining.map(r=>r.key).join(', ')}`);
console.log(`done: deleted ${deleted} entit${deleted===1?'y':'ies'}; backup at ${backupPath}`);
console.log('local journals that reference these entities (.bound/arkiv-demo, .bound/watcher-arkiv, .bound/curator, .bound/watcher-local-journal.json) are now stale.');
