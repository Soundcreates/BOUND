import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openExpiryRenewer} from './renewal.js';
const owner='0x'+'a'.repeat(40),key='0x'+'b'.repeat(64),record={schemaVersion:1,kind:'baseline',site:'example.org',chainId:1,counterparties:[],calledContracts:[],updatedAt:'2026-01-01T00:00:00.000Z'};
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'bound-renew-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let block=10,entity={key,owner,expiresAt:30,record},pending=false,fail=false;const calls=[];
 const options={path:join(dir,'journal'),owner,currentBlock:async()=>block,getEntity:async()=>structuredClone(entity),listCurrent:async()=>[{key,record}],hasPending:async()=>pending,recordExtension:async()=>{},lifetimes:{baseline:100,status:100},renewBeforeBlocks:10,extend:async(_record,id,entityKey,lifetime)=>{calls.push({id,entityKey,lifetime});entity={...entity,expiresAt:block+lifetime};if(fail)throw Error('lost acknowledgement');return structuredClone(entity);}};
 return {options,calls,setBlock:value=>block=value,setFail:value=>fail=value,setPending:value=>pending=value,setEntity:value=>entity=value};
}
test('renews only near expiry and resumes the same operation after a lost acknowledgement',async t=>{
 const f=await fixture(t);let renewer=await openExpiryRenewer(f.options);await renewer.renew();assert.equal(f.calls.length,0);
 f.setBlock(20);f.setFail(true);await assert.rejects(renewer.renew(),/lost acknowledgement/);
 const saved=JSON.parse(await readFile(f.options.path,'utf8'));assert.equal(saved.pending.id,f.calls[0].id);
 f.setFail(false);renewer=await openExpiryRenewer(f.options);await renewer.resume();assert.equal(f.calls.length,2);assert.equal(f.calls[0].id,f.calls[1].id);
 assert.equal(JSON.parse(await readFile(f.options.path,'utf8')).pending,null);await renewer.renew();assert.equal(f.calls.length,2);
});
test('does not create a renewal intent while a different transaction is pending',async t=>{
 const f=await fixture(t);f.setBlock(20);f.setPending(true);const renewer=await openExpiryRenewer(f.options);
 await assert.rejects(renewer.renew(),/transaction is pending/);assert.equal(f.calls.length,0);
 await assert.rejects(readFile(f.options.path),{code:'ENOENT'});
});
test('refuses unverified or altered entity and retains pending intent',async t=>{
 const f=await fixture(t);f.setBlock(20);f.setFail(true);let renewer=await openExpiryRenewer(f.options);await assert.rejects(renewer.renew(),/lost acknowledgement/);
 f.setEntity({key,owner:'0x'+'c'.repeat(40),expiresAt:100,record});f.setFail(false);renewer=await openExpiryRenewer(f.options);
 await assert.rejects(renewer.resume(),/unavailable or changed/);assert.equal(f.calls.length,1);
 assert.ok(JSON.parse(await readFile(f.options.path,'utf8')).pending);
});
test('registry expiry is persisted before renewal intent is cleared',async t=>{
 const f=await fixture(t);f.setBlock(20);let fail=true,updates=[];
 f.options.recordExtension=async(...args)=>{updates.push(args);if(fail)throw Error('registry unavailable');};
 let renewer=await openExpiryRenewer(f.options);await assert.rejects(renewer.renew(),/registry unavailable/);
 assert.ok(JSON.parse(await readFile(f.options.path,'utf8')).pending);
 fail=false;renewer=await openExpiryRenewer(f.options);await renewer.resume();
 assert.equal(updates.length,2);assert.equal(updates[1][2],120);assert.equal(JSON.parse(await readFile(f.options.path,'utf8')).pending,null);
});
