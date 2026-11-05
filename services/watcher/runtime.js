// Timers and adapters are explicit: this module does not choose networks or write keys.
export function createWatcherRuntime({sites,watcher,monitor,publishBaseline,intervals,onFailure=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}) {
 if(!Array.isArray(sites)||!sites.length||!watcher||typeof watcher.flush!=='function'||typeof watcher.baseline!=='function'||!monitor||typeof monitor.check!=='function'||typeof publishBaseline!=='function'||typeof onFailure!=='function'||typeof setTimer!=='function'||typeof clearTimer!=='function'||!intervals||['poll','flush','baseline'].some(name=>!Number.isSafeInteger(intervals[name])||intervals[name]<1||intervals[name]>2147483647))throw new Error('invalid runtime configuration');
 const keys=new Set();
 for(const entry of sites){
  if(!entry||typeof entry.site!=='string'||!Number.isSafeInteger(entry.chainId)||entry.chainId<1)throw new Error('invalid runtime site');
  let url;try{url=new URL(`https://${entry.site}`);}catch{throw new Error('invalid runtime site');}
  if(url.host!==entry.site||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('invalid runtime site');
  const key=JSON.stringify([entry.site,entry.chainId]);if(keys.has(key))throw new Error('duplicate runtime site');keys.add(key);
 }
 const configured=sites.map(({site,chainId})=>({site,chainId}));
 const report=event=>{try{onFailure(event);}catch{/* observability must not stop independent jobs */}};
 const jobs={
  poll:async()=>{for(const {site,chainId} of configured)try{await monitor.check(site,chainId);}catch{report({task:'poll',site,chainId});}},
  flush:async()=>{try{await watcher.flush();}catch{report({task:'flush'});}},
  baseline:async()=>{for(const {site,chainId} of configured)try{const record=await watcher.baseline(site,chainId);await publishBaseline(site,chainId,record);}catch{report({task:'baseline',site,chainId});}}
 };
 const active=new Map(),timers=new Map();let running=false, generation=0;
 function run(name){
  if(active.has(name))return active.get(name);
  const promise=Promise.resolve().then(jobs[name]).finally(()=>active.delete(name));active.set(name,promise);return promise;
 }
 function schedule(name,epoch){
  if(!running||generation!==epoch)return;
  timers.set(name,setTimer(async()=>{if(!running||generation!==epoch)return;timers.delete(name);try{await run(name);}finally{schedule(name,epoch);}},intervals[name]));
 }
 function start(){if(running)throw new Error('runtime already running');running=true;const epoch=++generation;for(const name of Object.keys(jobs))schedule(name,epoch);}
 async function stop(){running=false;generation++;for(const timer of timers.values())clearTimer(timer);timers.clear();await Promise.allSettled([...active.values()]);}
 return {start,stop,runPoll:()=>run('poll'),runFlush:()=>run('flush'),runBaseline:()=>run('baseline')};
}
