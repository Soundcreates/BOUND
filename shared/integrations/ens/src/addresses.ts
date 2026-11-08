/**
 * ENSv2 Sepolia deployment addresses, pinned (plan §3: "Pin the ENS chain, name, resolver,
 * and root-record key in extension configuration").
 *
 * Source: https://docs.ens.domains/learn/deployments, re-fetched and verified 2026-11-06
 * after the 2026-10-01 Sepolia redeploy (ens-cli PR #16) invalidated the prior
 * 2026-06-29 address set below. userRegistryImpl is new in this set — it's the
 * implementation a custom VerifiableFactory-deployed subregistry would use (only needed
 * if BOUND's root name ever grows subnames; registration below passes subregistry =
 * address(0), confirmed against docs.ens.domains/ensv2/eth-registrar's own example, so it
 * is tracked here but unused by registrar.ts). Re-verify against that page before the live
 * demo — a redeploy would change these again.
 */
export const SEPOLIA_CHAIN_ID = 11155111;

export const ENSV2_SEPOLIA = {
  universalResolverV2: "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe",
  /** Implementation address is retained for deployment context; read callers use the proxy above. */
  universalResolverV2Impl: "0x24e1d8e068620b647ca097f961a61055f4f42d72",
  managedUniversalResolverProxy: "0x6d80F2172CFdEc5730fE683860C33d26fC42e6F1",
  rootRegistry: "0xb458d6a3a77919449d03e7a6903c26827c1ec43f",
  ethRegistry: "0xd4ebcbbdf463c9c45784603db0ddd499bc44a8b4",
  ethRegistrar: "0xf633e7fc17e2bbe0d0965d18ec1821dcb754a3d3",
  verifiableFactory: "0xda70306c98e97ece36f997a21368e53298572991",
  userRegistryImpl: "0x9bd8a88719068d09ecee662f36c0e3856708366a",
  permissionedResolverImpl: "0x115eb53f0c60696633855f90b138178fb40b2b2c",
  standardRentPriceOracle: "0x8196665d4ca7488b6474a9ec8e7d2719fb42263a",
} as const;

/** BOUND's own configuration — fill in once the curator registers a name (Phase 0). */
export interface BoundEnsConfig {
  chainId: typeof SEPOLIA_CHAIN_ID;
  /** The ENS name BOUND publishes its root record under, e.g. "bound-demo.eth". */
  rootName: string;
  /** The PermissionedResolver PROXY address deployed for that name (not the implementation). */
  resolverAddress: `0x${string}`;
}
