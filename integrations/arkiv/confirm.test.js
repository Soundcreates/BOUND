import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {createArkivConfirmation} from './confirm.js';
const owner='0x'+'a'.repeat(40),target='0x'+'b'.repeat(40),tx='0x'+'c'.repeat(64),entityKey='0x'+'d'.repeat(64),blockHash='0x'+'e'.repeat(64);
const created='0xb282d7c494b8899aa8015cd07be621530beb03409eb8c5e8fdc1411ba64356a5';
const record={schemaVersion:1,kind:'observation',site:'example.org',chainId:1,value:'0x'+'1'.repeat(40),reporterKey:'key',event:'warned'};
const log={address:target,topics:[created,entityKey,'0x'+'0'.repeat(24)+owner.slice(2)],data:'0x'+'0'.repeat(62)+'65'+'0'.repeat(64),removed:false};
const receipt={transactionHash:tx,status:'0x1',from:owner,to:target,blockNumber:'0xa',blockHash,logs:[log]};
const entity={key:entityKey,owner,expiresAt:'0x65',attributes:[{name:'arkiv.schema',type:'str',value:'bound.record.v1'},{name:'payload',type:'bytes',value:'0x'+Buffer.from(JSON.stringify(record)).toString('hex')}]};
function fixture(overrides={}){const values={eth_chainId:'0x76edaf',eth_getTransactionReceipt:receipt,eth_blockNumber:'0xb',eth_getBlockByNumber:{hash:blockHash},arkiv_getEntity:entity,...overrides};return async method=>values[method];}
test('confirm checks canonical receipt, event owner and actual entity',async()=>{
 const confirm=createArkivConfirmation({rpc:fixture(),owner,target,chainId:7794095,schemaTag:'bound.record.v1'});
 const result=await confirm(tx);assert.equal(result.state,'confirmed');assert.equal(result.entity.key,entityKey);assert.deepEqual(result.entity.record,record);
});
test('pending, reorged, forged and expired receipts never confirm',async()=>{
 for(const overrides of [{eth_getTransactionReceipt:null},{eth_getBlockByNumber:{hash:'0x'+'1'.repeat(64)}},{arkiv_getEntity:{...entity,owner:'0x'+'1'.repeat(40)}},{arkiv_getEntity:{...entity,expiresAt:'0xa'}},{eth_getTransactionReceipt:{...receipt,logs:[{...log,address:'0x'+'1'.repeat(40)}]}}]){
  const confirm=createArkivConfirmation({rpc:fixture(overrides),owner,target,chainId:7794095,schemaTag:'bound.record.v1'});
  const result=await confirm(tx).catch(()=>({state:'rejected'}));assert.notEqual(result.state,'confirmed');
 }
});
