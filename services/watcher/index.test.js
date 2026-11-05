import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWatcher } from './index.js';
const a = '0x' + 'a'.repeat(40), b = '0x' + 'b'.repeat(40);
const e = (key, value = a, kind = 'warned') => ({ site: 'example.com', chainId: 1, value, kind, reporterKey: key });
test('windowed distinct warnings, drift and positive exclusion', async () => {
  let time = 0, drift = false, active = false; const writes = [];
  const w = createWatcher({ windowMs: 100, k: 3, now: () => time, writeObservation: async r => writes.push(r), isIncidentActive: async () => active, hasCorroboratedDrift: async () => drift });
  const send = async (...events) => w.intake({ schemaVersion: 1, events });
  await send(e('p', a, 'counterparty'), e('1'), e('1'), e('2'), e('3', b));
  assert.deepEqual(await w.triggers('example.com', 1), []);
  assert.deepEqual(w.baseline('example.com', 1).counterparties, []);
  await send(e('3')); assert.equal((await w.triggers('example.com', 1))[0].trigger, 'K-same-counterparty-warned');
  time = 100; assert.deepEqual(await w.triggers('example.com', 1), []);
  drift = true; assert.deepEqual(await w.triggers('example.com', 1), []);
  await send(e('1')); assert.equal((await w.triggers('example.com', 1))[0].trigger, 'drift+warned');
  active = true; const count = writes.length; await send(e('4', b, 'counterparty')); assert.equal(writes.length, count);
  assert.equal((await send({ ...e('x'), wallet: a })).result, 'rejected');
});
