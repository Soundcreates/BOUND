import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalize, canonicalBytes, keccak256Hex, rootDigest } from "../src/canonical.ts";

test("sorts object keys per RFC 8785", () => {
  assert.equal(canonicalize({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test("nested objects and arrays canonicalize deterministically regardless of input order", () => {
  const x = canonicalize({ z: [3, 2, 1], a: { d: 1, c: 2 } });
  const y = canonicalize({ a: { c: 2, d: 1 }, z: [3, 2, 1] });
  assert.equal(x, y);
  assert.equal(x, '{"a":{"c":2,"d":1},"z":[3,2,1]}');
});

test("rejects non-finite numbers and lone surrogates", () => {
  assert.throws(() => canonicalize({ a: NaN }));
  assert.throws(() => canonicalize({ a: Infinity }));
  assert.throws(() => canonicalize("\ud800"));
});

test("-0 canonicalizes to 0", () => {
  assert.equal(canonicalize(-0), "0");
});

test("rejects class instances (only plain objects/arrays/primitives)", () => {
  assert.throws(() => canonicalize(new Map()));
  assert.throws(() => canonicalize(new Date()));
});

test("keccak256 (not NIST SHA3-256) reference vector: keccak256('')", () => {
  // Ethereum uses Keccak-256, which differs from NIST SHA3-256 in its padding byte.
  // Using the wrong variant here would silently produce roots nothing on-chain agrees with.
  assert.equal(keccak256Hex(new Uint8Array(0)), "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
});

test("known-answer digest vector stays stable (regression guard)", () => {
  // Frozen vector: any change here is a breaking change to every published root record.
  const bytes = canonicalBytes({ epoch: 1, network: "sepolia" });
  assert.equal(new TextDecoder().decode(bytes), '{"epoch":1,"network":"sepolia"}');
  const digest = rootDigest(bytes);
  assert.equal(digest, keccak256Hex(bytes));
  assert.match(digest, /^0x[0-9a-f]{64}$/);
  // keccak256('{"epoch":1,"network":"sepolia"}'), computed once and pinned here so a future
  // hash-library swap (or accidental switch to sha3/other variant) is caught by CI.
  assert.equal(digest, "0xc7e61b2671a87f46d9df70c5c9cea6d02884c9b2c36f4112a902996422a2277f");
});
