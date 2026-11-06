import test from "node:test";
import assert from "node:assert/strict";
import { createObservationDispatcher } from "./observation-dispatcher.mjs";

function harness(queue = []) {
  const storageData = { boundObservationQueue: queue };
  const alarms = new Map();
  const storage = {
    async get(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((key) => key in storageData).map((key) => [key, storageData[key]]));
    },
    async set(values) { Object.assign(storageData, values); }
  };
  return { storageData, alarms, storage, alarmApi: { async create(name, info) { alarms.set(name, info.when); } } };
}

test("randomly schedules queued reports and restores the durable alarm", async () => {
  const h = harness([{ site: "swap.example", kind: "warned", chain: "1", reporterKey: "rotating" }]);
  const dispatcher = createObservationDispatcher({ storage: h.storage, alarms: h.alarmApi, send: async () => {}, now: () => 1000, random: () => 0.5 });
  await dispatcher.schedule();
  assert.equal(h.storageData.boundObservationDispatchAt, 7_000);
  await dispatcher.resume();
  assert.equal(h.alarms.get(dispatcher.alarmName), 7_000);
});

test("resume schedules an existing queue without a stored alarm", async () => {
  const h = harness([{ site: "queued.example", kind: "warned", chain: "1", reporterKey: "rotating" }]);
  const dispatcher = createObservationDispatcher({ storage: h.storage, alarms: h.alarmApi, send: async () => {}, now: () => 5000, random: () => 0 });
  await dispatcher.resume();
  assert.equal(h.storageData.boundObservationDispatchAt, 7_000);
  assert.equal(typeof h.storageData.boundObservationGeneration, "string");
  assert.equal(h.storageData.boundObservationScheduledGeneration, h.storageData.boundObservationGeneration);
  assert.equal(h.alarms.get(dispatcher.alarmName), 7_000);
});

test("crash recovery reschedules a queue whose generation is newer than its alarm", async () => {
  const record = { site: "new.example", kind: "warned", chain: "1", reporterKey: "rotating" };
  const h = harness([record]);
  let now = 100_000;
  Object.assign(h.storageData, {
    boundObservationGeneration: "generation-new",
    boundObservationScheduledGeneration: "generation-old",
    boundObservationDispatchAt: now
  });
  let sent = 0;
  const dispatcher = createObservationDispatcher({ storage: h.storage, alarms: h.alarmApi, send: async () => { sent++; }, now: () => now, random: () => 0 });
  await dispatcher.dispatch();
  assert.equal(sent, 0);
  assert.equal(h.storageData.boundObservationDispatchAt, now + 2_000);
  assert.equal(h.storageData.boundObservationScheduledGeneration, "generation-new");
  await dispatcher.resume();
  assert.equal(h.alarms.get(dispatcher.alarmName), now + 2_000);
  now += 2_000;
  await dispatcher.dispatch();
  assert.equal(sent, 1);
});

test("deduplicated enqueue arms an unscheduled existing queue", async () => {
  const record = { site: "swap.example", kind: "warned", chain: "1" };
  const h = harness();
  let now = 10_000;
  const dispatcher = createObservationDispatcher({ storage: h.storage, alarms: h.alarmApi, send: async () => {}, now: () => now, random: () => 0 });
  await dispatcher.enqueue([record], now);
  h.storageData.boundObservationDispatchAt = null;
  now = 20_000;
  await dispatcher.enqueue([record], now);
  assert.equal(h.storageData.boundObservationQueue.length, 1);
  assert.equal(h.storageData.boundObservationDispatchAt, 22_000);
});

test("new reports reset an older alarm and serialize against dispatch", async () => {
  const h = harness([{ site: "old.example", kind: "warned", chain: "1", reporterKey: "rotating" }]);
  let now = 1_000_000;
  h.storageData.boundObservationDispatchAt = now;
  const sent = [];
  const dispatcher = createObservationDispatcher({ storage: h.storage, alarms: h.alarmApi, send: async batch => sent.push(batch), now: () => now, random: () => 0 });
  const record = { site: "new.example", kind: "warned", chain: "1" };
  await Promise.all([dispatcher.enqueue([record], now), dispatcher.dispatch()]);
  assert.equal(h.storageData.boundObservationDispatchAt, now + 2_000);
  assert.deepEqual(sent, []);
  assert.equal(h.storageData.boundObservationQueue.length, 2);
  now += 2_000;
  await dispatcher.dispatch();
  assert.equal(sent[0].length, 2);
});

test("fake transport receives only queue batches and successful sends remove them", async () => {
  const queue = Array.from({ length: 25 }, (_, i) => ({ site: `site${i}.example`, kind: "warned", chain: "1", reporterKey: "rotating" }));
  const h = harness(queue);
  let now = 1_000_000;
  const sends = [];
  const dispatcher = createObservationDispatcher({ storage: h.storage, alarms: h.alarmApi, send: async (batch) => sends.push(batch), now: () => now, random: () => 0 });
  await dispatcher.schedule();
  now = h.storageData.boundObservationDispatchAt;
  await dispatcher.dispatch();
  assert.equal(sends[0].length, 20);
  assert.equal(h.storageData.boundObservationQueue.length, 5);
  assert.ok(h.storageData.boundObservationDispatchAt > now);
  now = h.storageData.boundObservationDispatchAt;
  await dispatcher.dispatch();
  assert.equal(sends[1].length, 5);
  assert.equal(h.storageData.boundObservationQueue.length, 0);
  assert.equal(h.storageData.boundObservationDispatchAt, null);
});

test("timed out transport retains the batch and schedules bounded retry", async () => {
  const record = { site: "swap.example", kind: "warned", chain: "1", reporterKey: "rotating" };
  const h = harness([record]);
  let now = 2_000_000;
  const dispatcher = createObservationDispatcher({ storage: h.storage, alarms: h.alarmApi, send: async () => { throw new Error("transport timeout"); }, now: () => now, random: () => 0 });
  await dispatcher.schedule();
  now = h.storageData.boundObservationDispatchAt;
  await assert.rejects(dispatcher.dispatch(), /timeout/);
  assert.deepEqual(h.storageData.boundObservationQueue, [record]);
  assert.equal(h.storageData.boundObservationRetry, 1);
  assert.equal(h.storageData.boundObservationDispatchAt, now + 2_000);
});

test("dispatcher timeout aborts transport and keeps the batch queued", async () => {
  const record = { site: "swap.example", kind: "warned", chain: "1", reporterKey: "rotating" };
  const h = harness([record]);
  let now = 3_000_000;
  let signal;
  const dispatcher = createObservationDispatcher({
    storage: h.storage,
    alarms: h.alarmApi,
    send: async (_batch, options) => { signal = options.signal; await new Promise(() => {}); },
    sendTimeoutMs: 5,
    now: () => now,
    random: () => 0
  });
  await dispatcher.schedule();
  now = h.storageData.boundObservationDispatchAt;
  await assert.rejects(dispatcher.dispatch(), /timed out/);
  assert.equal(signal.aborted, true);
  assert.deepEqual(h.storageData.boundObservationQueue, [record]);
  assert.equal(h.storageData.boundObservationDispatchAt, now + 2_000);
});

test('lost response retries the same queued prefix', async () => {
 const queue=Array.from({length:21},(_,i)=>({site:`s${i}.example`,kind:'warned',chain:'1',reporterKey:'key'}));
 const h=harness(queue); let now=1000; const sent=[];
 const dispatcher=createObservationDispatcher({storage:h.storage,alarms:h.alarmApi,now:()=>now,random:()=>0,send:async batch=>{sent.push(structuredClone(batch));if(sent.length===1)throw Error('lost response');}});
 await dispatcher.schedule(); now=h.storageData.boundObservationDispatchAt; await assert.rejects(dispatcher.dispatch(),/lost response/);
 assert.deepEqual(h.storageData.boundObservationQueue,queue); now=h.storageData.boundObservationDispatchAt; await dispatcher.dispatch();
 assert.deepEqual(sent[0],sent[1]); assert.equal(h.storageData.boundObservationQueue.length,1);
});
