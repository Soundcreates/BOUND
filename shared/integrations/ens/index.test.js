import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {Interface,namehash} from 'ethers';
import {canonicalizeJSON} from '../../snapshot/index.js';
import {createENSRootReader,createENSRootPublisher,createProtocolAttestationReader,createProtocolAttestationPublisher} from './index.js';

const scope={chainId:11155111,name:'bound-demo.eth',resolver:'0xc405306d78707eda003bcef387a8277ab5dc36a9',recordKey:'bound.policy.root'};
const universal='0x'+'1'.repeat(40),curator='0x'+'2'.repeat(40),txHash='0x'+'3'.repeat(64);
const root={schemaVersion:1,network:'test',epoch:1,digest:'0x'+'4'.repeat(64),swarmReference:'5'.repeat(64)};
const universalAbi=new Interface(['function findResolver(bytes) view returns(address,bytes32,uint256)','function resolve(bytes,bytes) view returns(bytes,address)']);
const textAbi=new Interface(['function text(bytes32,string) view returns(string)','function setText(bytes,string,string)']);
function provider(id,text,{resolver=scope.resolver,chain='0xaa36a7',offset=0n}={}){
 return {id,rpc:async(method,params)=>{
  if(method==='eth_chainId')return chain;
  assert.equal(method,'eth_call');assert.equal(params[0].to,universal);assert.equal(params[1],'finalized');
  const parsed=universalAbi.parseTransaction({data:params[0].data});
  if(parsed.name==='findResolver')return universalAbi.encodeFunctionResult('findResolver',[resolver,namehash(scope.name),offset]);
  return universalAbi.encodeFunctionResult('resolve',[textAbi.encodeFunctionResult('text',[text]),resolver]);
 }};
}
test('root reads require the pinned exact resolver and agreement',async()=>{
 const value=canonicalizeJSON(root),reader=createENSRootReader({scope,network:'test',universalResolver:universal,providers:[provider('a',value),provider('b',value)]});
 assert.deepEqual((await reader.read()).root,root);
 const different=createENSRootReader({scope,network:'test',universalResolver:universal,providers:[provider('a',value),provider('b','')]});
 await assert.rejects(different.read(),/disagreement/);
 const wrong=createENSRootReader({scope,network:'test',universalResolver:universal,providers:[provider('a',value,{offset:4n})],allowSingleProvider:true});
 await assert.rejects(wrong.read(),/resolver/);
 assert.throws(()=>createENSRootReader({scope,network:'test',universalResolver:universal,providers:[provider('a',value)]}),/providers/);
});
test('empty roots are explicit and malformed or wrong-network records fail',async()=>{
 const options={scope,network:'test',universalResolver:universal,allowSingleProvider:true};
 assert.equal((await createENSRootReader({...options,providers:[provider('a','')]}).read()).root,null);
 await assert.rejects(createENSRootReader({...options,providers:[provider('a','{"epoch":1,"epoch":2}')]}).read(),/root/);
 await assert.rejects(createENSRootReader({...options,providers:[provider('a',canonicalizeJSON({...root,network:'other'}))]}).read(),/root/);
});
test('publisher requires increasing epoch, verified receipt and matching readback',async()=>{
 let current=null,sends=0;
 const reader={read:async()=>({root:current,source:scope})};
 const publisher=createENSRootPublisher({scope,network:'test',curator,reader,sendOnce:async request=>{
  sends++;assert.equal(request.chainId,scope.chainId);assert.equal(request.from,curator);assert.equal(request.to,scope.resolver);
  const call=textAbi.parseTransaction({data:request.data});assert.equal(call.name,'setText');assert.equal(call.args[1],scope.recordKey);current=JSON.parse(call.args[2]);
  return {status:'confirmed',chainId:scope.chainId,from:curator,to:scope.resolver,transactionHash:txHash};
 }});
 assert.equal((await publisher.publish(root)).transactionHash,txHash);assert.equal(sends,1);
 await assert.rejects(publisher.publish(root),/increase/);assert.equal(sends,1);
 const bad=createENSRootPublisher({scope,network:'test',curator,reader:{read:async()=>({root:null,source:scope})},sendOnce:async()=>({status:'pending'})});
 await assert.rejects(bad.publish(root),/receipt/);
});
test('protocol attestations are bound to a preconfigured site, chain and ENS scope',async()=>{
 const site='protocol.example',chainId=1,record={schemaVersion:1,site,chainId,addresses:['0x'+'4'.repeat(40)]};let text=canonicalizeJSON(record);
 const textReader={read:async()=>({text,source:scope})};
 const reader=createProtocolAttestationReader({scope,site,chainId,textReader});
 assert.deepEqual(await reader.read(site,chainId),[{address:record.addresses[0],site,chainId,verified:true}]);
 await assert.rejects(reader.read('other.example',chainId),/scope/);
 text=canonicalizeJSON({...record,chainId:2});await assert.rejects(reader.read(site,chainId),/attestation/);
 const publisher=createProtocolAttestationPublisher({scope,site,chainId,protocolAccount:curator,textReader,sendOnce:async request=>{const call=textAbi.parseTransaction({data:request.data});text=call.args[2];return {status:'confirmed',chainId:scope.chainId,from:curator,to:scope.resolver,transactionHash:txHash};}});
 assert.equal((await publisher.publish(record)).transactionHash,txHash);assert.equal((await reader.read(site,chainId))[0].address,record.addresses[0]);
});
