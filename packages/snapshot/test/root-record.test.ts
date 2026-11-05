import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeRootRecord, parseRootRecord, encodeAttestation, parseAttestation } from "../src/root-record.ts";
import { SchemaError } from "../src/schema.ts";

const DIGEST = ("0x" + "ab".repeat(32)) as `0x${string}`;
const SWARM_REF = "cd".repeat(32);

test("root record round-trips through encode/parse", () => {
  const encoded = encodeRootRecord({ digest: DIGEST, epoch: 7, network: "sepolia", schemaVersion: 1, swarmRef: SWARM_REF });
  const parsed = parseRootRecord(encoded);
  assert.deepEqual(parsed, { digest: DIGEST, epoch: 7, network: "sepolia", schemaVersion: 1, swarmRef: SWARM_REF });
});

test("root record encoding is canonical (sorted keys, no whitespace)", () => {
  const encoded = encodeRootRecord({ digest: DIGEST, epoch: 7, network: "sepolia", schemaVersion: 1, swarmRef: SWARM_REF });
  assert.equal(encoded, `{"digest":"${DIGEST}","epoch":7,"network":"sepolia","schemaVersion":1,"swarmRef":"${SWARM_REF}"}`);
});

test("rejects an encrypted-looking Swarm reference (wrong length) and uppercase hex", () => {
  assert.throws(() => parseRootRecord(`{"digest":"${DIGEST}","epoch":1,"network":"sepolia","schemaVersion":1,"swarmRef":"deadbeef"}`), SchemaError);
  assert.throws(
    () => parseRootRecord(`{"digest":"${DIGEST}","epoch":1,"network":"sepolia","schemaVersion":1,"swarmRef":"${SWARM_REF.toUpperCase()}"}`),
    SchemaError,
  );
});

test("rejects unknown fields and missing fields", () => {
  assert.throws(() => parseRootRecord(`{"digest":"${DIGEST}","epoch":1,"network":"sepolia","schemaVersion":1,"swarmRef":"${SWARM_REF}","extra":1}`), SchemaError);
  assert.throws(() => parseRootRecord(`{"digest":"${DIGEST}","epoch":1,"network":"sepolia","schemaVersion":1}`), SchemaError);
});

test("rejects epoch 0 and non-integer epoch", () => {
  assert.throws(() => parseRootRecord(`{"digest":"${DIGEST}","epoch":0,"network":"sepolia","schemaVersion":1,"swarmRef":"${SWARM_REF}"}`), SchemaError);
});

test("attestation round-trips and rejects an expired-looking malformed timestamp", () => {
  const a = { schemaVersion: 1, site: "swap.cow.fi", addresses: { "1": ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] }, expiresAt: "2030-01-01T00:00:00Z" };
  const encoded = encodeAttestation(a);
  const parsed = parseAttestation(encoded);
  // parseAttestation returns a null-prototype `addresses` object (strict-json parsing
  // builds those to block prototype pollution); compare structurally, not by prototype.
  assert.equal(parsed.schemaVersion, a.schemaVersion);
  assert.equal(parsed.site, a.site);
  assert.equal(parsed.expiresAt, a.expiresAt);
  assert.deepEqual({ ...parsed.addresses }, a.addresses);
  assert.throws(() => parseAttestation(encoded.replace("2030-01-01T00:00:00Z", "not-a-date")), SchemaError);
});

test("attestation rejects a non-canonical site host", () => {
  const a = { schemaVersion: 1, site: "Swap.cow.fi", addresses: { "1": ["0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] }, expiresAt: "2030-01-01T00:00:00Z" };
  assert.throws(() => parseAttestation(encodeAttestation(a)), SchemaError);
});
