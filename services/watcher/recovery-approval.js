import {readFile} from 'node:fs/promises';
import {parseUniqueJSON,validateObservation} from '../../packages/contracts/index.js';
const id=/^[0-9a-f]{64}$/;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const validApproval=entry=>exact(entry,['site','chainId','incidentId','expiresAt'])&&validateObservation({site:entry.site,chainId:entry.chainId,value:'0x'+'0'.repeat(40),kind:'warned',reporterKey:'validation'})&&typeof entry.incidentId==='string'&&id.test(entry.incidentId)&&Number.isSafeInteger(entry.expiresAt)&&entry.expiresAt>=0;

// This file is an operator-controlled local authority, not a web endpoint.
// Each approval is limited to one incident episode and an expiration time.
export function createRecoveryApprovalPolicy({path,now=Date.now}){
 if(typeof path!=='string'||!path||typeof now!=='function')throw new Error('invalid recovery approval configuration');
 return async(site,chainId,episode)=>{
  if(!exact(episode,['incidentId'])||typeof episode.incidentId!=='string'||!id.test(episode.incidentId)||!validateObservation({site,chainId,value:'0x'+'0'.repeat(40),kind:'warned',reporterKey:'validation'}))throw new Error('invalid recovery approval scope');
  const time=now();if(!Number.isSafeInteger(time)||time<0)throw new Error('invalid recovery approval clock');
  let state;try{state=parseUniqueJSON(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return false;throw new Error('invalid recovery approval file',{cause:error});}
  if(!exact(state,['version','approvals'])||state.version!==1||!Array.isArray(state.approvals)||state.approvals.length>1000||!state.approvals.every(validApproval)||new Set(state.approvals.map(entry=>JSON.stringify([entry.site,entry.chainId,entry.incidentId]))).size!==state.approvals.length)throw new Error('invalid recovery approval file');
  return state.approvals.some(entry=>entry.site===site&&entry.chainId===chainId&&entry.incidentId===episode.incidentId&&time<entry.expiresAt);
 };
}
