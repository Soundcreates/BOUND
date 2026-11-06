import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openWatchedDrift} from './drift-binding.js';
const baseline={nameservers:['ns1.example'],addresses:['192.0.2.1'],asns:{'192.0.2.1':'64500'},certificate:{fingerprint:'old',issuer:'Example CA',names:['example.org']}};
test('published drift status survives publication failure and becomes stale on poll failure',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'bound-drift-binding-'));t.after(()=>rm(dir,{recursive:true,force:true}));let offline=false;
 const binding=await openWatchedDrift({path:join(dir,'state.json'),now:()=>0,maxAgeMs:100,readBaseline:async()=>baseline,poll:async()=>{if(offline)throw Error('offline');return {...baseline,nameservers:['ns2.example']};},publish:async()=>{throw Error('publisher offline');}});
 await assert.rejects(binding.monitor.check('example.org',1),/publication/);assert.equal(await binding.hasCorroboratedDrift('example.org',1),true);
 offline=true;await assert.rejects(binding.monitor.check('example.org',1),/offline/);await assert.rejects(binding.hasCorroboratedDrift('example.org',1),/unavailable/);
 assert.equal((await binding.readStatus('example.org',1)).corroborated,true);
});
