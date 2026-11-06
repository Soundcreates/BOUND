import test from 'node:test';
import assert from 'node:assert/strict';
import {syntheticDomainFixture} from './synthetic.mjs';
import {assessFrontend} from '../../packages/policy-core/frontend.mjs';
test('fictional domains contain synthetic mismatch and corroboration for an isolated safe-page test',()=>{
 for(const site of ['suspicious-wallet.example','fake-swap.example','wallet-verify.example','reward-claim.example','token-bridge.example','secure-airdrop.example']){
  const now=Date.now(),f=syntheticDomainFixture({site,now});
  const result=assessFrontend({observed:f.observed,record:f.frontend,now,drift:true,frame:{isTop:true,sameOrigin:true,ambiguous:false},dataState:'fresh',ageMs:0});
  assert.equal(result.comparison,'conflict');assert.equal(result.redirectEligible,true);assert.deepEqual(result.reasons,['drift']);
 }
 assert.throws(()=>syntheticDomainFixture({site:'app.uniswap.org'}));
});
