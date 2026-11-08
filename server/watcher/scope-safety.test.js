import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {parseNormalScopes,createScopeSafety} from './scope-safety.js';
test('normal scopes require explicit declaration and are overridden by risk',async()=>{
 const normalScopes=parseNormalScopes('localhost:4173,example.org:8080@2',1);let status=null,triggers=[];
 const resolve=createScopeSafety({normalScopes,watcher:{triggers:async()=>triggers},archive:{getLatestStatus:async()=>status}});
 assert.deepEqual(await resolve({site:'localhost:4173',chainId:1}),{known:true,rawDrift:false,incident:false});
 assert.equal((await resolve({site:'other.org',chainId:1})).known,false);
 status={state:'incident'};assert.deepEqual(await resolve({site:'localhost:4173',chainId:1}),{known:false,rawDrift:false,incident:true});
 status={state:'drift'};assert.equal((await resolve({site:'localhost:4173',chainId:1})).rawDrift,true);
 status=null;triggers=[{}];assert.equal((await resolve({site:'localhost:4173',chainId:1})).rawDrift,true);
 for(const value of ['a@','a@1@2','https://example.org','a,,b','a@0']) assert.throws(()=>parseNormalScopes(value,1));
});

test('drift remains sticky through expiry until version-bound independent approval, then fresh reports are required',async t=>{
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises'); const {join}=await import('node:path'); const {tmpdir}=await import('node:os');
 const {createRecoveryApprovalPolicy}=await import('./recovery-approval.js'); const {recoverLocalDrift}=await import('./scope-safety.js'); const {openFrontendAggregator}=await import('./frontend.js');
 const dir=await mkdtemp(join(tmpdir(),'local-recovery-')); t.after(()=>rm(dir,{recursive:true,force:true}));
 let time=1000000000, status={state:'drift'}, version='a'.repeat(64), quiet=false; const writes=[];
 const watcher={triggers:async()=>[],recoveryQuiet:async()=>quiet};
 const archive={getLatestStatus:async()=>status,getStatusVersion:async()=>version,writeRecoveryStatus:async(record,id,expected)=>{if(expected!==version) throw Error('stale'); status=record;version='b'.repeat(64);return {state:'current'};}};
 const approval=join(dir,'approval.json'); const canRecover=createRecoveryApprovalPolicy({path:approval,now:()=>time});
 const safety=createScopeSafety({normalScopes:[{site:'example.org',chainId:1}],watcher,archive});
 const aggregator=await openFrontendAggregator({path:join(dir,'journal'),now:()=>time,getScopeSafety:safety,writeFrontend:async r=>{writes.push(r);return {state:'current'};}}); t.after(()=>aggregator.close());
 const event=key=>({site:'example.org',chainId:1,kind:'frontend',reporterKey:key,path:'/a.js',hash:'sha256-'+Buffer.alloc(32,1).toString('base64')});
 await aggregator.intake(['a','b','c'].map(event)); time+=48*3600000; quiet=true;
 const args={site:'example.org',chainId:1,watcher,archive,canRecover,makeStatus:()=>({state:'normal'}),operationId:()=> 'id'};
 assert.equal(await recoverLocalDrift(args),false); await aggregator.publish(); assert.equal(writes.length,0);
 await writeFile(approval,JSON.stringify({version:1,approvals:[{site:'example.org',chainId:1,incidentId:version,expiresAt:time+1000}]}));
 assert.equal(await recoverLocalDrift(args),true); await aggregator.publish(); assert.equal(writes.length,0);
 await aggregator.intake(['d','e','f'].map(event)); time+=3600000; await aggregator.publish(); assert.equal(writes[0].scripts[0].established,true);
});


test('normal scope site length is bounded to 253 characters',()=>{
 const site='a'.repeat(63)+'.'+'b'.repeat(63)+'.'+'c'.repeat(63)+'.'+'d'.repeat(61);
 assert.equal(site.length,253);assert.deepEqual(parseNormalScopes(site,1),[{site,chainId:1}]);
 assert.throws(()=>parseNormalScopes(site+'e',1));
});

test('pending committed drift is reconciled before normal publication and requires independent approval',async t=>{
 const {openArkivUpsert}=await import('../../shared/integrations/arkiv/upsert.js');
 const {publishLocalStatus}=await import('./scope-safety.js');
 const dir=await mkdtemp(join(tmpdir(),'status-pending-')); t.after(()=>rm(dir,{recursive:true,force:true}));
 const owner='0x'+'a'.repeat(40),key='0x'+'b'.repeat(64),ref='0x'+'c'.repeat(64),site='example.com',chainId=1; let remote=null,fail=true,approvals=0;
 const risk={schemaVersion:1,kind:'status',site,chainId,state:'drift',feedReference:ref,incidentReference:null,updatedAt:'2026-01-01T00:00:00.000Z'};
 const normal={...risk,state:'normal',updatedAt:'2026-01-01T01:00:00.000Z'};
 const opts={path:join(dir,'registry'),owner,currentBlock:async()=>1,getEntity:async()=>remote,create:async record=>{remote={key,owner,expiresAt:100,record:structuredClone(record)};if(fail){fail=false;throw Error('lost ack');}return remote;},patch:async record=>remote={...remote,record:structuredClone(record)}};
 let upsert=await openArkivUpsert(opts); const riskId='a'.repeat(64); await assert.rejects(upsert.write(risk,riskId),/lost ack/); upsert=await openArkivUpsert(opts);
 const archive={reconcileStatus:(...args)=>upsert.reconcileStatus(...args),getStatusVersion:async()=> (await upsert.latestStatus(site,chainId))?.id??null,getLatestStatus:async()=> (await upsert.latestStatus(site,chainId))?.record??null,writeStatus:(record,id,version)=>upsert.write(record,id,{expectedVersion:version}),writeRecoveryStatus:(record,id,version)=>upsert.write(record,id,{recoverFrom:version})};
 const args={site,chainId,state:'normal',status:normal,statusId:'b'.repeat(64),watcher:{recoveryQuiet:async()=>true},archive,canRecover:async()=>{approvals++;return false;},operationId:()=> 'd'.repeat(64)};
 assert.equal(await publishLocalStatus(args),false); assert.equal(approvals,1); assert.equal(remote.record.state,'drift');
 await assert.rejects(upsert.write(normal,'e'.repeat(64)),/recovery approval/);
 args.canRecover=async(s,c,{incidentId})=>incidentId===riskId; await publishLocalStatus(args); assert.equal(remote.record.state,'normal');
});
