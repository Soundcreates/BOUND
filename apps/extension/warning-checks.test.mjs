import {test} from 'node:test';
import assert from 'node:assert/strict';
import {warningChecks} from './warning-checks.mjs';
test('transaction requests display six checks from their own verified evidence',()=>{
 const rows=warningChecks({topOrigin:'https://example.org',checkEvidence:{snapshotVerified:true,siteMatched:false,watcherLookup:true,watcherStatus:'drift',walletAvailable:true}});
 assert.equal(rows.length,6);
 assert.deepEqual(rows.map(r=>r.outcome),['passed','passed','failed','passed','failed','passed']);
});
test('missing evidence is visible and cannot invent positive checks',()=>{
 const rows=warningChecks({topOrigin:'https://example.org'});
 assert.deepEqual(rows.map(r=>r.outcome),['passed','unavailable','unavailable','unavailable','unavailable','unavailable']);
});
test('connection scopes distinguish failed and unavailable evidence',()=>{
 const rows=warningChecks({connectionScore:{scopes:[{checks:[{id:'origin',outcome:'passed'},{id:'domain',outcome:'failed'}]}]}});
 assert.equal(rows[0].outcome,'passed');assert.equal(rows[1].outcome,'unavailable');assert.equal(rows[2].outcome,'failed');
});
