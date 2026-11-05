import {resolveTxt as dnsResolveTxt} from 'node:dns/promises';
import {isIP} from 'node:net';

// Team Cymru's public DNS service exposes queried public server IPs to the resolver.
export function createCymruLookup({resolveTxt=dnsResolveTxt,timeoutMs=5000}={}) {
 if(typeof resolveTxt!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw new Error('invalid ASN configuration');
 return async ip=>{
  if(typeof ip!=='string'||isIP(ip)!==4)throw new Error('invalid IPv4 address');
  const question=ip.split('.').reverse().join('.')+'.origin.asn.cymru.com';
  let timer;
  try {
   const result=await Promise.race([resolveTxt(question),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('ASN lookup timeout')),timeoutMs);})]);
   if(!Array.isArray(result)||result.length!==1||!Array.isArray(result[0])||result[0].some(s=>typeof s!=='string'))throw new Error('invalid ASN response');
   const field=result[0].join('').split('|')[0].trim();
   if(!/^\d+(?:\s+\d+)*$/.test(field))throw new Error('invalid ASN response');
   const asns=[...new Set(field.split(/\s+/).map(n=>BigInt(n).toString()))].sort((a,b)=>BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0);
   if(asns.length !== 1 || asns.some(n=>BigInt(n)>4294967295n))throw new Error('invalid ASN response');
   return asns.join(' ');
  } finally {clearTimeout(timer);}
 };
}
