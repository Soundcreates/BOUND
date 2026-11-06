import {keccak256} from 'ethers';
import {openArkivArchive} from '../../integrations/arkiv/archive.js';
import {createSwarmAdapter} from '../../integrations/swarm/index.js';
import {createCymruLookup} from './asn.js';
import {createNetworkPollAdapters} from './network.js';
import {pollSite} from './poll.js';
import {openWatcherApplication} from './application.js';

// The caller supplies signing, curated reference samples, and a recovery policy.
// No network connections are opened until the first scheduled job or write.
export async function openWatcherDeployment({arkiv,swarm,watcher,zones,readBaseline,canRecover,fetchImpl=fetch}, factories={}) {
 if(!arkiv||!swarm||!watcher||!Array.isArray(watcher.feeds)||!zones||typeof zones!=='object'||typeof readBaseline!=='function'||typeof canRecover!=='function')throw new Error('deployment configuration required');
 const siteZones=new Map();
 for(const {site} of watcher.feeds){
  const zone=zones[site];
  if(typeof site!=='string'||typeof zone!=='string'||!/^[a-z0-9.-]+$/.test(zone)||zone.endsWith('.')||(site!==zone&&!site.endsWith('.'+zone))||(siteZones.has(site)&&siteZones.get(site)!==zone))throw new Error('valid parent nameserver zone required for each site');
  siteZones.set(site,zone);
 }
 const swarmAdapter=(factories.createSwarmAdapter??createSwarmAdapter)({...swarm,fetchImpl});
 const lookupAsn=(factories.createCymruLookup??createCymruLookup)();
 const network=(factories.createNetworkPollAdapters??createNetworkPollAdapters)({fetchImpl,lookupAsn});
 const archive=await (factories.openArkivArchive??openArkivArchive)({...arkiv,fetchImpl,hash:keccak256});
 try {
  const app=await (factories.openWatcherApplication??openWatcherApplication)({...watcher,archive,hash:keccak256,upload:bytes=>swarmAdapter.put(bytes),readBaseline,canRecover,poll:site=>{
   if(!siteZones.has(site))throw new Error('unconfigured watcher site');
   return pollSite(site,network,{nameserverZone:siteZones.get(site)});
  }});
  let closed;
  return {...app,close(){if(!closed)closed=(async()=>{await app.close();await archive.close();})();return closed;}};
 } catch(error){await archive.close();throw error;}
}
