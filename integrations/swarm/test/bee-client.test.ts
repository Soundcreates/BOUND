import { test } from "node:test";
import assert from "node:assert/strict";
import { uploadBytes, downloadBytes, uploadAndSelfVerify, BeeUploadError, BeeDownloadError } from "../src/bee-client.ts";

const BATCH_ID = "ab".repeat(32);
const REF = "cd".repeat(32);

function withFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

test("uploadBytes posts to /bytes with the postage header and returns the reference", async () => {
  let capturedHeaders: Headers | undefined;
  let capturedUrl: string | undefined;
  await withFetch(
    (async (url: string | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ reference: REF }), { status: 201 });
    }) as typeof fetch,
    async () => {
      const ref = await uploadBytes({ apiUrl: "https://bee.example", batchId: BATCH_ID }, new Uint8Array([1, 2, 3]));
      assert.equal(ref, REF);
    },
  );
  assert.equal(capturedUrl, "https://bee.example/bytes");
  assert.equal(capturedHeaders?.get("swarm-postage-batch-id"), BATCH_ID);
});

test("uploadBytes rejects a bad postage batch id before making any request", async () => {
  await assert.rejects(
    () => uploadBytes({ apiUrl: "https://bee.example", batchId: "not-a-batch-id" }, new Uint8Array([1])),
    TypeError,
  );
});

test("uploadBytes throws BeeUploadError on a non-ok response", async () => {
  await withFetch(
    (async () => new Response("server exploded", { status: 500 })) as typeof fetch,
    () => assert.rejects(() => uploadBytes({ apiUrl: "https://bee.example", batchId: BATCH_ID }, new Uint8Array([1])), BeeUploadError),
  );
});

test("uploadBytes throws BeeUploadError if the response reference is malformed", async () => {
  await withFetch(
    (async () => new Response(JSON.stringify({ reference: "short" }), { status: 201 })) as typeof fetch,
    () => assert.rejects(() => uploadBytes({ apiUrl: "https://bee.example", batchId: BATCH_ID }, new Uint8Array([1])), BeeUploadError),
  );
});

test("downloadBytes fetches /bytes/:reference and returns the raw bytes", async () => {
  const payload = new Uint8Array([9, 8, 7, 6]);
  let capturedUrl: string | undefined;
  const bytes = await withFetch(
    (async (url: string | URL) => {
      capturedUrl = String(url);
      return new Response(payload, { status: 200 });
    }) as typeof fetch,
    () => downloadBytes("https://gw.example/", REF),
  );
  assert.equal(capturedUrl, `https://gw.example/bytes/${REF}`);
  assert.deepEqual([...bytes], [...payload]);
});

test("downloadBytes throws BeeDownloadError on a non-ok response", async () => {
  await withFetch(
    (async () => new Response("not found", { status: 404 })) as typeof fetch,
    () => assert.rejects(() => downloadBytes("https://gw.example", REF), BeeDownloadError),
  );
});

test("uploadAndSelfVerify succeeds when the round-tripped bytes match", async () => {
  const sent = new Uint8Array([1, 2, 3, 4]);
  await withFetch(
    (async (url: string | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ reference: REF }), { status: 201 });
      }
      return new Response(sent, { status: 200 });
    }) as typeof fetch,
    async () => {
      const ref = await uploadAndSelfVerify({ apiUrl: "https://bee.example", batchId: BATCH_ID }, sent);
      assert.equal(ref, REF);
    },
  );
});

test("uploadAndSelfVerify throws if the round-tripped bytes do not match what was sent", async () => {
  const sent = new Uint8Array([1, 2, 3, 4]);
  const corrupted = new Uint8Array([1, 2, 3, 5]);
  await withFetch(
    (async (url: string | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ reference: REF }), { status: 201 });
      }
      return new Response(corrupted, { status: 200 });
    }) as typeof fetch,
    () => assert.rejects(() => uploadAndSelfVerify({ apiUrl: "https://bee.example", batchId: BATCH_ID }, sent), BeeUploadError),
  );
});
