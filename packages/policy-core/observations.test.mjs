import test from "node:test";
import assert from "node:assert/strict";
import { mayRecordObservation, observationCandidates, warnedEvent, warningCandidates } from "./observations.mjs";

test("observations omit active-account/from/owner values and refresh weekly", () => {
  const entries = ["a", "b", "c", "d"].map((n) => ({ address: `0x${n.repeat(40)}`, role: "destination" }));
  const request = { params: [{ from: entries[1].address }, { message: { owner: entries[2].address } }] };
  const candidates = observationCandidates({ site: "swap.example", chain: "1", classification: { kind: "decoded", entries }, request, accounts: [entries[0].address], now: 10_000_000, lastSeen: { [`swap.example:1:${entries[3].address}`]: 9_000_000 } });
  assert.deepEqual(candidates, []);
});

test("JSON typed-data owner and holder never enter observations", () => {
  const owner = "0x" + "a".repeat(40);
  const holder = "0x" + "b".repeat(40);
  const other = "0x" + "c".repeat(40);
  const classification = { kind: "decoded", entries: [owner, holder, other].map(address => ({ address, role: "rights" })) };
  const request = { method: "eth_signTypedData_v4", params: ["0x", JSON.stringify({ message: { owner, holder } })] };
  assert.deepEqual(observationCandidates({ site: "swap.example", chain: "1", classification, request }), [{ site: "swap.example", kind: "observation", value: other, chain: "1" }]);
  assert.deepEqual(observationCandidates({ site: "swap.example", chain: "1", classification, request: { ...request, params: ["0x", "{"] } }), []);
});

test("an order offerer is excluded from observations", () => {
  const offerer = "0x" + "a".repeat(40);
  const request = { method: "eth_signTypedData_v4", params: ["0x", JSON.stringify({ message: { offerer } })] };
  assert.deepEqual(observationCandidates({ site: "swap.example", chain: "1", classification: { kind: "decoded", entries: [{ address: offerer, role: "destination" }] }, request }), []);
});

test("only decoded first sightings are eligible for an observation", () => {
  const entry = { address: "0x0000000000000000000000000000000000000001", role: "destination" };
  assert.deepEqual(observationCandidates({ site: "swap.example", chain: "1", classification: { kind: "decoded", entries: [entry] } }), [
    { site: "swap.example", kind: "observation", value: entry.address, chain: "1" }
  ]);
  assert.deepEqual(observationCandidates({ site: "swap.example", chain: "1", classification: { kind: "opaque", entries: [entry] } }), []);
});
test("called contracts retain their observation subtype",()=>{
 const entry={address:"0x"+"1".repeat(40),role:"called"};
 assert.deepEqual(observationCandidates({site:"swap.example",chain:"1",classification:{kind:"decoded",entries:[entry]}}),[{site:"swap.example",kind:"observation",value:entry.address,chain:"1",observationKind:"called-contract"}]);
});

test("only continued green or amber requests with normal incident status can be observed", () => {
  for (const verdict of ["green", "amber", "red", "escalated", "grey"]) for (const incidentStatus of ["normal", "active", "unknown"]) for (const action of ["continue", "cancel"]) {
    assert.equal(mayRecordObservation({ verdict, incidentStatus, action }), ["green", "amber"].includes(verdict) && incidentStatus === "normal" && action === "continue");
  }
});

test("warned report is site-level and carries no user decision", () => {
  assert.deepEqual(warnedEvent({ site: "swap.example", chain: "1" }), { site: "swap.example", kind: "warned", chain: "1" });
});

test("warned reports retain the flagged counterparty but omit wallet and typed-data owners", () => {
  const owner = "0x" + "a".repeat(40), spender = "0x" + "b".repeat(40);
  const request = { method: "eth_signTypedData_v4", params: [owner, JSON.stringify({ message: { owner } })] };
  assert.deepEqual(warningCandidates({ site: "swap.example", chain: "1", addresses: [owner, spender, spender.toUpperCase().replace("0X", "0x")], request, accounts: [owner] }), [{ site: "swap.example", kind: "warned", value: spender, chain: "1" }]);
  assert.deepEqual(warningCandidates({ site: "swap.example", chain: "1", addresses: [owner], request, accounts: [owner] }), [{ site: "swap.example", kind: "warned", chain: "1" }]);
});

test("privacy filtering traverses the whole accepted request depth", () => {
  const owner = "0x" + "a".repeat(40);
  let nested = { owner };
  for (let i = 0; i < 24; i++) nested = { nested };
  const request = { method: "eth_signTypedData_v4", params: ["0x", JSON.stringify({ message: nested })] };
  assert.deepEqual(observationCandidates({ site: "swap.example", chain: "1", classification: { kind: "decoded", entries: [{ address: owner, role: "rights" }] }, request }), []);
});
