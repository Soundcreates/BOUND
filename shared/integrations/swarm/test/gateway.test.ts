import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchFromGateways, GatewayFetchError, GatewayMismatchError } from "../src/gateway.ts";

const REF = "ab".repeat(32);

function withFetch<T>(impl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

test("fetchFromGateways rejects a bad reference before making any request", async () => {
  await assert.rejects(() => fetchFromGateways("not-a-ref", ["https://a.example", "https://b.example"]), TypeError);
});

test("fetchFromGateways requires at least minAgree URLs supplied", async () => {
  await assert.rejects(() => fetchFromGateways(REF, ["https://a.example"], { minAgree: 2 }), RangeError);
});

test("fetchFromGateways rejects gateway URLs sharing an origin, including path variants", async () => {
  await assert.rejects(() => fetchFromGateways(REF, ["https://a.example/one", "https://a.example/two"]), RangeError);
});

test("fetchFromGateways returns the bytes when all gateways agree", async () => {
  const agreed = new Uint8Array([1, 2, 3]);
  const bytes = await withFetch(
    (async () => new Response(agreed, { status: 200 })) as typeof fetch,
    () => fetchFromGateways(REF, ["https://a.example", "https://b.example", "https://c.example"]),
  );
  assert.deepEqual([...bytes], [...agreed]);
});

test("fetchFromGateways succeeds on 2-of-3 agreement when one gateway is down", async () => {
  const agreed = new Uint8Array([9, 9, 9]);
  let call = 0;
  const bytes = await withFetch(
    (async () => {
      call += 1;
      if (call === 1) return new Response("gateway timeout", { status: 504 });
      return new Response(agreed, { status: 200 });
    }) as typeof fetch,
    () => fetchFromGateways(REF, ["https://a.example", "https://b.example", "https://c.example"]),
  );
  assert.deepEqual([...bytes], [...agreed]);
});

test("fetchFromGateways throws GatewayFetchError when too many gateways fail", async () => {
  await withFetch(
    (async () => new Response("nope", { status: 500 })) as typeof fetch,
    () => assert.rejects(() => fetchFromGateways(REF, ["https://a.example", "https://b.example"]), GatewayFetchError),
  );
});

test("fetchFromGateways rejects redirects and does not count the redirecting gateway", async () => {
  const optionsSeen: RequestInit[] = [];
  const bytes = await withFetch(
    (async (_input, init) => {
      optionsSeen.push(init ?? {});
      if (optionsSeen.length === 1) throw new TypeError("redirect mode is error");
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    }) as typeof fetch,
    () => fetchFromGateways(REF, ["https://a.example", "https://b.example", "https://c.example"]),
  );
  assert.deepEqual([...bytes], [1, 2, 3]);
  assert.equal(optionsSeen.length, 3);
  assert.ok(optionsSeen.every((options) => options.redirect === "error"));
});

test("fetchFromGateways throws GatewayMismatchError when gateways disagree", async () => {
  let call = 0;
  await withFetch(
    (async () => {
      call += 1;
      return new Response(new Uint8Array([call]), { status: 200 });
    }) as typeof fetch,
    () => assert.rejects(() => fetchFromGateways(REF, ["https://a.example", "https://b.example"]), GatewayMismatchError),
  );
});

test("fetchFromGateways picks the majority group when 2 of 3 agree and 1 differs", async () => {
  const majority = new Uint8Array([7, 7, 7]);
  const minority = new Uint8Array([1, 1, 1]);
  let call = 0;
  const bytes = await withFetch(
    (async () => {
      call += 1;
      return new Response(call === 2 ? minority : majority, { status: 200 });
    }) as typeof fetch,
    () => fetchFromGateways(REF, ["https://a.example", "https://b.example", "https://c.example"], { minAgree: 2 }),
  );
  assert.deepEqual([...bytes], [...majority]);
});

test("fetchFromGateways enforces streamed size limit despite misleading content-length", async () => {
  const oversized = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); },
  }), { headers: { "content-length": "1" } });
  await withFetch((async () => oversized) as typeof fetch, () =>
    assert.rejects(() => fetchFromGateways(REF, ["https://a.example", "https://b.example"], { maxBytes: 2 }), GatewayFetchError));
});
