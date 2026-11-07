// Uses the same installed-Playwright workflow as no-popup-check.mjs. Every
// browser profile and watcher journal is temporary; no live writer is involved.
import http from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createInterface} from 'node:readline/promises';
import {compileSnapshot} from '../../../services/curator/src/compile.ts';
import {openFrontendAggregator} from '../../../services/watcher/frontend.js';
import {DEFAULT_SETTINGS,normalizeSettings} from '../settings.mjs';
import {validateRecord} from '../../../packages/contracts/index.js';

const OWNER=DEFAULT_SETTINGS.watcherOwner.toLowerCase();
const key=n=>'0x'+n.toString(16).padStart(64,'0');
const ACCOUNT='0x'+'3'.repeat(40), CONTRACT='0x'+'2'.repeat(40);
const iso=t=>new Date(t).toISOString();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(read,{timeoutMs=10000,label='condition'}={}) {
 const end=Date.now()+timeoutMs;
 do {const result=await read();if(result)return result;await pause(25);}while(Date.now()<end);
 throw Error(`Timed out waiting for ${label}`);
}

// This fixture only seeds unrelated curator/status prerequisites. Frontend
// maturity is produced below by the real collector, receipts and aggregator.
export function browserFixture({site,time,frontend,state='normal',safePageUrl=''}) {
 const settings=normalizeSettings({...DEFAULT_SETTINGS,arkivRpcUrl:'https://arkiv.fixture.invalid',safePageUrl,watcherUrl:'',anonBootstrapUrl:'',anonRpcUrl:''});
 const built=compileSnapshot({epoch:1,network:'sepolia',rootName:settings.ensRootName,generatedAt:new Date(time-1000),validityDays:1,sites:[{host:site,chainId:1,trustedContracts:[CONTRACT],evidence:[{address:CONTRACT,kind:'contract',sourceUrl:'https://fixture.invalid/contracts',codeHash:key(8)}]}],shared:[]});
 const root={arkivKey:key(7),arkivOwner:OWNER,digest:built.digest,epoch:1,network:'sepolia',schemaVersion:1};
 const anchor={chainId:settings.ensChainId,name:settings.ensRootName,resolver:settings.ensResolver,network:settings.network,recordKey:'bound.root.v2'};
 const status={schemaVersion:1,kind:'status',site,chainId:1,state,feedReference:key(9),incidentReference:null,updatedAt:iso(time)};
 const baseline={schemaVersion:1,kind:'baseline',site,chainId:1,counterparties:[],calledContracts:[],updatedAt:iso(time)};
 const records=[status,frontend,baseline];
 if(state==='drift')records.push({schemaVersion:1,kind:'drift',site,chainId:1,changes:[{kind:'ns',before:['ns.clean.example'],after:['ns.changed.example']}],corroborated:true,evidenceReference:key(10).slice(2),detectedAt:status.updatedAt});
 if(!records.every(validateRecord))throw Error('Invalid browser fixture record');
 return {local:{boundMonitoring:true,boundSettings:settings,[`bound.trust.v2:${JSON.stringify(anchor)}`]:{version:1,root,canonical:new TextDecoder().decode(built.bytes),verifiedAt:time},
  boundWatcherBundle:{version:2,owner:OWNER,url:settings.arkivRpcUrl,chainId:settings.arkivChainId,fetchedAt:time,verifiedAt:time,block:100,records:records.map((record,i)=>({key:key(i+1),owner:OWNER,expiresAt:10000,record}))}},session:{}};
}

async function startFixture() {
 let attack=false;const forwarded=[];
 const script=()=>`window.fixtureVersion=${JSON.stringify(attack?'attack':'clean')};document.addEventListener('DOMContentLoaded',()=>{document.querySelector('#version').textContent=window.fixtureVersion==='clean'?'App A: normal frontend':'App B: changed frontend';});window.ethereum={isMetaMask:true,on(){},removeListener(){},async request(r){if(['eth_requestAccounts','eth_sendTransaction'].includes(r.method))await fetch('/forward',{method:'POST',body:r.method});if(r.method==='eth_chainId')return '0x1';if(r.method==='eth_accounts'||r.method==='eth_requestAccounts')return ['${ACCOUNT}'];return '0xfixture';}};window.dispatchEvent(new Event('ethereum#initialized'));`;
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/forward'&&req.method==='POST'){let text='';for await(const part of req)text+=part;forwarded.push(text);res.end('ok');return;}
  if(req.url==='/app.js'){res.setHeader('content-type','text/javascript');res.setHeader('cache-control','public, max-age=3600');res.end(script());return;}
  res.setHeader('content-type','text/html');res.setHeader('cache-control','no-store');res.end('<!doctype html><title>BOUND simulated demo</title><style>body{font:20px system-ui;margin:10vh auto;max-width:650px;padding:24px;background:#111b30;color:#fff}p{line-height:1.5}</style><h1 id="version">Loading demo…</h1><p>Simulated presentation: the wallet, watcher data and time are test fixtures.</p><p>Follow the prompts in the terminal. No real wallet transaction is sent.</p><script src="/app.js"></script>');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {url:`http://127.0.0.1:${server.address().port}/`,forwarded,attack(){attack=true},close:()=>new Promise(resolve=>server.close(resolve))};
}

export async function runFrontendMismatchChecks({extensionPath,launchBrowser,now=Date.now,safePageUrl='',demoPause=async()=>{}}={}) {
 if(typeof launchBrowser!=='function'||typeof extensionPath!=='string')throw Error('An extension path and browser launcher are required');
 const temporary=await mkdtemp(join(tmpdir(),'bound-mismatch-e2e-')),contexts=[];
 let fixture,aggregator,passed=0,failed=0;
 const check=(name,ok)=>{if(ok){passed++;console.log(`PASS ${name}`);}else{failed++;console.error(`FAIL ${name}`);}};
 try {
  fixture=await startFixture();const site=new URL(fixture.url).host;
  let receiptTime=now()-3600001,publication;
  aggregator=await openFrontendAggregator({path:join(temporary,'frontend.json'),now:()=>receiptTime,getScopeSafety:async()=>({known:true,rawDrift:false,incident:false}),writeFrontend:async record=>{publication=record;return {state:'current'}}});
  const install=async(context,frontend,state='normal')=>{
   const sw=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker',{timeout:10000});
   const data=browserFixture({site,time:now(),frontend,state,safePageUrl:state==='drift'?safePageUrl:''});
   await sw.evaluate(async data=>{await chrome.storage.local.set(data.local);await chrome.storage.session.set(data.session);},data);
   return sw;
  };
  const prompt=async context=>until(()=>context.pages().find(p=>p.url().includes('/warning.html?')),{timeoutMs:20000,label:'warning window'});
  const interactive=page=>page.evaluate(()=>{window.requestResult=null;window.ethereum.request({method:'eth_requestAccounts',params:[]}).then(()=>window.requestResult='forwarded',e=>window.requestResult=e.code);});
  // An untrusted approval plus corroborated drift scores 15 under the default
  // policy. A connection request with an otherwise healthy score must not redirect.
  const riskyApproval=page=>page.evaluate(({account,contract})=>{
   const spender='4'.repeat(40), data='0x095ea7b3'+spender.padStart(64,'0')+'f'.repeat(64);
   window.requestResult=null;window.ethereum.request({method:'eth_sendTransaction',params:[{from:account,to:contract,data}]}).then(()=>window.requestResult='forwarded',e=>window.requestResult=e.code);
  },{account:ACCOUNT,contract:CONTRACT});
  let primary;
  for(let i=0;i<3;i++) {
   const context=await launchBrowser({extensionPath,profilePath:join(temporary,'profile-'+i)});contexts.push(context);
   const empty={schemaVersion:1,kind:'frontend',site,chainId:1,scripts:[],updatedAt:iso(now())};
   const sw=await install(context,empty),page=await context.newPage();await page.goto(fixture.url);
   await page.waitForFunction(()=>window.fixtureVersion==='clean');await interactive(page);
   let warning;
   try {warning=await prompt(context);}catch(error){const result=await page.evaluate(()=>window.requestResult);const history=await sw.evaluate(async()=>((await chrome.storage.local.get('boundWarningHistory')).boundWarningHistory||[]).map(x=>({method:x.method,verdict:x.verdict})));throw Error(`${error.message}; result=${result}; history=${JSON.stringify(history)}; pages=${context.pages().map(p=>new URL(p.url()).pathname).join(',')}`);}
   const warningDetails=await warning.evaluate(async()=>chrome.runtime.sendMessage({type:'BOUND_GET_V1',id:new URL(location.href).searchParams.get('request')}));
   if(i===0)await demoPause('App A is running. This is its connection review; press Enter to continue.');
   await warning.locator('#continue').click();
   await page.waitForFunction(()=>window.requestResult==='forwarded',{timeout:10000});
   let rows;
   try {rows=await until(async()=>{const q=await sw.evaluate(async()=>((await chrome.storage.local.get('boundObservationQueue')).boundObservationQueue||[]).filter(x=>x.kind==='frontend'));return q.length?q:null;},{label:'collector reports after forwarding receipt'});}catch(error){throw Error(`${error.message}; verdict=${warningDetails?.verdict}; status=${warningDetails?.incidentStatus}; frontend=${JSON.stringify(warningDetails?.frontendIntegrity)}`);}
   check(`clean profile ${i+1} reports only public script tuples`,rows.every(r=>r.path==='/app.js'&&r.site===site&&!Object.hasOwn(r,'documentUrl')));
   await aggregator.intake(rows.map(({site,reporterKey,path,hash})=>({site,kind:'frontend',chainId:1,reporterKey,path,hash})));
   if(!i)primary={context,page,sw};else await context.close();
  }
  await aggregator.publish();check('three real reports do not mature early',publication?.scripts[0]?.established===false);
  receiptTime=now();await aggregator.publish();check('one-hour watcher clock matures three real collector reports',publication?.scripts[0]?.established===true&&publication.scripts[0].reporters===3);
  await primary.sw.evaluate(()=>{globalThis.__boundE2EEvents=[];chrome.storage.onChanged.addListener((changes,area)=>{if(changes.boundFrontendTickets)globalThis.__boundE2EEvents.push({kind:'tickets',area,tickets:changes.boundFrontendTickets.newValue?.tickets?.map(t=>({state:t.state,ready:t.ready,hop:t.expectedHop?.stage,doc:t.safeDocumentId}))});});chrome.webNavigation.onCommitted.addListener(async d=>{if(d.frameId!==0)return;const ts=(await chrome.storage.session.get('boundFrontendTickets')).boundFrontendTickets?.tickets||[],t=ts.find(t=>t.tabId===d.tabId),tab=await chrome.tabs.get(d.tabId),f=await chrome.webNavigation.getFrame({tabId:d.tabId,frameId:0});globalThis.__boundE2EEvents.push({kind:'commit',path:new URL(d.url).pathname,eventHash:!!new URL(d.url).hash,expected:t?.expectedHop?.url===d.url,tabFrame:tab.url===f.url,tabEvent:tab.url===d.url,frameEvent:f.url===d.url,tabHash:!!new URL(tab.url).hash,frameHash:!!new URL(f.url).hash});});chrome.runtime.onMessage.addListener((message,sender)=>{if(message.type?.startsWith('BOUND_SAFE_'))globalThis.__boundE2EEvents.push({kind:message.type,sender:{id:sender.id,tab:sender.tab?.id,frame:sender.frameId,doc:sender.documentId,hasHash:!!new URL(sender.url).hash}});});});
  await demoPause('App A baseline prepared with simulated reporter profiles and a simulated clock. Press Enter to switch the same URL to app B.');
  fixture.attack();await install(primary.context,publication,'drift');
  const cdp=await primary.context.newCDPSession(primary.page);await cdp.send('Network.clearBrowserCache');await cdp.detach();
  await primary.page.reload();await primary.page.waitForFunction(()=>window.fixtureVersion==='attack');
  await interactive(primary.page);
  const higherWarning=await prompt(primary.context);
  const higherDetails=await higherWarning.evaluate(()=>chrome.runtime.sendMessage({type:'BOUND_GET_V1',id:new URL(location.href).searchParams.get('request')}));
  check('higher-scored conflict stays on the site with a warning',higherDetails.score>=16 && primary.page.url()===fixture.url);
  await demoPause(`App B connection score ${higherDetails.score}/100: a warning is shown without redirect. Press Enter to test a simulated risky approval.`);
  await higherWarning.locator('#cancel').click();
  await primary.page.waitForFunction(()=>window.requestResult===4001,{timeout:10000});
  const before=fixture.forwarded.length;await riskyApproval(primary.page);
  try { await primary.page.waitForURL(url=>safePageUrl?url.href.split('#')[0]===safePageUrl:url.protocol==='chrome-extension:'&&url.pathname==='/safe.html',{timeout:15000}); }
  catch(error) {
   const warning=primary.context.pages().find(p=>p.url().includes('/warning.html?'));
   const details=warning?await warning.evaluate(()=>chrome.runtime.sendMessage({type:'BOUND_GET_V1',id:new URL(location.href).searchParams.get('request')})):null;
   throw Error(`Safe navigation not reached; score=${details?.score}, verdict=${details?.verdict}, frontend=${JSON.stringify(details?.frontendIntegrity)}, reasons=${JSON.stringify(details?.reasons)}: ${error.message}`);
  }
  check('safe navigation follows cancellation without a wallet forward',fixture.forwarded.length===before);
  check('safe page clears evidence fragment',new URL(primary.page.url()).hash==='');
  await demoPause('Swarm fallback opened after the simulated low-score approval was cancelled. Press Enter to finish the remaining checks.');
  try {await until(()=>primary.sw.evaluate(async()=>((await chrome.storage.session.get('boundFrontendTickets')).boundFrontendTickets?.tickets||[]).some(t=>t.state==='at_safe_page'&&t.ready)),{timeoutMs:2000,label:'safe page readiness'});}catch(error){const diagnostic=await primary.sw.evaluate(async()=>{const tabs=await chrome.tabs.query({});const safe=tabs.find(t=>t.url?.includes('/safe.html'));const frame=safe?await chrome.webNavigation.getFrame({tabId:safe.id,frameId:0}).catch(()=>null):null;const contexts=await chrome.runtime.getContexts({contextTypes:['TAB']});return {events:globalThis.__boundE2EEvents,frame:frame?{doc:frame.documentId,hash:!!new URL(frame.url).hash}:null,contexts:contexts.map(c=>({type:c.contextType,tab:c.tabId,frame:c.frameId,doc:c.documentId,path:new URL(c.documentUrl).pathname,hash:!!new URL(c.documentUrl).hash}))};});throw Error(`${error.message}; diagnostic=${JSON.stringify(diagnostic)}`);}
  await primary.page.locator('#confirm').click();await primary.page.waitForURL(/\/confirm\.html#/,{timeout:10000});
  await primary.page.locator('#phrase').fill('wrong');check('wrong private confirmation phrase stays disabled',await primary.page.locator('#continue').isDisabled());
  await primary.page.locator('#phrase').fill('I UNDERSTAND');await primary.page.locator('#continue').click();
  await primary.page.waitForURL(fixture.url,{timeout:10000});await primary.page.waitForFunction(()=>window.fixtureVersion==='attack');
  await install(primary.context,publication,'drift');await riskyApproval(primary.page);
  const retry=await prompt(primary.context);await retry.locator('#confirmation').waitFor({state:'visible'});
  check('new retry still requires typing before wallet forwarding',fixture.forwarded.length===before&&await retry.locator('#continue').isDisabled());
  await retry.locator('#confirmation').fill('I UNDERSTAND');await retry.locator('#continue').click();
  await primary.page.waitForFunction(()=>window.requestResult==='forwarded',{timeout:10000});
  check('approved frozen retry forwards exactly once',fixture.forwarded.length===before+1);
  const tickets=await primary.sw.evaluate(async()=>((await chrome.storage.session.get('boundFrontendTickets')).boundFrontendTickets?.tickets||[]));
  check('retry ticket is consumed',tickets.some(t=>t.state==='consumed'));
  return {passed,failed};
 } finally {
  await Promise.allSettled(contexts.map(context=>context.close()));await aggregator?.close();await fixture?.close();await rm(temporary,{recursive:true,force:true});
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
 const [,,playwrightPath,repo=process.cwd()]=process.argv;
 if(!playwrightPath)throw Error('Usage: node frontend-mismatch-check.mjs <installed-playwright-package> [repo]');
 const {chromium}=await import(pathToFileURL(join(resolve(playwrightPath),'index.mjs')).href);
 const demo=process.env.BOUND_E2E_DEMO==='1';
 const input=demo?createInterface({input:process.stdin,output:process.stdout}):null;
 try {
  const result=await runFrontendMismatchChecks({extensionPath:join(repo,'apps/extension/dist'),safePageUrl:process.env.BOUND_E2E_SAFE_PAGE_URL||'',demoPause:input?message=>input.question(`\n${message}\n`):undefined,launchBrowser:({extensionPath,profilePath})=>chromium.launchPersistentContext(profilePath,{channel:'chromium',headless:!demo,...(process.env.BOUND_CHROME_EXECUTABLE_PATH?{executablePath:process.env.BOUND_CHROME_EXECUTABLE_PATH}:{}),args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`]})});
  console.log(`${result.passed}/${result.passed+result.failed} checks passed`);if(result.failed)process.exitCode=1;
 } finally {input?.close();}
}
