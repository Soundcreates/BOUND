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
  assert.equal(result.scripts.length, 1);
  assert.equal(result.scripts[0].hash, await hashInlineScript("abc"));
  assert.equal(result.coverage.inlineExcluded, 1);
  assert.equal(result.coverage.crossOriginExcluded, 1);
  assert.equal(result.coverage.queryExcluded, 1);
});

test('caps at 32 and rejects private paths without fetching', async () => {
  let active=0, peak=0, calls=0;
  const doc={URL:'https://example.org/',querySelectorAll:()=>[
    {src:'https://example.org/0x1234567890123456789012345678901234567890.js'},
    ...Array.from({length:34},(_,i)=>({src:`https://example.org/${i}.js`}))
  ]};
  const result=await collectFrontendScripts(doc,{fetchImpl:async()=>{calls++; active++; peak=Math.max(peak,active); await new Promise(resolve=>setTimeout(resolve,1)); active--; return new Response('ok');}});
  assert.equal(result.coverage.total,35); assert.equal(result.coverage.overCap,3); assert.equal(result.coverage.privatePathExcluded,1); assert.equal(result.coverage.compared,31); assert.equal(calls,31); assert.ok(peak<=4);
});

test('deadline bounds a fetch that ignores abort', async () => {
  const doc={URL:'https://example.org/',querySelectorAll:()=>[{src:'https://example.org/app.js'}]};
  const result=await collectFrontendScripts(doc,{fetchImpl:()=>new Promise(()=>{})});
  assert.equal(result.coverage.unavailable,1);
});
