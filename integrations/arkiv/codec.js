import {createHash} from 'node:crypto';
import {validateRecord} from '../../packages/contracts/index.js';

const word=value=>{const n=BigInt(value);if(n<0n||n>=(1n<<256n))throw new Error('ABI integer out of range');return Buffer.from(n.toString(16).padStart(64,'0'),'hex');};
const concat=(...parts)=>Buffer.concat(parts);
const dynamicBytes=data=>concat(word(data.length),data,Buffer.alloc((32-data.length%32)%32));
const name32=name=>{const bytes=Buffer.from(name,'ascii');if(bytes.length>32)throw new Error('attribute name too long');return concat(bytes,Buffer.alloc(32-bytes.length));};
const tupleAttribute=attribute=>concat(name32(attribute.name),word(attribute.type),word(96),dynamicBytes(attribute.value));
function attributesArray(attributes){
 const items=attributes.map(tupleAttribute);let offset=items.length*32;
 const offsets=items.map(item=>{const value=word(offset);offset+=item.length;return value;});
 return concat(word(items.length),...offsets,...items);
}
const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;

// Proposed version-one entity shape. No network address or signing key is embedded.
// Validate this encoding independently against the selected network before live use.
export function encodeCreateRecord({record,operationId,schemaTag,lifetimeBlocks}) {
 if(!validateRecord(record))throw new Error('invalid Arkiv record');
 if(typeof operationId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(operationId)||typeof schemaTag!=='string'||!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(schemaTag)||!Number.isSafeInteger(lifetimeBlocks)||lifetimeBlocks<1||lifetimeBlocks>7884000)throw new Error('invalid Arkiv create configuration');
 const payload=Buffer.from(JSON.stringify(sort(record)),'utf8');
 if(payload.length>131072)throw new Error('Arkiv payload too large');
 const attributes=[{name:'arkiv.schema',type:136,value:Buffer.from(schemaTag)},{name:'kind',type:136,value:Buffer.from(record.kind)},{name:'operation',type:136,value:Buffer.from(operationId)},{name:'payload',type:7,value:payload}];
 const salt=BigInt('0x'+createHash('sha256').update(operationId).digest('hex').slice(0,32));
 // abi.encode((uint128,uint64,uint64,uint8,Attribute[]))
 const create=concat(word(32),word(salt),word(0),word(lifetimeBlocks),word(0),word(160),attributesArray(attributes));
 // execute((uint8,bytes)[]): one create operation, dynamic-array element offsets start after the length.
 const operation=concat(word(1),word(64),dynamicBytes(create));
 const args=concat(word(32),word(1),word(32),operation);
 return '0x49650044'+args.toString('hex');
}

// Caller must independently verify ownership, current kind, and expiry of entityKey.
export function encodePatchRecord({record,operationId,entityKey}) {
 if(!validateRecord(record))throw new Error('invalid Arkiv record');
 if(typeof operationId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(operationId)||typeof entityKey!=='string'||!/^0x[0-9a-f]{64}$/.test(entityKey))throw new Error('invalid Arkiv patch configuration');
 const payload=Buffer.from(JSON.stringify(sort(record)),'utf8');
 if(payload.length>131072)throw new Error('Arkiv payload too large');
 const attributes=[{name:'kind',type:136,value:Buffer.from(record.kind)},{name:'operation',type:136,value:Buffer.from(operationId)},{name:'payload',type:7,value:payload}];
 // abi.encode((bytes32,Attribute[])) for one patch operation.
 const patch=concat(word(32),Buffer.from(entityKey.slice(2),'hex'),word(64),attributesArray(attributes));
 const operation=concat(word(2),word(64),dynamicBytes(patch));
 return '0x49650044'+concat(word(32),word(1),word(32),operation).toString('hex');
}

// Extending to an earlier expiry reverts; caller must check the current expiry first.
export function encodeExtendEntity({entityKey,lifetimeBlocks}) {
 if(typeof entityKey!=='string'||!/^0x[0-9a-f]{64}$/.test(entityKey)||!Number.isSafeInteger(lifetimeBlocks)||lifetimeBlocks<1||lifetimeBlocks>7884000)throw new Error('invalid Arkiv extension configuration');
 const extension=concat(Buffer.from(entityKey.slice(2),'hex'),word(0),word(lifetimeBlocks));
 const operation=concat(word(3),word(64),dynamicBytes(extension));
 return '0x49650044'+concat(word(32),word(1),word(32),operation).toString('hex');
}

// Delete is operation 5 with payload abi.encode((bytes32 entityKey)), per the
// official @arkiv-network/sdk OperationType. Irreversible: the caller must
// verify ownership of entityKey first.
export function encodeDeleteEntity({entityKey}) {
 if(typeof entityKey!=='string'||!/^0x[0-9a-f]{64}$/.test(entityKey))throw new Error('invalid Arkiv delete configuration');
 const operation=concat(word(5),word(64),dynamicBytes(Buffer.from(entityKey.slice(2),'hex')));
 return '0x49650044'+concat(word(32),word(1),word(32),operation).toString('hex');
}
