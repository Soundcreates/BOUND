import {validateRecord,validateSnapshot} from '../contracts/index.js';

const address=/^0x[0-9a-f]{40}$/;
const verdict=score=>score>=70?'green':score>=40?'amber':score>=16?'red':'escalated';
const defaults=Object.freeze({base:50,snapshot:35,attested:40,lineage:15,calledKnown:20,calledUnknown:-30,drift:-30});

// Only extension browser metadata may supply this origin; page fields are not trusted.
export function canonicalSite(origin){
 let url;try{url=new URL(origin);}catch{throw new Error('invalid site origin');}
 if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('invalid site origin');
 return url.host.toLowerCase();
}
const normalizeList=value=>Array.isArray(value)&&value.every(item=>typeof item==='string'&&address.test(item))?new Set(value):new Set();

// verifiedSnapshot, owner-checked baseline, attestation and lineage facts must
// be supplied by extension-owned adapters, never by the requesting page.
export function evaluatePolicy({site,chainId,decoded,coverage='mediated',bypassPossible=false,verifiedSnapshot,baseline,accounts=[],attestations=[],lineageFacts=[],witnessed=[],corroboratedDrift=false,weights=defaults,now=Date.now()}){
 if(typeof site!=='string'||canonicalSite(`https://${site}`)!==site||!Number.isSafeInteger(chainId)||chainId<1||!decoded||!['read','unsupported','blind','decoded','opaque','malformed'].includes(decoded.classification)||!['mediated','unsupported'].includes(coverage)||typeof bypassPossible!=='boolean'||typeof corroboratedDrift!=='boolean'||!Number.isSafeInteger(now))throw new Error('invalid policy input');
 if(decoded.classification==='read')return {action:'pass',decision:null,reasons:[]};
 if(coverage==='unsupported'||decoded.classification==='unsupported')return {action:'warn',decision:{coverage:'unsupported',evaluated:false,bypassPossible,verdict:null,score:null},reasons:['unsupported method']};
 if(decoded.classification==='blind')return {action:'warn',decision:{coverage:'mediated',evaluated:true,bypassPossible,verdict:'escalated',score:0},reasons:['blind hash signing'],cap:0};
 const grey=reason=>({action:'notice',decision:{coverage:'mediated',evaluated:true,bypassPossible,verdict:'grey',score:null},reasons:[reason],cap:null});
 if(!verifiedSnapshot||!validateSnapshot(verifiedSnapshot)||Date.parse(verifiedSnapshot.generatedAt)>now||Date.parse(verifiedSnapshot.expiresAt)<=now)return grey('verified snapshot unavailable or expired');
 if(!baseline||!validateRecord(baseline)||baseline.kind!=='baseline'||baseline.site!==site||baseline.chainId!==chainId)return grey('baseline unavailable');
 if(!Array.isArray(decoded.addresses)||decoded.addresses.some(item=>!item||typeof item.address!=='string'||!address.test(item.address)||!['rights','destination','called','token'].includes(item.role)||typeof item.verified!=='boolean'))throw new Error('invalid decoded addresses');
 if(!weights||Object.keys(defaults).some(key=>!Number.isSafeInteger(weights[key])||Math.abs(weights[key])>100))throw new Error('invalid policy weights');
 const siteEntry=verifiedSnapshot.sites[site]?.[String(chainId)],seeded=!!siteEntry;
 const counterparts=normalizeList(siteEntry?.trustedCounterparties),called=normalizeList(siteEntry?.trustedCalledContracts);
 const shared=new Set((verifiedSnapshot.sharedContracts[String(chainId)]||[]).map(item=>item.address));
 const own=normalizeList(accounts),seen=normalizeList(witnessed);
 const attested=new Set();
 if(Array.isArray(attestations))for(const item of attestations)if(item?.verified===true&&item.site===site&&item.chainId===chainId&&typeof item.address==='string'&&address.test(item.address))attested.add(item.address);
 const creators=new Set((siteEntry?.deployerLineage||[]).map(item=>item.creator));
 const lineage=new Set();
 if(Array.isArray(lineageFacts))for(const item of lineageFacts)if(item?.verified===true&&item.chainId===chainId&&typeof item.address==='string'&&address.test(item.address)&&creators.has(item.creator))lineage.add(item.address);
 const sources=value=>({snapshot:counterparts.has(value)||called.has(value)||shared.has(value),attested:attested.has(value),lineage:lineage.has(value)});
 let cap=100,score=weights.base;const reasons=[],used=new Set();let hasKnownCall=false,hasUnknownCall=false;
 for(const item of decoded.addresses){
  const trust=item.verified?sources(item.address):{snapshot:false,attested:false,lineage:false};
  const trusted=trust.snapshot||trust.attested||trust.lineage;
  if(item.verified&&trust.snapshot)used.add('snapshot');if(item.verified&&trust.attested)used.add('attested');if(item.verified&&trust.lineage)used.add('lineage');
  if(item.role==='called'||item.role==='token'){if(trusted)hasKnownCall=true;else hasUnknownCall=true;}
  if(!item.verified){cap=Math.min(cap,65);reasons.push('unverified address scan');continue;}
  if(trusted)continue;
  if(!seeded){cap=Math.min(cap,seen.has(item.address)?65:(corroboratedDrift?15:35));reasons.push('untrusted address on uncurated site');}
  else if(item.role==='rights'){cap=Math.min(cap,corroboratedDrift?15:35);reasons.push('untrusted rights');}
  else if(item.role==='destination'&&!own.has(item.address)){cap=Math.min(cap,65);reasons.push('untrusted destination');}
 }
 if(used.has('snapshot'))score+=weights.snapshot;if(used.has('attested'))score+=weights.attested;if(used.has('lineage'))score+=weights.lineage;
 if(hasKnownCall)score+=weights.calledKnown;if(hasUnknownCall)score+=weights.calledUnknown;
 if(corroboratedDrift){score+=weights.drift;reasons.push('corroborated infrastructure drift');}
 if(decoded.classification==='malformed'){cap=Math.min(cap,35);reasons.push('malformed request');}
 if(decoded.unknownTypedFields){cap=Math.min(cap,65);reasons.push('unknown typed-data fields');}
 if(decoded.destinationNotFixed){cap=Math.min(cap,65);reasons.push('destination not fixed by signature');}
 if(decoded.contractCreation){cap=Math.min(cap,35);reasons.push('contract creation not understood');}
 if(bypassPossible){cap=Math.min(cap,69);reasons.push('provider bypass possible');}
 score=Math.min(Math.max(score,0),100,cap);
 const outcome=verdict(score),decision={coverage:'mediated',evaluated:true,bypassPossible,verdict:outcome,score};
 return {action:outcome==='red'||outcome==='escalated'?'warn':outcome==='amber'?'notice':'pass',decision,reasons:[...new Set(reasons)],cap};
}
