import {lstat, readFile, readdir, realpath} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const expected=join(root,'client/safe-page/dist');
const files=['app.js','index.html','style.css'];
export const DEFAULT_GATEWAY='https://api.gateway.ethswarm.org';
function endpoint(value, {gateway=false}={}) {
 const url=new URL(value);
 if(url.username||url.password||url.search||url.hash || (url.protocol!=='https:' && !(url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) throw Error(gateway?'invalid gateway URL':'invalid Bee URL');
 return url.href.replace(/\/$/,'');
}
async function json(response) {
 if(!response.ok)throw Error(`Swarm request failed: HTTP ${response.status}`);
 let data;
 if(response.body?.getReader){
  const reader=response.body.getReader(),parts=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();throw Error('Swarm response too large');}parts.push(Buffer.from(value));}}finally{reader.releaseLock();}
  data=Buffer.concat(parts).toString('utf8');
 }else{data=await response.text();if(Buffer.byteLength(data)>65536)throw Error('Swarm response too large');}
 return JSON.parse(data);
}
export function validateSafeHtml(html) {
 if(typeof html!=='string'||!html.includes('src="./app.js"')||!html.includes('href="./style.css"')||/<script\b(?![^>]*\bsrc=)/i.test(html)||/\son\w+\s*=/i.test(html)||/<(?:iframe|object|embed|base|form|img|audio|video)\b/i.test(html)||/<meta\b[^>]*http-equiv\s*=\s*["']?refresh/i.test(html))throw Error('invalid safe page HTML');
 const resources=[...html.matchAll(/\b(?:src|href)\s*=\s*(["'])(.*?)\1/gi)].map(m=>m[2]);
 if(resources.length!==2||resources.some(value=>!['./app.js','./style.css'].includes(value)))throw Error('safe page resources must be local');
 const policies=[...html.matchAll(/<meta\b[^>]*http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"[^>]*>/gi)];
 if(policies.length!==1)throw Error('safe page CSP missing');
 const directives=new Map();
 for(const part of policies[0][1].split(';').map(x=>x.trim()).filter(Boolean)) {const [name,...values]=part.split(/\s+/);if(directives.has(name))throw Error('duplicate safe page CSP directive');directives.set(name,values);}
 for(const [name,value] of [['default-src',"'none'"],['script-src',"'self'"],['style-src',"'self'"],['base-uri',"'none'"],['form-action',"'none'"],['object-src',"'none'"]])if(directives.get(name)?.join(' ')!==value)throw Error('invalid safe page CSP');
 const connections=directives.get('connect-src');
 if(directives.size!==7||connections?.length!==1)throw Error('invalid safe page connection policy');
 const rpc=new URL(connections[0]);
 if(endpoint(rpc.href)!==rpc.origin||rpc.pathname!=='/')throw Error('safe page connection policy must contain one public RPC origin');
 return true;
}
export async function publishSafePage({directory,beeUrl,batchId,fetchImpl=fetch,dryRun=true,apiVersion,gatewayUrl,stampedByHost=true,reference}) {
 if(typeof stampedByHost!=='boolean')throw Error('invalid gateway postage mode');
 if(resolve(directory)!==expected || await realpath(directory)!==expected) throw Error('directory must be the built safe page');
 const names=(await readdir(directory)).sort(); if(JSON.stringify(names)!==JSON.stringify(files))throw Error('safe page must contain exactly the declared files');
 const contents={}; for(const name of files) {const p=join(directory,name),stat=await lstat(p); if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1_000_000)throw Error('invalid safe page file'); contents[name]=await readFile(p);}
 const html=contents['index.html'].toString('utf8');
 validateSafeHtml(html);
 if(dryRun)return {reference:null,url:null,files};
 const base=endpoint(stampedByHost ? (gatewayUrl||DEFAULT_GATEWAY) : beeUrl), gateway=endpoint(gatewayUrl||base,{gateway:true});
 const request=async(url,options)=>{
  try{return await fetchImpl(url,options);}catch(error){
   const causes=[];let cause=error;
   for(let i=0;cause&&i<5;i++,cause=cause.cause){if(cause.code)causes.push(cause.code);if(cause.message&&!causes.includes(cause.message))causes.push(cause.message);}
   throw new Error(`Swarm ${options?.method||'GET'} ${new URL(url).origin}${new URL(url).pathname} failed: ${causes.join(': ')}`,{cause:error});
  }
 };
 const get=async url=>json(await request(url,{signal:AbortSignal.timeout(10000),redirect:'error',credentials:'omit'}));
 if(reference!==undefined&&!/^[0-9a-f]{64}$/.test(reference))throw Error('invalid existing Swarm reference');
 if(!reference&&stampedByHost){
  if(batchId||beeUrl||apiVersion)throw Error('gateway mode uses host postage; remove Bee URL, batch ID and API version');
 } else if(!reference) {
  if(!/^[a-fA-F0-9]{64}$/.test(batchId??''))throw Error('invalid postage batch ID');
  if(!/^\d+\.\d+\.\d+$/.test(apiVersion??''))throw Error('set the Bee API version verified on the owner node');
  const health=await get(`${base}/health`); if(health.status!=='ok'||health.apiVersion!==apiVersion)throw Error('Bee health/API version mismatch; verify compatibility on the owner node');
  const stamp=await get(`${base}/stamps/${batchId}`); if(stamp.batchID?.toLowerCase()!==batchId.toLowerCase()||stamp.exists!==true||stamp.usable!==true||stamp.immutableFlag!==true)throw Error('postage batch must exist, be usable and immutable');
 }
 const form=new FormData(); for(const name of files)form.append('file',new Blob([contents[name]],{type:name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'text/javascript'}),name);
 const result=reference?{reference}:await json(await request(`${base}/bzz`,{method:'POST',headers:{...(!stampedByHost?{'swarm-postage-batch-id':batchId}:{}),'swarm-index-document':'index.html'},body:form,signal:AbortSignal.timeout(120000),redirect:'error'}));
 if(!/^[0-9a-f]{64}$/.test(result.reference??''))throw Error('invalid Bee reference');
 // A reference/HTTP 200 alone can be a gateway shell or blocked content.
 // Verify every served resource and the root document before advertising the URL.
 try {
 for(const name of [...files,'']) {
  const response=await request(`${gateway}/bzz/${result.reference}/${name}`,{signal:AbortSignal.timeout(15000),redirect:'manual',credentials:'omit'});
  if(response.status>=300&&response.status<400){const location=response.headers.get('location')||'';const forbidden=/\/forbidden(?:[/?#]|$)/.test(location);throw Error(forbidden?'Public gateway blocks this release (redirect to /forbidden). Gateway approval or another serving gateway is required.':'Gateway redirected this resource; the release was not verified.');}
  if(!response.ok)throw Error(`Gateway read-back failed for ${name||'index'}: HTTP ${response.status}`);
  const expected=contents[name||'index.html'];
  const mime=response.headers?.get('content-type')?.split(';')[0].trim().toLowerCase();
  const allowed=name==='app.js'?['text/javascript','application/javascript']:name==='style.css'?['text/css']:['text/html'];
  if(!allowed.includes(mime))throw Error(`Gateway returned incorrect MIME for ${name||'index'}`);
  const reader=response.body?.getReader(); if(!reader)throw Error('Gateway response must be streamed');
  const chunks=[];let length=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>expected.length){await reader.cancel();throw Error('Gateway read-back exceeds expected bytes');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
  if(!Buffer.concat(chunks).equals(expected))throw Error(`Gateway read-back differs for ${name||'index'}`);
 }
 }catch(error){throw new Error(`${error.message} Uploaded reference: ${result.reference}. Recheck without uploading: npm run swarm:safe:publish -- --verify ${result.reference}`,{cause:error});}
 return {reference:result.reference,url:`${gateway}/bzz/${result.reference}/`,files};
}
async function main(){
 const args=process.argv.slice(2), options={directory:expected,dryRun:true};
 while(args.length){const flag=args.shift();if(flag==='--publish') options.dryRun=false;else if(flag==='--bee') options.stampedByHost=false;else if(flag==='--gateway') options.stampedByHost=true;else if(flag==='--dry-run') options.dryRun=true;else if(flag==='--verify'&&args.length) options.reference=args.shift();else if(flag==='--directory'&&args.length) options.directory=args.shift();else throw Error('usage: [--directory client/safe-page/dist] [--gateway | --bee] [--dry-run | --publish] [--verify <reference>]');}
 Object.assign(options,{...(options.stampedByHost===false?{beeUrl:process.env.BOUND_BEE_API_URL,batchId:process.env.BOUND_POSTAGE_BATCH_ID,apiVersion:process.env.BOUND_BEE_API_VERSION}:{}),gatewayUrl:process.env.BOUND_SWARM_GATEWAY_URL});
 console.log(JSON.stringify(await publishSafePage(options),null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
