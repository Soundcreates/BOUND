import {Interface,dnsEncode,getAddress,keccak256,namehash,toUtf8Bytes} from 'ethers';
import {canonicalizeJSON,normalizeEnsScope} from '../../snapshot/index.js';
import {parseUniqueJSON,validateRoot} from '../../contracts/index.js';

const universalAbi=new Interface(['function findResolver(bytes) view returns(address,bytes32,uint256)','function resolve(bytes,bytes) view returns(bytes,address)']);
const textAbi=new Interface(['function text(bytes32,string) view returns(string)','function setText(bytes,string,string)']);
const address=value=>{try{return getAddress(value).toLowerCase();}catch{throw new Error('invalid ENS address');}};
const copy=value=>parseUniqueJSON(canonicalizeJSON(value));

// Providers are configured independently. An eligible per-site lookup must
// supply Anon-RPC-backed providers; this module never makes a direct request.
export function createPinnedTextReader({scope,universalResolver,providers,allowSingleProvider=false}){
 const pinned=normalizeEnsScope(scope),universal=address(universalResolver),dns=dnsEncode(pinned.name);
 if(!Array.isArray(providers)||providers.length<1||providers.length>2||(providers.length===1&&!allowSingleProvider)||providers.some(p=>!p||typeof p.id!=='string'||!p.id||typeof p.rpc!=='function')||new Set(providers.map(p=>p.id)).size!==providers.length)throw new Error('invalid ENS providers');
 async function from(provider){
  const chain=await provider.rpc('eth_chainId',[]);
  if(typeof chain!=='string'||!/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(chain)||BigInt(chain)!==BigInt(pinned.chainId))throw new Error('unexpected ENS chain');
  const call=async data=>provider.rpc('eth_call',[{to:universal,data},'finalized']);
  let found,resolved;
  try{
   found=universalAbi.decodeFunctionResult('findResolver',await call(universalAbi.encodeFunctionData('findResolver',[dns])));
   if(address(found[0])!==pinned.resolver||found[1].toLowerCase()!==namehash(pinned.name)||found[2]!==0n)throw new Error();
   const request=textAbi.encodeFunctionData('text',[namehash(pinned.name),pinned.recordKey]);
   resolved=universalAbi.decodeFunctionResult('resolve',await call(universalAbi.encodeFunctionData('resolve',[dns,request])));
   if(address(resolved[1])!==pinned.resolver)throw new Error();
   const text=textAbi.decodeFunctionResult('text',resolved[0])[0];
   if(typeof text!=='string'||text.length>65536)throw new Error();
   return text;
  }catch{throw new Error('ENS resolver read failed');}
 }
 async function read(){
  const values=await Promise.all(providers.map(from));
  if(values.some(value=>value!==values[0]))throw new Error('ENS provider disagreement');
  return {text:values[0],source:{...pinned},assurance:providers.length===2?'provider-agreement':'pinned-provider'};
 }
 return {read,scope:{...pinned}};
}

export function createENSRootReader({network,...options}){
 if(typeof network!=='string'||!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(network))throw new Error('invalid ENS network');
 const textReader=createPinnedTextReader(options);
 async function read(){
  const result=await textReader.read();if(result.text==='')return {...result,root:null};
  let root;try{root=parseUniqueJSON(result.text);}catch{throw new Error('invalid ENS root');}
  if(!validateRoot(root)||root.network!==network||canonicalizeJSON(root)!==result.text)throw new Error('invalid ENS root');
  return {root,source:result.source,assurance:result.assurance};
 }
 return {read,scope:textReader.scope};
}

// sendOnce must journal signed bytes before broadcast and verify the receipt.
// Ambiguous submissions are surfaced; this publisher never creates replacements.
export function createENSRootPublisher({scope,network,curator,reader,sendOnce}){
 const pinned=normalizeEnsScope(scope),signer=address(curator);
 if(!reader||typeof reader.read!=='function'||typeof sendOnce!=='function'||typeof network!=='string')throw new Error('invalid ENS publisher configuration');
 let queue=Promise.resolve();
 async function publish(input){
  const root=copy(input);
  if(!validateRoot(root)||root.network!==network)throw new Error('invalid ENS root');
  const run=queue.then(async()=>{
   const current=await reader.read();
   if(!current||canonicalizeJSON(normalizeEnsScope(current.source))!==canonicalizeJSON(pinned))throw new Error('ENS scope mismatch');
   if(current.root!==null&&(!validateRoot(current.root)||current.root.network!==network))throw new Error('invalid current ENS root');
   if(current.root&&root.epoch<=current.root.epoch)throw new Error('ENS epoch must increase');
   const data=textAbi.encodeFunctionData('setText',[dnsEncode(pinned.name),pinned.recordKey,canonicalizeJSON(root)]);
   const operationId=keccak256(toUtf8Bytes(canonicalizeJSON({scope:pinned,root})));
   const receipt=await sendOnce({operationId,chainId:pinned.chainId,from:signer,to:pinned.resolver,value:'0x0',data});
   if(!receipt||receipt.status!=='confirmed'||receipt.chainId!==pinned.chainId||address(receipt.from)!==signer||address(receipt.to)!==pinned.resolver||typeof receipt.transactionHash!=='string'||!/^0x[0-9a-f]{64}$/.test(receipt.transactionHash))throw new Error('unverified ENS receipt');
   const after=await reader.read();
   if(!after?.root||canonicalizeJSON(normalizeEnsScope(after.source))!==canonicalizeJSON(pinned)||canonicalizeJSON(after.root)!==canonicalizeJSON(root))throw new Error('ENS publication readback mismatch');
   return {root,transactionHash:receipt.transactionHash};
  });
  queue=run.catch(()=>{});return run;
 }
 return {publish};
}

function attestation(value,site,chainId){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==4||!['schemaVersion','site','chainId','addresses'].every(key=>Object.hasOwn(value,key))||value.schemaVersion!==1||value.site!==site||value.chainId!==chainId||!Array.isArray(value.addresses)||!value.addresses.every((item,index)=>typeof item==='string'&&/^0x[0-9a-f]{40}$/.test(item)&&(!index||value.addresses[index-1]<item)))throw new Error('invalid protocol attestation');
 return value;
}
function protocolMapping({scope,site,chainId}){
 const pinned=normalizeEnsScope(scope);let url;
 try{url=new URL(`https://${site}`);}catch{throw new Error('invalid protocol mapping');}
 if(typeof site!=='string'||url.host!==site||url.pathname!=='/'||url.username||url.password||url.search||url.hash||!Number.isSafeInteger(chainId)||chainId<1)throw new Error('invalid protocol mapping');
 return {pinned,site,chainId};
}

// The site-to-ENS mapping must come from a curator-verified configuration.
// The text reader must use Anon-RPC for these per-site lookups.
export function createProtocolAttestationReader({scope,site,chainId,textReader}){
 const mapping=protocolMapping({scope,site,chainId});
 if(!textReader||typeof textReader.read!=='function')throw new Error('invalid protocol reader');
 async function read(requestedSite,requestedChain){
  if(requestedSite!==site||requestedChain!==chainId)throw new Error('protocol scope mismatch');
  const response=await textReader.read();
  if(!response||canonicalizeJSON(normalizeEnsScope(response.source))!==canonicalizeJSON(mapping.pinned))throw new Error('ENS scope mismatch');
  if(response.text==='')return [];
  let parsed;try{parsed=parseUniqueJSON(response.text);}catch{throw new Error('invalid protocol attestation');}
  attestation(parsed,site,chainId);
  if(canonicalizeJSON(parsed)!==response.text)throw new Error('invalid protocol attestation');
  return parsed.addresses.map(value=>({address:value,site,chainId,verified:true}));
 }
 return {read};
}

export function createProtocolAttestationPublisher({scope,site,chainId,protocolAccount,textReader,sendOnce}){
 const mapping=protocolMapping({scope,site,chainId}),signer=address(protocolAccount);
 if(!textReader||typeof textReader.read!=='function'||typeof sendOnce!=='function')throw new Error('invalid protocol publisher');
 let queue=Promise.resolve();
 async function publish(input){
  const record=attestation(copy(input),site,chainId);
  const run=queue.then(async()=>{
   const before=await textReader.read();
   if(!before||canonicalizeJSON(normalizeEnsScope(before.source))!==canonicalizeJSON(mapping.pinned))throw new Error('ENS scope mismatch');
   const data=textAbi.encodeFunctionData('setText',[dnsEncode(mapping.pinned.name),mapping.pinned.recordKey,canonicalizeJSON(record)]);
   const operationId=keccak256(toUtf8Bytes(canonicalizeJSON({scope:mapping.pinned,record})));
   const receipt=await sendOnce({operationId,chainId:mapping.pinned.chainId,from:signer,to:mapping.pinned.resolver,value:'0x0',data});
   if(!receipt||receipt.status!=='confirmed'||receipt.chainId!==mapping.pinned.chainId||address(receipt.from)!==signer||address(receipt.to)!==mapping.pinned.resolver||typeof receipt.transactionHash!=='string'||!/^0x[0-9a-f]{64}$/.test(receipt.transactionHash))throw new Error('unverified ENS receipt');
   const after=await textReader.read();
   if(!after||canonicalizeJSON(normalizeEnsScope(after.source))!==canonicalizeJSON(mapping.pinned)||after.text!==canonicalizeJSON(record))throw new Error('protocol publication readback mismatch');
   return {record,transactionHash:receipt.transactionHash};
  });
  queue=run.catch(()=>{});return run;
 }
 return {publish};
}
