import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createDriftMonitor} from './monitor.js';
const baseline={nameservers:['ns1.example'],addresses:['192.0.2.1'],asns:{'192.0.2.1':'64500'},certificate:{fingerprint:'old',issuer:'Example CA',names:['example.org']}};
test('monitor leaves curated baseline fixed and publishes a stable drift id',async()=>{
 const published=[];let current=structuredClone(baseline);
 const monitor=createDriftMonitor({readBaseline:async()=>baseline,poll:async()=>current,publish:async event=>published.push(event)});
 assert.equal((await monitor.check('example.org',1)).state,'normal'); assert.equal(published.length,0);
 current={...current,nameservers:['ns2.example']};
 assert.equal((await monitor.check('example.org',1)).corroborated,true);
 await monitor.check('example.org',1);assert.equal(published[0].id,published[1].id);
 current=structuredClone(baseline);assert.equal((await monitor.check('example.org',1)).state,'normal');
});
test('missing reference or failed poll cannot publish or silently create a baseline',async()=>{
 let published=0;
 const missing=createDriftMonitor({readBaseline:async()=>null,poll:async()=>baseline,publish:async()=>published++});
 await assert.rejects(missing.check('example.org',1),/baseline/);
 const outage=createDriftMonitor({readBaseline:async()=>baseline,poll:async()=>{throw Error('offline');},publish:async()=>published++});
 await assert.rejects(outage.check('example.org',1),/offline/); assert.equal(published,0);
});
test('monitor records successful observations before publication and marks poll failures stale',async()=>{
 const calls=[];let fail=false;
 const monitor=createDriftMonitor({readBaseline:async()=>baseline,poll:async()=>{if(fail)throw Error('offline');return {...baseline,nameservers:['ns2.example']};},onObservation:async(_site,_chain,result)=>calls.push(['observation',result]),onPollFailure:async()=>calls.push(['unavailable']),publish:async()=>{calls.push(['publish']);throw Error('swarm offline');}});
 await assert.rejects(monitor.check('example.org',1),/publication/);assert.deepEqual(calls.map(c=>c[0]),['observation','publish']);
 fail=true;await assert.rejects(monitor.check('example.org',1),/offline/);assert.equal(calls.at(-1)[0],'unavailable');
});
