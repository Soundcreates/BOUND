import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {readFile} from 'node:fs/promises';
import {canonicalSite,evaluatePolicy} from './index.js';

const snapshot=JSON.parse(await readFile(new URL('../../fixtures/contracts/snapshot.json',import.meta.url),'utf8'));
const site='xn--bcher-kva.example:8443',trusted='0x'+'1'.repeat(40),unknown='0x'+'2'.repeat(40),own='0x'+'3'.repeat(40),time=Date.parse('2026-06-01T00:00:00Z');
const baseline={schemaVersion:1,kind:'baseline',site,chainId:1,counterparties:[],calledContracts:[],updatedAt:'2026-01-01T00:00:00.000Z'};
const item=(address,role,verified=true)=>({address,role,verified});
const evaluate=(addresses,extra={})=>evaluatePolicy({site,chainId:1,decoded:{classification:'decoded',addresses},verifiedSnapshot:snapshot,baseline,now:time,...extra});

test('canonical host is exact, IDNA normalized and retains nondefault ports',()=>{
 assert.equal(canonicalSite('https://BÜCHER.example:8443/'),site);
 assert.throws(()=>canonicalSite('http://example.org/'),/origin/);
 assert.throws(()=>canonicalSite('https://example.org/path'),/origin/);
});
test('untrusted rights and destinations obey strict caps including corroborated drift',()=>{
 assert.equal(evaluate([item(unknown,'rights')]).cap,35);
 const drift=evaluate([item(unknown,'rights')],{corroboratedDrift:true});assert.equal(drift.cap,15);assert.equal(drift.decision.verdict,'escalated');
 assert.equal(evaluate([item(unknown,'destination')]).cap,65);
 assert.equal(evaluate([item(own,'destination')],{accounts:[own]}).cap,100);
 assert.equal(evaluate([item(unknown,'rights'),item(own,'destination')],{accounts:[own]}).cap,35);
});
test('trust remains scoped to site and chain and observations cannot create it',()=>{
 const known=evaluate([item(trusted,'rights')]);assert.equal(known.cap,100);
 const other=evaluatePolicy({site,chainId:2,decoded:{classification:'decoded',addresses:[item(trusted,'rights')]},verifiedSnapshot:snapshot,baseline:{...baseline,chainId:2},now:time,witnessed:[trusted]});
 assert.equal(other.cap,65);assert.notEqual(other.decision.verdict,'green');
 const noWitness=evaluatePolicy({site,chainId:2,decoded:{classification:'decoded',addresses:[item(trusted,'rights')]},verifiedSnapshot:snapshot,baseline:{...baseline,chainId:2},now:time});
 assert.equal(noWitness.cap,35);
});
test('opaque heuristics, malformed input, unfixed destinations and bypass cannot yield green',()=>{
 assert.equal(evaluate([item(unknown,'destination',false)],{decoded:{classification:'opaque',addresses:[item(unknown,'destination',false)]}}).cap,65);
 assert.equal(evaluate([],{decoded:{classification:'malformed',addresses:[]}}).cap,35);
 assert.equal(evaluate([item(trusted,'rights')],{decoded:{classification:'decoded',addresses:[item(trusted,'rights')],destinationNotFixed:true}}).cap,65);
 assert.notEqual(evaluate([item(trusted,'rights')],{bypassPossible:true}).decision.verdict,'green');
});
test('missing trust and baseline are grey; blind and unsupported methods remain explicit',()=>{
 assert.equal(evaluate([],{verifiedSnapshot:null}).decision.verdict,'grey');
 assert.equal(evaluate([],{baseline:null}).decision.verdict,'grey');
 assert.equal(evaluate([],{now:Date.parse('2028-01-01T00:00:00Z')}).decision.verdict,'grey');
 assert.equal(evaluate([],{decoded:{classification:'blind',addresses:[]},baseline:null}).decision.verdict,'escalated');
 const unsupported=evaluate([],{decoded:{classification:'unsupported',addresses:[]}}).decision;
 assert.equal(unsupported.coverage,'unsupported');assert.equal(unsupported.score,null);
});
