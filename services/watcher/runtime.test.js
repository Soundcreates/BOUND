import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createWatcherRuntime} from './runtime.js';
const sites=[{site:'example.org',chainId:1},{site:'other.example',chainId:1}];
test('independent cycles continue after per-site failures without leaking errors',async()=>{
 const calls=[],failures=[];
 const watcher={flush:async()=>calls.push('flush'),baseline:async(site)=>({site})};
 const monitor={check:async(site)=>{calls.push('poll:'+site);if(site==='example.org')throw Error('secret');}};
 const runtime=createWatcherRuntime({sites,watcher,monitor,publishBaseline:async(site,chainId,baseline)=>calls.push('baseline:'+baseline.site),intervals:{poll:1000,flush:1000,baseline:3600000},onFailure:event=>failures.push(event)});
 await runtime.runPoll();await runtime.runFlush();await runtime.runBaseline();
 assert.deepEqual(calls,['poll:example.org','poll:other.example','flush','baseline:example.org','baseline:other.example']);
 assert.deepEqual(failures,[{task:'poll',site:'example.org',chainId:1}]);
});
test('scheduler does not overlap work and stops cleanly',async()=>{
 const timers=[],clear=[];let release,active=0,maxActive=0;
 const watcher={flush:async()=>{active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>release=resolve);active--;},baseline:async()=>({})};
 const runtime=createWatcherRuntime({sites:[sites[0]],watcher,monitor:{check:async()=>{}},publishBaseline:async()=>{},intervals:{poll:100,flush:100,baseline:100},setTimer:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},clearTimer:t=>clear.push(t)});
 runtime.start();assert.equal(timers.length,3);
 const tick=timers[1].fn(); await Promise.resolve(); assert.equal(maxActive,1);
 const stop=runtime.stop();release();await tick;await stop;
 assert.equal(maxActive,1);assert.equal(timers.length,3);assert.ok(clear.length>=2);
});
test('stale timers cannot duplicate work after stop and restart',async()=>{
 const timers=[];let calls=0;
 const runtime=createWatcherRuntime({sites:[sites[0]],watcher:{flush:async()=>{calls++;},baseline:async()=>({})},monitor:{check:async()=>{}},publishBaseline:async()=>{},intervals:{poll:1,flush:1,baseline:1},setTimer:fn=>{const t={fn};timers.push(t);return t;},clearTimer:()=>{}});
 runtime.start();const old=timers[1];await runtime.stop();runtime.start();await old.fn();assert.equal(calls,0);
 await timers[4].fn();assert.equal(calls,1);await runtime.stop();
});
