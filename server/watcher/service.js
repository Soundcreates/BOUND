import {createHash} from 'node:crypto';
import {validateRecord} from '../../shared/contracts/index.js';
import {openDurableWatcher} from './durable.js';
import {createIntakeServer} from './http.js';
import {createWatcherRuntime} from './runtime.js';

// Local-only service boundary. The deployment must provide trusted status,
// archive, monitor and TLS termination adapters; no network is started here.
export async function createWatcherService({journalPath,windowMs,retentionMs,k,now=Date.now,sites,allowedOrigins,monitor,isIncidentActive,hasCorroboratedDrift,archive,intervals,onFailure,handleTriggers}) {
 if(!archive||typeof archive.writeObservation!=='function'||typeof archive.writeBaseline!=='function'||typeof handleTriggers!=='function')throw new Error('archive and incident adapters required');
 const watcher=await openDurableWatcher({path:journalPath,windowMs,retentionMs,k,now,isIncidentActive,hasCorroboratedDrift,writeObservation:(record,id)=>archive.writeObservation(record,id)});
 const server=createIntakeServer({watcher,allowedOrigins});
 const runtime=createWatcherRuntime({sites,watcher,monitor,intervals,onFailure,onTriggers:handleTriggers,onRenew:typeof archive.renew==='function'?()=>archive.renew():null,publishBaseline:async(_site,_chainId,source)=>{
  if(!validateRecord(source)||source.kind!=='baseline')throw new Error('invalid baseline');
  const hour=Math.floor(Date.parse(source.updatedAt)/3600000)*3600000;
  const record={...source,updatedAt:new Date(hour).toISOString()};
  const id=createHash('sha256').update(JSON.stringify(['hourly-baseline',record])).digest('hex');
  await archive.writeBaseline(record,id);
 }});
 let running=false,starting=null,stopping=null;
 function start({host='127.0.0.1',port=0}={}){
  if(host!=='127.0.0.1')return Promise.reject(new Error('service requires a loopback listener'));
  if(!Number.isInteger(port)||port<0||port>65535)return Promise.reject(new Error('invalid service port'));
  if(running||starting||stopping)return Promise.reject(new Error('service already active'));
  starting=(async()=>{
   await new Promise((resolve,reject)=>{const fail=error=>reject(error);server.once('error',fail);server.listen(port,host,()=>{server.off('error',fail);resolve();});});
   try{runtime.start();running=true;return server.address();}
   catch(error){await new Promise(resolve=>server.close(resolve));throw error;}
  })().finally(()=>{starting=null;});
  return starting;
 }
 function stop(){
  if(stopping)return stopping;
  stopping=(async()=>{
   if(starting){try{await starting;}catch{/* failed startup needs no shutdown */}}
   if(server.listening)await new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeIdleConnections?.();});
   await runtime.stop();running=false;
  })().finally(()=>{stopping=null;});
  return stopping;
 }
 return {watcher,runtime,start,stop};
}
