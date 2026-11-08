import { test } from "node:test";
import assert from "node:assert/strict";
import { isPostageBatchId, assertPostageBatchId, parsePostageBatchStatus, assertUsablePostageBatch, PostageBatchError } from "../src/postage.ts";

test("isPostageBatchId accepts 64-char hex IDs in either case", () => {
  const good = "ab".repeat(32);
  assert.equal(isPostageBatchId(good), true);
  assert.equal(isPostageBatchId("0x" + good), false);
  assert.equal(isPostageBatchId(good.toUpperCase()), true);
  assert.equal(isPostageBatchId(good.slice(0, 63)), false);
  assert.equal(isPostageBatchId(123), false);
});

test("assertPostageBatchId throws with context on a bad id", () => {
  assert.throws(() => assertPostageBatchId("nope", "test-ctx"), /test-ctx/);
});

test("parsePostageBatchStatus validates and narrows a well-formed body", () => {
  const body = {
    batchID: "ab".repeat(32),
    exists: true,
    usable: true,
    utilization: 3,
    depth: 20,
    bucketDepth: 16,
    amount: "1000000000",
    batchTTL: 86400,
    immutableFlag: false,
  };
  const status = parsePostageBatchStatus(body);
  assert.equal(status.batchID, body.batchID);
  assert.equal(status.usable, true);
  assert.equal(status.depth, 20);
});

test("parsePostageBatchStatus rejects a body missing required fields", () => {
  assert.throws(() => parsePostageBatchStatus({ batchID: "x" }), TypeError);
  assert.throws(() => parsePostageBatchStatus(null), TypeError);
  assert.throws(() => parsePostageBatchStatus("not an object"), TypeError);
});

test("assertUsablePostageBatch throws PostageBatchError when exists=false", async () => {
  const batchId = "cd".repeat(32);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        batchID: batchId,
        exists: false,
        usable: false,
        utilization: 0,
        depth: 0,
        bucketDepth: 0,
        amount: "0",
        batchTTL: 0,
        immutableFlag: false,
      }),
      { status: 200 },
    )) as typeof fetch;
  try {
    await assert.rejects(() => assertUsablePostageBatch("https://bee.example", batchId), PostageBatchError);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("assertUsablePostageBatch throws PostageBatchError when usable=false", async () => {
  const batchId = "ef".repeat(32);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        batchID: batchId,
        exists: true,
        usable: false,
        utilization: 5,
        depth: 20,
        bucketDepth: 16,
        amount: "123",
        batchTTL: 86400,
        immutableFlag: false,
      }),
      { status: 200 },
    )) as typeof fetch;
  try {
    await assert.rejects(() => assertUsablePostageBatch("https://bee.example", batchId), PostageBatchError);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("assertUsablePostageBatch resolves with status when usable", async () => {
  const batchId = "11".repeat(32);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        batchID: batchId,
        exists: true,
        usable: true,
        utilization: 1,
        depth: 22,
        bucketDepth: 16,
        amount: "999",
        batchTTL: 86400,
        immutableFlag: false,
      }),
      { status: 200 },
    )) as typeof fetch;
  try {
    const status = await assertUsablePostageBatch("https://bee.example/", batchId);
    assert.equal(status.usable, true);
    assert.equal(status.depth, 22);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
