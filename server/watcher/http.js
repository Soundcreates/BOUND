import http from 'node:http';
import {parseUniqueJSON,validateObservationBatch,validateIntakeResponse} from '../../shared/contracts/index.js';

// Origin allowlisting constrains browser CORS; it is not reporter authentication.
// Callers must bind the returned server to a deliberately configured interface.
export function createIntakeServer({watcher,allowedOrigins,maxBodyBytes=65536}) {
 if (!watcher || typeof watcher.intake !== 'function' || !Array.isArray(allowedOrigins) || !allowedOrigins.length || allowedOrigins.some(origin=>typeof origin!=='string'||!/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) || !Number.isSafeInteger(maxBodyBytes) || maxBodyBytes<1 || maxBodyBytes>1048576) throw new Error('invalid intake configuration');
 const allowed=new Set(allowedOrigins);
 const server=http.createServer(async(req,res)=>{
  const origin=req.headers.origin;
  const headers={'cache-control':'no-store','x-content-type-options':'nosniff','vary':'Origin'};
  if (allowed.has(origin)) headers['access-control-allow-origin']=origin;
  const respond=(status,body)=>{
   if(res.headersSent)return;
   if(body!==undefined)headers['content-type']='application/json; charset=utf-8';
   res.writeHead(status,headers);res.end(body===undefined?undefined:JSON.stringify(body));
  };
  if(req.url!=='/v1/observations')return respond(404);
  if(!allowed.has(origin))return respond(403);
  if(req.method==='OPTIONS') {
   const requested=(req.headers['access-control-request-headers']??'').toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
   if(req.headers['access-control-request-method']!=='POST'||requested.some(h=>h!=='content-type'))return respond(403);
   headers['access-control-allow-methods']='POST, OPTIONS';headers['access-control-allow-headers']='content-type';
   return respond(204);
  }
  if(req.method!=='POST')return respond(405);
  if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']??'') || (req.headers['content-encoding'] && req.headers['content-encoding']!=='identity'))return respond(415);
  const length=req.headers['content-length'];
  if(length!==undefined && (!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))))return respond(400);
  if(length!==undefined && Number(length)>maxBodyBytes){headers.connection='close';req.resume();return respond(413);}
  const chunks=[];let size=0;
  try {
   for await(const chunk of req){size+=chunk.length;if(size>maxBodyBytes){headers.connection='close';req.resume();return respond(413);}chunks.push(chunk);}
   const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
   let batch;try{batch=parseUniqueJSON(text);}catch{return respond(400);}
   if(!validateObservationBatch(batch))return respond(400);
   let result;try{result=await watcher.intake(batch);}catch{return respond(503,{schemaVersion:1,result:'retry'});}
   if(!validateIntakeResponse(result))return respond(503,{schemaVersion:1,result:'retry'});
   return respond(result.result==='accepted'?202:result.result==='retry'?503:400,result);
  } catch {return respond(400);}
 });
 server.requestTimeout=10000;server.headersTimeout=10000;server.maxHeadersCount=64;
 return server;
}
