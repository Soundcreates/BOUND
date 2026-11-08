import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256, toHex } from "viem";
import { textPartHash, textResource, ROOT_RESOURCE, ROLE_SET_TEXT, adminOf } from "../src/roles.ts";

test("textPartHash matches keccak256(bytes(key)) per the post-audit-2 Resource Scheme table", () => {
  assert.equal(textPartHash("bound.root.v1"), keccak256(toHex("bound.root.v1")));
});

test("textResource is the bigint form of textPartHash — argument-scoped, NOT node-scoped", () => {
  assert.equal(textResource("bound.root.v1"), BigInt(textPartHash("bound.root.v1")));
});

test("different text keys produce different resources (no accidental key collision)", () => {
  assert.notEqual(textResource("bound.root.v1"), textResource("bound.attest.v1"));
});

test("textResource is never accidentally ROOT_RESOURCE", () => {
  assert.notEqual(textResource("bound.root.v1"), ROOT_RESOURCE);
});

test("adminOf shifts into the upper 128 bits, per role << 128", () => {
  assert.equal(adminOf(ROLE_SET_TEXT), ROLE_SET_TEXT << 128n);
  assert.notEqual(adminOf(ROLE_SET_TEXT) & ROLE_SET_TEXT, ROLE_SET_TEXT); // no overlap with the regular half
});
