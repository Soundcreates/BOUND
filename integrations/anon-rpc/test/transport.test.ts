import { test } from "node:test";
import assert from "node:assert/strict";
import { createAnonRpcProvider, JsonRpcError, type AnonFetchLike } from "../src/transport.ts";
import { AnonRpcTelemetry } from "../src/telemetry.ts";

function fakeAnonFetchReturning(result: unknown): AnonFetchLike {
  return async () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), { status: 200 });
}

test("request() posts a JSON-RPC envelope and returns the result", async () => {
  let captured: { url: string; body: unknown } | undefined;
  const anonFetch: AnonFetchLike = async (input, init) => {
    captured = { url: String(input), body: JSON.parse(String(init?.body)) };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x10" }), { status: 200 });
  };
  const provider = createAnonRpcProvider(anonFetch, "https://worker-rpc.example");
  const result = await provider.request({ method: "eth_blockNumber", params: [] });
  assert.equal(result, "0x10");
  assert.equal(captured?.url, "https://worker-rpc.example");
  assert.equal((captured?.body as { method: string }).method, "eth_blockNumber");
});

test("request() rejects with JsonRpcError on a non-ok HTTP response", async () => {
  const anonFetch: AnonFetchLike = async () => new Response("nope", { status: 503 });
  const provider = createAnonRpcProvider(anonFetch, "https://worker-rpc.example");
  await assert.rejects(() => provider.request({ method: "eth_chainId" }), JsonRpcError);
});

test("request() rejects with JsonRpcError on a JSON-RPC error body", async () => {
  const anonFetch: AnonFetchLike = async () =>
    new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "execution reverted" } }), {
      status: 200,
    });
  const provider = createAnonRpcProvider(anonFetch, "https://worker-rpc.example");
  await assert.rejects(() => provider.request({ method: "eth_call" }), /execution reverted/);
});

test("request() rejects promptly with JsonRpcError when the budget expires, instead of hanging", async () => {
  const anonFetch: AnonFetchLike = () =>
    new Promise((resolve) => {
      setTimeout(() => resolve(new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "late" }), { status: 200 })), 500);
    });
  const provider = createAnonRpcProvider(anonFetch, "https://worker-rpc.example", { budgetMs: 20 });
  const t0 = Date.now();
  await assert.rejects(() => provider.request({ method: "eth_getBalance" }), JsonRpcError);
  assert.ok(Date.now() - t0 < 200, "should reject near the 20ms budget, not wait the full 500ms");
});

test("request() records every attempt to the supplied telemetry instance", async () => {
  const telemetry = new AnonRpcTelemetry();
  const provider = createAnonRpcProvider(fakeAnonFetchReturning("0x1"), "https://worker-rpc.example", { telemetry });
  await provider.request({ method: "eth_chainId" });
  await provider.request({ method: "eth_chainId" });
  const snap = telemetry.snapshot();
  assert.equal(snap.attempts, 2);
  assert.equal(snap.successes, 2);
});

test("request() rejects with JsonRpcError on a malformed (non-object) response body", async () => {
  const anonFetch: AnonFetchLike = async () => new Response("null", { status: 200 });
  const provider = createAnonRpcProvider(anonFetch, "https://worker-rpc.example");
  await assert.rejects(() => provider.request({ method: "eth_chainId" }), JsonRpcError);
});
