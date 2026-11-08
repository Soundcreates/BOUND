import test from "node:test";
import assert from "node:assert/strict";
import { createEnsLookupCache } from "./ens-cache.mjs";

function sessionStorage() {
  const data = {};
  return { data, get: async (key) => (Object.hasOwn(data, key) ? { [key]: structuredClone(data[key]) } : {}), set: async (value) => { Object.assign(data, structuredClone(value)); } };
}

test("L1 miss reads live ENS, stores it, and the next lookup is served from memory", async () => {
  let clock = 1_000, live = 0;
  const cache = createEnsLookupCache({ storage: sessionStorage(), now: () => clock });
  const readLive = async () => { live++; return { value: { site: "a.example.org" } }; };
  assert.deepEqual(await cache.lookup({ key: "k", readLive }), { source: "live", value: { site: "a.example.org" } });
  assert.deepEqual(await cache.lookup({ key: "k", readLive }), { source: "memory", value: { site: "a.example.org" } });
  assert.equal(live, 1);
  clock += 60 * 60_000;
  assert.equal((await cache.lookup({ key: "k", readLive })).source, "live");
  assert.equal(live, 2);
});

test("Arkiv value is returned only as unconfirmed when live fails, and is never cached", async () => {
  const cache = createEnsLookupCache({ storage: sessionStorage(), now: () => 5 });
  let liveUp = false;
  const readLive = async () => { if (!liveUp) throw new Error("anon down"); return { value: "live" }; };
  const readArkiv = async () => ({ value: "watcher" });
  assert.deepEqual(await cache.lookup({ key: "k", readLive, readArkiv }), { source: "arkiv_unconfirmed", value: "watcher" });
  liveUp = true;
  const next = await cache.lookup({ key: "k", readLive, readArkiv });
  assert.equal(next.source, "live");
  assert.equal(next.value, "live");
  assert.equal(next.inconsistent, true);
});

test("live timeout falls back to Arkiv within the budget; nothing available is unavailable", async () => {
  const cache = createEnsLookupCache({ storage: sessionStorage() });
  const hang = () => new Promise(() => {});
  assert.deepEqual(await cache.lookup({ key: "a", readLive: hang, readArkiv: async () => ({ value: null }), timeoutMs: 20 }), { source: "arkiv_unconfirmed", value: null });
  assert.deepEqual(await cache.lookup({ key: "b", readLive: hang, timeoutMs: 20 }), { source: "unavailable", value: null });
  assert.deepEqual(await cache.lookup({ key: "c", readLive: hang, readArkiv: async () => { throw new Error("x"); }, timeoutMs: 20 }), { source: "unavailable", value: null });
});

test("a live 'no record' answer is cached for the shorter negative TTL", async () => {
  let clock = 0, live = 0;
  const cache = createEnsLookupCache({ storage: sessionStorage(), now: () => clock, negativeTtlMs: 1_000 });
  const readLive = async () => { live++; return { value: null }; };
  await cache.lookup({ key: "k", readLive });
  clock = 999; assert.equal((await cache.lookup({ key: "k", readLive })).source, "memory");
  clock = 1_000; assert.equal((await cache.lookup({ key: "k", readLive })).source, "live");
  assert.equal(live, 2);
});

test("session mirror restores L1 after a service-worker restart", async () => {
  const storage = sessionStorage();
  const first = createEnsLookupCache({ storage, now: () => 10 });
  await first.lookup({ key: "k", readLive: async () => ({ value: [1, 2] }) });
  const restarted = createEnsLookupCache({ storage, now: () => 20 });
  assert.deepEqual(await restarted.lookup({ key: "k", readLive: async () => { throw new Error("must not run"); } }), { source: "memory", value: [1, 2] });
});

test("expired or malformed mirror entries are ignored", async () => {
  const storage = sessionStorage();
  storage.data.boundEnsCacheV1 = { old: { value: 1, storedAt: 0, expiresAt: 5 }, bad: { value: 1 }, future: { value: 1, storedAt: 999, expiresAt: 2_000 } };
  const cache = createEnsLookupCache({ storage, now: () => 10 });
  for (const key of ["old", "bad", "future"]) assert.equal((await cache.lookup({ key, readLive: async () => ({ value: 2 }) })).source, "live", key);
});

test("concurrent misses share one live read and callers cannot mutate cached values", async () => {
  let live = 0, release;
  const gate = new Promise((resolve) => { release = resolve; });
  const cache = createEnsLookupCache({ storage: sessionStorage() });
  const readLive = async () => { live++; await gate; return { value: { list: [1] } }; };
  const both = Promise.all([cache.lookup({ key: "k", readLive }), cache.lookup({ key: "k", readLive })]);
  release();
  const [a, b] = await both;
  assert.equal(live, 1);
  a.value.list.push(99);
  assert.deepEqual(b.value, { list: [1] });
  assert.deepEqual((await cache.lookup({ key: "k", readLive })).value, { list: [1] });
});

test("invalid live results are treated as unavailable, not cached", async () => {
  const cache = createEnsLookupCache({ storage: sessionStorage() });
  assert.equal((await cache.lookup({ key: "k", readLive: async () => "raw" })).source, "unavailable");
  assert.equal((await cache.lookup({ key: "k", readLive: async () => ({ value: 3 }) })).source, "live");
  assert.throws(() => createEnsLookupCache({}), /configuration/);
  await assert.rejects(cache.lookup({ key: "", readLive: async () => ({ value: 1 }) }), /lookup/);
});

test("a stalled Arkiv lookup cannot hold up a completed live lookup indefinitely", async () => {
  const cache = createEnsLookupCache({ storage: sessionStorage() });
  const result = await cache.lookup({ key: "k", timeoutMs: 20, readLive: async () => ({ value: "live" }), readArkiv: () => new Promise(() => {}) });
  assert.deepEqual(result, { source: "live", value: "live" });
});
