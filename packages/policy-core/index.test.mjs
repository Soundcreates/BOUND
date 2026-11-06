import test from "node:test";
import assert from "node:assert/strict";
import { canonicalSite, evaluate } from "./index.mjs";
import { classifyRequest } from "../decoder/index.mjs";
import { benignDexRequest } from "../decoder/fixtures.mjs";

const addr = (n) => `0x${n.toString(16).padStart(40, "0")}`;
const rights = (n) => ({ address: addr(n), role: "rights" });
const destination = (n) => ({ address: addr(n), role: "destination" });

test("missing baseline is grey and unsupported never scores green", () => {
  assert.equal(evaluate({ classification: { kind: "decoded" }, baseline: null }).verdict, "grey");
  assert.deepEqual(evaluate({ classification: { kind: "unsupported" }, baseline: "seeded" }).coverage, "unsupported");
});

test("missing baseline still explains destination-not-fixed and chain-wide authorizations", () => {
  for (const label of ["Destination not fixed by signature", "EIP-7702 chainId zero"]) {
    const result = evaluate({ classification: { kind: "opaque", label }, baseline: null });
    assert.equal(result.verdict, "grey");
    assert.ok(result.reasons.includes(label));
  }
});

test("a detected bypass cannot receive a green verdict", () => {
  const classification = { kind: "decoded", entries: [] };
  assert.equal(evaluate({ classification, baseline: "seeded" }).verdict, "green");
  const result = evaluate({ classification, baseline: "seeded", coverage: "bypass_possible" });
  assert.equal(result.verdict, "grey");
  assert.equal(result.score, null);
  assert.equal(result.coverage, "bypass_possible");
});

test("site identity normalizes IDNA and keeps only non-default ports", () => {
  assert.equal(canonicalSite("https://BÜCHER.example:443/path"), "xn--bcher-kva.example");
  assert.equal(canonicalSite("https://swap.example:8443/path"), "swap.example:8443");
  assert.equal(canonicalSite("http://localhost:8000"), "localhost:8000");
  assert.equal(canonicalSite("http://swap.example"), null);
});

test("seeded rights and destination caps are applied with strictest mixed role", () => {
  assert.equal(evaluate({ classification: { kind: "decoded", entries: [rights(1)] }, baseline: "seeded" }).score, 35);
  assert.equal(evaluate({ classification: { kind: "decoded", entries: [destination(1)] }, baseline: "seeded" }).score, 65);
  assert.equal(evaluate({ classification: { kind: "decoded", entries: [rights(1), destination(2)] }, baseline: "seeded", drift: true }).score, 15);
  assert.deepEqual(evaluate({ classification: { kind: "decoded", entries: [rights(1), destination(2)] }, baseline: "seeded" }).warnedAddresses, [addr(1)]);
});

test("uncurated witness, signer-owned destination and drift rules", () => {
  assert.equal(evaluate({ classification: { kind: "decoded", entries: [rights(1)] }, baseline: "uncurated", witnessed: new Set([addr(1)]) }).score, 65);
  assert.equal(evaluate({ classification: { kind: "decoded", entries: [destination(1)] }, baseline: "uncurated", signerAccounts: [addr(1)] }).score, 100);
  assert.equal(evaluate({ classification: { kind: "decoded", entries: [destination(2)] }, baseline: "uncurated", drift: true }).score, 15);
});

test("signer ownership does not lift an untrusted rights cap", () => {
  assert.equal(evaluate({ classification: { kind: "decoded", entries: [rights(1)] }, baseline: "seeded", signerAccounts: [addr(1)] }).score, 35);
});

test("untrusted called contracts and tokens cannot silently score green", () => {
  for (const role of ["called", "token", "unknown"]) {
    const classification = { kind: "decoded", entries: [{ role, address: addr(9) }] };
    assert.equal(evaluate({ classification, baseline: "seeded" }).score, 65);
    assert.equal(evaluate({ classification, baseline: "uncurated" }).score, 35);
    assert.equal(evaluate({ classification, baseline: "uncurated", drift: true }).score, 15);
    assert.equal(evaluate({ classification, baseline: "uncurated", witnessed: new Set([addr(9)]) }).score, 65);
  }
});

test("rights cap matrix holds across baseline, drift, and witness combinations", () => {
  for (const baseline of ["seeded", "uncurated"]) for (const drift of [false, true]) for (const isWitnessed of [false, true]) {
    const witnessed = new Set(isWitnessed ? [addr(1)] : []);
    const expected = baseline === "seeded" ? (drift ? 15 : 35) : isWitnessed ? 65 : drift ? 15 : 35;
    assert.equal(evaluate({ classification: { kind: "decoded", entries: [rights(1)] }, baseline, drift, witnessed }).score, expected);
  }
});

test("only the four configured trust sources lift a cap; opaque and malformed stay capped", () => {
  const trusted = { [addr(1)]: { sources: ["snapshot"] } };
  assert.equal(evaluate({ classification: { kind: "decoded", entries: [rights(1)] }, baseline: "seeded", policy: trusted }).score, 100);
  assert.equal(evaluate({ classification: { kind: "decoded", entries: [rights(1)] }, baseline: "seeded", policy: { [addr(1)]: { sources: ["arkiv_observation"] } } }).score, 35);
  assert.equal(evaluate({ classification: { kind: "opaque", entries: [], cap: 65 }, baseline: "seeded" }).score, 65);
  assert.equal(evaluate({ classification: { kind: "malformed", entries: [], cap: 35 }, baseline: "seeded" }).score, 35);
});

test("snapshot trust is limited to the roles explicitly assigned to each source", () => {
  const policy = { [addr(1)]: { sources: ["snapshot"], rolesBySource: { snapshot: ["called", "token"] } } };
  assert.equal(evaluate({ classification: { kind: "decoded", entries: [{ address: addr(1), role: "called" }] }, baseline: "seeded", policy }).verdict, "green");
  assert.equal(evaluate({ classification: { kind: "decoded", entries: [rights(1)] }, baseline: "seeded", policy }).score, 35);
});

test("verified deployer lineage limits the request to amber without another applicable trust source", () => {
  const policy = { [addr(1)]: { sources: ["deployer_lineage"], rolesBySource: { deployer_lineage: ["rights", "called"] } } };
  const result = evaluate({ classification: { kind: "decoded", entries: [rights(1)] }, baseline: "seeded", policy });
  assert.equal(result.score, 65);
  assert.equal(result.verdict, "amber");
});

test("eth_sign remains escalated even when there is no baseline", () => {
  assert.deepEqual(evaluate({ classification: { kind: "escalated", cap: 0, label: "Blind signature" }, baseline: null }), {
    counterpartyRisk: false, verdict: "escalated", score: 0, coverage: "mediated", reasons: ["Blind signature"]
  });
});

test("same address only trusts the site-chain policy that names it", () => {
  const classification = { kind: "decoded", entries: [rights(7)] };
  const matching = { [addr(7)]: { sources: ["snapshot"] } };
  assert.equal(evaluate({ classification, baseline: "seeded", policy: matching }).verdict, "green");
  assert.equal(evaluate({ classification, baseline: "seeded", policy: {} }).score, 35);
});

test("normal DEX opaque calldata with heuristic hits remains amber even when addresses are trusted", () => {
  const decoded = classifyRequest(benignDexRequest);
  assert.equal(decoded.kind, "opaque");
  const policy = Object.fromEntries(decoded.entries.map((entry) => [entry.address, { sources: ["snapshot"] }]));
  const result = evaluate({
    classification: decoded,
    baseline: "seeded",
    policy,
    signerAccounts: ["0x1111111111111111111111111111111111111111"]
  });
  assert.equal(result.verdict, "amber");
});

test("trusted router calldata without heuristic address hits stays green", () => {
  const classification = classifyRequest({ method: "eth_sendTransaction", params: [{ to: addr(1), data: `0xdeadbeef${"0".repeat(63)}1` }] });
  assert.equal(evaluate({ classification, baseline: "seeded", policy: { [addr(1)]: { sources: ["snapshot"] } } }).verdict, "green");
});


test("counterparty risk follows verified roles and applicable trust without changing scores", () => {
  const run = (role, extra = {}) => evaluate({classification:{kind:"decoded", entries:[{address:addr(1),role}]},baseline:"seeded",policy:{},...extra});
  for (const role of ["called", "destination"]) { const result = run(role); assert.equal(result.counterpartyRisk,true); assert.equal(result.score,65); assert.equal(result.verdict,"amber"); }
  for (const role of ["token","unknown"]) assert.equal(run(role).counterpartyRisk,false);
  assert.equal(run("destination",{signerAccounts:[addr(1)]}).counterpartyRisk,false);
  const policy = { [addr(1)]: {sources:["snapshot"],rolesBySource:{snapshot:["called"]}} };
  assert.equal(run("called",{policy}).counterpartyRisk,false);
  assert.equal(run("rights",{policy}).counterpartyRisk,true);
  assert.equal(run("rights",{policy:{[addr(1)]:{sources:["deployer_lineage"]}}}).counterpartyRisk,false);
  assert.equal(run("called",{classification:{kind:"decoded",entries:[{address:addr(1),role:"called",verified:false}]}}).counterpartyRisk,false);
  assert.equal(run("called",{baseline:null}).counterpartyRisk,false);
  assert.equal(run("called",{policy:null}).counterpartyRisk,false);
  for (const kind of ["unsupported","escalated"]) assert.equal(run("called",{classification:{kind}}).counterpartyRisk,false);
});
