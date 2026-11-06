import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publishSafePage,validateSafeHtml} from './publish-safe-page.mjs';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
execFileSync(process.execPath,['apps/safe-page/build.mjs']);
const directory=resolve('apps/safe-page/dist'),batchId='a'.repeat(64),reference='b'.repeat(64);
const config={directory,beeUrl:'http://127.0.0.1:1633',gatewayUrl:'https://example.com',batchId,apiVersion:'1.2.3',dryRun:false,stampedByHost:false};
const response=value=>({ok:true,text:async()=>JSON.stringify(value)});
test('dry run performs no network activity',async()=>{
 let calls=0; const result=await publishSafePage({directory,fetchImpl:async()=>{calls++;throw Error('network');}});
 assert.equal(calls,0);assert.equal(result.reference,null);assert.deepEqual(result.files,['app.js','index.html','style.css']);
});
test('allows the fixed public RPC CSP while rejecting external assets and executable markup',async()=>{
 const html=await readFile(resolve(directory,'index.html'),'utf8');assert.equal(validateSafeHtml(html),true);
 for(const changed of [html.replace('./app.js','https://evil.example/app.js'),html.replace('./style.css','//evil.example/style.css'),html.replace("script-src 'self'","script-src 'self' 'unsafe-inline'"),html.replace("connect-src https://rpc.rabdi.db-chain.testnet.arkiv.network","connect-src *"),html.replace('</body>','<script>alert(1)</script></body>'),html.replace('<main>','<main onclick="alert(1)">')])assert.throws(()=>validateSafeHtml(changed));
});
test('uploads one collection after health and immutable stamp checks',async()=>{
 const calls=[];const fetchImpl=async(url,options)=>{calls.push({url,options});if(options?.method!=='POST'&&url.includes('/bzz/'))return served(url);if(url.endsWith('/health'))return response({status:'ok',apiVersion:'1.2.3'});if(url.includes('/stamps/'))return response({batchID:batchId,exists:true,usable:true,immutableFlag:true});return response({reference});};
 const result=await publishSafePage({...config,fetchImpl});assert.equal(result.url,`https://example.com/bzz/${reference}/`);assert.equal(calls.length,7);assert.equal(calls[2].options.method,'POST');assert.equal(calls[2].options.headers['swarm-index-document'],'index.html');assert.equal([...calls[2].options.body.keys()].length,3);
});
test('rejects incompatible node, unusable batch and forged references',async()=>{
 for(const values of [[{status:'ok',apiVersion:'9.9.9'}],[{status:'ok',apiVersion:'1.2.3'},{batchID:batchId,exists:true,usable:true,immutableFlag:false}],[{status:'ok',apiVersion:'1.2.3'},{batchID:batchId,exists:true,usable:true,immutableFlag:true},{reference:'bad'}]]) {
 let i=0;await assert.rejects(publishSafePage({...config,fetchImpl:async()=>response(values[i++])}));
 }
 await assert.rejects(publishSafePage({...config,batchId:'bad'}));await assert.rejects(publishSafePage({...config,directory:'/tmp'}));
});

async function served(url){const name=url.endsWith('/')?'index.html':url.split('/').at(-1);return new Response(await readFile(resolve(directory,name)),{headers:{'content-type':name.endsWith('.html')?'text/html':name.endsWith('.css')?'text/css':'text/javascript'}});}
test('gateway uploads without Bee health, stamps or postage and verifies all assets',async()=>{
 const calls=[];
 const result=await publishSafePage({directory,dryRun:false,fetchImpl:async(url,options)=>{
  calls.push({url,options});if(options.method==='POST'){
   assert.equal(url,'https://api.gateway.ethswarm.org/bzz');
   assert.deepEqual(options.headers,{'swarm-index-document':'index.html'});
   assert.equal([...options.body.keys()].length,3);return response({reference});
  }return served(url);
 }});
 assert.equal(calls.length,5);assert.equal(result.url,`https://api.gateway.ethswarm.org/bzz/${reference}/`);
});
test('gateway rejects shells, modified assets, wrong MIME, missing resources and mixed postage',async()=>{
 for(const mode of ['shell','mime','missing','oversize']){
  await assert.rejects(publishSafePage({directory,dryRun:false,fetchImpl:async(url,options)=>{
   if(options.method==='POST')return response({reference});
   if(mode==='missing')return new Response('',{status:404});
   if(mode==='mime')return new Response('x',{headers:{'content-type':'text/plain'}});
   return new Response(mode==='shell'?'<html>gateway shell</html>':'x'.repeat(1000001),{headers:{'content-type':'text/javascript'}});
  }}));
 }
 await assert.rejects(publishSafePage({directory,dryRun:false,batchId}));
});
test('blocked releases retain their reference and verification retries never upload',async()=>{
 const calls=[];
 await assert.rejects(publishSafePage({directory,dryRun:false,reference,fetchImpl:async(url,options)=>{
  calls.push(options.method||'GET');return new Response(null,{status:302,headers:{location:`https://bzz.link/forbidden?hash=${reference}`}});
 }}),error=>error.message.includes('blocks this release')&&error.message.includes(reference)&&error.message.includes('--verify'));
 assert.deepEqual(calls,['GET']);
 let posts=0;
 const result=await publishSafePage({directory,dryRun:false,reference,fetchImpl:async(url,options)=>{if(options.method==='POST')posts++;return served(url);}});
 assert.equal(posts,0);assert.equal(result.reference,reference);
});
test('transport errors name the request stage and underlying cause',async()=>{
 await assert.rejects(publishSafePage({directory,dryRun:false,fetchImpl:async()=>{throw new TypeError('fetch failed',{cause:Object.assign(new Error('connection timeout'),{code:'UND_ERR_CONNECT_TIMEOUT'})});}}),error=>error.message.includes('POST https://api.gateway.ethswarm.org/bzz')&&error.message.includes('UND_ERR_CONNECT_TIMEOUT'));
});
