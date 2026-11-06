import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreConnection} from './connection-score.mjs';
const now=Date.parse('2026-11-06T12:00:00Z');
const normal={status:'normal',expiresAt:new Date(now+30000).toISOString(),evidence:{snapshotVerified:true,siteMatched:true,watcherLookup:true}};
const evaluate=(status=normal,extra={})=>scoreConnection({origins:[{origin:'https://demo.example',status}],providerValid:true,now,...extra});
test('complete evidence earns 100 and passes the fixed threshold',()=>{
 const result=evaluate();assert.equal(result.score,100);assert.equal(result.threshold,80);assert.equal(result.allowed,true);
 assert.equal(result.scopes[0].checks.reduce((sum,item)=>sum+item.points,0),100);
});
test('missing evidence earns no points and failed evidence subtracts points',()=>{
 const missing=evaluate({...normal,status:'unknown',expiresAt:null});assert.equal(missing.score,75);assert.equal(missing.allowed,false);
 const failure=evaluate({...normal,status:'unknown',expiresAt:null,evidence:{...normal.evidence,watcherLookup:false}});assert.equal(failure.score,55);assert.equal(failure.allowed,false);
 assert.equal(evaluate(undefined,{origins:[{origin:'https://demo.example'}]}).score,20);
});
test('known incidents and drift block and subtract the watcher weight',()=>{
 for(const status of ['active','drift']){const result=evaluate({...normal,status});assert.equal(result.score,50);assert.equal(result.allowed,false);assert.equal(result.blockers.length,1);}
});
test('the weakest frame determines the decision and expired normal status earns no points',()=>{
 const expired={...normal,expiresAt:new Date(now).toISOString()};
 const result=evaluate(normal,{origins:[{origin:'https://demo.example',status:normal},{origin:'https://frame.example',status:expired}]});
 assert.equal(result.score,75);assert.equal(result.allowed,false);
});
test('unavailable wallet state and public HTTP remain blocked; loopback is supported',()=>{
 assert.equal(evaluate(normal,{providerValid:false}).allowed,false);
 assert.equal(evaluate(normal,{origins:[{origin:'http://demo.example',status:normal}]}).allowed,false);
 assert.equal(evaluate(normal,{origins:[{origin:'http://127.0.0.1:8000',status:normal}]}).allowed,true);
 assert.equal(evaluate(normal,{origins:[]}).allowed,false);
});
