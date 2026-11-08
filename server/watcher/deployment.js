import {keccak256} from 'ethers';
import {openArkivArchive} from '../../shared/integrations/arkiv/archive.js';
import {createSwarmAdapter} from '../../shared/integrations/swarm/index.js';
import {createPinnedTextReader} from '../../shared/integrations/ens/index.js';
import {createCymruLookup} from './asn.js';
import {createNetworkPollAdapters} from './network.js';
import {pollSite} from './poll.js';
import {openWatcherApplication} from './application.js';
import {createEnsCachePublisher,createJsonRpc} from './ens-cache.js';

// ENSv2 Sepolia upgradeable UniversalResolver proxy.
const SEPOLIA_UNIVERSAL_RESOLVER='0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe';
const SEPOLIA_CHAIN_ID=11155111;

function ensCacheJob({ensCache,archive,fetchImpl,factories}){
 if(ensCache===undefined)return null;
 if(!ensCache||typeof ensCache!=='object'||typeof archive.writeEnsRecord!=='function')throw new Error('invalid ENS cache configuration');
 const intervalMs=ensCache.intervalMs??3600000;
 if(!Number.isSafeInteger(intervalMs)||intervalMs<60000||intervalMs>2147483647)throw new Error('invalid ENS cache interval');
 const rpc=(factories.createJsonRpc??createJsonRpc)({url:ensCache.rpcUrl,fetchImpl});
 const universalResolver=ensCache.universalResolver??SEPOLIA_UNIVERSAL_RESOLVER;
 const publisher=createEnsCachePublisher({entries:ensCache.entries,writeEnsRecord:(record,id)=>archive.writeEnsRecord(record,id),readText:async({name,resolver,recordKey})=>{
  const reader=createPinnedTextReader({scope:{chainId:SEPOLIA_CHAIN_ID,name,resolver,recordKey},universalResolver,providers:[{id:'ens-rpc',rpc}],allowSingleProvider:true});
  return (await reader.read()).text;
 }});
 const setTimer=factories.setInterval??setInterval,clearTimer=factories.clearInterval??clearInterval;
 let timer=null,running=null;
 const run=()=>{running??=publisher.publish().catch(()=>[]).finally(()=>{running=null;});return running;};
 return {start(){if(timer===null){run();timer=setTimer(run,intervalMs);}},async stop(){if(timer!==null){clearTimer(timer);timer=null;}await running;},run};
}

// The caller supplies signing, curated reference samples, and a recovery policy.
// No network connections are opened until the first scheduled job or write.
export async function openWatcherDeployment({arkiv,swarm,watcher,zones,readBaseline,canRecover,ensCache,fetchImpl=fetch}, factories={}) {
 if(!arkiv||!watcher||!Array.isArray(watcher.feeds)||!zones||typeof zones!=='object'||typeof readBaseline!=='function'||typeof canRecover!=='function')throw new Error('deployment configuration required');
 const siteZones=new Map();
 for(const {site} of watcher.feeds){
  const zone=zones[site];
  if(typeof site!=='string'||typeof zone!=='string'||!/^[a-z0-9.-]+$/.test(zone)||zone.endsWith('.')||(site!==zone&&!site.endsWith('.'+zone))||(siteZones.has(site)&&siteZones.get(site)!==zone))throw new Error('valid parent nameserver zone required for each site');
  siteZones.set(site,zone);
 }
 const swarmAdapter=swarm?(factories.createSwarmAdapter??createSwarmAdapter)({...swarm,fetchImpl}):null;
 const lookupAsn=(factories.createCymruLookup??createCymruLookup)();
 const network=(factories.createNetworkPollAdapters??createNetworkPollAdapters)({fetchImpl,lookupAsn});
 const archive=await (factories.openArkivArchive??openArkivArchive)({...arkiv,fetchImpl,hash:keccak256});
 try {
  const ensJob=ensCacheJob({ensCache,archive,fetchImpl,factories});
  const upload=swarmAdapter?(bytes=>swarmAdapter.put(bytes)):undefined;
  const writeEvidence=archive.writeEvidence?((record,id)=>archive.writeEvidence(record,id)):undefined;
  const app=await (factories.openWatcherApplication??openWatcherApplication)({...watcher,archive,hash:keccak256,upload,writeEvidence,readBaseline,canRecover,poll:site=>{
   if(!siteZones.has(site))throw new Error('unconfigured watcher site');
   return pollSite(site,network,{nameserverZone:siteZones.get(site)});
  }});
  let closed;
  const start=ensJob?async(...args)=>{const result=await app.start?.(...args);ensJob.start();return result;}:app.start;
  return {...app,start,...(ensJob?{runEnsCache:ensJob.run}:{}),close(){if(!closed)closed=(async()=>{await ensJob?.stop();await app.close();await archive.close();})();return closed;}};
 } catch(error){await archive.close();throw error;}
}
