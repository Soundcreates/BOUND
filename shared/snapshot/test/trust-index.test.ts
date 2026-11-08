import { test } from "node:test";
import assert from "node:assert/strict";
import { TrustIndex, capFor, type AddressTrust, type Role } from "../src/trust-index.ts";
import { baseInput, CURATOR_SITE, CURATOR_RELAYER, ATTACKER } from "./fixtures.ts";
import { buildSnapshot } from "../src/compiler.ts";

const CHAIN = "11155111";

function trust(addr: `0x${string}`, trusted: boolean, sources: AddressTrust["sources"] = []): AddressTrust {
  return { address: addr, trusted, sources: trusted ? (sources.length ? sources : ["snapshot"]) : [] };
}

test("TrustIndex.lookup finds the seeded relayer and not the attacker", () => {
  const snapshot = buildSnapshot(baseInput());
  const idx = new TrustIndex(snapshot);
  assert.equal(idx.lookup(CURATOR_SITE, CHAIN, CURATOR_RELAYER).trusted, true);
  assert.equal(idx.lookup(CURATOR_SITE, CHAIN, ATTACKER).trusted, false);
  assert.equal(idx.hasBaseline(CURATOR_SITE, CHAIN), true);
  assert.equal(idx.hasBaseline("unseeded.example", CHAIN), false);
});

test("trust is per (site, chain): same address on another chain starts untrusted", () => {
  const snapshot = buildSnapshot(baseInput());
  const idx = new TrustIndex(snapshot);
  assert.equal(idx.lookup(CURATOR_SITE, "1", CURATOR_RELAYER).trusted, false);
});

// ---- §9.3 cap matrix -------------------------------------------------------------------

function cap(opts: {
  hasBaseline?: boolean;
  tagged?: Array<{ role: Role; trust: AddressTrust }>;
  drift?: boolean;
  uncurated?: boolean;
  witnessed?: boolean;
  ownAccount?: (a: string) => boolean;
  destNotFixed?: boolean;
}) {
  return capFor({
    hasBaseline: opts.hasBaseline ?? true,
    taggedAddresses: opts.tagged ?? [],
    corroboratedDrift: opts.drift ?? false,
    uncurated: { isUncurated: opts.uncurated ?? false, anyWitnessed: opts.witnessed ?? false },
    isSignerOwnAccount: (a) => opts.ownAccount?.(a) ?? false,
    destinationNotFixedBySignature: opts.destNotFixed ?? false,
  });
}

test("real relayer on a seeded site: every role trusted -> no cap", () => {
  const r = cap({ tagged: [{ role: "rights", trust: trust(CURATOR_RELAYER, true) }] });
  assert.equal(r.cap, 100);
});

test("drainer deployed and verified weeks early: untrusted rights role on seeded site -> capped 35", () => {
  const r = cap({ tagged: [{ role: "rights", trust: trust(ATTACKER, false) }] });
  assert.equal(r.cap, 35);
  assert.equal(r.reason, "untrusted-rights-seeded");
});

test("same drainer with 500 fake witnesses: witnesses never lift the cap on a seeded site", () => {
  // witnessed/uncurated flags are irrelevant once the site IS curated (hasBaseline true,
  // uncurated:false) — the seeded cap rule applies regardless.
  const r = cap({ tagged: [{ role: "rights", trust: trust(ATTACKER, false) }], uncurated: false, witnessed: true });
  assert.equal(r.cap, 35);
});

test("same drainer with corroborated cert change: cap drops from 35 to 15", () => {
  const r = cap({ tagged: [{ role: "rights", trust: trust(ATTACKER, false) }], drift: true });
  assert.equal(r.cap, 15);
});

test("real router, output address changed to attacker: untrusted destination -> capped 65, not the signer's own", () => {
  const r = cap({ tagged: [{ role: "destination", trust: trust(ATTACKER, false) }], ownAccount: () => false });
  assert.equal(r.cap, 65);
  assert.equal(r.reason, "untrusted-destination");
});

test("destination equal to the signer's own account restricts nothing", () => {
  const r = cap({ tagged: [{ role: "destination", trust: trust(ATTACKER, false) }], ownAccount: (a) => a === ATTACKER });
  assert.equal(r.cap, 100);
});

test("uncurated site, witnessed untrusted address -> capped 65", () => {
  const r = cap({ hasBaseline: true, uncurated: true, witnessed: true, tagged: [{ role: "rights", trust: trust(ATTACKER, false) }] });
  assert.equal(r.cap, 65);
  assert.equal(r.reason, "uncurated-witnessed");
});

test("uncurated site, unwitnessed untrusted address -> capped 35, or 15 with drift", () => {
  const r1 = cap({ hasBaseline: true, uncurated: true, witnessed: false, tagged: [{ role: "rights", trust: trust(ATTACKER, false) }] });
  assert.equal(r1.cap, 35);
  const r2 = cap({ hasBaseline: true, uncurated: true, witnessed: false, drift: true, tagged: [{ role: "rights", trust: trust(ATTACKER, false) }] });
  assert.equal(r2.cap, 15);
});

test("no baseline at all is treated as the most restrictive uncurated case if reached (grey is decided upstream)", () => {
  const r = cap({ hasBaseline: false, witnessed: false });
  assert.equal(r.cap, 35);
});

test("Permit2 SignatureTransfer: destination-not-fixed caps at 65 regardless of tagged roles", () => {
  const r = cap({ destNotFixed: true, tagged: [{ role: "rights", trust: trust(CURATOR_RELAYER, true) }] });
  assert.equal(r.cap, 65);
  assert.equal(r.reason, "destination-not-fixed");
});

test("mixed roles: the most restrictive applicable cap wins", () => {
  const r = cap({
    tagged: [
      { role: "destination", trust: trust(ATTACKER, false) }, // would cap 65
      { role: "rights", trust: trust(ATTACKER, false) }, // caps 35, more restrictive
    ],
  });
  assert.equal(r.cap, 35);
});

test("a trusted rights-role address alongside an untrusted destination still caps at 65 (false-hold guard)", () => {
  // Regression for the "normal DEX flow" false-hold fixture the plan calls for: a benign
  // request where the spender is trusted but, say, a change-receiver is not should amber,
  // not red — i.e. the trusted address must not count toward the untrusted-rights cap.
  const r = cap({
    tagged: [
      { role: "rights", trust: trust(CURATOR_RELAYER, true) },
      { role: "destination", trust: trust(ATTACKER, false) },
    ],
  });
  assert.equal(r.cap, 65);
});
