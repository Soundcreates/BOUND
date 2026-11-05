/**
 * CREATE-address derivation: address = keccak256(rlp([sender, nonce]))[12:].
 *
 * This is how BOUND proves deployer lineage WITHOUT trusting an explorer's "creator" field
 * (plan §3: "do not assume standard signing-time JSON-RPC exposes a deployer"):
 *  - at curation time, a deployer entry must name a trusted contract and the nonce that
 *    produced it; the validator re-derives the address offline;
 *  - at signing time, an unknown address A is "from trusted deployer D" iff some nonce
 *    n < eth_getTransactionCount(D) gives createAddress(D, n) == A and A has code.
 * CREATE2 lineage is intentionally NOT supported (plan §Phase 1 Dev 2).
 */
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes, type Address } from "./hex.ts";

function rlpNonce(nonce: bigint): Uint8Array {
  if (nonce < 0n) throw new RangeError("nonce must be non-negative");
  if (nonce === 0n) return Uint8Array.of(0x80);
  if (nonce < 0x80n) return Uint8Array.of(Number(nonce));
  const bytes: number[] = [];
  let n = nonce;
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  if (bytes.length > 8) throw new RangeError("nonce exceeds 2^64-1");
  return Uint8Array.of(0x80 + bytes.length, ...bytes);
}

export function createAddress(sender: Address, nonce: bigint | number): Address {
  const s = hexToBytes(sender);
  if (s.length !== 20) throw new TypeError("sender must be 20 bytes");
  const n = rlpNonce(BigInt(nonce));
  const payloadLen = 1 + 20 + n.length;
  const buf = new Uint8Array(1 + payloadLen);
  buf[0] = 0xc0 + payloadLen;
  buf[1] = 0x94;
  buf.set(s, 2);
  buf.set(n, 22);
  return `0x${bytesToHex(keccak_256(buf).slice(12))}` as Address;
}

/**
 * Search nonces [0, nonceCount) of `deployer` for `target`. Bounded so a deployer with a
 * huge nonce cannot turn a signing-time check into a CPU sink; the caller treats
 * "bound exceeded" as "lineage not established", never as trusted.
 */
export function findCreateNonce(
  deployer: Address,
  target: Address,
  nonceCount: bigint,
  maxNonces = 20_000,
): { found: true; nonce: number } | { found: false; reason: "not-found" | "bound-exceeded" } {
  // Search the most recent nonces first: a new contract from a known deployer is the
  // case lineage exists for (arch §9.6 "Router v2 from CoW's usual deployer").
  const count = nonceCount;
  const start = count > BigInt(maxNonces) ? count - BigInt(maxNonces) : 0n;
  for (let n = count - 1n; n >= start; n--) {
    if (createAddress(deployer, n) === target) return { found: true, nonce: Number(n) };
  }
  return { found: false, reason: start > 0n ? "bound-exceeded" : "not-found" };
}
