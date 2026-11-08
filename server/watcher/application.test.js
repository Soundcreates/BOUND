import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {keccak256} from '../../shared/contracts/keccak-reference.js';
import {openWatcherApplication} from './application.js';

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'bound-app-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 let time=0,healthy=false;const statuses=[],drifts=[];
 const baseline={nameservers:['ns1.example'],addresses:['192.0.2.1'],asns:{'192.0.2.1':'64500'},certificate:{fingerprint:'old',issuer:'CA',names:['example.org']}};
 let current={...baseline,nameservers:['ns2.example']};
 const archive={writeObservation:async()=>{},writeBaseline:async()=>{},writeDrift:async record=>drifts.push(record),writeIncident:async()=> '0x'+'a'.repeat(64),writeStatus:async record=>{statuses.push(record);return {state:'current'};}};
 const config={paths:Object.fromEntries(['watcher','drift','publication','incidents'].map(n=>[n,join(dir,n+'.json')])),feeds:[{site:'example.org',chainId:1,feedReference:'0x'+'d'.repeat(64),evidenceReferences:[]}],archive,hash:bytes=>keccak256(bytes),upload:async bytes=>({reference:'b'.repeat(64),digest:keccak256(bytes)}),readBaseline:async()=>baseline,poll:async()=>current,canRecover:async()=>healthy,now:()=>time,maxDriftAgeMs:7200000,renewalWindowMs:3600000,windowMs:3600000,retentionMs:7200000,k:3,allowedOrigins:['chrome-extension://'+'a'.repeat(32)],intervals:{poll:100000,flush:100000,baseline:100000}};
 return {config,statuses,drifts,setTime:v=>time=v,setHealthy:v=>healthy=v,setNormal:()=>current=baseline};
}
test('composition publishes drift, serializes incident status and requires fresh recovery',async t=>{
 const f=await fixture(t),app=await openWatcherApplication(f.config);t.after(()=>app.close());
 await app.runtime.runPoll();assert.equal(f.statuses.at(-1).state,'drift');
 const address=await app.start({port:0});
 const response=await fetch(`http://127.0.0.1:${address.port}/v1/observations`,{method:'POST',headers:{origin:f.config.allowedOrigins[0],'content-type':'application/json'},body:JSON.stringify({schemaVersion:1,events:[{site:'example.org',chainId:1,value:'0x'+'1'.repeat(40),kind:'warned',reporterKey:'key'}]})});assert.equal(response.status,202);
 await app.runtime.runFlush();assert.equal(f.statuses.at(-1).state,'incident');
 f.setTime(3600000);await app.runtime.runPoll();assert.equal(f.statuses.at(-1).state,'incident');
 f.setHealthy(true);await app.runtime.runFlush();assert.equal(f.statuses.at(-1).state,'incident');
 f.setNormal();await app.runtime.runPoll();await app.runtime.runFlush();assert.equal(f.statuses.at(-1).state,'normal');
 assert.equal(f.drifts.length,2);
});
test('journal locks prevent simultaneous instances and are released on close or failed initialization',async t=>{
 const f=await fixture(t),app=await openWatcherApplication(f.config);
 await assert.rejects(openWatcherApplication(f.config),/locked/);await app.close();
 await assert.rejects(app.start(),/closed/);await assert.rejects(app.runtime.runPoll(),/closed/);
 await assert.rejects(openWatcherApplication({...f.config,intervals:{poll:0,flush:1,baseline:1}}),/configuration/);
 const reopened=await openWatcherApplication(f.config);await reopened.close();
 await assert.rejects(openWatcherApplication({...f.config,paths:{...f.config.paths,drift:f.config.paths.watcher}}),/distinct/);
});
test('a clean poll publishes normal after drift without an incident',async t=>{
 const f=await fixture(t),app=await openWatcherApplication(f.config);t.after(()=>app.close());
 await app.runtime.runPoll();assert.equal(f.statuses.at(-1).state,'drift');
 f.config.feeds[0].feedReference='0x'+'e'.repeat(64);
 f.setTime(3600000);f.setNormal();await app.runtime.runPoll();assert.equal(f.statuses.at(-1).state,'normal');
 assert.equal(f.statuses.at(-1).feedReference,'0x'+'d'.repeat(64));
});
test('configured archive renewal is available through the service runtime',async t=>{
 const f=await fixture(t);let calls=0;f.config.archive.renew=async()=>{calls++;};
 const app=await openWatcherApplication(f.config);t.after(()=>app.close());
 await app.runtime.runRenew();assert.equal(calls,1);await app.close();await assert.rejects(app.runtime.runRenew(),/closed/);
});
test('same-hour recovery uses guarded status capability only after a clean poll',async t=>{
 const f=await fixture(t);f.config.windowMs=1;let recoveries=0,approvedEpisode;
 f.config.canRecover=async(_site,_chain,episode)=>{approvedEpisode=episode;return true;};
 f.config.archive.getStatusVersion=async()=> 'version';
 f.config.archive.writeRecoveryStatus=async record=>{recoveries++;f.statuses.push(record);return {state:'current'};};
 const app=await openWatcherApplication(f.config);t.after(()=>app.close());await app.runtime.runPoll();
 const address=await app.start({port:0});
 await fetch(`http://127.0.0.1:${address.port}/v1/observations`,{method:'POST',headers:{origin:f.config.allowedOrigins[0],'content-type':'application/json'},body:JSON.stringify({schemaVersion:1,events:[{site:'example.org',chainId:1,value:'0x'+'1'.repeat(40),kind:'warned',reporterKey:'key'}]})});
 await app.runtime.runFlush();assert.equal(f.statuses.at(-1).state,'incident');
 f.setTime(2);f.setHealthy(true);await app.runtime.runFlush();assert.equal(recoveries,0);
 f.setNormal();await app.runtime.runPoll();assert.equal(recoveries,0);
 await app.runtime.runFlush();assert.equal(recoveries,1);assert.match(approvedEpisode.incidentId,/^[0-9a-f]{64}$/);assert.equal(f.statuses.at(-1).state,'normal');assert.equal(f.statuses.at(-1).updatedAt,'1970-01-01T00:00:00.000Z');
});
test('a clean poll alone cannot recover an incident while a recent warning remains',async t=>{
 const f=await fixture(t),app=await openWatcherApplication(f.config);t.after(()=>app.close());await app.runtime.runPoll();
 const address=await app.start({port:0});
 await fetch(`http://127.0.0.1:${address.port}/v1/observations`,{method:'POST',headers:{origin:f.config.allowedOrigins[0],'content-type':'application/json'},body:JSON.stringify({schemaVersion:1,events:[{site:'example.org',chainId:1,value:'0x'+'1'.repeat(40),kind:'warned',reporterKey:'key'}]})});
 await app.runtime.runFlush();assert.equal(f.statuses.at(-1).state,'incident');
 f.setNormal();f.setHealthy(true);await app.runtime.runPoll();await app.runtime.runFlush();assert.equal(f.statuses.at(-1).state,'incident');
 f.setTime(3600000);await app.runtime.runPoll();await app.runtime.runFlush();assert.equal(f.statuses.at(-1).state,'normal');
});
