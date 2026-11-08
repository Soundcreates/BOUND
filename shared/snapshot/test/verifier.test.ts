import { test } from "node:test";
import assert from "node:assert/strict";
import {
  freshAnchorState,
  checkRootRecord,
  applySnapshotBytes,
  applyTransportFailure,
  type AnchorKey,
  type PersistedAnchorState,
} from "../src/verifier.ts";
import { compileSnapshot } from "../src/compiler.ts";
import { baseInput } from "./fixtures.ts";
import type { RootRecord } from "../src/root-record.ts";

const ANCHOR: AnchorKey = { chainId: 11155111, ensName: "bound-demo.eth", resolver: "0x1111111111111111111111111111111111111111", recordKey: "bound.root.v1" };
const NOW = Date.parse("2026-11-08T12:00:00Z");

function compileEpoch(epoch: number) {
  return compileSnapshot(baseInput({ epoch }));
}

function rootFor(epoch: number, digest: `0x${string}`): RootRecord {
  return { digest, epoch, network: "sepolia", schemaVersion: 1, swarmRef: "ab".repeat(32) };
}

test("first valid snapshot is adopted as trusted", () => {
  const state = freshAnchorState(ANCHOR);
  const { bytes, digest } = compileEpoch(1);
  const root = rootFor(1, digest);
  const check = checkRootRecord(state, root, "sepolia", "bound-demo.eth", NOW);
  assert.equal(check.accept, true);
  const { state: next, outcome } = applySnapshotBytes(state, root, bytes, NOW);
  assert.equal(outcome.status, "trusted");
  assert.equal(next.highestValidatedEpoch, 1);
});

test("a lower epoch than already validated is refused at the root-record step", () => {
  let state = freshAnchorState(ANCHOR);
  const e1 = compileEpoch(5);
  const r1 = rootFor(5, e1.digest);
  ({ state } = applySnapshotBytes(state, r1, e1.bytes, NOW));
  assert.equal(state.highestValidatedEpoch, 5);

  const e2 = compileEpoch(3);
  const r2 = rootFor(3, e2.digest);
  const check = checkRootRecord(state, r2, "sepolia", "bound-demo.eth", NOW);
  assert.equal(check.accept, false);
  if (!check.accept) assert.equal(check.reason, "lower-epoch");
});

test("a replayed lower epoch is refused even after a simulated restart (persisted state)", () => {
  let state = freshAnchorState(ANCHOR);
  const e1 = compileEpoch(5);
  const r1 = rootFor(5, e1.digest);
  ({ state } = applySnapshotBytes(state, r1, e1.bytes, NOW));

  // Simulate "restart": only highestValidatedEpoch survives, as if loaded from storage.
  const reloaded: PersistedAnchorState = { anchor: ANCHOR, highestValidatedEpoch: state.highestValidatedEpoch };
  const e0 = compileEpoch(2);
  const r0 = rootFor(2, e0.digest);
  const check = checkRootRecord(reloaded, r0, "sepolia", "bound-demo.eth", NOW);
  assert.equal(check.accept, false);
});

test("conflicting same-epoch roots (equivocation) are rejected", () => {
  let state = freshAnchorState(ANCHOR);
  const e1 = compileEpoch(5);
  const r1 = rootFor(5, e1.digest);
  ({ state } = applySnapshotBytes(state, r1, e1.bytes, NOW));

  const fakeDigest = ("0x" + "ff".repeat(32)) as `0x${string}`;
  const conflicting = rootFor(5, fakeDigest);
  const check = checkRootRecord(state, conflicting, "sepolia", "bound-demo.eth", NOW);
  assert.equal(check.accept, false);
  if (!check.accept) assert.equal(check.reason, "conflicting-epoch");
});

test("wrong network root record is rejected", () => {
  const state = freshAnchorState(ANCHOR);
  const e1 = compileEpoch(1);
  const r1 = { ...rootFor(1, e1.digest), network: "mainnet" };
  const check = checkRootRecord(state, r1, "sepolia", "bound-demo.eth", NOW);
  assert.equal(check.accept, false);
  if (!check.accept) assert.equal(check.reason, "wrong-network");
});

test("hash mismatch (gateway-altered bytes) is refused and falls back to an unexpired cache", () => {
  let state = freshAnchorState(ANCHOR);
  const e1 = compileEpoch(1);
  const r1 = rootFor(1, e1.digest);
  ({ state } = applySnapshotBytes(state, r1, e1.bytes, NOW));

  const e2 = compileEpoch(2);
  const r2 = rootFor(2, e2.digest);
  const tamperedBytes = new TextEncoder().encode(new TextDecoder().decode(e2.bytes).replace('"epoch":2', '"epoch":2 ')); // byte-level alteration
  const { state: next, outcome } = applySnapshotBytes(state, r2, tamperedBytes, NOW);
  assert.equal(outcome.status, "trusted-cached");
  if (outcome.status === "trusted-cached") assert.equal(outcome.epoch, 1);
  assert.equal(next.highestValidatedEpoch, 1); // tampered epoch 2 never adopted
});

test("hash mismatch with no prior cache falls to grey", () => {
  const state = freshAnchorState(ANCHOR);
  const e1 = compileEpoch(1);
  const r1 = rootFor(1, e1.digest);
  const tampered = new Uint8Array(e1.bytes);
  tampered[0] = tampered[0]! ^ 0xff;
  const { outcome } = applySnapshotBytes(state, r1, tampered, NOW);
  assert.equal(outcome.status, "grey");
});

test("transport failure with a current cache returns trusted-cached and age; past expiry returns grey", () => {
  let state = freshAnchorState(ANCHOR);
  const e1 = compileEpoch(1);
  const r1 = rootFor(1, e1.digest);
  ({ state } = applySnapshotBytes(state, r1, e1.bytes, NOW));

  const soon = applyTransportFailure(state, NOW + 60_000);
  assert.equal(soon.status, "trusted-cached");
  if (soon.status === "trusted-cached") assert.equal(soon.ageMs, 60_000);

  const wayLater = applyTransportFailure(state, NOW + 30 * 24 * 3600 * 1000); // validityDays=7 in fixture
  assert.equal(wayLater.status, "grey");
});

test("transport failure with never-any-snapshot returns grey with the specific reason", () => {
  const state = freshAnchorState(ANCHOR);
  const outcome = applyTransportFailure(state, NOW);
  assert.equal(outcome.status, "grey");
  if (outcome.status === "grey") assert.equal(outcome.reason, "root-unreachable-no-cache");
});

test("an already-expired snapshot is never adopted even with a fresh, higher epoch", () => {
  const state = freshAnchorState(ANCHOR);
  const { snapshot, bytes, digest } = compileEpoch(1);
  const root = rootFor(1, digest);
  // nowMs AFTER the snapshot's own expiresAt simulates clock skew / a stale publish.
  const pastExpiry = Date.parse(snapshot.expiresAt) + 1000;
  const { outcome } = applySnapshotBytes(state, root, bytes, pastExpiry);
  assert.equal(outcome.status, "grey");
  if (outcome.status === "grey") assert.equal(outcome.reason, "expired-no-fallback");
});
