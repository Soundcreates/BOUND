import {encodeCreateRecord,encodePatchRecord,encodeExtendEntity} from '../../shared/integrations/arkiv/codec.js';
import {keccak256} from '../../shared/contracts/keccak-reference.js';
const [rpcUrl,target]=process.argv.slice(2);
let endpoint;try{endpoint=new URL(rpcUrl);}catch{throw new Error('usage: node scripts/integration/arkiv-call-smoke.mjs <https-rpc-url> <documented-system-address>');}
if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||typeof target!=='string'||!/^0x[0-9a-f]{40}$/.test(target))throw new Error('invalid public RPC or system address');
async function rpc(method,params){
 const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw new Error('RPC unavailable');return response.json();
}
const chain=await rpc('eth_chainId',[]);if(chain.result!=='0x76edaf')throw new Error('unexpected chain');
const code=await rpc('eth_getCode',[target,'latest']);
const fixture={schemaVersion:1,kind:'observation',site:'example.org',chainId:1,value:'0x'+'1'.repeat(40),reporterKey:'public-fixture',event:'warned'};
const data=encodeCreateRecord({record:fixture,operationId:'public-fixture',schemaTag:'bound.record.v1',lifetimeBlocks:20});
const from='0x'+'0'.repeat(40);
const valid=await rpc('eth_call',[{from,to:target,data},'latest']);
const invalid=await rpc('eth_call',[{from,to:target,data:'0x49650044'},'latest']);
const patchData=encodePatchRecord({record:fixture,operationId:'public-patch-fixture',entityKey:'0x'+'f'.repeat(64)});
const patch=await rpc('eth_call',[{from,to:target,data:patchData},'latest']);
const extension=await rpc('eth_call',[{from,to:target,data:encodeExtendEntity({entityKey:'0x'+'f'.repeat(64),lifetimeBlocks:20})},'latest']);
const missingSelector=keccak256('EntityNotFound(bytes32)').slice(0,10);
if(valid.result!=='0x'||!invalid.error||patch.error?.data?.slice(0,10)!==missingSelector||extension.error?.data?.slice(0,10)!==missingSelector)throw new Error('unexpected call outcomes');
console.log(JSON.stringify({chainId:chain.result,bytecodePresent:code.result!=='0x',validCreateCall:'accepted',malformedCall:'reverted',nonexistentPatch:'entity-not-found',nonexistentExtension:'entity-not-found',persisted:false}));
