import test from 'node:test';
import assert from 'node:assert/strict';
import {loadCompileInput,compileSnapshot} from '../../services/curator/src/compile.ts';
import {createTrustEngine} from './trust-engine.mjs';

test('concurrent snapshot checks share one verified root and Arkiv read',async()=>{
 const input=await loadCompileInput('fixtures/snapshots/demo-seed.compile-input.json');
 const built=compileSnapshot(input),key='0x'+'a'.repeat(64),owner='0x'+'b'.repeat(40);
 const root={arkivKey:key,arkivOwner:owner,digest:built.digest,epoch:built.snapshot.epoch,network:'sepolia',schemaVersion:1};
 const data={},settings={ensRootName:built.snapshot.rootName,ensResolver:'0x'+'c'.repeat(40),arkivRpcUrl:'https://arkiv.example'};
 let release,started;const entered=new Promise(resolve=>{started=resolve;});const gate=new Promise(resolve=>{release=resolve;});
 let roots=0,entities=0;
 const engine=createTrustEngine({getSettings:async()=>settings,storage:{get:async k=>({[k]:data[k]}),set:async v=>Object.assign(data,v)},now:()=>Date.parse('2026-11-07T00:00:00Z'),
  readRoot:async()=>{roots++;started();await gate;return root;},
  readArkivSnapshot:async()=>{entities++;return {key,owner,record:{kind:'trust_snapshot',digest:built.digest,epoch:root.epoch,network:'sepolia',canonical:new TextDecoder().decode(built.bytes)}};}
 });
 const first=engine.readVerifiedSnapshot();await entered;const second=engine.readVerifiedSnapshot();release();
 const values=await Promise.all([first,second]);assert.equal(roots,1);assert.equal(entities,1);assert.equal(values[0].root.digest,values[1].root.digest);
});
