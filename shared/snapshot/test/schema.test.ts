import { test } from "node:test";
import assert from "node:assert/strict";
import { parseStrictJson } from "../src/strict-json.ts";
import { validateSnapshot, SchemaError } from "../src/schema.ts";
import { baseSnapshot, baseInput, CURATOR_SITE, CURATOR_RELAYER } from "./fixtures.ts";
import { compileSnapshot } from "../src/compiler.ts";
import { decodeSnapshotBytes } from "../src/digest.ts";

test("a well-formed snapshot round-trips through compile -> decode", () => {
  const { bytes, snapshot } = compileSnapshot(baseInput());
  const decoded = decodeSnapshotBytes(bytes);
  assert.deepEqual(decoded.snapshot, snapshot);
});

test("rejects unknown top-level fields", () => {
  const draft = JSON.parse(JSON.stringify(baseSnapshot())) as Record<string, unknown>;
  draft.extra = "nope";
  assert.throws(() => validateSnapshot(parseStrictJson(JSON.stringify(draft))), SchemaError);
});

test("rejects a site-chain entry that trusts nothing", () => {
  const draft = JSON.parse(JSON.stringify(baseSnapshot())) as any;
  draft.sites[CURATOR_SITE]["11155111"].trustedCounterparties = [];
  draft.sites[CURATOR_SITE]["11155111"].evidence = [];
  assert.throws(() => validateSnapshot(parseStrictJson(JSON.stringify(draft))), SchemaError);
});

test("rejects unsorted or duplicate address lists", () => {
  const draft = JSON.parse(JSON.stringify(baseSnapshot())) as any;
  draft.sites[CURATOR_SITE]["11155111"].trustedCounterparties = [CURATOR_RELAYER, CURATOR_RELAYER];
  assert.throws(() => validateSnapshot(parseStrictJson(JSON.stringify(draft))), SchemaError);
});

test("rejects mixed-case addresses", () => {
  const draft = JSON.parse(JSON.stringify(baseSnapshot())) as any;
  draft.sites[CURATOR_SITE]["11155111"].trustedCounterparties = [CURATOR_RELAYER.toUpperCase().replace("0X", "0x")];
  assert.throws(() => validateSnapshot(parseStrictJson(JSON.stringify(draft))), SchemaError);
});

test("rejects evidence for an address not in any trusted list (orphan evidence)", () => {
  const draft = JSON.parse(JSON.stringify(baseSnapshot())) as any;
  draft.sites[CURATOR_SITE]["11155111"].evidence.push({
    address: "0x9999999999999999999999999999999999999999",
    kind: "counterparty",
    sourceUrl: "https://example.com",
    eoa: true,
  });
  assert.throws(() => validateSnapshot(parseStrictJson(JSON.stringify(draft))), SchemaError);
});

test("rejects a trusted address with no evidence at all", () => {
  const draft = JSON.parse(JSON.stringify(baseSnapshot())) as any;
  draft.sites[CURATOR_SITE]["11155111"].trustedCounterparties.push("0x9999999999999999999999999999999999999999");
  assert.throws(() => validateSnapshot(parseStrictJson(JSON.stringify(draft))), SchemaError);
});

test("rejects contract evidence (codeHash required) submitted as an EOA", () => {
  const draft = JSON.parse(JSON.stringify(baseSnapshot())) as any;
  draft.sites[CURATOR_SITE]["11155111"].trustedContracts = ["0x9999999999999999999999999999999999999999"];
  draft.sites[CURATOR_SITE]["11155111"].evidence.push({
    address: "0x9999999999999999999999999999999999999999",
    kind: "contract",
    sourceUrl: "https://example.com",
    eoa: true,
  });
  assert.throws(() => validateSnapshot(parseStrictJson(JSON.stringify(draft))), SchemaError);
});

test("rejects deployer evidence whose nonce does not actually derive the claimed contract", () => {
  const draft = JSON.parse(JSON.stringify(baseSnapshot())) as any;
  const deployer = "0x3333333333333333333333333333333333333333";
  draft.sites[CURATOR_SITE]["11155111"].trustedContracts.push(CURATOR_RELAYER); // reuse as "deployed" target
  draft.sites[CURATOR_SITE]["11155111"].deployers = [deployer];
  draft.sites[CURATOR_SITE]["11155111"].evidence.push({
    address: deployer,
    kind: "deployer",
    sourceUrl: "https://example.com",
    deployedContract: CURATOR_RELAYER,
    createNonce: 999, // wrong on purpose
    creationTx: "0x".concat("11".repeat(32)),
  });
  assert.throws(() => validateSnapshot(parseStrictJson(JSON.stringify(draft))), SchemaError);
});

test("rejects a non-https evidence source URL", () => {
  const draft = JSON.parse(JSON.stringify(baseSnapshot())) as any;
  draft.sites[CURATOR_SITE]["11155111"].evidence[0].sourceUrl = "http://example.com";
  assert.throws(() => validateSnapshot(parseStrictJson(JSON.stringify(draft))), SchemaError);
});

test("rejects expiresAt before generatedAt, and a too-long validity window", () => {
  const draft = JSON.parse(JSON.stringify(baseSnapshot())) as any;
  draft.expiresAt = "2020-01-01T00:00:00Z";
  assert.throws(() => validateSnapshot(parseStrictJson(JSON.stringify(draft))), SchemaError);

  const draft2 = JSON.parse(JSON.stringify(baseSnapshot())) as any;
  draft2.expiresAt = "2030-01-01T00:00:00Z";
  assert.throws(() => validateSnapshot(parseStrictJson(JSON.stringify(draft2))), SchemaError);
});

test("rejects a non-canonical site host key (uppercase)", () => {
  const draft = JSON.parse(JSON.stringify(baseSnapshot())) as any;
  const entry = draft.sites[CURATOR_SITE];
  delete draft.sites[CURATOR_SITE];
  draft.sites["Swap.cow.fi"] = entry;
  assert.throws(() => validateSnapshot(parseStrictJson(JSON.stringify(draft))), SchemaError);
});

test("rejects an attestation binding to a non-ASCII-normalized-looking ENS name field shape", () => {
  const draft = JSON.parse(JSON.stringify(baseSnapshot())) as any;
  draft.sites[CURATOR_SITE]["11155111"].attestation = { name: "NOT-LOWERCASE.eth" };
  assert.throws(() => validateSnapshot(parseStrictJson(JSON.stringify(draft))), SchemaError);
});
