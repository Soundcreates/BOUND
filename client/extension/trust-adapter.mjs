import {anonRpc} from "./anon-rpc-host.mjs";
import {createEnsLookupCache} from "./ens-cache.mjs";
import {createTrustEngine} from "./trust-engine.mjs";
import {createArkivReader} from "./arkiv-reader.mjs";
import {readEnsRegistry} from "./ens-registry.mjs";
import {normalizeSettings} from "./settings.mjs";
// L1 of the ENS lookup cache: in memory, mirrored to chrome.storage.session.
const ensCache=createEnsLookupCache({storage:chrome.storage.session});
// ENS/digest audit trail, printed in the service-worker console
// (chrome://extensions -> BOUND -> "service worker"). Silence it from that
// console with: globalThis.BOUND_ENS_AUDIT=false
function ensAuditLog(level,step,details){
 if(globalThis.BOUND_ENS_AUDIT===false)return;
 const write=typeof console[level]==="function"?console[level]:console.info;
 write.call(console,`[BOUND ENS] ${step}`,details);
}
let engine,reader;
async function settings(){const {boundSettings}=await chrome.storage.local.get("boundSettings");return boundSettings;}
async function trustEngine(){
 if(!engine)engine=createTrustEngine({getSettings:settings,storage:chrome.storage.local,anonymousRequest:anonRpc,readArkivSnapshot:async query=>(await arkivReader()).readTrustSnapshot(query),ensCache,readEnsRecord:async query=>(await arkivReader()).readEnsRecord(query),log:ensAuditLog});
 return engine;
}
async function arkivReader(){
 if(!reader)reader=createArkivReader({getSettings:settings,storage:chrome.storage.local,anonymousRequest:anonRpc});
 return reader;
}
export async function getWatcherOwner(){
 const {boundSettings}=await chrome.storage.local.get("boundSettings");const owner=boundSettings?.watcherOwner;
 return typeof owner==="string"&&/^0x[0-9a-f]{40}$/.test(owner)?owner:null;
}
export const decisionAdapters={
 async readVerifiedSnapshot(){return (await trustEngine()).readVerifiedSnapshot();},
 async readProtocolAttestationsViaAnonRpc(query){return (await trustEngine()).readProtocolAttestationsViaAnonRpc(query);},
 async readProtocolAttestations(query){return (await trustEngine()).readProtocolAttestations(query);},
 async readWatcherBundle(){return (await arkivReader()).readWatcherBundle();},
 async readSiteStatusViaAnonRpc(query){return (await arkivReader()).readSiteStatusViaAnonRpc(query);},
 async readUncuratedViaAnonRpc(query){return (await arkivReader()).readUncuratedViaAnonRpc(query);},
 async refreshWatcherBundle(){return (await arkivReader()).refresh();},
 async readFrontendCommunity(query){return (await arkivReader()).ensureCommunity(query);},
 async readIncidentHistory(query){return (await arkivReader()).readIncidentHistory(query);},
 async readEnsRegistry(query){return readEnsRegistry({...query,settings:normalizeSettings((await settings())||{}),anonymousRequest:anonRpc});},
 async refresh(){await Promise.allSettled([trustEngine().then(value=>value.readVerifiedSnapshot()),arkivReader().then(value=>value.refresh())]);}
};
