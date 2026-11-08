import { test } from "node:test";
import assert from "node:assert/strict";
import { isCanonicalSwarmRef, assertCanonicalSwarmRef, swarmGatewayUrl } from "../src/swarm-ref.ts";

test("accepts only 64 lowercase hex chars, no 0x prefix", () => {
  const good = "ab".repeat(32);
  assert.equal(isCanonicalSwarmRef(good), true);
  assert.equal(isCanonicalSwarmRef("0x" + good), false);
  assert.equal(isCanonicalSwarmRef(good.toUpperCase()), false);
  assert.equal(isCanonicalSwarmRef(good.slice(0, 63)), false);
});

test("swarmGatewayUrl builds a /bytes/<ref> URL and strips a trailing slash on the base", () => {
  const ref = "cd".repeat(32);
  assert.equal(swarmGatewayUrl("https://gw.example", ref), `https://gw.example/bytes/${ref}`);
  assert.equal(swarmGatewayUrl("https://gw.example/", ref), `https://gw.example/bytes/${ref}`);
});

test("assertCanonicalSwarmRef throws with context on a bad ref", () => {
  assert.throws(() => assertCanonicalSwarmRef("not-a-ref", "test"), /test/);
});
