import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createIntakeRouter} from './intake-router.js';
const a={site:'example.org',chainId:1,kind:'warned',value:'0x'+'1'.repeat(40),reporterKey:'a'};
const f={site:'example.org',chainId:1,kind:'frontend',path:'/app.js',hash:'sha256-'+Buffer.alloc(32).toString('base64'),reporterKey:'b'};
const batch=(...events)=>({schemaVersion:1,events});
test('validates whole batch and routes each part without extra fields',async()=>{
 const calls=[];const router=createIntakeRouter({addressWatcher:{intake:async b=>{calls.push(b);return {result:'accepted'};}},frontendAggregator:{intake:async e=>calls.push(e)}});
 assert.equal((await router.intake(batch(a,{...f,extra:1}))).result,'rejected');assert.deepEqual(calls,[]);
 for(const events of [[a],[f],[a,f]]) assert.equal((await router.intake(batch(...events))).result,'accepted');
 assert.deepEqual(calls,[batch(a),[f],batch(a),[f]]);
 assert.equal((await router.intake({...batch(a),extra:true})).result,'rejected');
});
test('partial persistence retries without double counting deduplicated reports',async()=>{
 const addresses=new Set(),frontends=new Set();let fail=true;
 const router=createIntakeRouter({addressWatcher:{intake:async b=>{b.events.forEach(e=>addresses.add(JSON.stringify(e)));return {result:'accepted'};}},frontendAggregator:{intake:async events=>{events.forEach(e=>frontends.add(JSON.stringify(e)));if(fail){fail=false;throw Error('lost acknowledgement');}}}});
 assert.equal((await router.intake(batch(a,f))).result,'retry');assert.equal((await router.intake(batch(a,f))).result,'accepted');assert.equal(addresses.size,1);assert.equal(frontends.size,1);
 const other=createIntakeRouter({addressWatcher:{intake:async()=>({result:'rejected'})},frontendAggregator:{intake:async()=>assert.fail()}});assert.equal((await other.intake(batch(a,f))).result,'retry');
});
