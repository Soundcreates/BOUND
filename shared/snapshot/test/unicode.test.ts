import { test } from "node:test";
import { strict as assert } from "node:assert";
import { isWellFormedUnicode } from "../src/unicode.ts";
import { canonicalize } from "../src/canonical.ts";
import { parseStrictJson } from "../src/strict-json.ts";

test("canonical and strict JSON reject unpaired surrogates without native isWellFormed", () => {
  assert.equal(isWellFormedUnicode("ok \ud83d\ude00"), true);
  for (const value of ["\ud800", "\udc00", "\ud800x", "x\udfff"]) {
    assert.equal(isWellFormedUnicode(value), false);
    assert.throws(() => canonicalize(value));
    assert.throws(() => parseStrictJson(JSON.stringify(value)));
  }
});
