import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {openWatcherDeployment} from './deployment.js';
import {Interface} from 'ethers';

function fixture(){
 const calls=[];let application;
 const archive={writeDrift:async()=>{},close:async()=>calls.push('archive closed')};
 const config={arkiv:{},swarm:{},watcher:{feeds:[{site:'a.example.org',chainId:1}]},zones:{'a.example.org':'example.org'},readBaseline:async()=>{},canRecover:async()=>false};
 const factories={createSwarmAdapter:()=>({put:async bytes=>({reference:'b'.repeat(64),bytes})}),createCymruLookup:()=>async()=> '64500',createNetworkPollAdapters:({lookupAsn})=>({lookupAsn,resolve:async(_host,type)=>type==='NS'?['ns.example.org']:['192.0.2.1'],certificate:async()=>({fingerprint:'f',issuer:'ca',names:['a.example.org']})}),openArkivArchive:async()=>archive,openWatcherApplication:async options=>{application=options;return {start:()=>{},close:async()=>calls.push('app closed')};}};
 return {config,factories,calls,getApplication:()=>application};
}
test('deployment wires configured zone, upload and orderly shutdown',async()=>{
 const f=fixture(),deployment=await openWatcherDeployment(f.config,f.factories),app=f.getApplication();
 const sample=await app.poll('a.example.org');assert.deepEqual(sample.nameservers,['ns.example.org']);assert.equal(sample.asns['192.0.2.1'],'64500');
 assert.throws(()=>app.poll('other.example.org'),/unconfigured/);
 assert.equal((await app.upload(new Uint8Array([1]))).reference,'b'.repeat(64));
 await Promise.all([deployment.close(),deployment.close()]);assert.deepEqual(f.calls,['app closed','archive closed']);
});
test('failed application initialization releases archive and missing zones fail before opening it',async()=>{
 const f=fixture();f.factories.openWatcherApplication=async()=>{throw Error('broken application');};
 await assert.rejects(openWatcherDeployment(f.config,f.factories),/broken application/);assert.deepEqual(f.calls,['archive closed']);
 await assert.rejects(openWatcherDeployment({...f.config,zones:{}},f.factories),/zone/);assert.deepEqual(f.calls,['archive closed']);
 await assert.rejects(openWatcherDeployment({...f.config,zones:{'a.example.org':'unrelated.org'}},f.factories),/zone/);assert.deepEqual(f.calls,['archive closed']);
});
test('optional ENS cache job starts with the app, runs on its timer and stops on close',async()=>{
 const f=fixture(),written=[],timers=[];
 f.calls.length=0;
 const archive={writeDrift:async()=>{},writeEnsRecord:async record=>{written.push(record);return {state:'current'};},close:async()=>f.calls.push('archive closed')};
 f.factories.openArkivArchive=async()=>archive;
 f.factories.createJsonRpc=()=>async()=>{throw new Error('unused');};
 f.factories.setInterval=(fn,ms)=>{timers.push({fn,ms});return 7;};
 f.factories.clearInterval=id=>timers.push({cleared:id});
 const base=f.factories.openWatcherApplication;
 f.factories.openWatcherApplication=async options=>({...(await base(options)),start:async()=>({address:'127.0.0.1',port:1})});
 const ensCache={rpcUrl:'https://rpc.example.org',intervalMs:600000,entries:[{site:'a.example.org',chainId:11155111,name:'example.eth',resolver:'0x'+'a'.repeat(40)}]};
 const deployment=await openWatcherDeployment({...f.config,ensCache},f.factories);
 await deployment.start();
 assert.equal(timers[0].ms,600000);
 await deployment.close();
 assert.deepEqual(timers.at(-1),{cleared:7});
 await assert.rejects(openWatcherDeployment({...f.config,ensCache:{...ensCache,intervalMs:5}},f.factories),/interval/);
});

test('default ENS cache read calls the canonical universal resolver and keeps the configured resolver pin',async()=>{
 const f=fixture(),calls=[];
 const archive={writeDrift:async()=>{},writeEnsRecord:async()=>({state:'current'}),close:async()=>{}};
 f.factories.openArkivArchive=async()=>archive;
 f.factories.createJsonRpc=()=>async(method,params)=>{
  calls.push({method,params});
  return method==='eth_chainId'?'0xaa36a7':'0x';
 };
 const resolver='0x'+'a'.repeat(40);
 const deployment=await openWatcherDeployment({...f.config,ensCache:{rpcUrl:'https://rpc.example.org',entries:[{site:'a.example.org',chainId:11155111,name:'example.eth',resolver}]}},f.factories);
 await deployment.runEnsCache();
 const read=calls.find(call=>call.method==='eth_call');
 assert.ok(read,'ENS publisher performed an onchain read');
 assert.equal(read.params[0].to.toLowerCase(),'0xeeeeeeee14d718c2b47d9923deab1335e144eeee');
 const iface=new Interface(['function findResolver(bytes) view returns(address,bytes32,uint256)']);
 assert.equal(read.params[0].data.slice(0,10),iface.getFunction('findResolver').selector);
 // A zero/malformed RPC response cannot satisfy the configured resolver pin.
 assert.deepEqual(await deployment.runEnsCache(),[{site:'a.example.org',chainId:11155111,state:'failed'}]);
 await deployment.close();
});
