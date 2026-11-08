export type Hex = `0x${string}`;
export type Address = `0x${string}`;

const ADDRESS_RE = /^0x[0-9a-f]{40}$/;
const HEX32_RE = /^0x[0-9a-f]{64}$/;

/** Lowercase canonical address check. Mixed case is rejected in trust data, never "fixed". */
export function isCanonicalAddress(v: unknown): v is Address {
  return typeof v === "string" && ADDRESS_RE.test(v);
}

export function isHex32(v: unknown): v is Hex {
  return typeof v === "string" && HEX32_RE.test(v);
}

/** Normalize any-case address input (curator tooling only; never on trust-read paths). */
export function normalizeAddress(v: string): Address {
  const lower = v.toLowerCase();
  if (!ADDRESS_RE.test(lower)) throw new TypeError(`not an address: ${v}`);
  return lower as Address;
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i]!.toString(16).padStart(2, "0");
  return s;
}

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) throw new TypeError("invalid hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Strictly ascending (sorted, no duplicates) by JS string order. */
export function isStrictlySorted(arr: readonly string[]): boolean {
  for (let i = 1; i < arr.length; i++) if (!(arr[i - 1]! < arr[i]!)) return false;
  return true;
}
