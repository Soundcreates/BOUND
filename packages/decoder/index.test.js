import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {Interface} from 'ethers';
import {decodeRequest} from './index.js';

const token='0x'+'a'.repeat(40),spender='0x'+'b'.repeat(40),recipient='0x'+'c'.repeat(40),owner='0x'+'d'.repeat(40),zero32='0x'+'0'.repeat(64);
const abi=new Interface(['function approve(address,uint256)','function increaseAllowance(address,uint256)','function setApprovalForAll(address,bool)','function transfer(address,uint256)','function transferFrom(address,address,uint256)','function safeTransferFrom(address,address,uint256)','function safeTransferFrom(address,address,uint256,bytes)','function approve(address,address,uint160,uint48)','function permit(address,address,uint256,uint256,uint8,bytes32,bytes32)']);
const tx=data=>({method:'eth_sendTransaction',params:[{to:token,data}]});
const found=(result,address,role,verified=true)=>result.addresses.some(item=>item.address===address&&item.role===role&&item.verified===verified);
test('real ABI encodings identify rights, destinations, called contracts and tokens',()=>{
 const cases=[
  ['approve(address,uint256)',[spender,2n**255n],spender,'rights'],['increaseAllowance',[spender,1],spender,'rights'],
  ['setApprovalForAll',[spender,true],spender,'rights'],['transfer',[recipient,1],recipient,'destination'],
  ['transferFrom',[owner,recipient,1],recipient,'destination'],['safeTransferFrom(address,address,uint256)',[owner,recipient,1],recipient,'destination'],
  ['safeTransferFrom(address,address,uint256,bytes)',[owner,recipient,1,'0x1234'],recipient,'destination'],
  ['approve(address,address,uint160,uint48)',[token,spender,1,2],spender,'rights'],
  ['permit',[owner,spender,1,2,27,zero32,zero32],spender,'rights']
 ];
 for(const [name,args,target,role] of cases){const decoded=decodeRequest(tx(abi.encodeFunctionData(name,args)));assert.equal(decoded.classification,'decoded',name);assert.ok(found(decoded,token,'called'),name);assert.ok(found(decoded,target,role),name);}
});
test('truncated, noncanonical and oversized calldata are malformed; unknown data is opaque',()=>{
 const approve=abi.encodeFunctionData('approve(address,uint256)',[spender,1]);
 assert.equal(decodeRequest(tx(approve.slice(0,40))).classification,'malformed');
 assert.equal(decodeRequest(tx(`${approve}00`)).classification,'malformed');
 assert.equal(decodeRequest(tx(`0x${'aa'.repeat(140000)}`)).classification,'malformed');
 const opaque=decodeRequest(tx(`0xdeadbeef${'0'.repeat(24)}${spender.slice(2)}`));
 assert.equal(opaque.classification,'opaque');assert.ok(found(opaque,spender,'destination',false));
 assert.equal(decodeRequest(tx('0xdeadbeef')).addresses.filter(x=>!x.verified).length,0);
 assert.ok(found(decodeRequest(tx('0x')),token,'destination'));
});
test('batches take the strictest item classification and unknown methods never become reads',()=>{
 const good={to:token,data:abi.encodeFunctionData('approve(address,uint256)',[spender,1])};
 assert.equal(decodeRequest({method:'wallet_sendCalls',params:[{calls:[good,{to:token,data:'0xdeadbeef'}]}]}).classification,'opaque');
 assert.equal(decodeRequest({method:'wallet_sendCalls',params:[{calls:[good,{to:token,data:'0x095ea7b3'}]}]}).classification,'malformed');
 assert.equal(decodeRequest({method:'wallet_addEthereumChain',params:[]}).classification,'unsupported');
 assert.equal(decodeRequest({method:'eth_chainId',params:[]}).classification,'read');
 assert.equal(decodeRequest({method:'eth_sign',params:[owner,zero32]}).classification,'blind');
});
test('typed permits identify spender and token, while signature transfer marks an unfixed destination',()=>{
 const permit={types:{Permit:[{name:'owner',type:'address'},{name:'spender',type:'address'},{name:'value',type:'uint256'},{name:'nonce',type:'uint256'},{name:'deadline',type:'uint256'}]},primaryType:'Permit',domain:{verifyingContract:token},message:{owner,spender,value:'1',nonce:'0',deadline:'42'}};
 const decoded=decodeRequest({method:'eth_signTypedData_v4',params:[owner,JSON.stringify(permit)]});
 assert.equal(decoded.classification,'decoded');assert.ok(found(decoded,spender,'rights'));assert.ok(found(decoded,token,'token'));
 const transfer={types:{TokenPermissions:[{name:'token',type:'address'},{name:'amount',type:'uint256'}],PermitTransferFrom:[{name:'permitted',type:'TokenPermissions'},{name:'spender',type:'address'},{name:'nonce',type:'uint256'},{name:'deadline',type:'uint256'}]},primaryType:'PermitTransferFrom',domain:{verifyingContract:token},message:{permitted:{token,amount:'5'},spender,nonce:'0',deadline:'42'}};
 const signature=decodeRequest({method:'eth_signTypedData_v4',params:[owner,transfer]});
 assert.equal(signature.classification,'decoded');assert.equal(signature.destinationNotFixed,true);assert.ok(found(signature,spender,'rights'));
 permit.message.unexpected='anything';assert.equal(decodeRequest({method:'eth_signTypedData_v4',params:[owner,permit]}).classification,'opaque');
});
test('authorization chain zero is flagged and accessor inputs cannot escape the decoder',()=>{
 const result=decodeRequest({method:'wallet_signAuthorization',params:[{chainId:'0x0',address:spender}]});
 assert.equal(result.chainIdZero,true);assert.ok(found(result,spender,'rights'));
 assert.equal(decodeRequest({method:'wallet_signAuthorization',params:[{chainId:9007199254740992,address:spender}]}).classification,'malformed');
 const request={};Object.defineProperty(request,'method',{enumerable:true,get(){throw Error('attacker getter');}});
 assert.equal(decodeRequest(request).classification,'malformed');
});
