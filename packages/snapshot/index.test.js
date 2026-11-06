import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readFile} from 'node:fs/promises';
import {keccak256} from 'ethers';
import {canonicalizeJSON,compileSnapshot,createSnapshotVerifier} from './index.js';

const fixture=JSON.parse(await readFile(new URL('../../fixtures/contracts/snapshot.json',import.meta.url),'utf8'));
const expected=JSON.parse(await readFile(new URL('../../fixtures/contracts/snapshot-digest.json',import.meta.url),'utf8'));
const canonical=await readFile(new URL('../../fixtures/contracts/snapshot-canonical.json',import.meta.url),'utf8');
const scope={chainId:11155111,name:'bound-demo.eth',resolver:'0xc405306d78707eda003bcef387a8277ab5dc36a9',recordKey:'bound.policy.root'};
const time=Date.parse('2026-06-01T00:00:00.000Z');
const memory=()=>{const data=new Map();return {data,async get(k){return structuredClone(data.get(k));},async set(k,v){data.set(k,structuredClone(v));}};};
const rootFor=(snapshot,reference='a'.repeat(64))=>{const compiled=compileSnapshot(snapshot);return {...compiled,root:{schemaVersion:1,network:snapshot.network,epoch:snapshot.epoch,digest:compiled.digest,swarmReference:reference}};};

test('canonical snapshot and Keccak match the independently checked fixture',()=>{
 const result=compileSnapshot(fixture);
 assert.equal(result.canonical,canonical);assert.equal(result.digest,expected.digest);
 assert.equal(canonicalizeJSON({z:[3,2],a:{b:true,a:null}}),'{"a":{"a":null,"b":true},"z":[3,2]}');
 assert.throws(()=>canonicalizeJSON({value:'\ud800'}),/Unicode/);
 const accessor={};Object.defineProperty(accessor,'a',{enumerable:true,get(){throw Error('getter invoked');}});
 assert.throws(()=>canonicalizeJSON(accessor),/property/);
});

test('verified snapshots persist and reject tampering, rollback and same-epoch equivocation',async()=>{
 const store=memory(),verifier=createSnapshotVerifier({scope,network:'test',store,now:()=>time}),first=rootFor(fixture);
 const accepted=await verifier.accept({source:scope,root:first.root,bytes:first.bytes});
 assert.equal(accepted.snapshot.epoch,1);assert.ok(Object.isFrozen(accepted.snapshot));
 const second=rootFor({...fixture,epoch:2});await verifier.accept({source:scope,root:second.root,bytes:second.bytes});
 const restarted=createSnapshotVerifier({scope,network:'test',store,now:()=>time});
 await assert.rejects(restarted.accept({source:scope,root:first.root,bytes:first.bytes}),/rollback/);
 await assert.rejects(restarted.accept({source:scope,root:{...second.root,swarmReference:'b'.repeat(64)},bytes:second.bytes}),/equivocation/);
 const altered=second.bytes.slice();altered[altered.length-2]^=1;
 await assert.rejects(restarted.accept({source:scope,root:second.root,bytes:altered}));
 assert.equal((await restarted.cached()).snapshot.epoch,2);
});

test('scope, canonical bytes, duplicate keys and epoch equality are mandatory',async()=>{
 const store=memory(),verifier=createSnapshotVerifier({scope,network:'test',store,now:()=>time}),item=rootFor(fixture);
 await assert.rejects(verifier.accept({source:{...scope,chainId:1},root:item.root,bytes:item.bytes}),/scope/);
 await assert.rejects(verifier.accept({source:scope,root:{...item.root,epoch:2},bytes:item.bytes}),/verification/);
 const noncanonical=new TextEncoder().encode(JSON.stringify(fixture,null,2));
 await assert.rejects(verifier.accept({source:scope,root:{...item.root,digest:keccak256(noncanonical)},bytes:noncanonical}),/verification/);
 const duplicate=new TextEncoder().encode('{"schemaVersion":1,"schemaVersion":1}');
 await assert.rejects(verifier.accept({source:scope,root:{...item.root,digest:keccak256(duplicate)},bytes:duplicate}),/bytes/);
 assert.equal(await verifier.cached(),null);
});

test('expired cache grants no trust and cannot lower the persisted watermark',async()=>{
 const store=memory(),item=rootFor(fixture);let now=time;
 const verifier=createSnapshotVerifier({scope,network:'test',store,now:()=>now});
 await verifier.accept({source:scope,root:item.root,bytes:item.bytes});
 now=Date.parse(fixture.expiresAt);assert.equal(await verifier.cached(),null);
 await assert.rejects(verifier.accept({source:scope,root:item.root,bytes:item.bytes}),/validity/);
 const older={...fixture,epoch:0};assert.throws(()=>compileSnapshot(older),/snapshot/);
 assert.equal(store.data.size,1);
});

test('inputs are captured before asynchronous storage operations',async()=>{
 const store=memory(),verifier=createSnapshotVerifier({scope,network:'test',store,now:()=>time}),item=rootFor(fixture),input={source:{...scope},root:{...item.root},bytes:item.bytes.slice()};
 const pending=verifier.accept(input);input.root.epoch=50;input.bytes[0]=0;input.source.chainId=1;
 assert.equal((await pending).snapshot.epoch,1);
});
