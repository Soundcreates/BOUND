import {Contract,Interface,JsonRpcProvider,dnsEncode,ensNormalize,getAddress,namehash} from 'ethers';

// Read-only Phase 0 probe. These deployment addresses are from the ENS Sepolia
// deployments page; this does not establish resolver role permissions.
const chainId=11155111;
const universalResolver='0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe';
const universalHelper='0xd453e5bdb62cc3bea84341b1e306319c8ffd7dfe';
const expectedImplementation='0x115eb53f0c60696633855f90b138178fb40b2b2c';
const implementationSlot='0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const endpoint=process.env.BOUND_ENS_RPC_URL||'https://ethereum-sepolia.publicnode.com';
const expectedChain=Number(process.env.BOUND_ENS_CHAIN_ID||chainId);
const recordKey=process.env.BOUND_ENS_RECORD_KEY||'bound.policy.root';
let url,name,resolver;
try{url=new URL(endpoint);name=ensNormalize(process.env.BOUND_ROOT_NAME||'');resolver=getAddress(process.env.BOUND_RESOLVER_ADDRESS||'');}
catch{throw new Error('invalid ENS probe configuration');}
if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||expectedChain!==chainId||!name||!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(recordKey))throw new Error('invalid ENS probe configuration');

const provider=new JsonRpcProvider(url.toString(),chainId,{staticNetwork:true});
try{
 const actualChain=Number(BigInt(await provider.send('eth_chainId',[])));
 if(actualChain!==chainId)throw new Error('unexpected ENS chain');
 const block=await provider.send('eth_getBlockByNumber',['finalized',false]);
 if(!block||typeof block.number!=='string'||typeof block.hash!=='string')throw new Error('finalized ENS block unavailable');
 const blockTag=block.number,dnsName=dnsEncode(name);
 const universal=new Contract(universalResolver,['function isENSv2() view returns(bool)','function findResolver(bytes) view returns(address,bytes32,uint256)','function resolve(bytes,bytes) view returns(bytes,address)'],provider);
 const helper=new Contract(universalHelper,['function findExactOwner(bytes) view returns(address)','function findParentRegistry(bytes) view returns(address)'],provider);
 const textInterface=new Interface(['function text(bytes32,string) view returns(string)']);
 const [isV2,found,owner,parent,code,slot]=await Promise.all([
  universal.isENSv2({blockTag}),universal.findResolver(dnsName,{blockTag}),helper.findExactOwner(dnsName,{blockTag}),helper.findParentRegistry(dnsName,{blockTag}),
  provider.getCode(resolver,blockTag),provider.getStorage(resolver,implementationSlot,blockTag)
 ]);
 if(!isV2||found[0].toLowerCase()!==resolver.toLowerCase()||found[2]!==0n||code==='0x'||owner==='0x0000000000000000000000000000000000000000')throw new Error('ENS name, resolver, or owner did not match the configured Sepolia deployment');
 const [encoded]=await universal.resolve(dnsName,textInterface.encodeFunctionData('text',[namehash(name),recordKey]),{blockTag});
 const value=textInterface.decodeFunctionResult('text',encoded)[0];
 const implementation=slot.length===66?`0x${slot.slice(-40)}`:null;
 const writer=process.env.ARKIV_TEST_WRITER_ADDRESS;
 console.log(JSON.stringify({network:'sepolia',chainId,blockNumber:Number(BigInt(block.number)),blockHash:block.hash,name,resolver,owner,parentRegistry:parent,exactResolver:true,implementation,officialImplementationMatch:implementation?.toLowerCase()===expectedImplementation,recordKey,rootRecordPresent:value.length>0,ownerDiffersFromArkivWriter:writer?owner.toLowerCase()!==writer.toLowerCase():null,rolePermissionsVerified:false,publicationVerified:false,phase0GatePassed:false}));
}catch(error){
 // Provider error objects can include full URLs; keep configuration out of logs.
 console.error(error.message?.startsWith('ENS ')||error.message==='unexpected ENS chain'||error.message==='finalized ENS block unavailable'?error.message:'ENS read-only probe failed');
 process.exitCode=1;
}finally{await provider.destroy();}
