import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { createWatcher } from './index.js';
const site = 'example.org', address = '0x' + '1'.repeat(40), other = '0x' + '2'.repeat(40);
const event = (key, value = address, kind = 'warned') => ({site, chainId:1, value, reporterKey:key, kind});
const batch = (...events) => ({schemaVersion:1, events});
function setup() {
  let time = 0, drift = false, active = false;
  const written = [];
  const watcher = createWatcher({windowMs:1000,k:3,now:()=>time,writeObservation:async r => { written.push(r); },isIncidentActive:async()=>active,hasCorroboratedDrift:async()=>drift});
  return {watcher,written,setTime:v=>time=v,setDrift:v=>drift=v,setActive:v=>active=v};
}
test('incident threshold counts distinct keys per counterparty in the window', async () => {
  const {watcher,setTime} = setup();
  await watcher.intake(batch(event('a'),event('a'),event('b'),event('c',other)));
  assert.deepEqual(await watcher.triggers(site,1), []);
  await watcher.intake(batch(event('c')));
  assert.deepEqual(await watcher.triggers(site,1), [{counterparty:address,trigger:'K-same-counterparty-warned'}]);
  setTime(1000);
  assert.deepEqual(await watcher.triggers(site,1), []);
});
test('drift needs a warning and incident suppresses observations', async () => {
  const {watcher,written,setDrift,setActive} = setup();
  setDrift(true);
  assert.deepEqual(await watcher.triggers(site,1), []);
  setActive(true); await watcher.intake(batch(event('a',address,'counterparty')));
  assert.equal(written.length,0);
  setActive(false); await watcher.intake(batch(event('a')));
  assert.deepEqual(await watcher.triggers(site,1), [{counterparty:address,trigger:'drift+warned'}]);
});
test('warning and positive sightings remain distinct; warned addresses cannot enter baseline', async () => {
  const {watcher} = setup();
  await watcher.intake(batch(event('a',address,'counterparty'),event('a',address,'warned'),event('b',other,'called-contract')));
  const baseline = watcher.baseline(site,1);
  assert.deepEqual(baseline.counterparties, []);
  assert.deepEqual(baseline.calledContracts, [other]);
});
test('concurrent duplicate reports only write once', async () => {
  const {watcher,written} = setup();
  await Promise.all([watcher.intake(batch(event('a'))),watcher.intake(batch(event('a')))]);
  assert.equal(written.length,1);
});
