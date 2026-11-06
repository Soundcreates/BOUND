import {parseSafeFragment} from './fragment.mjs';
import {querySafeCommunity,DEFAULT_CONFIG} from './community.mjs';
const config=typeof __SAFE_CONFIG__==='undefined'?DEFAULT_CONFIG:__SAFE_CONFIG__;
export function liveEvidenceDisagrees(evidence,result) {
 if(evidence.reason.includes('incident')!==result.activeIncident||evidence.reason.includes('drift')!==result.corroboratedDrift)return true;
 if(!result.frontend||result.ambiguous)return evidence.conflicts.length>0||evidence.unfamiliar.length>0;
 const hashes=path=>result.frontend.scripts.filter(row=>row.established===true&&row.path===path).map(row=>row.hash).sort();
 return evidence.conflicts.some(row=>{const expected=hashes(row.path);return expected.includes(row.observed)||JSON.stringify(expected)!==JSON.stringify([...row.expected].sort());})||evidence.unfamiliar.some(row=>hashes(row.path).length>0);
}
export function startSafePage({window:win=window,document:doc=document,query=querySafeCommunity}={}){
 let evidence=null;try{evidence=parseSafeFragment(win.location.hash);}finally{win.history.replaceState(null,'',win.location.pathname+win.location.search);}
 const by=id=>doc.getElementById(id),set=(id,value)=>{by(id).textContent=value;};
 const confirm=by('confirm');confirm.disabled=!evidence;
 by('leave').addEventListener('click',()=>win.location.assign('about:blank'));
 if(!evidence){set('summary','This page could not read the extension evidence.');set('live','Live community data unavailable.');return;}
 set('summary',`Site: ${evidence.site} · Chain: ${evidence.chain} · Severity: ${evidence.sev} · Score: ${evidence.score??'unavailable'}`);
 set('reasons',`Corroboration: ${evidence.reason.join(', ')||'none'}`);
 set('coverage',`Observed scripts: ${evidence.cov.compared} of ${evidence.cov.total}. ${Object.entries(evidence.cov).filter(([key])=>!['total','compared'].includes(key)).map(([key,value])=>`${key}: ${value}`).join('; ')}. Cached bytes may differ from executed code.`);
 const rows=by('rows');for(const row of evidence.conflicts){const li=doc.createElement('li');li.textContent=`${row.path}: observed ${row.observed}; expected ${row.expected.join(', ')}`;rows.appendChild(li);}for(const row of evidence.unfamiliar){const li=doc.createElement('li');li.textContent=`${row.path}: unfamiliar ${row.hash}`;rows.appendChild(li);}
 const message=type=>{const payload={type,ticket:evidence.ticket};if(win.location.protocol==='chrome-extension:'&&win.chrome?.runtime?.sendMessage){try{Promise.resolve(win.chrome.runtime.sendMessage(payload)).catch(()=>{});}catch{}}else win.postMessage(payload,win.location.origin);};
 confirm.addEventListener('click',()=>message('BOUND_SAFE_CONFIRM_V1'));message('BOUND_SAFE_READY_V1');
 set('live','Checking live community data…');Promise.resolve().then(()=>query({rpcUrl:config.rpcUrl,watcher:evidence.watcher,chainId:evidence.chain,site:evidence.site})).then(result=>{if(result.state!=='fresh'){set('live','From your extension; live community data unavailable.');return;}set('live',`Live community data: ${result.ambiguous?'ambiguous':result.activeIncident?'active incident':result.corroboratedDrift?'corroborated drift':result.rawDrift?'reported drift':'no linked incident or corroborated drift'} (block ${result.block}).${liveEvidenceDisagrees(evidence,result)?' Live data and extension evidence may disagree.':''}`);}).catch(()=>set('live','From your extension; live community data unavailable.'));
}
if(typeof window!=='undefined'&&typeof document!=='undefined')startSafePage();
