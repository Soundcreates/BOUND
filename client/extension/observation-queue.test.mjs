import test from "node:test";
import assert from "node:assert/strict";
import { enqueue, flush } from "./observation-queue.mjs";

function memoryStorage() {
  const data = {};
  return {
    data,
    async get(keys) { const list = Array.isArray(keys) ? keys : [keys]; return Object.fromEntries(list.filter((key) => key in data).map((key) => [key, data[key]])); },
    async set(values) { Object.assign(data, values); }
  };
}

test("queue deduplicates for a week and stores only site-level report fields", async () => {
  const storage = memoryStorage();
  const record = { site: "swap.example", kind: "observation", value: "0x0000000000000000000000000000000000000001", chain: "0x1" };
  await enqueue([record], storage, 10_000_000);
  await enqueue([record], storage, 10_000_001);
  assert.equal(storage.data.boundObservationQueue.length, 1);
  assert.deepEqual(Object.keys(storage.data.boundObservationQueue[0]).sort(), ["chain", "kind", "reporterKey", "site", "value"]);
  // A report counts against the weekly limit once it has been sent.
  const firstKey = storage.data.boundObservationQueue[0].reporterKey;
  await flush(async () => {}, storage, 20, () => 10_000_002);
  await enqueue([record], storage, 10_000_003);
  assert.equal(storage.data.boundObservationQueue.length, 0);
  await enqueue([record], storage, 10_000_002 + 7 * 24 * 60 * 60 * 1000);
  assert.equal(storage.data.boundObservationQueue.length, 1);
  assert.notEqual(storage.data.boundObservationQueue[0].reporterKey, firstKey);
});

test("failed sends retain queued reports for retry; successful sends remove one batch", async () => {
  const storage = memoryStorage();
  storage.data.boundObservationQueue = Array.from({ length: 25 }, (_, i) => ({ site: `site${i}`, kind: "warned", chain: "1", reporterKey: "key" }));
  await assert.rejects(flush(async () => { throw new Error("offline"); }, storage));
  assert.equal(storage.data.boundObservationQueue.length, 25);
  assert.equal(await flush(async () => {}, storage), 20);
  assert.equal(storage.data.boundObservationQueue.length, 5);
});

test("simultaneous writes and a flush retain every unsent record", async () => {
  const storage = memoryStorage();
  const record = n => ({ site: `site${n}.example`, kind: "observation", value: `0x${n.toString(16).padStart(40, "0")}`, chain: "1" });
  await Promise.all(Array.from({ length: 20 }, (_, i) => enqueue([record(i + 1)], storage, 10_000)));
  assert.equal(storage.data.boundObservationQueue.length, 20);
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  let started;
  const sending = new Promise(resolve => { started = resolve; });
  const flushing = flush(async () => { started(); await blocked; }, storage, 10);
  await sending;
  const adding = enqueue([record(21)], storage, 10_001);
  release();
  await Promise.all([flushing, adding]);
  assert.equal(storage.data.boundObservationQueue.length, 11);
  assert.equal(storage.data.boundObservationQueue.some(item => item.site === "site21.example"), true);
});

test("queue strips extra fields and refuses to discard existing records when full", async () => {
  const storage = memoryStorage();
  const record = { site: "swap.example", kind: "observation", value: "0x" + "a".repeat(40), chain: "1", wallet: "secret", choice: "continue" };
  await enqueue([record], storage, 1);
  assert.deepEqual(Object.keys(storage.data.boundObservationQueue[0]).sort(), ["chain", "kind", "reporterKey", "site", "value"]);
  const original = Array.from({ length: 500 }, (_, i) => ({ site: `s${i}`, kind: "warned", chain: "1", reporterKey: "key" }));
  storage.data.boundObservationQueue = original;
  await assert.rejects(enqueue([{ ...record, site: "new.example" }], storage, 2), /queue is full/);
  assert.deepEqual(storage.data.boundObservationQueue, original);
});

test('migration preserves address entries and dedupes frontend by decimal chain for 24 hours', async () => {
  const storage=memoryStorage(), old={site:'example.org',kind:'observation',value:'0x'+'1'.repeat(40),observationKind:'called-contract',chain:'0x1',reporterKey:'old'};
  const oldKey=JSON.stringify(['example.org','0x1','observation',old.value,'called-contract']);
  Object.assign(storage.data,{boundObservationQueue:[old],boundObservationSeen:{[oldKey]:1}});
  const front={site:'example.org',kind:'frontend',chain:'0x1',path:'/app.js',hash:'sha256-'+'A'.repeat(43)+'='};
  await enqueue([front],storage,100); await enqueue([{...front,chain:'1'}],storage,101);
  assert.deepEqual(storage.data.boundObservationQueue[0],old); assert.equal(storage.data.boundObservationQueue.length,2);
  assert.equal(storage.data.boundObservationQueueVersion,2); assert.equal(storage.data.boundObservationSeen[oldKey],1);
  await enqueue([front],storage,100+86400000); assert.equal(storage.data.boundObservationQueue.length,3);
});

test('full queue fails atomically and malformed stored state is reported', async () => {
 const storage=memoryStorage(); storage.data.boundObservationQueue=Array.from({length:499},(_,i)=>({site:`s${i}`,kind:'warned',chain:'1',reporterKey:'key'}));
 const before=structuredClone(storage.data);
 await assert.rejects(enqueue([{site:'a',kind:'warned',chain:'1'},{site:'b',kind:'warned',chain:'1'}],storage,1),/full/);
 assert.deepEqual(storage.data,before);
 storage.data.boundObservationQueue={}; await assert.rejects(flush(async()=>{},storage),/Invalid observation queue/);
});

test('flush sends the longest prefix within the byte limit', async () => {
 const storage=memoryStorage(); const site='a'.repeat(63)+'.'+'b'.repeat(63)+'.'+'c'.repeat(63)+'.'+'d'.repeat(60);
 storage.data.boundObservationQueue=Array.from({length:100},()=>({site,kind:'observation',chain:'1',reporterKey:'é'.repeat(128),value:'0x'+'1'.repeat(40)}));
 let sent; const count=await flush(async batch=>{sent=batch},storage,100);
 assert.ok(count>0 && count<100); assert.equal(sent.length,count); assert.equal(storage.data.boundObservationQueue.length,100-count);
});
