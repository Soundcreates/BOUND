import { test } from "node:test";
import assert from "node:assert/strict";
import { createWorkerLifecycle } from "../src/worker-lifecycle.ts";
import { cacheKey } from "../src/worker-factory.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const closed: number[] = [];
  let id = 0;
  const life = createWorkerLifecycle<{ close(): void }, number>();
  return { closed, life, make: () => {
    const n = ++id, ready = deferred<number>();
    return { worker: { close: () => closed.push(n) }, ready: ready.promise, resolve: () => ready.resolve(n), reject: (e: unknown) => ready.reject(e), id: n };
  } };
}

test("close during pending startup closes eventual worker and rejects handle", async () => {
  const f = fixture(), w = f.make();
  const result = f.life.ensure("a", () => w);
  f.life.close(); w.resolve();
  await assert.rejects(result, /invalidated/);
  assert.deepEqual(f.closed, [w.id]);
});

test("distinct overlapping keys invalidate earlier startup", async () => {
  const f = fixture(), a = f.make(), b = f.make();
  const pa = f.life.ensure("a", () => a);
  const pb = f.life.ensure("b", () => b);
  a.resolve(); await assert.rejects(pa, /invalidated/);
  b.resolve(); assert.equal(await pb, b.id);
  assert.deepEqual(f.closed, [a.id]);
});

test("same key coalesces pending startup", async () => {
  const f = fixture(), a = f.make(); let calls = 0;
  const make = () => { calls++; return a; };
  const x = f.life.ensure("a", make), y = f.life.ensure("a", make);
  assert.equal(calls, 1); a.resolve(); assert.equal(await x, await y);
});

test("failed ready closes worker and permits retry", async () => {
  const f = fixture(), a = f.make();
  const p = f.life.ensure("a", () => a); a.reject(Error("boot"));
  await assert.rejects(p, /boot/); assert.deepEqual(f.closed, [a.id]);
  const b = f.make(), q = f.life.ensure("a", () => b); b.resolve(); assert.equal(await q, b.id);
});

test("binary configs with different bytes have distinct cache keys", () => {
  assert.notEqual(cacheKey("nox", new Uint8Array([1, 2])), cacheKey("nox", new Uint8Array([1, 3])));
  assert.notEqual(cacheKey("nox", new Uint8Array([1, 2])), cacheKey("nox", new Uint8Array([1, 2]).buffer));
});
