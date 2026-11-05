import test from "node:test";
import assert from "node:assert/strict";
import { anonRpc } from "./anon-rpc-host.mjs";

test("offscreen adapter rejects write and unsupported RPC methods without a direct fallback", async () => {
  assert.deepEqual(await anonRpc({ method: "eth_sendTransaction", params: [] }), { error: "method_not_allowed" });
  assert.deepEqual(await anonRpc(null), { error: "method_not_allowed" });
});

test("allowed reads create the MV3 offscreen worker host and return its result", async () => {
  const calls = [];
  globalThis.chrome = {
    runtime: {
      getURL: (path) => `chrome-extension://test/${path}`,
      getContexts: async () => [],
      sendMessage: async (message) => ({ error: "anon_rpc_not_configured", method: message.request.method })
    },
    offscreen: { createDocument: async (options) => calls.push(options) }
  };
  try {
    assert.deepEqual(await anonRpc({ method: "eth_call", params: [] }), { error: "anon_rpc_not_configured", method: "eth_call" });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].reasons, ["WORKERS"]);
  } finally {
    delete globalThis.chrome;
  }
});
