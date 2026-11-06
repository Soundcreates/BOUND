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
  await enqueue([record], storage, 10_000_000 + 7 * 24 * 60 * 60 * 1000);
  assert.equal(storage.data.boundObservationQueue.length, 2);
  assert.notEqual(storage.data.boundObservationQueue[0].reporterKey, storage.data.boundObservationQueue[1].reporterKey);
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
