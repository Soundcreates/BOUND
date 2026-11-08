import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessFrontend, frontendObservationCandidates } from './frontend.mjs';
const now = 1800000000000, iso = n => new Date(n).toISOString();
const a = 'sha256-' + Buffer.alloc(32,1).toString('base64'), b = 'sha256-' + Buffer.alloc(32,2).toString('base64');
const row = (hash=a, reporters=3, first=now-4000000, last=now) => ({path:'/app.js',hash,reporters,firstSeen:iso(first),lastSeen:iso(last),established:reporters>=3 && now-first>=3600000});
const record = scripts => ({schemaVersion:1,kind:'frontend',site:'example.com',chainId:1,scripts,updatedAt:iso(now)});
const observed = (scripts=[{path:'/app.js',hash:a}]) => ({version:1,documentUrl:'https://example.com/',scripts,coverage:{total:scripts.length,compared:scripts.length,inlineExcluded:0,queryExcluded:0,crossOriginExcluded:0,privatePathExcluded:0,unavailable:0,overCap:0}});
const base = {observed:observed(),record:record([row()]),now,frame:{isTop:true,sameOrigin:true},dataState:'fresh'};
const cases = [
 ['empty', {observed:observed([])}, 'none'], ['agree',{},'agree'], ['conflict',{observed:observed([{path:'/app.js',hash:b}])},'conflict'], ['unseen',{observed:observed([{path:'/new.js',hash:b}])},'unfamiliar'], ['weak',{record:record([row(a),row(b,2)]) ,observed:observed([{path:'/app.js',hash:b}])},'conflict'], ['missing',{record:null},'none'], ['future',{now:now-1},'none'], ['unavailable',{dataState:'unavailable'},'none'], ['malformed',{record:{}},'none'], ['wrong k',{k:2},'none'], ['wrong maturity',{maturityMs:1},'none'], ['expired',{now:now+172800000},'unfamiliar']
];
for (const [name, change, expected] of cases) test(name, () => assert.equal(assessFrontend({...base,...change}).comparison,expected));
test('corroboration, frame and stale', () => { for (const source of ['drift','incident','counterpartyRisk']) { const args={...base,observed:observed([{path:'/app.js',hash:b}]),[source]:true}; assert.equal(assessFrontend(args).redirectEligible,true); assert.equal(assessFrontend({...args,dataState:'stale'}).redirectEligible,false); assert.equal(assessFrontend({...args,frame:{isTop:false,sameOrigin:true}}).redirectEligible,false); } });
test('reporting vetoes', () => { const assessment=assessFrontend(base); const args={site:'example.com',chain:'1',observed:base.observed,assessment,verdict:'green',incidentStatus:'normal',action:'continue',communityReportingSafe:true,rawDrift:false,incident:false,overrideUsed:false,frame:{isTop:true,sameOrigin:true}}; assert.equal(frontendObservationCandidates(args).length,1); for (const change of [{verdict:'red'},{incidentStatus:'drift'},{action:'cancel'},{rawDrift:true},{incident:true},{overrideUsed:true},{assessment:assessFrontend({...base,dataState:'stale'})},{frame:{isTop:false,sameOrigin:true}},{frame:undefined},{frame:{isTop:true,sameOrigin:true,ambiguous:true}}]) assert.deepEqual(frontendObservationCandidates({...args,...change}),[]); });
test('max evidence, partial coverage, and distinct established hashes', () => {
  const scripts=Array.from({length:32},(_,i)=>({path:`/asset${i}.js`,hash:a}));
  const obs=observed(scripts); obs.coverage.total=34; obs.coverage.inlineExcluded=1; obs.coverage.unavailable=1;
  assert.equal(assessFrontend({...base,observed:obs}).unfamiliar.length,32);
  const both=[row(a),row(b)].sort((x,y)=>(x.hash < y.hash ? -1 : 1));
  assert.equal(assessFrontend({...base,record:record(both),observed:observed([{path:'/app.js',hash:b}])}).comparison,'agree');
  assert.equal(assessFrontend(null).comparison,'none');
});
test('deploy without corroboration and ambiguity do not redirect', () => {
  const args={...base,observed:observed([{path:'/app.js',hash:b}])};
  assert.equal(assessFrontend(args).redirectEligible,false);
  assert.equal(assessFrontend({...args,drift:true,frame:{isTop:true,sameOrigin:true,ambiguous:true}}).redirectEligible,false);
});
test('maturity boundary and reporting deduplication', () => {
  const before=row(a,3,now-3599999), at=row(a,3,now-3600000);
  assert.equal(assessFrontend({...base,record:record([before])}).comparison,'unfamiliar');
  assert.equal(assessFrontend({...base,record:record([at])}).comparison,'agree');
  const obs=observed(Array(32).fill({path:'/app.js',hash:a}));
  const assessment=assessFrontend({...base,observed:obs});
  const args={site:'example.com',chain:'1',observed:obs,assessment,verdict:'amber',incidentStatus:'normal',action:'continue',communityReportingSafe:true,rawDrift:false,incident:false,overrideUsed:false,frame:{isTop:true,sameOrigin:true}};
  assert.equal(frontendObservationCandidates(args).length,1);
  assert.deepEqual(frontendObservationCandidates({...args,assessment:assessFrontend({...base,observed:observed([{path:'/app.js',hash:b}])})}),[]);
  assert.deepEqual(frontendObservationCandidates({...args,frame:{isTop:true,sameOrigin:false}}),[]);
});
test('page precedence and stale conflicts', () => {
  const obs=observed([{path:'/app.js',hash:a},{path:'/new.js',hash:a}]);
  assert.equal(assessFrontend({...base,observed:obs}).comparison,'unfamiliar');
  obs.scripts.push({path:'/app.js',hash:b}); obs.coverage.total++; obs.coverage.compared++;
  const stale=assessFrontend({...base,observed:obs,dataState:'stale',incident:true});
  assert.equal(stale.comparison,'conflict'); assert.equal(stale.corroborated,false);
});
test('reporting caps unique scripts and requires verified provenance', () => {
  const obs=observed(Array.from({length:32},(_,i)=>({path:`/asset${i}.js`,hash:a})));
  const assessment=assessFrontend({...base,observed:obs});
  const args={site:'example.com',chain:'1',observed:obs,assessment,verdict:'green',incidentStatus:'normal',action:'continue',communityReportingSafe:true,rawDrift:false,incident:false,overrideUsed:false,frame:{isTop:true,sameOrigin:true}};
  assert.equal(frontendObservationCandidates(args).length,32);
  assert.equal(frontendObservationCandidates({...args,assessment:JSON.parse(JSON.stringify(assessment))}).length,32);
  assert.deepEqual(frontendObservationCandidates({...args,assessment:assessFrontend({...base,record:{}})}),[]);
});

test('community reporting safety gate requires an unambiguous normal status', async () => {
  const {frontendReportingSafetyAllows} = await import('./frontend.mjs');
  const safe={communityReportingSafe:true,rawDrift:false,incident:false};
  assert.equal(frontendReportingSafetyAllows(safe),true);
  for (const change of [{communityReportingSafe:false},{communityReportingSafe:undefined},{rawDrift:true},{rawDrift:undefined},{incident:true},{incident:undefined}]) assert.equal(frontendReportingSafetyAllows({...safe,...change}),false);
});
