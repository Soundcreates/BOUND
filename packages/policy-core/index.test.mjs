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
});

test("uncurated witness, signer-owned destination and drift rules", () => {
  assert.equal(evaluate({ classification: { kind: "decoded", entries: [rights(1)] }, baseline: "uncurated", witnessed: new Set([addr(1)]) }).score, 65);
  assert.equal(evaluate({ classification: { kind: "decoded", entries: [destination(1)] }, baseline: "uncurated", signerAccounts: [addr(1)] }).score, 100);
  assert.equal(evaluate({ classification: { kind: "decoded", entries: [destination(2)] }, baseline: "uncurated", drift: true }).score, 15);
});

test("only the four configured trust sources lift a cap; opaque and malformed stay capped", () => {
  const trusted = { [addr(1)]: { sources: ["snapshot"] } };
  assert.equal(evaluate({ classification: { kind: "decoded", entries: [rights(1)] }, baseline: "seeded", policy: trusted }).score, 100);
  assert.equal(evaluate({ classification: { kind: "decoded", entries: [rights(1)] }, baseline: "seeded", policy: { [addr(1)]: { sources: ["arkiv_observation"] } } }).score, 35);
  assert.equal(evaluate({ classification: { kind: "opaque", entries: [], cap: 65 }, baseline: "seeded" }).score, 65);
  assert.equal(evaluate({ classification: { kind: "malformed", entries: [], cap: 35 }, baseline: "seeded" }).score, 35);
});

test("eth_sign remains escalated even when there is no baseline", () => {
  assert.deepEqual(evaluate({ classification: { kind: "escalated", cap: 0, label: "Blind signature" }, baseline: null }), {
    verdict: "escalated", score: 0, coverage: "mediated", reasons: ["Blind signature"]
  });
});

test("same address only trusts the site-chain policy that names it", () => {
  const classification = { kind: "decoded", entries: [rights(7)] };
  const matching = { [addr(7)]: { sources: ["snapshot"] } };
  assert.equal(evaluate({ classification, baseline: "seeded", policy: matching }).verdict, "green");
  assert.equal(evaluate({ classification, baseline: "seeded", policy: {} }).score, 35);
});

test("normal DEX opaque calldata does not false-hold trusted path and signer recipient", () => {
  const decoded = classifyRequest(benignDexRequest);
  assert.equal(decoded.kind, "opaque");
  const policy = Object.fromEntries(decoded.entries.map((entry) => [entry.address, { sources: ["snapshot"] }]));
  const result = evaluate({
    classification: decoded,
    baseline: "seeded",
    policy,
    signerAccounts: ["0x1111111111111111111111111111111111111111"]
  });
  assert.equal(result.verdict, "green");
});
