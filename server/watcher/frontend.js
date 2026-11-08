import {createHash, randomUUID} from 'node:crypto';
import {open, readFile, rename, unlink} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {acquireJournalLocks} from '../../shared/integrations/arkiv/journal-lock.js';
import {parseUniqueJSON, validateObservation} from '../../shared/contracts/index.js';
import {FRONTEND_K, FRONTEND_MATURITY_MS, FRONTEND_REPORT_WINDOW_MS, FRONTEND_DEDUPE_MS, FRONTEND_MAX_ROWS, validateFrontendRecord} from '../../shared/contracts/frontend.js';

const exact = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o,k));
const scopeKey = o => JSON.stringify([o.site,o.chainId]);
const cmp = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const tupleCmp = (a,b) => cmp(a.site,b.site) || a.chainId-b.chainId || cmp(a.path,b.path) || cmp(a.hash,b.hash);
const idFor = record => createHash('sha256').update(JSON.stringify(['frontend-aggregate',record])).digest('hex');
const timeValid = n => Number.isSafeInteger(n) && n >= 0 && n <= 8640000000000000;
const eventFor = (t,key) => ({site:t.site,chainId:t.chainId,kind:'frontend',path:t.path,hash:t.hash,reporterKey:key});
function validState(s) {
  if (!exact(s,['version','lastNow','tuples','publications']) || s.version !== 1 || !timeValid(s.lastNow) || !Array.isArray(s.tuples) || !Array.isArray(s.publications)) return false;
  if (!s.tuples.every((t,i) => exact(t,['site','chainId','path','hash','reporters','quarantined']) && typeof t.quarantined === 'boolean' && Array.isArray(t.reporters) && t.reporters.length > 0 && t.reporters.every((r,j) => exact(r,['key','firstReceipt','lastReceipt']) && validateObservation(eventFor(t,r.key)) && timeValid(r.firstReceipt) && timeValid(r.lastReceipt) && r.firstReceipt <= r.lastReceipt && r.lastReceipt <= s.lastNow && (!j || t.reporters[j-1].key < r.key)) && (!i || tupleCmp(s.tuples[i-1],t)<0))) return false;
  return s.publications.every(p => (exact(p,['site','chainId','id','record','delivered']) || (exact(p,['site','chainId','id','record','delivered','quarantined']) && p.quarantined===true && !p.delivered)) && typeof p.delivered === 'boolean' && validateFrontendRecord(p.record) && p.site === p.record.site && p.chainId === p.record.chainId && p.id === idFor(p.record) && Date.parse(p.record.updatedAt) <= s.lastNow);
}
function capacity(s) {
  const groups = new Map(); let reporters = 0;
  for (const t of s.tuples) { const k=scopeKey(t); groups.set(k,(groups.get(k)||0)+1); reporters+=t.reporters.length; if(t.reporters.length>128) return false; }
  for (const p of s.publications) if (!groups.has(scopeKey(p))) groups.set(scopeKey(p),0);
  return groups.size<=128 && [...groups.values()].every(n=>n<=256) && reporters<=16384 && s.publications.filter(p=>!p.delivered).length<=128 && Buffer.byteLength(JSON.stringify(s))<=1_000_000;
}
async function persist(path,s) {
  const tmp = `${path}.${randomUUID()}.tmp`; let f;
  try { f=await open(tmp,'wx',0o600); await f.writeFile(JSON.stringify(s)); await f.sync(); await f.close(); f=undefined; await rename(tmp,path); const d=await open(dirname(path),'r'); try { await d.sync(); } finally { await d.close(); } }
  finally { if(f) await f.close(); await unlink(tmp).catch(e=>{if(e.code!=='ENOENT') throw e;}); }
}
export async function openFrontendAggregator({path,now=Date.now,getScopeSafety,writeFrontend,reconcileFrontend=async()=>{throw new Error('frontend reconciliation required');}}) {
  if(typeof path!=='string'||!path||typeof now!=='function'||typeof getScopeSafety!=='function'||typeof writeFrontend!=='function') throw new Error('invalid frontend configuration');
  const lock = await acquireJournalLocks([resolve(path)]);
  let state;
  try {
    try { state=parseUniqueJSON(await readFile(path,'utf8')); } catch(e) { if(e.code==='ENOENT') state={version:1,lastNow:0,tuples:[],publications:[]}; else throw e; }
    if(!validState(state)||!capacity(state)) throw new Error('invalid frontend journal');
  } catch(e) { await lock.close(); throw e; }
  let queue=Promise.resolve(), closed=false, uncertain=false, maxTime=state.lastNow;
  const serial = fn => { const result=queue.then(()=>{if(closed||uncertain) throw new Error('frontend journal closed or uncertain'); return fn();}); queue=result.catch(()=>{}); return result; };
  const clock = () => { const t=now(); if(!timeValid(t)||t<maxTime) throw new Error('invalid or reversed watcher clock'); maxTime=t; return t; };
  const save = async s => { if(!capacity(s)) throw new Error('frontend journal capacity exceeded'); try {await persist(path,s);state=s;} catch(e) {uncertain=true;throw e;} };
  const pruneState = (s,t) => { s.tuples=s.tuples.map(x=>({...x,reporters:x.reporters.filter(r=>t-r.lastReceipt<FRONTEND_REPORT_WINDOW_MS)})).filter(x=>x.reporters.length); };
  const safe = async s => { const v=await getScopeSafety({site:s.site,chainId:s.chainId}); return !!v && v.known===true && v.rawDrift===false && v.incident===false; };
  const intake = events => { events=structuredClone(events); return serial(async()=>{
    if(!Array.isArray(events)||!events.every(e=>validateObservation(e)&&e.kind==='frontend')) throw new Error('invalid frontend events');
    const t=clock(), next=structuredClone(state); pruneState(next,t);
    const safety=new Map(); for(const e of events) {const k=scopeKey(e);if(!safety.has(k)) { let allowed=false; try { allowed=await safe(e); } catch { /* Unknown safety fails closed. */ } safety.set(k,allowed); }}
    for(const [k,ok] of safety) if(!ok) for(const p of next.publications) if(scopeKey(p)===k && !p.delivered) p.quarantined=true;
    for(const [k,ok] of safety) for(const tuple of next.tuples.filter(x=>scopeKey(x)===k)) {if(!ok) tuple.quarantined=true; else if(tuple.quarantined) tuple.reporters=[];}
    next.tuples=next.tuples.filter(x=>x.reporters.length);
    if([...safety.values()].some(ok=>!ok)) { next.lastNow=t; await save(structuredClone(next)); }
    for(const e of events) {let x=next.tuples.find(x=>tupleCmp(x,e)===0); if(!x){x={site:e.site,chainId:e.chainId,path:e.path,hash:e.hash,reporters:[],quarantined:!safety.get(scopeKey(e))};next.tuples.push(x);} let r=x.reporters.find(r=>r.key===e.reporterKey); if(!r) x.reporters.push({key:e.reporterKey,firstReceipt:t,lastReceipt:t}); else if(t-r.lastReceipt>=FRONTEND_DEDUPE_MS) r.lastReceipt=t; x.reporters.sort((a,b)=>cmp(a.key,b.key)); }
    next.tuples.sort(tupleCmp); next.lastNow=t; await save(next);
  }); };
  async function drain(errors) {
    for (let i=0;i<state.publications.length;) {
      const p=state.publications[i]; if(p.delivered) { i++; continue; }
      if(p.quarantined) {
        let allowed=false; try { allowed=await safe(p); } catch {}
        if(!allowed) { i++; continue; }
        let result;
        try { result=await reconcileFrontend(structuredClone(p.record),p.id); if(!['current','absent'].includes(result?.state)) throw new Error('frontend reconciliation unverified'); } catch(error) { errors.push(error); i++; continue; }
        const next=structuredClone(state);
        if(result.state==='current') { delete next.publications[i].quarantined; next.publications[i].delivered=true; }
        else next.publications.splice(i,1);
        await save(next); if(result.state==='current') i++; continue;
      }
      let allowed=false;
      try { allowed=await safe(p); } catch { /* Unknown safety fails closed. */ }
      if(!allowed) {
        const next=structuredClone(state);
        for(const tuple of next.tuples) if(scopeKey(tuple)===scopeKey(p)) tuple.quarantined=true;
        next.publications[i].quarantined=true;
        next.lastNow=clock(); await save(next); i++; continue;
      }
      let result;
      try { result=await writeFrontend(structuredClone(p.record),p.id); } catch(error) {
        if(error?.code==='FRONTEND_QUARANTINED') { const next=structuredClone(state); next.publications[i].quarantined=true; for(const tuple of next.tuples) if(scopeKey(tuple)===scopeKey(p)) tuple.quarantined=true; await save(next); }
        errors.push(error); i++; continue;
      }
      if(result?.state!=='current') { errors.push(new Error(result?.state==='superseded'?'frontend publication superseded':'frontend publication readback unverified')); i++; continue; }
      const next=structuredClone(state); next.publications[i].delivered=true; await save(next); i++;
    }
  }
  const publish = () => serial(async()=>{
    const errors=[]; clock(); await drain(errors); const t=clock(), next=structuredClone(state); pruneState(next,t);
    const all=new Map(); for(const x of [...next.tuples,...next.publications]) all.set(scopeKey(x),{site:x.site,chainId:x.chainId});
    for(const [key,scope] of all) {
      let allowed=false; try { allowed=await safe(scope); } catch { /* Unknown safety fails closed. */ }
      if(!allowed) {for(const x of next.tuples) if(scopeKey(x)===key) x.quarantined=true; for(const p of next.publications) if(scopeKey(p)===key && !p.delivered) p.quarantined=true; continue;}
      next.tuples=next.tuples.filter(x=>scopeKey(x)!==key||!x.quarantined);
      if(next.publications.some(p=>scopeKey(p)===key&&!p.delivered)) continue;
      let rows=next.tuples.filter(x=>scopeKey(x)===key && x.reporters.length>=2).map(x=>{const first=Math.min(...x.reporters.map(r=>r.firstReceipt)),last=Math.max(...x.reporters.map(r=>r.lastReceipt));return {path:x.path,hash:x.hash,reporters:x.reporters.length,firstSeen:new Date(first).toISOString(),lastSeen:new Date(last).toISOString(),established:x.reporters.length>=FRONTEND_K&&t-first>=FRONTEND_MATURITY_MS};});
      rows.sort((a,b)=>Number(b.established)-Number(a.established)||b.reporters-a.reporters||cmp(b.lastSeen,a.lastSeen)||cmp(a.path,b.path)||cmp(a.hash,b.hash)); rows=rows.slice(0,FRONTEND_MAX_ROWS);
      const previous=next.publications.some(p=>scopeKey(p)===key && p.delivered && p.record.scripts.length);
      if(!rows.length&&!previous) continue;
      const record={schemaVersion:1,kind:'frontend',site:scope.site,chainId:scope.chainId,scripts:[],updatedAt:new Date(t).toISOString()};
      do { record.scripts=[...rows].sort((a,b)=>cmp(a.path,b.path)||cmp(a.hash,b.hash)); if(Buffer.byteLength(JSON.stringify(record))<=61440) break; rows.pop(); } while(rows.length);
      if(!validateFrontendRecord(record)) throw new Error('invalid frontend aggregate');
      next.publications=next.publications.filter(p=>scopeKey(p)!==key||!p.delivered);
      next.publications.push({...scope,id:idFor(record),record,delivered:false});
    }
    next.lastNow=t; await save(next); await drain(errors); if(errors.length) throw errors[0];
  });
  const prune = () => serial(async()=>{const t=clock(),next=structuredClone(state);pruneState(next,t);next.lastNow=t;await save(next);});
  let closing; const close = () => closing ??= (async()=>{await queue; closed=true; await lock.close();})();
  const scopes = () => [...new Map([...state.tuples,...state.publications].map(x=>[scopeKey(x),{site:x.site,chainId:x.chainId}])).values()].sort((a,b)=>cmp(a.site,b.site)||a.chainId-b.chainId);
  return {intake,publish,prune,close,scopes};
}
