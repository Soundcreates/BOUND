import {test} from 'node:test';
import assert from 'node:assert/strict';
import {localArkivConfig} from './local-arkiv-config.mjs';
test('uses existing demo writer settings and ignores empty watcher placeholders',()=>{
 assert.deepEqual(localArkivConfig({BOUND_ARKIV_RPC_URL:'',ARKIV_RPC_URL:'https://rpc.example',ARKIV_CHAIN_ID:'7794095',ARKIV_TEST_WRITER_ADDRESS:'0xABC',ARKIV_TEST_WRITER_PRIVATE_KEY:'demo-key'}),{url:'https://rpc.example',chainId:7794095,owner:'0xabc',privateKey:'demo-key'});
});
test('explicit watcher overrides take precedence even if invalid',()=>{
 const c=localArkivConfig({BOUND_ARKIV_RPC_URL:'https://watcher.example',ARKIV_RPC_URL:'https://demo.example',BOUND_ARKIV_CHAIN_ID:'bad',ARKIV_CHAIN_ID:'7794095',BOUND_ARKIV_OWNER:'0xDEF',ARKIV_TEST_WRITER_ADDRESS:'0xABC',BOUND_ARKIV_PRIVATE_KEY:'watcher-key',ARKIV_TEST_WRITER_PRIVATE_KEY:'demo-key'});
 assert.equal(c.url,'https://watcher.example');assert.equal(c.owner,'0xdef');assert.equal(c.privateKey,'watcher-key');assert.ok(Number.isNaN(c.chainId));
});
