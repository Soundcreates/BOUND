import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {openFrontendAggregator} from './frontend.js';

const hour=3600000, day=24*hour, hash='sha256-'+Buffer.alloc(32,1).toString('base64');
const event=(key,path='/a.js')=>({site:'example.com',kind:'frontend',chainId:1,reporterKey:key,path,hash});
async function fixture(fn) {
 const dir=await mkdtemp(join(tmpdir(),'frontend-')); const path=join(dir,'journal.json'); let time=1000000000, safety={known:true,rawDrift:false,incident:false}, writes=[]; let fail=false;
 const options={path,now:()=>time,getScopeSafety:async()=>safety,writeFrontend:async(record,id)=>{writes.push({record,id});if(fail) throw Error('lost acknowledgement');return {state:'current'};}};
 let watcher=await openFrontendAggregator(options);
 try {await fn({path,options,get watcher(){return watcher;},set watcher(v){watcher=v;},get writes(){return writes;},set time(v){time=v;},get time(){return time;},set safety(v){safety=v;},set fail(v){fail=v;}});} finally {await watcher.close();await rm(dir,{recursive:true,force:true});}
}
test('maturity, replay, refresh, retirement and withdrawal',()=>fixture(async f=>{
 await f.watcher.intake([event('a'),event('b'),event('a')]); await f.watcher.publish(); assert.equal(f.writes.at(-1).record.scripts[0].reporters,2);
 await f.watcher.intake([event('c')]); f.time+=hour-1; await f.watcher.publish(); assert.equal(f.writes.at(-1).record.scripts[0].established,false);
 f.time++; await f.watcher.publish(); assert.equal(f.writes.at(-1).record.scripts[0].established,true);
 const t=f.time; await f.watcher.intake([event('a')]); let j=JSON.parse(await readFile(f.path)); assert.equal(j.tuples[0].reporters[0].lastReceipt,t-hour);
 f.time=t-hour+day; await f.watcher.intake([event('a')]); j=JSON.parse(await readFile(f.path)); assert.equal(j.tuples[0].reporters[0].lastReceipt,f.time);
 f.time+=2*day; await f.watcher.publish(); assert.deepEqual(f.writes.at(-1).record.scripts,[]);
}));
test('unsafe scopes quarantine and recovery discards history',()=>fixture(async f=>{
 for(const safety of [{known:false,rawDrift:false,incident:false},{known:true,rawDrift:true,incident:false},{known:true,rawDrift:false,incident:true}]) {f.safety=safety; await f.watcher.intake([event('a'),event('b'),event('c')]); f.time+=hour; await f.watcher.publish(); assert.equal(f.writes.length,0); f.safety={known:true,rawDrift:false,incident:false}; await f.watcher.publish(); assert.equal(f.writes.length,0);}
 await f.watcher.intake([event('d'),event('e')]); await f.watcher.publish(); assert.equal(f.writes.at(-1).record.scripts[0].reporters,2);
}));
test('outbox survives failure and reopening with exact record',()=>fixture(async f=>{
 await f.watcher.intake([event('a'),event('b')]); f.fail=true; await assert.rejects(f.watcher.publish()); const original=f.writes[0]; await f.watcher.close(); f.watcher=await openFrontendAggregator(f.options); f.time+=hour; f.fail=false; await f.watcher.publish(); assert.deepEqual(f.writes[1],original);
 const j=JSON.parse(await readFile(f.path)); assert.deepEqual(Object.keys(j),['version','lastNow','tuples','publications']); assert.deepEqual(Object.keys(j.tuples[0]),['site','chainId','path','hash','reporters','quarantined']); assert.deepEqual(Object.keys(j.tuples[0].reporters[0]),['key','firstReceipt','lastReceipt']); assert.deepEqual(Object.keys(j.publications[0]),['site','chainId','id','record','delivered']);
}));
test('clock reversal and capacity reject atomically',()=>fixture(async f=>{
 await f.watcher.intake([event('a')]); const before=await readFile(f.path,'utf8'); f.time--; await assert.rejects(f.watcher.intake([event('b')])); assert.equal(await readFile(f.path,'utf8'),before); f.time++;
 await assert.rejects(f.watcher.intake(Array.from({length:128},(_,i)=>event('key'+i)))); assert.equal(await readFile(f.path,'utf8'),before);
}));
test('selection prioritizes established rows and caps at 128',()=>fixture(async f=>{
 const events=[]; for(let i=0;i<129;i++) for(let j=0;j<(i===128?3:2);j++) events.push(event('r'+j,'/'+String(i).padStart(3,'0'))); await f.watcher.intake(events); f.time+=hour; await f.watcher.publish(); const rows=f.writes.at(-1).record.scripts; assert.equal(rows.length,128); assert.ok(rows.some(x=>x.path==='/128')); assert.ok(!rows.some(x=>x.path==='/127'));
}));
test('scope and tuple limits reject entire batches',()=>fixture(async f=>{
 await f.watcher.intake(Array.from({length:128},(_,i)=>({...event('r'),site:`s${i}.example.com`})));
 const before=await readFile(f.path,'utf8'); await assert.rejects(f.watcher.intake([{...event('r'),site:'extra.example.com'},event('other')])); assert.equal(await readFile(f.path,'utf8'),before);
}));
test('maximum length rows remain within serialized publication limit',()=>fixture(async f=>{
 const events=[]; for(let i=0;i<128;i++) {const path='/'+String(i).padStart(3,'0')+'z'.repeat(60)+'/'+('g'.repeat(64))+'/'+('h'.repeat(64))+'/'+('i'.repeat(60)); for(const key of ['a','b']) events.push(event(key,path));} await f.watcher.intake(events); await f.watcher.publish(); const record=f.writes.at(-1).record; assert.equal(record.scripts.length,128); assert.ok(Buffer.byteLength(JSON.stringify(record))<=61440);
}));
test('single process journal lock and reopening',()=>fixture(async f=>{await assert.rejects(openFrontendAggregator(f.options)); await f.watcher.close(); f.watcher=await openFrontendAggregator(f.options);}));

test('lost acknowledgement followed by unsafe restart quarantines history before any retry',()=>fixture(async f=>{
 await f.watcher.intake([event('a'),event('b'),event('c')]); f.time+=hour; f.fail=true;
 await assert.rejects(f.watcher.publish()); await f.watcher.close();
 f.safety={known:true,rawDrift:true,incident:false}; f.fail=false; f.watcher=await openFrontendAggregator(f.options);
 await f.watcher.publish(); assert.equal(f.writes.length,1);
 let journal=JSON.parse(await readFile(f.path)); assert.equal(journal.publications[0].quarantined,true); assert.equal(journal.tuples[0].quarantined,true);
 await f.watcher.close(); f.options.reconcileFrontend=async()=>({state:'current'}); f.watcher=await openFrontendAggregator(f.options); f.safety={known:true,rawDrift:false,incident:false};
 await f.watcher.publish(); assert.equal(f.writes.length,2); assert.deepEqual(f.writes.at(-1).record.scripts,[]); assert.equal(JSON.parse(await readFile(f.path)).tuples.length,0);
}));
test('unverified and superseded archive results stay pending',()=>fixture(async f=>{
 for(const result of [undefined,{state:'superseded'}]) {
  f.options.writeFrontend=async()=>result; await f.watcher.close(); f.watcher=await openFrontendAggregator(f.options);
  if(!JSON.parse(await readFile(f.path,'utf8').catch(()=>'{"tuples":[]}')).tuples.length) await f.watcher.intake([event('a'),event('b')]);
  await assert.rejects(f.watcher.publish(),/unverified|superseded/);
  assert.equal(JSON.parse(await readFile(f.path)).publications[0].delivered,false);
 }
}));
test('journal lock excludes another process and is released on open failure',()=>fixture(async f=>{
 const script=`import {openFrontendAggregator} from ${JSON.stringify(new URL('./frontend.js',import.meta.url).href)}; try { const w=await openFrontendAggregator({path:process.argv[1],getScopeSafety:async()=>({known:true,rawDrift:false,incident:false}),writeFrontend:async()=>({state:'current'})}); await w.close(); process.exit(0); } catch { process.exit(2); }`;
 const child=spawn(process.execPath,['--input-type=module','-e',script,f.path],{stdio:'ignore'}); const [code]=await once(child,'exit'); assert.equal(code,2);
 await f.watcher.close(); const child2=spawn(process.execPath,['--input-type=module','-e',script,f.path],{stdio:'ignore'}); const [code2]=await once(child2,'exit'); assert.equal(code2,0);
 const bad=f.path+'.invalid'; await writeFile(bad,'{}'); await assert.rejects(openFrontendAggregator({...f.options,path:bad}),/invalid frontend journal/);
 await unlink(bad); const recovered=await openFrontendAggregator({...f.options,path:bad}); await recovered.close();
 f.watcher=await openFrontendAggregator(f.options);
}));

test('unsafe intake invalidates an unsent pending publication before recovery',()=>fixture(async f=>{
 await f.watcher.intake([event('a'),event('b'),event('c')]); f.time+=hour; f.fail=true;
 await assert.rejects(f.watcher.publish());
 f.safety={known:true,rawDrift:true,incident:false}; await f.watcher.intake([event('d')]);
 assert.equal(JSON.parse(await readFile(f.path)).publications[0].quarantined,true);
 await f.watcher.close(); f.options.reconcileFrontend=async()=>({state:'absent'}); f.watcher=await openFrontendAggregator(f.options);
 f.safety={known:true,rawDrift:false,incident:false}; f.fail=false; await f.watcher.publish();
 assert.equal(f.writes.length,1); assert.equal(JSON.parse(await readFile(f.path)).publications.length,0);
}));

test('lost committed publication is reconciled and withdrawn after unsafe restart',async t=>{
 const {openArkivUpsert}=await import('../../integrations/arkiv/upsert.js');
 const dir=await mkdtemp(join(tmpdir(),'frontend-registry-')); t.after(()=>rm(dir,{recursive:true,force:true}));
 const owner='0x'+'a'.repeat(40), key='0x'+'b'.repeat(64); let remote=null, fail=true, safe=true, time=1000000000;
 const opts={path:join(dir,'registry'),owner,currentBlock:async()=>1,getEntity:async()=>remote,getFrontendSafety:async()=>({known:safe,rawDrift:!safe,incident:false}),create:async record=>{remote={key,owner,expiresAt:100,record:structuredClone(record)};if(fail){fail=false;throw Error('lost ack');}return remote;},patch:async record=>remote={...remote,record:structuredClone(record)},reconcileQuarantined:async op=>{assert.deepEqual(remote.record,op.record);return remote;}};
 let registry=await openArkivUpsert(opts);
 const config={path:join(dir,'frontend'),now:()=>time,getScopeSafety:async()=>({known:safe,rawDrift:!safe,incident:false}),writeFrontend:(record,id)=>registry.write(record,id),reconcileFrontend:(record,id)=>registry.reconcileFrontend(record.site,record.chainId,id)};
 let watcher=await openFrontendAggregator(config);
 await watcher.intake([event('a'),event('b'),event('c')]); time+=hour; await assert.rejects(watcher.publish(),/lost ack/); assert.equal(remote.record.scripts[0].established,true);
 await watcher.close(); registry=await openArkivUpsert(opts); watcher=await openFrontendAggregator(config); safe=false; await registry.quarantineFrontend('example.com',1); await watcher.publish();
 await watcher.close(); registry=await openArkivUpsert(opts); watcher=await openFrontendAggregator(config); safe=true; time++; await watcher.publish();
 assert.deepEqual(remote.record.scripts,[]); await watcher.close();
});
