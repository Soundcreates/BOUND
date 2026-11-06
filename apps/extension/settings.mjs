// Phase 0 Rabdi/Sepolia test defaults. Reports go to the hosted aggregator; they are
// sealed to its pinned key and sent only while monitoring is on.
export const DEFAULT_SETTINGS=Object.freeze({
 ensRootName:"bound-v2.eth",
 ensResolver:"0xf6efa18d24c108a060b0d2a0e715b9045e09ea0f",
 arkivRpcUrl:"https://rpc.rabdi.db-chain.testnet.arkiv.network",
 watcherOwner:"0xE63393558E36dF643347326E7e03AD5fB0E6c867",
 safePageUrl:"https://bzz.limo/bzz/2ef102c267b6d62900b8c31c25620405d5fff12e22cd01f79038bd3eea0e682c/",
 watcherUrl:"https://bound-aggregator-0-1-1.onrender.com/v1/observations",
 anonBootstrapUrl:"https://ethereum-sepolia-rpc.publicnode.com",
 anonRpcUrl:"https://ethereum-sepolia-rpc.publicnode.com"
});
const URL_FIELDS=["arkivRpcUrl","watcherUrl","anonBootstrapUrl","anonRpcUrl","safePageUrl"];
function cleanUrl(value,{local=false}={}){
 if(value==="")return "";
 let url;try{url=new URL(value);}catch{throw new Error("Enter a valid endpoint URL.");}
 if((url.protocol!=="https:"&&!(local&&url.protocol==="http:"&&["127.0.0.1","localhost","[::1]"].includes(url.hostname)))||url.username||url.password||url.search||url.hash)throw new Error("Endpoints must use HTTPS without credentials or query parameters.");
 return url.toString();
}
export function normalizeSettings(input){
 if(!input||typeof input!=="object"||Array.isArray(input))throw new Error("Invalid settings.");
 const settings={network:"sepolia",ensChainId:11155111,arkivChainId:7794095,anonWorkerId:"nox"};
 for(const name of URL_FIELDS){if(input[name]!==undefined&&typeof input[name]!=="string")throw new Error("Invalid endpoint.");settings[name]=cleanUrl((input[name]??"").trim(),{local:name==="watcherUrl"||name==="safePageUrl"});}
 if(settings.watcherUrl&&new URL(settings.watcherUrl).pathname!=="/v1/observations")throw new Error("The watcher URL must end with /v1/observations.");
 for(const name of ["ensResolver","watcherOwner"]){if(input[name]!==undefined&&typeof input[name]!=="string")throw new Error("Invalid address.");const value=(input[name]??"").trim().toLowerCase();if(value&&!/^0x[0-9a-f]{40}$/.test(value))throw new Error("Enter a valid 20-byte address.");settings[name]=value;}
 if(input.ensRootName!==undefined&&typeof input.ensRootName!=="string")throw new Error("Invalid ENS root name.");const root=(input.ensRootName??"").trim().toLowerCase();if(root&&!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]+$/.test(root))throw new Error("Enter a valid ENS root name.");settings.ensRootName=root;
 return settings;
}

// Without stored settings the extension has no watcher owner, so every request
// is scored grey with nothing checked. Store the defaults once, only when no
// settings exist at all: a saved configuration, including deliberately cleared
// fields, is never overwritten. Returns true when it seeded.
// The intake URL that earlier builds seeded. A configuration still holding exactly that
// default is moved to the hosted aggregator; any other saved value is left alone.
const PREVIOUS_DEFAULT_WATCHER_URL="http://127.0.0.1:8787/v1/observations";
export async function ensureDefaultSettings(storage){
 const {boundSettings}=await storage.get("boundSettings");
 if(boundSettings!==undefined){
  if(boundSettings?.watcherUrl===PREVIOUS_DEFAULT_WATCHER_URL)await storage.set({boundSettings:{...boundSettings,watcherUrl:DEFAULT_SETTINGS.watcherUrl}});
  return false;
 }
 await storage.set({boundSettings:normalizeSettings(DEFAULT_SETTINGS)});
 return true;
}
