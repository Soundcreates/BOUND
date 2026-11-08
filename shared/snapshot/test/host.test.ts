import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalizeHost, isCanonicalHost, siteKeyFromUrl, HostError } from "../src/host.ts";

test("canonicalizeHost lowercases and preserves non-default port", () => {
  assert.equal(canonicalizeHost("Swap.COW.fi"), "swap.cow.fi");
  assert.equal(canonicalizeHost("swap.cow.fi:8443"), "swap.cow.fi:8443");
  assert.equal(canonicalizeHost("swap.cow.fi:443"), "swap.cow.fi"); // default https port dropped by URL
});

test("rejects trailing-dot hosts", () => {
  assert.throws(() => canonicalizeHost("swap.cow.fi."), HostError);
});

test("rejects paths, credentials, query strings disguised as a host", () => {
  assert.throws(() => canonicalizeHost("swap.cow.fi/evil"), HostError);
  assert.throws(() => canonicalizeHost("user@swap.cow.fi"), HostError);
  assert.throws(() => canonicalizeHost("swap.cow.fi?x=1"), HostError);
});

test("no suffix matching: subdomain and suffix lookalikes are different hosts", () => {
  const a = canonicalizeHost("foo.swap.cow.fi");
  const b = canonicalizeHost("swap.cow.fi");
  const c = canonicalizeHost("cow.fi.evil.example");
  assert.notEqual(a, b);
  assert.notEqual(c, b);
});

test("IDNA: punycode and Unicode forms of the same host canonicalize identically", () => {
  // xn--... is the ASCII (punycode) form of a host with non-ASCII labels.
  const unicode = canonicalizeHost("münchen.example");
  const punycode = canonicalizeHost("xn--mnchen-3ya.example");
  assert.equal(unicode, punycode);
});

test("siteKeyFromUrl requires https", () => {
  assert.throws(() => siteKeyFromUrl("http://swap.cow.fi/"), HostError);
  assert.equal(siteKeyFromUrl("https://swap.cow.fi/app?x=1"), "swap.cow.fi");
});

test("isCanonicalHost round-trips canonical forms only", () => {
  assert.equal(isCanonicalHost("swap.cow.fi"), true);
  assert.equal(isCanonicalHost("Swap.cow.fi"), false);
  assert.equal(isCanonicalHost("swap.cow.fi."), false);
});
