import test from "node:test";
import assert from "node:assert/strict";
import { collectFrontendScripts } from "./frontend-collector.mjs";
import { hashInlineScript } from "./frontend-integrity.mjs";

test("collects inline and cached same-origin scripts without making network requests", async () => {
  const calls = [];
  const doc = { URL: "https://example.org/app", querySelectorAll: () => [
    { src: "", textContent: "abc" },
    { src: "https://example.org/app.js" },
    { src: "https://other.example/track.js" },
    { src: "https://example.org/private.js?token=secret" }
  ] };
  const result = await collectFrontendScripts(doc, { fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return new Response("abc", { status: 200 });
  } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.cache, "only-if-cached");
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(result.scripts.length, 2);
  assert.equal(result.scripts[0].hash, await hashInlineScript("abc"));
  assert.equal(result.scripts[1].hash, result.scripts[0].hash);
  assert.equal(result.unavailable, 2);
});
