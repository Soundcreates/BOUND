import {createPublicClient, custom, parseAbi, encodeFunctionData, decodeFunctionResult, namehash, toHex} from 'viem';
import {packetToBytes} from 'viem/ens';
import {sepolia} from 'viem/chains';
import {ENSV2_SEPOLIA} from '../../integrations/ens/src/addresses.ts';

const KEY='com.bound.frontend-observation.v1';
const resolverAbi=parseAbi(['function text(bytes32 node,string key) view returns (string)']);
const universalAbi=parseAbi(['function findResolver(bytes name) view returns (address,bytes32,uint256)','function resolve(bytes name,bytes data) view returns (bytes,address)']);
const dns=name=>toHex(packetToBytes(name));
const HASH=/^sha256-[A-Za-z0-9+/]{43}=$/;
const unknown=(reason)=>({status:'unavailable',reason});

export async function registryName(host, root, subtle=globalThis.crypto.subtle) {
  const data=new Uint8Array(await subtle.digest('SHA-256',new TextEncoder().encode(host)));
  const label=Array.from(data, x=>x.toString(16).padStart(2,'0')).join('').slice(0,24);
  return `site-${label}.${root}`;
}

export function compareRegistryRecord({host,url,raw,observed,now=Date.now()}) {
  try {
    if(typeof raw!=='string'||raw.length>32768||!raw)return unknown('No registry observation');
    const record=JSON.parse(raw), site=new URL(url);
    if(site.protocol!=='https:'||site.host!==host||record.hostname!==host||record.version!==1||!Array.isArray(record.scripts)||record.scripts.length>12||!['observed','unavailable'].includes(record.status))return unknown('Registry record does not match this host');
    const at=Date.parse(record.observedAt);
    if(!Number.isFinite(at)||at>now||now-at>7*86400000)return unknown('Registry observation is stale or invalid');
    const expected=new Map();
    for(const row of record.scripts){
      if(typeof row?.path!=='string'||!row.path.startsWith('/')||row.path.startsWith('//')||/[?#\\]/.test(row.path)||typeof row.sha256!=='string'||!HASH.test(row.sha256)||expected.has(row.path))return unknown('Invalid registry script data');
      expected.set(row.path,row.sha256);
    }
    if(record.status!=='observed'||!expected.size||!Array.isArray(observed?.scripts))return unknown('Script evidence unavailable');
    let compared=0,changed=0,unfamiliar=0;
    for(const row of observed.scripts){
      if(typeof row?.path!=='string'||typeof row.hash!=='string'||!HASH.test(row.hash))return unknown('Invalid browser script evidence');
      if(!expected.has(row.path)){unfamiliar++;continue;}
      compared++;if(expected.get(row.path)!==row.hash)changed++;
    }
    return {status:changed?'changed':compared?'matched-subset':'unavailable',reason:compared?null:'No matching script paths',compared,changed,unfamiliar,expected:expected.size,observedAt:record.observedAt};
  } catch {return unknown('Invalid registry record');}
}

export async function readEnsRegistry({siteOrigin, settings, anonymousRequest, observed, now=Date.now()}) {
  try {
    const site=new URL(siteOrigin);
    if(site.protocol!=='https:' || site.username || site.password || !site.hostname || site.port || !settings?.ensRootName || !/^0x[0-9a-f]{40}$/i.test(settings?.ensResolver||'') || settings.ensChainId!==11155111 || typeof anonymousRequest!=='function')return unknown('Registry unavailable for this origin');
    const host=site.host, child=await registryName(host,settings.ensRootName);
    const client=createPublicClient({chain:sepolia,transport:custom({request:async({method,params})=>{
      const result=await anonymousRequest({method,params:params??[]});
      if(result?.error||!Object.hasOwn(result??{},'result'))throw Error('Anonymous ENS RPC unavailable');return result.result;
    },retryCount:0})});
    if(await client.getChainId()!==11155111)throw Error('Wrong ENS chain');
    const [resolver]=await client.readContract({address:ENSV2_SEPOLIA.universalResolverV2,abi:universalAbi,functionName:'findResolver',args:[dns(child)]});
    if(resolver.toLowerCase()!==settings.ensResolver.toLowerCase())throw Error('Registry resolver does not match pinned resolver');
    async function text(key) {
      const call=encodeFunctionData({abi:resolverAbi,functionName:'text',args:[namehash(child),key]});
      const [result,used]=await client.readContract({address:ENSV2_SEPOLIA.universalResolverV2,abi:universalAbi,functionName:'resolve',args:[dns(child),call]});
      if(used.toLowerCase()!==settings.ensResolver.toLowerCase())throw Error('ENS resolver changed');
      return decodeFunctionResult({abi:resolverAbi,functionName:'text',data:result});
    }
    const [url,raw]=await Promise.all([text('url'),text(KEY)]);
    return {...compareRegistryRecord({host,url,raw,observed,now}),name:child};
  } catch {return unknown('ENS registry could not be read');}
}
