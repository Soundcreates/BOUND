/**
 * Chain-read primitives against the minimal `RpcProvider` shape (transport.ts), so every
 * read here works identically whether `provider` is a direct connection or one wrapped by
 * `createAnonRpcProvider`. BOUND's signing-time counterparty facts (arch §12.2) are read
 * through Anon-RPC specifically so no provider learns wallet + dApp + counterparty together;
 * these functions are what gets called with that provider, not a reason to use a different
 * one.
 *
 * Only reads used by the architecture are implemented:
 *  - T17 (arch adversarial matrix): "Proxy upgraded behind a trusted address" — the EIP-1967
 *    implementation-slot read, so a caller can compare against a previously observed value
 *    and flag a recent change. Deciding what counts as "recent" is policy-core's job (it
 *    needs a timestamp/epoch store this package has no opinion on); this module's job ends
 *    at "what is the implementation address right now."
 *  - Plain existence/nonce reads that `@bound/snapshot`'s CREATE-lineage helper
 *    (`findCreateNonce`) needs a live chain for: it is pure math over a candidate nonce range,
 *    and the nonce to start from, or to confirm against, comes from here.
 */

import type { RpcProvider } from "./transport.ts";

/**
 * EIP-1967 storage slot for a transparent/UUPS proxy's implementation address:
 * `bytes32(uint256(keccak256('eip1967.proxy.implementation')) - 1)`.
 * Computed with `@noble/hashes`' keccak_256 and cross-checked against the value this same
 * computation produces for OpenZeppelin's `ERC1967Utils.IMPLEMENTATION_SLOT` — not hand-typed
 * from memory (see `test/chain-facts.test.ts`, which recomputes it independently).
 */
export const EIP1967_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;
/**
 * EIP-1967 storage slot for a transparent proxy's admin address:
 * `bytes32(uint256(keccak256('eip1967.proxy.admin')) - 1)`. Same verification approach as
 * the implementation slot above.
 */
export const EIP1967_ADMIN_SLOT = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103" as const;

export class ChainReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChainReadError";
  }
}

function assertHexAddress(v: string, context: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(v)) {
    throw new TypeError(`${context}: expected a 20-byte hex address, got ${JSON.stringify(v)}`);
  }
  return v as `0x${string}`;
}

/** The last 20 bytes of a 32-byte storage slot value, as a checksummed-case-agnostic lowercase address. */
function addressFromSlotValue(slotValue: string): `0x${string}` | undefined {
  if (!/^0x[0-9a-fA-F]{64}$/.test(slotValue)) {
    throw new ChainReadError(`eth_getStorageAt returned a malformed 32-byte value: ${JSON.stringify(slotValue)}`);
  }
  const addr = `0x${slotValue.slice(-40)}`.toLowerCase();
  if (addr === "0x0000000000000000000000000000000000000000") return undefined;
  return addr as `0x${string}`;
}

/** `eth_getCode`; true iff the address currently has contract bytecode deployed. */
export async function isContract(provider: RpcProvider, address: string): Promise<boolean> {
  const addr = assertHexAddress(address, "isContract");
  const code = await provider.request({ method: "eth_getCode", params: [addr, "latest"] });
  if (typeof code !== "string") throw new ChainReadError("eth_getCode returned a non-string result");
  return code !== "0x" && code !== "0x0";
}

/**
 * Reads the EIP-1967 implementation slot at `address` for the given block tag. Returns
 * `undefined` if the slot is unset (zero) — i.e. `address` is not a proxy that uses this
 * standard slot (it may be a non-proxied contract, or a proxy using a different pattern
 * BOUND does not decode; either way, "no signal" rather than "trusted absence").
 */
export async function readImplementationSlot(
  provider: RpcProvider,
  address: string,
  blockTag: string = "latest",
): Promise<`0x${string}` | undefined> {
  const addr = assertHexAddress(address, "readImplementationSlot");
  const value = await provider.request({
    method: "eth_getStorageAt",
    params: [addr, EIP1967_IMPLEMENTATION_SLOT, blockTag],
  });
  if (typeof value !== "string") throw new ChainReadError("eth_getStorageAt returned a non-string result");
  return addressFromSlotValue(value);
}

/** Reads the EIP-1967 admin slot the same way; `undefined` if unset. */
export async function readAdminSlot(
  provider: RpcProvider,
  address: string,
  blockTag: string = "latest",
): Promise<`0x${string}` | undefined> {
  const addr = assertHexAddress(address, "readAdminSlot");
  const value = await provider.request({
    method: "eth_getStorageAt",
    params: [addr, EIP1967_ADMIN_SLOT, blockTag],
  });
  if (typeof value !== "string") throw new ChainReadError("eth_getStorageAt returned a non-string result");
  return addressFromSlotValue(value);
}

/**
 * Compares two previously-observed implementation reads and reports whether the
 * implementation changed. Pure comparison, no network — kept here (rather than inlined at
 * call sites) because "undefined means not-a-proxy, not no-change" is an easy mistake:
 * naive `a !== b` would report a change the first time a proxy is seen at all.
 */
export function implementationChanged(
  previous: `0x${string}` | undefined,
  current: `0x${string}` | undefined,
): boolean {
  if (previous === undefined || current === undefined) return false;
  return previous.toLowerCase() !== current.toLowerCase();
}

/** `eth_getTransactionCount`; the nonce to feed `@bound/snapshot`'s `findCreateNonce`/`createAddress`. */
export async function getTransactionCount(
  provider: RpcProvider,
  address: string,
  blockTag: string = "latest",
): Promise<bigint> {
  const addr = assertHexAddress(address, "getTransactionCount");
  const value = await provider.request({ method: "eth_getTransactionCount", params: [addr, blockTag] });
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)) {
    throw new ChainReadError("eth_getTransactionCount returned a non-hex result");
  }
  return BigInt(value);
}
