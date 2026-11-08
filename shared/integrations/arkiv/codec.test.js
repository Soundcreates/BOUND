import {createHash} from "node:crypto";

import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {encodeCreateRecord,encodePatchRecord,encodeExtendEntity,encodeDeleteEntity} from './codec.js';
import {Interface,AbiCoder} from 'ethers';
const record={schemaVersion:1,kind:'observation',site:'example.org',chainId:1,value:'0x'+'1'.repeat(40),reporterKey:'key',event:'warned'};
const word=(b,i)=>Number(BigInt('0x'+b.subarray(i,i+32).toString('hex')));
const bytes=(b,i)=>b.subarray(i+32,i+32+word(b,i));
test('create calldata follows nested ABI offsets, attributes and bounds',()=>{
 const data=encodeCreateRecord({record,operationId:'a'.repeat(64),schemaTag:'bound.record.v1',lifetimeBlocks:300});
 assert.equal(data.slice(0,10),'0x49650044');
 const outer=Buffer.from(data.slice(10),'hex');assert.equal(word(outer,0),32);
 const array=32;assert.equal(word(outer,array),1);
 const operation=array+32+word(outer,array+32);assert.equal(word(outer,operation),1);
 const encoded=bytes(outer,operation+word(outer,operation+32));assert.equal(word(encoded,0),32);
 const tuple=32;assert.equal(word(encoded,tuple+32),0);assert.equal(word(encoded,tuple+64),300);assert.equal(word(encoded,tuple+96),0);
 const attrs=tuple+word(encoded,tuple+128);assert.equal(word(encoded,attrs),4);
 const names=[];const decoded=[];
 for(let i=0;i<4;i++){const pos=attrs+32+word(encoded,attrs+32+i*32);names.push(encoded.subarray(pos,pos+32).toString().replace(/\0+$/,''));decoded.push({type:word(encoded,pos+32),value:bytes(encoded,pos+word(encoded,pos+64))});}
 assert.deepEqual(names,['arkiv.schema','kind','operation','payload']);assert.deepEqual(decoded.map(a=>a.type),[136,136,136,7]);
 assert.deepEqual(JSON.parse(decoded[3].value.toString()),record);
});
test('codec rejects invalid record and unsafe lifetimes',()=>{
 for(const lifetimeBlocks of [0,7884001,-1,1.2])assert.throws(()=>encodeCreateRecord({record,operationId:'id',schemaTag:'bound.record.v1',lifetimeBlocks}),/configuration/);
 assert.throws(()=>encodeCreateRecord({record:{...record,wallet:'private'},operationId:'id',schemaTag:'bound.record.v1',lifetimeBlocks:100}),/record/);
});
test('patch calldata updates only record fields for an existing entity',()=>{
 const key='0x'+'2'.repeat(64),data=encodePatchRecord({record,operationId:'b'.repeat(64),entityKey:key});
 const outer=Buffer.from(data.slice(10),'hex'),array=word(outer,0),operation=array+32+word(outer,array+32);
 assert.equal(word(outer,operation),2);
 const encoded=bytes(outer,operation+word(outer,operation+32)),tuple=word(encoded,0);
 assert.equal('0x'+encoded.subarray(tuple,tuple+32).toString('hex'),key);
 const attrs=tuple+word(encoded,tuple+32);assert.equal(word(encoded,attrs),3);
 const names=[];for(let i=0;i<3;i++){const pos=attrs+32+word(encoded,attrs+32+i*32);names.push(encoded.subarray(pos,pos+32).toString().replace(/\0+$/,''));}
 assert.deepEqual(names,['kind','operation','payload']);
 assert.throws(()=>encodePatchRecord({record,operationId:'id',entityKey:'bad'}),/configuration/);
});
test('expiry extension uses the provided entity and bounded block lifetime',()=>{
 const key='0x'+'2'.repeat(64),data=encodeExtendEntity({entityKey:key,lifetimeBlocks:300});
 const outer=Buffer.from(data.slice(10),'hex'),array=word(outer,0),operation=array+32+word(outer,array+32);
 assert.equal(word(outer,operation),3);
 const encoded=bytes(outer,operation+word(outer,operation+32));
 assert.equal('0x'+encoded.subarray(0,32).toString('hex'),key);assert.equal(word(encoded,32),0);assert.equal(word(encoded,64),300);
 assert.throws(()=>encodeExtendEntity({entityKey:key,lifetimeBlocks:7884001}),/configuration/);
});

test('delete calldata matches an independent ABI encoding of execute((uint8,bytes)[]) with operation 5',()=>{
 const entityKey='0x'+'ab'.repeat(32);
 const iface=new Interface(['function execute((uint8 operation, bytes operationData)[] ops) returns (bytes32[] keys)']);
 const expected=iface.encodeFunctionData('execute',[[[5,AbiCoder.defaultAbiCoder().encode(['tuple(bytes32 entityKey)'],[[entityKey]])]]]);
 assert.equal(encodeDeleteEntity({entityKey}),expected);
 for(const bad of [undefined,'0x1234','0x'+'AB'.repeat(32),'ab'.repeat(32)])assert.throws(()=>encodeDeleteEntity({entityKey:bad}));
});

test('create calldata matches independent ethers encoding byte for byte',()=>{
 const operationId='a'.repeat(64),schemaTag='bound.record.v1',lifetimeBlocks=300;
 const key=createHashForTest(operationId);
 const payload=JSON.stringify(Object.fromEntries(Object.keys(record).sort().map(k=>[k,record[k]])));
 const attrs=[['arkiv.schema',136,Buffer.from(schemaTag)],['kind',136,Buffer.from(record.kind)],['operation',136,Buffer.from(operationId)],['payload',7,Buffer.from(payload)]];
 const encodedAttrs=attrs.map(([name,type,value])=>[name32ForTest(name),type,value]);
 const coder=AbiCoder.defaultAbiCoder();
 const create=coder.encode(['tuple(uint128,uint64,uint64,uint8,tuple(bytes32,uint8,bytes)[])'],[[BigInt('0x'+key),0,lifetimeBlocks,0,encodedAttrs]]);
 const iface=new Interface(['function execute((uint8,bytes)[])']);
 assert.equal(encodeCreateRecord({record,operationId,schemaTag,lifetimeBlocks}),iface.encodeFunctionData('execute',[[[1,create]]]));
});
test('patch and extension calldata match independent ethers encoding byte for byte',()=>{
 const entityKey='0x'+'22'.repeat(32),operationId='b'.repeat(64);
 const payload=JSON.stringify(Object.fromEntries(Object.keys(record).sort().map(k=>[k,record[k]])));
 const patchAttrs=[['kind',136,Buffer.from(record.kind)],['operation',136,Buffer.from(operationId)],['payload',7,Buffer.from(payload)]].map(([n,t,v])=>[name32ForTest(n),t,v]);
 const coder=AbiCoder.defaultAbiCoder(),iface=new Interface(['function execute((uint8,bytes)[])']);
 const patch=coder.encode(['tuple(bytes32,tuple(bytes32,uint8,bytes)[])'],[[entityKey,patchAttrs]]);
 assert.equal(encodePatchRecord({record,operationId,entityKey}),iface.encodeFunctionData('execute',[[[2,patch]]]));
 const extension=coder.encode(['tuple(bytes32,uint64,uint64)'],[[entityKey,0,300]]);
 assert.equal(encodeExtendEntity({entityKey,lifetimeBlocks:300}),iface.encodeFunctionData('execute',[[[3,extension]]]));
});
function name32ForTest(name){return '0x'+Buffer.from(name,'ascii').toString('hex').padEnd(64,'0');}
function createHashForTest(value){return createHash('sha256').update(value).digest('hex').slice(0,32);}
