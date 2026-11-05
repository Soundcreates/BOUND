import { test } from "node:test";
import assert from "node:assert/strict";
import { KNOWN_WORKERS, getKnownWorker, assertKnownWorker, networkWorkersOnChain, UnknownWorkerError } from "../src/known-workers.ts";

test("getKnownWorker finds nox, published on Sepolia, kind network", () => {
  const nox = getKnownWorker("nox");
  assert.ok(nox);
  assert.equal(nox?.chainId, 11155111);
  assert.equal(nox?.kind, "network");
});

test("getKnownWorker returns undefined for an unknown id", () => {
  assert.equal(getKnownWorker("not-a-real-worker"), undefined);
});

test("assertKnownWorker throws UnknownWorkerError for an unknown id", () => {
  assert.throws(() => assertKnownWorker("nope"), UnknownWorkerError);
});

test("every specifier is a well-formed 0x address", () => {
  for (const w of KNOWN_WORKERS) {
    assert.match(w.specifier, /^0x[0-9a-fA-F]{40}$/, `${w.id} has a malformed specifier`);
  }
});

test("networkWorkersOnChain excludes the reference-only passthrough worker", () => {
  const mainnetNetworkWorkers = networkWorkersOnChain(1);
  assert.ok(mainnetNetworkWorkers.every((w) => w.kind === "network"));
  assert.ok(!mainnetNetworkWorkers.some((w) => w.id === "passthrough"));
});

test("networkWorkersOnChain on Sepolia returns exactly nox", () => {
  const sepoliaWorkers = networkWorkersOnChain(11155111);
  assert.deepEqual(sepoliaWorkers.map((w) => w.id), ["nox"]);
});
