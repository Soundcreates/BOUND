import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreConfigFromEnv} from './score-config.mjs';
import {scoreConnection} from './connection-score.mjs';
import {evaluate} from '../../packages/policy-core/index.mjs';

test('configured connection threshold changes the decision and preserves incident blocking',()=>{
 const config=scoreConfigFromEnv({BOUND_CONNECTION_THRESHOLD:'75'});
 const status={status:'unknown',expiresAt:null,evidence:{snapshotVerified:true,siteMatched:true,watcherLookup:true}};
 const input={origins:[{origin:'https://example.org',status}],providerValid:true,config};
 assert.equal(scoreConnection(input).score,75);
 assert.equal(scoreConnection(input).allowed,true);
 status.status='active';status.expiresAt=new Date(Date.now()+60000).toISOString();
 assert.equal(scoreConnection(input).allowed,false);
});
test('configured transaction bands change verdicts while preserving risk caps',()=>{
 const {transaction}=scoreConfigFromEnv({BOUND_TX_GREEN_THRESHOLD:'80',BOUND_TX_AMBER_THRESHOLD:'50',BOUND_TX_RED_THRESHOLD:'20'});
 const classification={kind:'opaque',entries:[],cap:75};
 assert.equal(evaluate({classification,baseline:'seeded',thresholds:transaction}).verdict,'amber');
});
test('invalid or unsafe settings fail with only the variable name in errors',()=>{
 for(const input of [{BOUND_CONNECTION_THRESHOLD:'0'},{BOUND_CONNECTION_WEIGHT_ORIGIN:'11'},{BOUND_TX_GREEN_THRESHOLD:'65'},{BOUND_TX_AMBER_THRESHOLD:'39'},{BOUND_TX_RED_THRESHOLD:'40'},{BOUND_TX_RED_THRESHOLD:'abc'}])assert.throws(()=>scoreConfigFromEnv(input));
});
