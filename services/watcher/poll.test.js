import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { pollSite } from './poll.js';
test('poll normalizes DNS and tolerates unavailable ASN data', async () => {
  const resolve = async (_host,type) => type === 'NS' ? ['NS2.EXAMPLE.','ns1.example.','ns1.example.'] : ['192.0.2.2','192.0.2.1'];
  const certificate = async () => ({fingerprint:'AB',issuer:'CA',names:['example.org']});
  const out = await pollSite('example.org',{resolve,certificate,lookupAsn:async()=>{throw Error('offline');}});
  assert.deepEqual(out.nameservers,['ns1.example','ns2.example']);
  assert.deepEqual(out.addresses,['192.0.2.1','192.0.2.2']);
  assert.deepEqual(out.asns,{});
});
test('missing DNS or certificate data fails without a partial observation', async () => {
  const resolve=async (_host,type)=>type==='NS'?[]:['192.0.2.1'];
  await assert.rejects(pollSite('example.org',{resolve,certificate:async()=>({}),lookupAsn:async()=>null}),/incomplete/);
});
test('rejects URLs and noncanonical site identities', async () => {
  await assert.rejects(pollSite('https://example.org',{}),/host/);
  await assert.rejects(pollSite('EXAMPLE.org',{}),/host/);
});
test('NS polling uses an explicitly configured ancestor zone only', async () => {
  const calls=[];
  const adapters={resolve:async (host,type)=>{calls.push([host,type]);return type==='NS'?['ns1.example.org.']:['192.0.2.1'];},certificate:async()=>({fingerprint:'AB',issuer:'CA',names:['app.example.org']}),lookupAsn:async()=>null};
  await pollSite('app.example.org',adapters,{nameserverZone:'example.org'});
  assert.ok(calls.some(([host,type])=>host==='example.org'&&type==='NS'));
  assert.ok(calls.some(([host,type])=>host==='app.example.org'&&type==='A'));
  await assert.rejects(pollSite('app.example.org',adapters,{nameserverZone:'attacker.example'}),/zone/);
});
