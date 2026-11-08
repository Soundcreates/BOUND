import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createIntakeServer} from './http.js';
const origin='chrome-extension://'+'a'.repeat(32);
const valid={schemaVersion:1,events:[{site:'example.org',chainId:1,value:'0x'+'1'.repeat(40),kind:'warned',reporterKey:'test-key'}]};
async function setup(t,watcher={intake:async()=>({schemaVersion:1,result:'accepted'})}) {
 const server=createIntakeServer({watcher,allowedOrigins:[origin],maxBodyBytes:512});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 return `http://127.0.0.1:${server.address().port}`;
}
const post=(base,body,source=origin)=>fetch(base+'/v1/observations',{method:'POST',headers:{origin:source,'content-type':'application/json'},body});
test('intake accepts only bounded, valid JSON from configured browser origins',async t=>{
 let count=0;const base=await setup(t,{intake:async()=>{count++;return {schemaVersion:1,result:'accepted'};}});
 let r=await post(base,JSON.stringify(valid));assert.equal(r.status,202);assert.equal((await r.json()).result,'accepted');assert.equal(r.headers.get('access-control-allow-origin'),origin);
 r=await post(base,JSON.stringify(valid),'https://attacker.example');assert.equal(r.status,403);
 r=await post(base,'{"schemaVersion":1,"schemaVersion":1,"events":[]}');assert.equal(r.status,400);
 r=await post(base,JSON.stringify({...valid,wallet:'private'}));assert.equal(r.status,400);
 r=await post(base,'x'.repeat(513));assert.equal(r.status,413);
 assert.equal(count,1);
});
test('preflight is restricted and failures do not expose internal errors',async t=>{
 const base=await setup(t,{intake:async()=>{throw Error('secret internal state');}});
 let r=await fetch(base+'/v1/observations',{method:'OPTIONS',headers:{origin,'access-control-request-method':'POST','access-control-request-headers':'content-type'}});assert.equal(r.status,204);
 r=await fetch(base+'/v1/observations',{method:'OPTIONS',headers:{origin,'access-control-request-method':'DELETE'}});assert.equal(r.status,403);
 r=await post(base,JSON.stringify(valid));assert.equal(r.status,503);assert.deepEqual(await r.json(),{schemaVersion:1,result:'retry'});
});
