import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeSnapshotBytes, SnapshotBytesError } from "../src/digest.ts";
import { compileSnapshot } from "../src/compiler.ts";
import { baseInput } from "./fixtures.ts";

test("decodeSnapshotBytes accepts canonical bytes and rejects re-serialized (non-canonical) bytes", () => {
  const { bytes } = compileSnapshot(baseInput());
  const decoded = decodeSnapshotBytes(bytes);
  assert.ok(decoded.digest.startsWith("0x"));

  // Simulate a gateway/serializer that re-emits equivalent but non-canonical JSON
  // (reordered keys, extra whitespace) — must be refused, not silently re-hashed.
  const text = new TextDecoder().decode(bytes);
  const reparsed = JSON.parse(text);
  const reserialized = new TextEncoder().encode(JSON.stringify(reparsed, null, 2));
  assert.throws(() => decodeSnapshotBytes(reserialized), SnapshotBytesError);
});

test("decodeSnapshotBytes rejects empty and oversized input", () => {
  assert.throws(() => decodeSnapshotBytes(new Uint8Array(0)), SnapshotBytesError);
  const huge = new Uint8Array(10);
  assert.throws(() => decodeSnapshotBytes(huge, 5), SnapshotBytesError);
});

test("decodeSnapshotBytes surfaces schema errors on malformed-but-valid-JSON input", () => {
  const bad = new TextEncoder().encode('{"not":"a snapshot"}');
  assert.throws(() => decodeSnapshotBytes(bad));
});

test("same logical snapshot compiles to byte-identical output across repeated calls (determinism)", () => {
  const a = compileSnapshot(baseInput());
  const b = compileSnapshot(baseInput());
  assert.deepEqual(a.bytes, b.bytes);
  assert.equal(a.digest, b.digest);
});
