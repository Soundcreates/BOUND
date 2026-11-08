import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak_256 } from "@noble/hashes/sha3";
import {
  isContract,
  readImplementationSlot,
  readAdminSlot,
  implementationChanged,
  getTransactionCount,
  ChainReadError,
  EIP1967_IMPLEMENTATION_SLOT,
  EIP1967_ADMIN_SLOT,
} from "../src/chain-facts.ts";
import type { RpcProvider } from "../src/transport.ts";

function independentSlotHex(label: string): string {
  const hash = keccak_256(new TextEncoder().encode(label));
  const n = BigInt("0x" + Buffer.from(hash).toString("hex")) - 1n;
  return "0x" + n.toString(16).padStart(64, "0");
}

function providerReturning(fn: (method: string, params: unknown[]) => unknown): RpcProvider {
  return { request: async ({ method, params }) => fn(method, params ?? []) };
}

test("EIP1967 slot constants match an independently recomputed keccak256(label) - 1", () => {
  assert.equal(EIP1967_IMPLEMENTATION_SLOT, independentSlotHex("eip1967.proxy.implementation"));
  assert.equal(EIP1967_ADMIN_SLOT, independentSlotHex("eip1967.proxy.admin"));
});

test("isContract returns true for non-empty code and false for 0x", async () => {
  const withCode = providerReturning(() => "0x6080604052");
  assert.equal(await isContract(withCode, "0x1111111111111111111111111111111111111111"), true);
  const noCode = providerReturning(() => "0x");
  assert.equal(await isContract(noCode, "0x1111111111111111111111111111111111111111"), false);
});

test("isContract rejects a malformed address before calling the provider", async () => {
  await assert.rejects(() => isContract(providerReturning(() => "0x"), "not-an-address"), TypeError);
});

test("readImplementationSlot decodes the trailing 20 bytes of the slot value", async () => {
  const implAddr = "0x" + "ab".repeat(20);
  const slotValue = "0x" + "00".repeat(12) + "ab".repeat(20);
  const provider = providerReturning((method, params) => {
    assert.equal(method, "eth_getStorageAt");
    assert.equal(params[1], EIP1967_IMPLEMENTATION_SLOT);
    return slotValue;
  });
  const result = await readImplementationSlot(provider, "0x1111111111111111111111111111111111111111");
  assert.equal(result, implAddr);
});

test("readImplementationSlot returns undefined for an all-zero slot (not a proxy via this slot)", async () => {
  const provider = providerReturning(() => "0x" + "00".repeat(32));
  const result = await readImplementationSlot(provider, "0x1111111111111111111111111111111111111111");
  assert.equal(result, undefined);
});

test("readImplementationSlot throws ChainReadError on a malformed slot value", async () => {
  const provider = providerReturning(() => "not-32-bytes");
  await assert.rejects(() => readImplementationSlot(provider, "0x1111111111111111111111111111111111111111"), ChainReadError);
});

test("readAdminSlot reads the EIP1967 admin slot specifically", async () => {
  let seenSlot: unknown;
  const provider = providerReturning((_method, params) => {
    seenSlot = params[1];
    return "0x" + "00".repeat(32);
  });
  await readAdminSlot(provider, "0x1111111111111111111111111111111111111111");
  assert.equal(seenSlot, EIP1967_ADMIN_SLOT);
});

test("implementationChanged is false when either side is undefined (not-a-proxy, not a change)", () => {
  const a = ("0x" + "aa".repeat(20)) as `0x${string}`;
  assert.equal(implementationChanged(undefined, a), false);
  assert.equal(implementationChanged(a, undefined), false);
  assert.equal(implementationChanged(undefined, undefined), false);
});

test("implementationChanged is case-insensitive and detects a real change", () => {
  const a = ("0x" + "aa".repeat(20)) as `0x${string}`;
  const aUpper = ("0x" + "AA".repeat(20)) as `0x${string}`;
  const b = ("0x" + "bb".repeat(20)) as `0x${string}`;
  assert.equal(implementationChanged(a, aUpper), false);
  assert.equal(implementationChanged(a, b), true);
});

test("getTransactionCount parses a hex nonce into a bigint", async () => {
  const provider = providerReturning(() => "0x2a");
  assert.equal(await getTransactionCount(provider, "0x1111111111111111111111111111111111111111"), 42n);
});

test("getTransactionCount throws ChainReadError on a non-hex result", async () => {
  const provider = providerReturning(() => "not-hex");
  await assert.rejects(() => getTransactionCount(provider, "0x1111111111111111111111111111111111111111"), ChainReadError);
});
