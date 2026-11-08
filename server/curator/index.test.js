import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readFile} from 'node:fs/promises';
import {keccak256} from 'ethers';
import {createCurator} from './index.js';

const snapshot=JSON.parse(await readFile(new URL('../../fixtures/contracts/snapshot.json',import.meta.url),'utf8'));
const now=Date.parse('2026-06-01T00:00:00Z'),reference='a'.repeat(64),tx='0x'+'b'.repeat(64);
test('curator verifies uploaded bytes before publishing the coherent root',async()=>{
 let bytes,published;
 const curator=createCurator({network:'test',now:()=>now,rootReader:{read:async()=>({root:null})},swarm:{put:async value=>{bytes=value;return {reference,digest:keccak256(value)};},verifyIndependent:async()=>bytes},rootPublisher:{publish:async root=>{published=root;return {transactionHash:tx};}}});
 const result=await curator.publish(snapshot);assert.equal(result.root.epoch,1);assert.equal(published.digest,keccak256(bytes));assert.equal(result.transactionHash,tx);
});
test('rollback and mismatched storage never publish a root',async()=>{
 let uploads=0,publishes=0;
 const opts={network:'test',now:()=>now,rootReader:{read:async()=>({root:{schemaVersion:1,network:'test',epoch:1,digest:'0x'+'c'.repeat(64),swarmReference:reference}})},swarm:{put:async value=>{uploads++;return {reference,digest:keccak256(value)};},verifyIndependent:async()=>new Uint8Array([0])},rootPublisher:{publish:async()=>{publishes++;}}};
 await assert.rejects(createCurator(opts).publish(snapshot),/increase/);assert.equal(uploads,0);
 opts.rootReader={read:async()=>({root:null})};await assert.rejects(createCurator(opts).publish(snapshot),/mismatch/);assert.equal(publishes,0);
});
