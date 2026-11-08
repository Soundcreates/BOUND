import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStrictJson, decodeUtf8Strict, StrictJsonError } from "../src/strict-json.ts";

test("rejects duplicate keys", () => {
  assert.throws(() => parseStrictJson('{"a":1,"a":2}'), StrictJsonError);
});

test("rejects trailing data", () => {
  assert.throws(() => parseStrictJson("{}  x"), StrictJsonError);
});

test("rejects floats and exponents", () => {
  assert.throws(() => parseStrictJson("1.5"), StrictJsonError);
  assert.throws(() => parseStrictJson("1e10"), StrictJsonError);
  assert.throws(() => parseStrictJson("-0"), StrictJsonError);
});

test("rejects non-exactly-representable integers", () => {
  assert.throws(() => parseStrictJson("9007199254740993"), StrictJsonError); // > 2^53
});

test("rejects nesting past the depth limit", () => {
  const deep = "[".repeat(50) + "]".repeat(50);
  assert.throws(() => parseStrictJson(deep, { maxDepth: 16, maxLength: 1e6, maxStringLength: 100 }), StrictJsonError);
});

test("rejects control characters and lone surrogates in strings", () => {
  assert.throws(() => parseStrictJson('"\u0001"'));
  assert.throws(() => parseStrictJson('"\\ud800"'));
});

test("accepts a well-formed object with sorted-looking but unsorted keys (parser does not sort)", () => {
  const v = parseStrictJson('{"b":1,"a":2}') as Record<string, number>;
  assert.equal(v.a, 2);
  assert.equal(v.b, 1);
});

test("__proto__ key does not pollute the prototype", () => {
  const v = parseStrictJson('{"__proto__":{"polluted":true}}') as Record<string, unknown>;
  assert.equal(Object.getPrototypeOf(v), null);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test("decodeUtf8Strict rejects invalid UTF-8 and BOM", () => {
  assert.throws(() => decodeUtf8Strict(Uint8Array.of(0xff, 0xfe)));
  assert.throws(() => decodeUtf8Strict(Uint8Array.of(0xef, 0xbb, 0xbf, 0x7b, 0x7d)));
});
