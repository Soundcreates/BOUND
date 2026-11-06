import { parseUniqueJSON, validateRecord } from '../../packages/contracts/index.js';
const address = /^0x[0-9a-f]{40}$/;
const key = /^0x[0-9a-f]{64}$/;
const quantity = /^0x(?:0|[1-9a-f][0-9a-f]*)$/;
const safeQuantity = value => {
  if (typeof value !== 'string' || !quantity.test(value)) throw new Error('invalid Arkiv block');
  const result = Number(BigInt(value));
  if (!Number.isSafeInteger(result)) throw new Error('invalid Arkiv block');
  return result;
};
export function decodeArkivPayload(attributes, schemaTag) {
  if (!Array.isArray(attributes)) throw new Error('invalid Arkiv payload');
  const tags = attributes.filter(a=>a?.name === 'arkiv.schema');
  const parts = attributes.filter(a=>a?.name === 'payload');
  if (tags.length !== 1 || tags[0].type !== 'str' || tags[0].value !== schemaTag || parts.length !== 1 || parts[0].type !== 'bytes' || typeof parts[0].value !== 'string' || !/^0x(?:[0-9a-f]{2})*$/.test(parts[0].value) || parts[0].value.length > 262146) throw new Error('invalid Arkiv payload');
  try {
    const text = new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(parts[0].value.slice(2),'hex'));
    const record = parseUniqueJSON(text);
    if (!validateRecord(record)) throw new Error('invalid record');
    return record;
  } catch (error) { throw new Error('invalid Arkiv payload',{cause:error}); }
}
// Proposed wire format: schema tag plus a bytes attribute holding UTF-8 JSON.
// This owner-wide read does not implement per-site transport or Anon-RPC.
export function createArkivRpcReader({url, schemaTag, fetchImpl=fetch, accessKey, expectedChainId=7794095, pageSize=100, maxPages=50, timeoutMs=10000}) {
  let endpoint;
  try { endpoint = new URL(url); } catch { throw new Error('invalid Arkiv configuration'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || typeof schemaTag !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(schemaTag) || typeof fetchImpl !== 'function' || (accessKey !== undefined && typeof accessKey !== 'string') || !Number.isSafeInteger(expectedChainId) || expectedChainId < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 1000 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error('invalid Arkiv configuration');
  async function queryInternal({owner,operationId}) {
    if (typeof owner !== 'string' || !address.test(owner)) throw new Error('invalid owner');
    if (operationId !== undefined && (typeof operationId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(operationId))) throw new Error('invalid operation ID');
    async function rpc(method, params) {
      let response, json;
      try {
        response = await fetchImpl(endpoint.toString(),{method:'POST',headers:{'content-type':'application/json',...(accessKey ? {'x-api-key':accessKey} : {})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(timeoutMs)});
        if (!response.ok) throw new Error('HTTP failure');
        json = await response.json();
      } catch { throw new Error('Arkiv query unavailable'); }
      if (!json || json.jsonrpc !== '2.0' || json.id !== 1 || json.error || !Object.hasOwn(json,'result')) throw new Error('invalid Arkiv query response');
      return json.result;
    }
    if (safeQuantity(await rpc('eth_chainId',[])) !== expectedChainId) throw new Error('unexpected Arkiv chain');
    let cursor = null, block = null;
    const records = [];
    for (let page=0; page<maxPages; page++) {
      const expression = `$owner = addr(${owner}) AND arkiv.schema = str('${schemaTag}')${operationId ? ` AND operation = str('${operationId}')` : ''}${cursor ? ` AND $key > key(${cursor})` : ''} ORDER BY $key ASC`;
      const result = await rpc('arkiv_query',[expression,{select:{key:true,owner:true,expiresAt:true,attributes:true},limit:`0x${pageSize.toString(16)}`}]);
      if (!result || !Array.isArray(result.data) || result.data.length > pageSize) throw new Error('invalid Arkiv query response');
      const current = safeQuantity(result.blockNumber);
      if (block !== null && block !== current) throw new Error('Arkiv pagination changed block');
      block = current;
      for (const item of result.data) {
        if (!item || typeof item.key !== 'string' || !key.test(item.key) || (cursor && item.key <= cursor)) throw new Error('invalid Arkiv pagination');
        cursor = item.key;
        if (typeof item.owner !== 'string' || !address.test(item.owner)) throw new Error('invalid Arkiv owner');
        if (item.owner !== owner) continue;
        const expiresAt = safeQuantity(item.expiresAt);
        if (expiresAt <= block) continue;
        if (operationId !== undefined) {
          if (!Array.isArray(item.attributes)) throw new Error('invalid Arkiv operation metadata');
          const ops=item.attributes.filter(attribute=>attribute?.name==='operation');
          if (ops.length!==1 || ops[0].type!=='str' || ops[0].value!==operationId) throw new Error('invalid Arkiv operation metadata');
        }
        records.push({key:item.key,owner:item.owner,expiresAt,record:decodeArkivPayload(item.attributes,schemaTag)});
      }
      if (result.data.length < pageSize) return records;
    }
    throw new Error('Arkiv pagination limit reached');
  }
  const query=({owner})=>queryInternal({owner});
  async function findByOperationId({owner,operationId, schemaTag:requestedTag=schemaTag}) {
    if(requestedTag!==schemaTag)throw new Error('invalid Arkiv schema');
    const records=await queryInternal({owner,operationId});
    if(records.length>1)throw new Error('duplicate Arkiv operation ID');
    return records[0]??null;
  }
  return {query,findByOperationId};
}
