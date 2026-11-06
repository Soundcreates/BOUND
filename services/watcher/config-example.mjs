// Example only: adapt recovery policy and key custody before use.
// BOUND_WATCHER_CONFIG points to a private JSON file containing deployment
// options plus curated `baselines`; ARKIV_PRIVATE_KEY contains the writer key.
import {readFile} from 'node:fs/promises';
import {FetchRequest,JsonRpcProvider,Wallet} from 'ethers';
import {parseUniqueJSON} from '../../packages/contracts/index.js';
import {createArkivSigner} from '../../integrations/arkiv/signer.js';
import {createRecoveryApprovalPolicy} from './recovery-approval.js';

export async function createConfig(){
 const file=process.env.BOUND_WATCHER_CONFIG,key=process.env.ARKIV_PRIVATE_KEY;
 if(!file||!key)throw new Error('watcher configuration and dedicated writer key are required');
 const config=parseUniqueJSON(await readFile(file,'utf8'));
 if(!config||!config.arkiv||!Array.isArray(config.baselines))throw new Error('invalid watcher configuration');
 const {baselines,recoveryApprovalFile,...deployment}=config;
 const rpc=new FetchRequest(config.arkiv.url);
 if(config.arkiv.accessKey)rpc.setHeader('x-api-key',config.arkiv.accessKey);
 const wallet=new Wallet(key),provider=new JsonRpcProvider(rpc,config.arkiv.chainId);
 const signer=createArkivSigner({wallet,provider,owner:config.arkiv.owner,target:config.arkiv.target,chainId:config.arkiv.chainId});
 const references=new Map();
 for(const entry of baselines){
  const id=JSON.stringify([entry.site,entry.chainId]);
  if(references.has(id))throw new Error('duplicate curated baseline');
  references.set(id,structuredClone(entry.sample));
 }
 const canRecover=recoveryApprovalFile?createRecoveryApprovalPolicy({path:recoveryApprovalFile}):async()=>false;
 return {...deployment,arkiv:{...config.arkiv,...signer},readBaseline:async(site,chainId)=>structuredClone(references.get(JSON.stringify([site,chainId]))),canRecover};
}
