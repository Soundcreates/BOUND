const categories=new Set(['wallet','amount','transaction_hash','request_digest','user_choice']);
const address=/^0x[0-9a-f]{40}$/;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const marker=value=>typeof value==='string'&&value.length>=8&&value.length<=256&&/^[\x20-\x7e]+$/.test(value);

// Scans synthetic test artifacts only. Results identify the artifact and the
// category but never return the canary or the matching data.
export function scanPrivacy({artifacts,canaries,publicCounterparties=[]}){
 if(!Array.isArray(artifacts)||artifacts.length>100||!Array.isArray(canaries)||!canaries.length||canaries.length>100||!Array.isArray(publicCounterparties)||publicCounterparties.some(value=>typeof value!=='string'||!address.test(value)))throw new Error('invalid privacy scan configuration');
 const names=new Set();let total=0;
 for(const artifact of artifacts){
  if(!exact(artifact,['name','content'])||typeof artifact.name!=='string'||!/^[a-zA-Z0-9._-]{1,80}$/.test(artifact.name)||names.has(artifact.name)||!(typeof artifact.content==='string'||artifact.content instanceof Uint8Array))throw new Error('invalid privacy scan artifact');
  names.add(artifact.name);total+=typeof artifact.content==='string'?Buffer.byteLength(artifact.content):artifact.content.length;
 }
 if(total>8000000)throw new Error('privacy scan artifacts too large');
 const publicSet=new Set(publicCounterparties.map(value=>value.toLowerCase()));
 for(const canary of canaries){
  if(!exact(canary,['category','value'])||!categories.has(canary.category)||!marker(canary.value))throw new Error('invalid privacy scan canary');
  if(publicSet.has(canary.value.toLowerCase()))throw new Error('privacy canary conflicts with a public counterparty');
 }
 const findings=[];
 for(const artifact of artifacts){
  const bytes=typeof artifact.content==='string'?Buffer.from(artifact.content):Buffer.from(artifact.content);
  const text=bytes.toString('utf8').toLowerCase(),binary=bytes.toString('hex');
  const found=new Set();
  for(const {category,value} of canaries){
   const normalized=value.toLowerCase(),escaped=JSON.stringify(value).slice(1,-1).toLowerCase();
   const rawHex=/^0x(?:[0-9a-f]{2}){4,}$/i.test(value)?normalized.slice(2):null;
   if(text.includes(normalized)||text.includes(escaped)||(rawHex&&(text.includes(rawHex)||binary.includes(rawHex))))found.add(category);
  }
  for(const category of [...found].sort())findings.push({artifact:artifact.name,category});
 }
 return {artifactCount:artifacts.length,canaryCount:canaries.length,findings};
}
