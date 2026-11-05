/**
 * RFC 8785 JSON Canonicalization Scheme (JCS) and the BOUND root digest.
 *
 * Digest rule (plan §3, frozen): rootDigest = keccak256( UTF-8( JCS(snapshot) ) ).
 * The bytes stored on Swarm ARE the canonical bytes. Verifiers hash the raw bytes they
 * received and additionally require that those bytes are already canonical, so nobody
 * ever hashes a re-serialized object.
 */
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "./hex.ts";

/**
 * Serialize a JSON value per RFC 8785.
 * - Object keys sorted by UTF-16 code units (JS default string comparison).
 * - Strings serialized as ECMAScript JSON.stringify does (RFC 8785 §3.2.2.2).
 * - Numbers serialized as ECMAScript Number#toString (RFC 8785 §3.2.2.3); non-finite rejected.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      if (!value.isWellFormed()) throw new TypeError("lone surrogate cannot be canonicalized");
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) throw new TypeError("non-finite number cannot be canonicalized");
      if (Object.is(value, -0)) return "0";
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return "[" + value.map((v) => canonicalize(v)).join(",") + "]";
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== null && proto !== Object.prototype) {
        throw new TypeError("only plain objects can be canonicalized");
      }
      const keys = Object.keys(value as object).sort();
      const parts: string[] = [];
      for (const k of keys) {
        const v = (value as Record<string, unknown>)[k];
        if (v === undefined) throw new TypeError(`undefined value at key "${k}"`);
        parts.push(JSON.stringify(k) + ":" + canonicalize(v));
      }
      return "{" + parts.join(",") + "}";
    }
    default:
      throw new TypeError(`cannot canonicalize ${typeof value}`);
  }
}

const encoder = new TextEncoder();

export function canonicalBytes(value: unknown): Uint8Array {
  return encoder.encode(canonicalize(value));
}

export function keccak256Hex(bytes: Uint8Array): `0x${string}` {
  return `0x${bytesToHex(keccak_256(bytes))}`;
}

/** The BOUND root digest of already-canonical bytes. */
export function rootDigest(canonical: Uint8Array): `0x${string}` {
  return keccak256Hex(canonical);
}

/** Byte-exact equality; used to require that received bytes are already canonical. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
