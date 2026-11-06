const URL_FIELDS=["ensRpcUrl","arkivRpcUrl","watcherUrl","anonBootstrapUrl","anonRpcUrl"];
function cleanUrl(value,{local=false}={}){
 if(value==="")return "";
 let url;try{url=new URL(value);}catch{throw new Error("Enter a valid endpoint URL.");}
 if((url.protocol!=="https:"&&!(local&&url.protocol==="http:"&&["127.0.0.1","localhost","[::1]"].includes(url.hostname)))||url.username||url.password||url.search||url.hash)throw new Error("Endpoints must use HTTPS without credentials or query parameters.");
 return url.toString();
}
export function normalizeSettings(input){
 if(!input||typeof input!=="object"||Array.isArray(input))throw new Error("Invalid settings.");
 const settings={network:"sepolia",ensChainId:11155111,arkivChainId:7794095,anonWorkerId:"nox"};
 for(const name of URL_FIELDS){if(input[name]!==undefined&&typeof input[name]!=="string")throw new Error("Invalid endpoint.");settings[name]=cleanUrl((input[name]??"").trim(),{local:name==="watcherUrl"});}
 if(settings.watcherUrl&&new URL(settings.watcherUrl).pathname!=="/v1/observations")throw new Error("The watcher URL must end with /v1/observations.");
 for(const name of ["ensResolver","watcherOwner"]){if(input[name]!==undefined&&typeof input[name]!=="string")throw new Error("Invalid address.");const value=(input[name]??"").trim().toLowerCase();if(value&&!/^0x[0-9a-f]{40}$/.test(value))throw new Error("Enter a valid 20-byte address.");settings[name]=value;}
 if(input.ensRootName!==undefined&&typeof input.ensRootName!=="string")throw new Error("Invalid ENS root name.");const root=(input.ensRootName??"").trim().toLowerCase();if(root&&!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]+$/.test(root))throw new Error("Enter a valid ENS root name.");settings.ensRootName=root;
 const gateways=Array.isArray(input.swarmGateways)?input.swarmGateways:typeof input.swarmGateways==="string"?input.swarmGateways.split(/\r?\n/):[];
 if(gateways.some(value=>typeof value!=="string"))throw new Error("Invalid Swarm gateway.");settings.swarmGateways=gateways.map(value=>cleanUrl(value.trim())).filter(Boolean);
 if(settings.swarmGateways.length>8||new Set(settings.swarmGateways.map(value=>new URL(value).origin)).size!==settings.swarmGateways.length)throw new Error("Swarm gateways must have distinct origins.");
 return settings;
}
