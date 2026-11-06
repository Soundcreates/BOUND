import {anonRpc} from "./anon-rpc-host.mjs";
let engine,loading,reader,readerLoading;
async function settings(){const {boundSettings}=await chrome.storage.local.get("boundSettings");return boundSettings;}
async function trustEngine(){
 if(!engine){loading??=import("./trust-bundle.js").then(({createTrustEngine})=>createTrustEngine({getSettings:settings,storage:chrome.storage.local,anonymousRequest:anonRpc})).finally(()=>{loading=null;});engine=await loading;}
 return engine;
}
async function arkivReader(){
 if(!reader){readerLoading??=import("./arkiv-bundle.js").then(({createArkivReader})=>createArkivReader({getSettings:settings,storage:chrome.storage.local,anonymousRequest:anonRpc})).finally(()=>{readerLoading=null;});reader=await readerLoading;}
 return reader;
}
export async function getWatcherOwner(){
 const {boundSettings}=await chrome.storage.local.get("boundSettings");const owner=boundSettings?.watcherOwner;
 return typeof owner==="string"&&/^0x[0-9a-f]{40}$/.test(owner)?owner:null;
}
export const decisionAdapters={
 async readVerifiedSnapshot(){return (await trustEngine()).readVerifiedSnapshot();},
 async readProtocolAttestationsViaAnonRpc(query){return (await trustEngine()).readProtocolAttestationsViaAnonRpc(query);},
 async readWatcherBundle(){return (await arkivReader()).readWatcherBundle();},
 async readSiteStatusViaAnonRpc(query){return (await arkivReader()).readSiteStatusViaAnonRpc(query);},
 async readUncuratedViaAnonRpc(query){return (await arkivReader()).readUncuratedViaAnonRpc(query);},
 async refresh(){await Promise.allSettled([trustEngine().then(value=>value.readVerifiedSnapshot()),arkivReader().then(value=>value.refresh())]);}
};
