import {Interface,TypedDataEncoder,getAddress} from 'ethers';
import {ALREADY_SIGNED_METHODS,READ_ONLY_METHODS,parseUniqueJSON} from '../contracts/index.js';
import {canonicalizeJSON} from '../snapshot/index.js';

const abi=new Interface([
 'function approve(address,uint256)','function increaseAllowance(address,uint256)','function setApprovalForAll(address,bool)',
 'function transfer(address,uint256)','function transferFrom(address,address,uint256)',
 'function safeTransferFrom(address,address,uint256)','function safeTransferFrom(address,address,uint256,bytes)',
 'function approve(address,address,uint160,uint48)','function permit(address,address,uint256,uint256,uint8,bytes32,bytes32)'
]);
const rules=new Map([
 ['0x095ea7b3',{role:'rights',arg:0,token:true}],['0x39509351',{role:'rights',arg:0,token:true}],
 ['0xa22cb465',{role:'rights',arg:0,token:true}],['0xa9059cbb',{role:'destination',arg:0,token:true}],
 ['0x23b872dd',{role:'destination',arg:1,token:true}],['0x42842e0e',{role:'destination',arg:1,token:true}],
 ['0xb88d4fde',{role:'destination',arg:1,token:true}],['0x87517c45',{role:'rights',arg:1,tokenArg:0}],
 ['0xd505accf',{role:'rights',arg:1,token:true}]
]);
const hex=/^0x(?:[0-9a-fA-F]{2})*$/,addr=/^0x[0-9a-fA-F]{40}$/;
const knownTypes={
 Permit:[['owner','address'],['spender','address'],['value','uint256'],['nonce','uint256'],['deadline','uint256']],
 PermitDetails:[['token','address'],['amount','uint160'],['expiration','uint48'],['nonce','uint48']],
 PermitSingle:[['details','PermitDetails'],['spender','address'],['sigDeadline','uint256']],
 PermitBatch:[['details','PermitDetails[]'],['spender','address'],['sigDeadline','uint256']],
 TokenPermissions:[['token','address'],['amount','uint256']],
 PermitTransferFrom:[['permitted','TokenPermissions'],['spender','address'],['nonce','uint256'],['deadline','uint256']],
 PermitBatchTransferFrom:[['permitted','TokenPermissions[]'],['spender','address'],['nonce','uint256'],['deadline','uint256']],
 OfferItem:[['itemType','uint8'],['token','address'],['identifierOrCriteria','uint256'],['startAmount','uint256'],['endAmount','uint256']],
 ConsiderationItem:[['itemType','uint8'],['token','address'],['identifierOrCriteria','uint256'],['startAmount','uint256'],['endAmount','uint256'],['recipient','address']],
 OrderComponents:[['offerer','address'],['zone','address'],['offer','OfferItem[]'],['consideration','ConsiderationItem[]'],['orderType','uint8'],['startTime','uint256'],['endTime','uint256'],['zoneHash','bytes32'],['salt','uint256'],['conduitKey','bytes32'],['counter','uint256']]
};
const validType=(types,name)=>Array.isArray(types[name])&&knownTypes[name]&&types[name].length===knownTypes[name].length&&types[name].every((field,index)=>field?.name===knownTypes[name][index][0]&&field?.type===knownTypes[name][index][1]&&Object.keys(field).length===2);
const normalize=value=>{if(typeof value!=='string'||!addr.test(value))throw new Error('invalid address');return getAddress(value).toLowerCase();};
const add=(items,value,role,verified=true)=>{const address=normalize(value);if(!items.some(item=>item.address===address&&item.role===role&&item.verified===verified))items.push({address,role,verified});};
const result=(classification,addresses=[],extra={})=>({classification,addresses,...extra});
function scanCalldata(data,items){
 const body=data.slice(10);if(body.length/64>256)throw new Error('calldata scan limit');
 for(let i=0;i+64<=body.length;i+=64){const word=body.slice(i,i+64);if(/^0{24}[0-9a-fA-F]{40}$/.test(word)&&!/^0{28}/.test(word))add(items,`0x${word.slice(24)}`,'destination',false);}
}
function transaction(tx){
 if(!tx||typeof tx!=='object'||Array.isArray(tx))throw new Error('invalid transaction');
 const items=[];if(tx.to!==undefined&&tx.to!==null)add(items,tx.to,'called');
 const data=tx.data??tx.input??'0x';
 if(typeof data!=='string'||!hex.test(data)||data.length>131074||(tx.data!==undefined&&tx.input!==undefined&&tx.data.toLowerCase()!==tx.input.toLowerCase()))throw new Error('invalid calldata');
 if(tx.to===undefined||tx.to===null)return result('opaque',items,{contractCreation:true});
 if(data==='0x'){add(items,tx.to,'destination');return result('decoded',items);}
 if(data.length<10)throw new Error('truncated selector');
 const selector=data.slice(0,10).toLowerCase(),rule=rules.get(selector);
 if(!rule){scanCalldata(data,items);return result('opaque',items);}
 const fragment=abi.getFunction(selector),decoded=abi.decodeFunctionData(fragment,data);
 if(abi.encodeFunctionData(fragment,decoded).toLowerCase()!==data.toLowerCase())throw new Error('noncanonical calldata');
 add(items,decoded[rule.arg],rule.role);
 if(rule.token)add(items,tx.to,'token');
 if(rule.tokenArg!==undefined)add(items,decoded[rule.tokenArg],'token');
 return result('decoded',items);
}
function exactFields(types,type,value,depth=0){
 if(depth>12)throw new Error('typed data depth');
 const array=type.match(/^(.*)\[(?:\d*)\]$/);
 if(array){if(!Array.isArray(value)||value.length>100)throw new Error('invalid typed array');return value.every(item=>exactFields(types,array[1],item,depth+1));}
 if(!types[type])return true;
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid typed struct');
 const fields=types[type],names=fields.map(field=>field.name);
 if(Object.keys(value).some(key=>!names.includes(key))||names.some(key=>!Object.hasOwn(value,key)))return false;
 return fields.every(field=>exactFields(types,field.type,value[field.name],depth+1));
}
function scanFields(value,items,depth=0){
 if(depth>12)throw new Error('typed data depth');
 if(Array.isArray(value)){if(value.length>100)throw new Error('typed array limit');for(const item of value)scanFields(item,items,depth+1);return;}
 if(!value||typeof value!=='object')return;
 const keys=Object.keys(value);if(keys.length>100)throw new Error('typed object limit');
 for(const key of keys){const v=value[key],role=/^(spender|operator|delegate)$/i.test(key)?'rights':/^(to|recipient|receiver|beneficiary)$/i.test(key)?'destination':null;if(role&&typeof v==='string'&&addr.test(v))add(items,v,role,false);else scanFields(v,items,depth+1);}
}
function typedData(value){
 const typed=typeof value==='string'?parseUniqueJSON(value):value;
 if(!typed||typeof typed!=='object'||Array.isArray(typed)||!typed.types||!typed.message||!typed.domain||typeof typed.primaryType!=='string')throw new Error('invalid typed data');
 const types=Object.fromEntries(Object.entries(typed.types).filter(([key])=>key!=='EIP712Domain'));
 TypedDataEncoder.hashStruct(typed.primaryType,types,typed.message);
 const fieldsExact=exactFields(types,typed.primaryType,typed.message),items=[];
 if(typed.domain.verifyingContract!==undefined)add(items,typed.domain.verifyingContract,'called');
 const primary=typed.primaryType,message=typed.message;
 if(primary==='Permit'&&validType(types,'Permit')){
  add(items,message.spender,'rights');if(typed.domain.verifyingContract)add(items,typed.domain.verifyingContract,'token');
  return result(fieldsExact?'decoded':'opaque',items,{unknownTypedFields:!fieldsExact});
 }
 if(['PermitSingle','PermitBatch'].includes(primary)&&validType(types,primary)&&validType(types,'PermitDetails')){
  add(items,message.spender,'rights');for(const detail of primary==='PermitSingle'?[message.details]:message.details)add(items,detail.token,'token');
  return result(fieldsExact?'decoded':'opaque',items,{unknownTypedFields:!fieldsExact});
 }
 if(['PermitTransferFrom','PermitBatchTransferFrom'].includes(primary)&&validType(types,primary)&&validType(types,'TokenPermissions')){
  add(items,message.spender,'rights');for(const permission of primary==='PermitTransferFrom'?[message.permitted]:message.permitted)add(items,permission.token,'token');
  return result(fieldsExact?'decoded':'opaque',items,{destinationNotFixed:true,unknownTypedFields:!fieldsExact});
 }
 if(primary==='OrderComponents'&&validType(types,primary)&&validType(types,'OfferItem')&&validType(types,'ConsiderationItem')){
  const offerer=normalize(message.offerer);for(const item of message.consideration)if(normalize(item.recipient)!==offerer)add(items,item.recipient,'destination');
  return result(fieldsExact?'decoded':'opaque',items,{unknownTypedFields:!fieldsExact});
 }
 scanFields(message,items);return result('opaque',items,{unknownTypedFields:true,destinationNotFixed:/Permit.*WitnessTransferFrom/i.test(primary)});
}
function decode(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||typeof input.method!=='string'||!Array.isArray(input.params??[]))throw new Error('invalid request');
 const method=input.method,params=input.params??[];
 if([...READ_ONLY_METHODS,...ALREADY_SIGNED_METHODS].includes(method))return result('read');
 if(method==='eth_sign')return result('blind',[],{method});
 if(method==='personal_sign')return params.length>=2?result('decoded',[],{method}):result('malformed',[],{method});
 if(['eth_sendTransaction','eth_signTransaction'].includes(method))return {...transaction(params[0]),method};
 if(method==='wallet_sendCalls'){
  const batch=params[0];if(!batch||!Array.isArray(batch.calls)||!batch.calls.length||batch.calls.length>32)throw new Error('invalid batch');
  const decoded=batch.calls.map(transaction),classification=decoded.some(x=>x.classification==='malformed')?'malformed':decoded.some(x=>x.classification==='opaque')?'opaque':'decoded';
  return result(classification,decoded.flatMap(x=>x.addresses),{method,batch:true});
 }
 if(['eth_signTypedData','eth_signTypedData_v3','eth_signTypedData_v4'].includes(method))return {...typedData(params[1]),method};
 if(['wallet_signAuthorization','eth_signAuthorization'].includes(method)){
  const auth=params[0];if(!auth||typeof auth!=='object'||Array.isArray(auth)||auth.chainId===undefined)throw new Error('invalid authorization');
  if(!(typeof auth.chainId==='string'&&/^(?:0x[0-9a-fA-F]+|[0-9]+)$/.test(auth.chainId))&&!(typeof auth.chainId==='number'&&Number.isSafeInteger(auth.chainId)&&auth.chainId>=0))throw new Error('invalid authorization chain');
  const chain=BigInt(auth.chainId);if(chain<0n)throw new Error('invalid authorization chain');const items=[];add(items,auth.address,'rights');
  return result('decoded',items,{method,chainIdZero:chain===0n,authorizationChainId:chain.toString()});
 }
 return result('unsupported',[],{method});
}

// Every exception is malformed, never a successful decode. Inputs are copied
// from accessor-free JSON before parsing so mutation cannot alter evaluation.
export function decodeRequest(input){
 try{const text=canonicalizeJSON(input);if(text.length>262144)throw Error('request too large');return decode(parseUniqueJSON(text));}
 catch{return result('malformed',[],{method:null});}
}
