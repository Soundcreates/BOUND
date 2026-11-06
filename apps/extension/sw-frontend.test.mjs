import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Run the real worker and detector with deterministic data adapters. No network,
// browser profile, persisted journal, or production clock override is involved.
async function worker({conflict = false, frameId = 0, invalidEvidence = false, drift = false} = {}) {
  const timers = new Set(), listeners = {}, windows = [], candidates = [];
  const hash = 'sha256-' + Buffer.alloc(32).toString('base64');
  const other = 'sha256-' + Buffer.alloc(32, 1).toString('base64');
  const url = 'https://app.example/';
  const coverage = {total:1, compared:1, inlineExcluded:0, queryExcluded:0, crossOriginExcluded:0, privatePathExcluded:0, unavailable:0, overCap:0};
  const evidence = {version:1, documentUrl:url, scripts:[{path:'/app.js',hash}], coverage};
  const now = Date.now();
  const community = {state:'fresh', fetchedAt:now, ageMs:0, rawDrift:drift, corroboratedDrift:drift, activeIncident:false, ambiguous:false, communityReportingSafe:true,
    frontend:{schemaVersion:1, kind:'frontend', site:'app.example', chainId:1, updatedAt:new Date(now).toISOString(), scripts:[{path:'/app.js',hash:conflict ? other : hash,reporters:3,firstSeen:new Date(now - 3600001).toISOString(),lastSeen:new Date(now).toISOString(),established:true}]}};
  const fake = {community, candidates, collections:[], context:{baseline:'seeded', policy:{}, incidentStatus:'normal'},
    status:{status:'normal', expiresAt:new Date(now+60000).toISOString(),evidence:{snapshotVerified:true,siteMatched:true,watcherLookup:true}}};
  const modules = {
    'trust-adapter.mjs': `export const decisionAdapters = {}; export async function getWatcherOwner(){ return '0x'+'1'.repeat(40); }`,
    'decision-context.mjs': `export async function createDecisionContext(){return fake.context} export async function readFrontendContext(){return structuredClone(fake.community)} export async function readPreconnectionSiteStatus(){return fake.status}`,
    'anon-rpc-host.mjs': `export async function anonRpc(){return {error:'offline'}}`
  };
  const entry = fileURLToPath(new URL('./sw.js', import.meta.url));
  const result = await build({entryPoints:[entry], bundle:true, write:false, format:'iife', platform:'browser',plugins:[{name:'fixtures',setup(b){
    b.onLoad({filter:/\/(trust-adapter|decision-context|anon-rpc-host)\.mjs$/},args=>({contents:modules[args.path.split('/').at(-1)],loader:'js'}));
    // Observe the worker's original/current reporting inputs without sending
    // synthetic observations to a real watcher.
    b.onLoad({filter:/policy-core\/frontend\.mjs$/}, async args=>{
      const {readFile} = await import('node:fs/promises');
      const contents = (await readFile(args.path,'utf8')).replace('export function frontendObservationCandidates(input) {', 'export function frontendObservationCandidates(input) { fake.candidates.push(structuredClone(input));');
      return {contents,loader:'js',resolveDir:fileURLToPath(new URL('../../packages/policy-core/',import.meta.url))};
    });
  }}]});
  const data = {boundMonitoring:true, boundSettings:{watcherOwner:'0x'+'1'.repeat(40)}};
  const store = {async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(k=>k in data).map(k=>[k,data[k]]))},async set(values){Object.assign(data,values)}};
  const event = name=>({addListener(fn){listeners[name]=fn}});
  let current = {url, documentId:'source'}, target;
  fake.navigate = async (documentId) => { current = {url:target,documentId}; listeners.committed({tabId:1,frameId:0,...current}); await new Promise(r=>setTimeout(r,10)); };
  fake.current = () => current;
  fake.target = () => target;
  const sender = {id:'extension',tab:{id:1,url},frameId,documentId:'source',url};
  const chrome = {
    runtime:{id:'extension',getURL:p=>'chrome-extension://extension/'+p,onMessage:event('message')},
    storage:{local:store,session:store,onChanged:event('storage')},
    tabs:{onUpdated:event('tab'),onRemoved:event('removed'),async query(){return []},async get(){return {id:1,url:current.url}},async update(id,change){target=change.url;return {id,url:target}},async sendMessage(tab,msg,options){if(msg.type==='BOUND_RETRY_GUARD_V1'){fake.guard=msg;if(fake.guardAck !== false) queueMicrotask(()=>listeners.message({...msg,type:'BOUND_RETRY_GUARDED_V1'},{...sender,documentId:current.documentId,url:current.url,tab:{id:1,url:current.url}},()=>{}));return;} fake.collections.push({tab,msg,options});return invalidEvidence?{scripts:[]} : {...evidence,documentUrl:current.url}}},
    webNavigation:{onCommitted:event('committed'),onErrorOccurred:event('naverror'),async getFrame(){return current}},
    windows:{onRemoved:event('window'),async create(options){if(fake.failWindow)throw Error('unavailable');const w={id:windows.length+1,url:options.url};windows.push(w);return w}},
    alarms:{onAlarm:event('alarm'),async create(){},async clear(){}},action:{setBadgeText(){},setBadgeBackgroundColor(){}}
  };
  const context=vm.createContext({fake,chrome,crypto:webcrypto,URL,TextEncoder,TextDecoder,AbortController,structuredClone,console,atob,btoa,fetch:async()=>{throw Error('unexpected network request')},
    setTimeout(fn,ms){if(ms===600000)fake.deadline=fn;const t=setTimeout(fn,ms);timers.add(t);return t},clearTimeout(t){clearTimeout(t);timers.delete(t)}});
  vm.runInContext(result.outputFiles[0].text,context);
  const send=(msg,who=sender)=>new Promise(resolve=>{
    context.messageJson=JSON.stringify(msg);
    listeners.message(vm.runInContext('JSON.parse(messageJson)',context),who,resolve);
  });
  const digest=async value=>Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))).toString('hex');
  return {fake,windows,send,sender,async request(method){const request={method,params:method==='eth_sendTransaction'?[{to:'0x'+'2'.repeat(40),data:'0x'}]:[]};const state={chainId:'0x1',accounts:['0x'+'3'.repeat(40)]};return {type:'BOUND_REQUEST_V1',...(drift ? {id:'1:00000000-0000-4000-8000-000000000000'} : {}),request,state,digest:await digest(request),stateDigest:await digest(state)}},
    async warning(index=0){for(let i=0;i<100;i++){if(windows[index]){const w=windows[index],id=new URL(w.url).searchParams.get('request');return {id,sender:{id:'extension',frameId:0,url:w.url,tab:{windowId:w.id}}}}await new Promise(r=>setTimeout(r,5))}throw Error('no warning')},
    stopMonitoring(){listeners.storage({boundMonitoring:{newValue:false}},'local')},
    closeWindow(id){listeners.window(id)},
    close(){for(const t of timers)clearTimeout(t)}};
}

for(const method of ['eth_requestAccounts','eth_sendTransaction']) {
  test(`${method}: collector targets the source document; conflicts warn without changing score`, async t=>{
    const w=await worker({conflict:true});t.after(()=>w.close());
    const request=await w.request(method),pending=w.send(request),popup=await w.warning();
    const details=await w.send({type:'BOUND_GET_V1',id:popup.id},popup.sender);
    assert.equal(details.frontendIntegrity.comparison,'conflict');
    assert.equal(details.tier,'huge');
    assert.equal(details.score,method==='eth_requestAccounts'?100:65);
    assert.equal(w.fake.collections.length,1);
    assert.equal(w.fake.collections[0].options.documentId,'source');
    assert.equal(w.fake.candidates.length,0,'warning display must not report');
    await w.send({type:'BOUND_DECISION_V1',id:popup.id,action:'cancel'},popup.sender);
    assert.equal((await pending).action,'cancel');
    assert.equal(w.fake.candidates.length,0);
  });
  test(`${method}: a wallet-forward receipt rechecks current data and retains the original conflict veto`, async t=>{
    const w=await worker({conflict:true});t.after(()=>w.close());
    const request=await w.request(method),pending=w.send(request),popup=await w.warning();
    await w.send({type:'BOUND_DECISION_V1',id:popup.id,action:'continue'},popup.sender);
    const decision=await pending;
    assert.ok(decision.receiptToken);
    assert.equal(w.fake.candidates.length,0);
    w.fake.community.frontend.scripts[0].hash='sha256-'+Buffer.alloc(32).toString('base64');
    const receipt={type:'BOUND_FORWARDED_V1',receiptToken:decision.receiptToken,digest:request.digest,stateDigest:request.stateDigest};
    assert.equal((await w.send(receipt,{...w.sender,documentId:'spoof'})).ok,false);
    assert.equal((await w.send(receipt)).ok,true);
    assert.equal(w.fake.candidates[0].assessment.comparison,'conflict');
    assert.equal(w.fake.candidates[0].communityReportingSafe,true);
    assert.equal(w.fake.candidates.length,1,'original conflict prevents even attempting current reports');
    assert.equal((await w.send(receipt)).ok,false,'receipt is single use');
  });
}
test('legacy collector evidence is unavailable and passive reads do not collect',async t=>{
  const w=await worker({invalidEvidence:true});t.after(()=>w.close());
  assert.equal((await w.send(await w.request('eth_accounts'))).readOnly,true);
  assert.equal(w.fake.collections.length,0);
  const pending=w.send(await w.request('eth_sendTransaction')),popup=await w.warning();
  const details=await w.send({type:'BOUND_GET_V1',id:popup.id},popup.sender);
  assert.equal(details.frontendIntegrity.comparison,'none');
  await w.send({type:'BOUND_DECISION_V1',id:popup.id,action:'cancel'},popup.sender);await pending;
});

for(const failure of ['deadline','monitoring','window']) {
  test(`required typing cancels on ${failure}; ordinary warnings retain timeout behavior`,async t=>{
    for(const method of ['eth_sign','eth_sendTransaction']) {
      const w=await worker();t.after(()=>w.close());
      w.fake.failWindow=failure==='window';
      const pending=w.send(await w.request(method));
      if(failure!=='window') {
        const popup=await w.warning();
        if(method==='eth_sign') {
          const rejected=await w.send({type:'BOUND_DECISION_V1',id:popup.id,action:'continue'},popup.sender);
          assert.equal(rejected.error,'confirmation_required');
        }
        if(failure==='deadline')w.fake.deadline();else w.stopMonitoring();
      }
      const result=await pending;
      assert.equal(result.action,method==='eth_sign'?'cancel':'continue');
      assert.equal(result.receiptToken,undefined,'fallback cannot train');
      assert.equal(w.fake.candidates.length,0);
    }
  });
}

for(const frameId of [0,2]) {
  test(`receipt preserves both safety snapshots and frame provenance (frame ${frameId})`,async t=>{
    const w=await worker({frameId});t.after(()=>w.close());
    const req=await w.request('eth_requestAccounts'),pending=w.send(req),popup=await w.warning();
    await w.send({type:'BOUND_DECISION_V1',id:popup.id,action:'continue'},popup.sender);
    const decision=await pending;
    w.fake.community.communityReportingSafe=false;
    w.fake.community.ambiguous=true;
    await w.send({type:'BOUND_FORWARDED_V1',receiptToken:decision.receiptToken,digest:req.digest,stateDigest:req.stateDigest});
    assert.equal(w.fake.candidates[0].frame.isTop,frameId===0);
    assert.equal(w.fake.candidates[0].communityReportingSafe,true,'original safety stays frozen');
    assert.equal(w.fake.candidates.length,frameId===0?2:1);
    if(frameId===0)assert.equal(w.fake.candidates[1].communityReportingSafe,false,'current safety is checked separately');
  });
}


async function approvedWorker(t) {
  const w=await worker({conflict:true,drift:true}); t.after(()=>w.close());
  const req=await w.request('eth_sendTransaction');
  const decision=await w.send(req);
  assert.equal(decision.action,'cancel'); assert.equal(decision.safePage,true);
  assert.equal(w.fake.target(),undefined);
  const ack={type:'BOUND_CANCEL_DELIVERED_V1',id:req.id,digest:req.digest,stateDigest:req.stateDigest,ticket:decision.ticket,cancelNonce:decision.cancelNonce};
  assert.equal((await w.send(ack)).ok,true);
  assert.match(w.fake.target(),/^chrome-extension:\/\/extension\/safe.html#/);
  await w.fake.navigate('safe');
  const safe={...w.sender,documentId:'safe',url:w.fake.current().url,tab:{id:1,url:w.fake.current().url}};
  assert.equal((await w.send({type:'BOUND_SAFE_READY_V1',ticket:decision.ticket},safe)).ok,true);
  assert.equal((await w.send({type:'BOUND_SAFE_CONFIRM_V1',ticket:decision.ticket},safe)).ok,true);
  await w.fake.navigate('confirm');
  const confirm={...safe,documentId:'confirm',url:w.fake.current().url,tab:{id:1,url:w.fake.current().url}};
  assert.equal((await w.send({type:'BOUND_TICKET_APPROVE_V1',ticket:decision.ticket,phrase:'wrong'},confirm)).ok,false);
  assert.equal((await w.send({type:'BOUND_TICKET_APPROVE_V1',ticket:decision.ticket,phrase:'I UNDERSTAND'},confirm)).ok,true);
  await w.fake.navigate('returned');
  const returned={...w.sender,documentId:'returned'};
  return {w,req,returned};
}
test('worker cancels before navigation, then binds guarded retry to typed confirmation', async t => {
  const {w,req,returned}=await approvedWorker(t);
  const pending=w.send(req,returned), popup=await w.warning();
  assert.equal(w.fake.guard.id,req.id);
  const details=await w.send({type:'BOUND_GET_V1',id:popup.id},popup.sender);
  assert.equal(details.requireTypedConfirmation,true);
  assert.equal((await w.send({type:'BOUND_DECISION_V1',id:popup.id,action:'continue'},popup.sender)).error,'confirmation_required');
  assert.equal((await w.send({type:'BOUND_DECISION_V1',id:popup.id,action:'continue',confirmation:'I UNDERSTAND'},popup.sender)).ok,true);
  const result=await pending; assert.equal(result.action,'continue'); assert.equal(result.typedApproved,true);
});

for (const failure of ['guard timeout','popup failure','deadline','monitoring','window close']) {
  test(`guarded retry cancels on ${failure}`, async t => {
    const {w,req,returned}=await approvedWorker(t);
    if(failure==='guard timeout') w.fake.guardAck=false;
    if(failure==='popup failure') w.fake.failWindow=true;
    const pending=w.send(req,returned);
    if(!['guard timeout','popup failure'].includes(failure)) {
      const popup=await w.warning();
      if(failure==='deadline') w.fake.deadline();
      else if(failure==='monitoring') w.stopMonitoring();
      else w.closeWindow(popup.sender.tab.windowId);
    }
    const result=await pending; assert.equal(result.action,'cancel'); assert.notEqual(result.typedApproved,true);
  });
}

test('an approved retry is cancelled at the rate cap before any forwarding', async t => {
  const {w,req,returned}=await approvedWorker(t);
  const other=structuredClone(req); other.state.chainId='0x2';
  other.stateDigest=Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(other.state)))).toString('hex');
  for(let i=0;i<8;i++) {
    other.id=`${i+2}:00000000-0000-4000-8000-000000000000`;
    const pending=w.send(other,returned), popup=await w.warning(i);
    await w.send({type:'BOUND_DECISION_V1',id:popup.id,action:'cancel'},popup.sender);
    assert.equal((await pending).action,'cancel');
  }
  const result=await w.send(req,returned);
  assert.equal(result.action,'cancel'); assert.equal(w.fake.guard,undefined);
});
