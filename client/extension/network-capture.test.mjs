import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createNetworkCapture, isCapturePage } from "./network-capture.mjs";

test("capture supports websites and local test pages, not browser internal pages", () => {
  assert.equal(isCapturePage("chrome://newtab"), false);
  assert.equal(isCapturePage("https://example.org"), true);
  assert.equal(isCapturePage("http://127.0.0.1:8000"), true);
  assert.equal(isCapturePage("http://example.org"), false);
});

test("captures actual source response hashes and only approved network metadata", async () => {
  let event, detach;
  const api = {
    onEvent: { addListener(fn) { event = fn; } }, onDetach: { addListener(fn) { detach = fn; } },
    async attach() {}, async detach() {},
    async sendCommand(_target, method) { return method === "Network.getResponseBody" ? { body: "abc", base64Encoded: false } : {}; }
  };
  const capture = createNetworkCapture({ api });
  await capture.start(4);
  event({ tabId: 4 }, "Network.requestWillBeSent", { requestId: "1", request: { method: "GET", url: "https://site.example/private?token=secret", headers: { Authorization: "secret" } } });
  event({ tabId: 4 }, "Network.responseReceived", { requestId: "1", type: "Script", response: { url: "https://site.example/private?token=secret", status: 200, headers: { "Content-Type": "text/javascript", "Set-Cookie": "secret", Authorization: "secret" } } });
  event({ tabId: 4 }, "Network.loadingFinished", { requestId: "1", encodedDataLength: 3 });
  await new Promise(resolve => setTimeout(resolve, 10));
  const [row] = capture.snapshot(4).rows;
  assert.equal(row.hash, "sha256-ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=");
  assert.equal(row.method, "GET"); assert.equal(row.origin, "https://site.example");
  assert.deepEqual({ ...row.headers }, { "content-type": "text/javascript" });
  const canonical = JSON.stringify(["bound-network-v1", "GET", "https://site.example", "Script", 200, [["content-type", "text/javascript"]]]);
  assert.equal(row.metadataHash, `sha256-${createHash("sha256").update(canonical).digest("base64")}`);
  assert.ok(!JSON.stringify(row).includes("secret"));
  capture.reset(4); assert.equal(capture.snapshot(4).rows.length, 0);
  detach({ tabId: 4 }); assert.equal(capture.snapshot(4).active, false);
});
