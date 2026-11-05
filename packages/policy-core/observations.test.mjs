import test from "node:test";
import assert from "node:assert/strict";
import { observationCandidates, warnedEvent } from "./observations.mjs";

test("observations omit active-account/from/owner values and refresh weekly", () => {
  const entries = ["a", "b", "c", "d"].map((n) => ({ address: `0x${n.repeat(40)}`, role: "destination" }));
  const request = { params: [{ from: entries[1].address }, { message: { owner: entries[2].address } }] };
  const candidates = observationCandidates({ site: "swap.example", chain: "1", classification: { entries }, request, accounts: [entries[0].address], now: 10_000_000, lastSeen: { [`swap.example:1:${entries[3].address}`]: 9_000_000 } });
  assert.deepEqual(candidates, []);
});

test("only decoded first sightings are eligible for an observation", () => {
  const entry = { address: "0x0000000000000000000000000000000000000001", role: "destination" };
  assert.deepEqual(observationCandidates({ site: "swap.example", chain: "1", classification: { kind: "decoded", entries: [entry] } }), [
    { site: "swap.example", kind: "observation", value: entry.address, chain: "1" }
  ]);
  assert.deepEqual(observationCandidates({ site: "swap.example", chain: "1", classification: { kind: "opaque", entries: [entry] } }), []);
});

test("warned report is site-level and carries no user decision", () => {
  assert.deepEqual(warnedEvent({ site: "swap.example", chain: "1" }), { site: "swap.example", kind: "warned", chain: "1" });
});
