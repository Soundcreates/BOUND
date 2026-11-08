import test from "node:test";
import assert from "node:assert/strict";
import { hashInlineScript, hashScript, compareScripts } from "./frontend-integrity.mjs";

test("script hashing uses SHA-256 of the exact UTF-8 bytes", async () => {
  assert.equal(await hashInlineScript("abc"), "sha256-ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=");
  await assert.rejects(hashScript(new Uint8Array(5), { maxBytes: 4 }), /too large/);
});

test("comparison requires complete evidence and reports differing or unlisted scripts", async () => {
  const hash = await hashInlineScript("abc"), other = await hashInlineScript("other");
  const expected = { "/app.js": hash };
  assert.equal(compareScripts({ expected, observed: [{ path: "/app.js", hash }], complete: true }).status, "matched");
  assert.equal(compareScripts({ expected, observed: [{ path: "/app.js", hash }], complete: false }).status, "unknown");
  assert.deepEqual(compareScripts({ expected, observed: [{ path: "/app.js", hash: other }], complete: false }), { status: "mismatch", mismatches: ["/app.js"] });
  assert.equal(compareScripts({ expected, observed: [], complete: true }).status, "unknown");
  assert.equal(compareScripts({ expected: { "//other/app.js": hash }, observed: [], complete: true }).status, "unknown");
});
