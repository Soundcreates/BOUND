import {isDeepStrictEqual} from 'node:util';
import {keccak256,toUtf8Bytes} from 'ethers';
import {validateRecord} from '../../packages/contracts/index.js';

export const DEMO_SCOPES=Object.freeze(['127.0.0.1:8000','localhost:8000','127.0.0.1:8001','localhost:8001'].map(site=>Object.freeze({site,chainId:11155111})));

export function createDemoRecords(scopes,updatedAt){
 if(!Array.isArray(scopes)||!scopes.length||!Number.isFinite(Date.parse(updatedAt)))throw new Error('invalid demo scopes or timestamp');
 const seen=new Set();
 return scopes.flatMap(({site,chainId})=>{
  const url=new URL(`http://${site}`),scope=JSON.stringify([site,chainId]);
  if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.host!==site||url.pathname!=='/'||url.username||url.password||url.search||url.hash||!Number.isSafeInteger(chainId)||chainId<1||seen.has(scope))throw new Error('demo scopes must be unique loopback hosts with valid chains');
  seen.add(scope);
  const common={schemaVersion:1,site,chainId};
  const records=[{...common,kind:'baseline',counterparties:[],calledContracts:[],updatedAt},{...common,kind:'status',state:'normal',feedReference:keccak256(toUtf8Bytes(JSON.stringify(['bound-local-demo-fixture-v1',site,chainId]))),incidentReference:null,updatedAt}];
  if(!records.every(validateRecord))throw new Error('invalid demo records');
  return records;
 });
}

export function checkDemoRecords(expected,rows){
 for(const record of expected){
  const matches=rows.filter(row=>row.record.site===record.site&&row.record.chainId===record.chainId&&row.record.kind===record.kind);
  if(matches.length!==1||!isDeepStrictEqual(matches[0].record,record))throw new Error(`demo record missing, duplicate or changed: ${record.site} ${record.chainId} ${record.kind}`);
 }
}
