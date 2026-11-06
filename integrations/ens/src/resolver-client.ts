/**
 * Thin, typed wrapper over the live PermissionedResolver + UniversalResolverV2 contracts.
 *
 * This module does network I/O; packages/snapshot does none. Keeping the split means the
 * extension's verifier (packages/snapshot/src/verifier.ts) stays testable without a chain,
 * and this module stays swappable (a different RPC, a different resolver) without
 * touching trust logic.
 */
import {
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  encodeFunctionData,
  http,
  namehash,
  toHex,
  type Account,
  type Address,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { packetToBytes } from "viem/ens";
import { sepolia } from "viem/chains";
import { permissionedResolverAbi, universalResolverV2Abi } from "./abi.ts";
import { ENSV2_SEPOLIA, type BoundEnsConfig } from "./addresses.ts";
import { textResource, ROLE_SET_TEXT } from "./roles.ts";
import { ROOT_RECORD_KEY, ATTESTATION_RECORD_KEY, parseRootRecord, encodeRootRecord, parseAttestation, encodeAttestation, type RootRecord, type Attestation } from "@bound/snapshot";

export function makePublicClient(rpcUrl: string): PublicClient {
  return createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
}

export function makeWalletClient(rpcUrl: string, account: Account): WalletClient<Transport, typeof sepolia, Account> {
  return createWalletClient({ chain: sepolia, transport: http(rpcUrl), account });
}

/**
 * Resolve a name to its resolver address and namehash via the UniversalResolverV2, exactly
 * the path a real reader (and BOUND's own extension) takes — never assume the resolver you
 * deployed is still the one actually bound to the name, in case of a later change.
 */
export async function findResolver(client: PublicClient, name: string): Promise<{ resolver: Address; node: Hex }> {
  const dnsName = toHex(packetToBytes(name));
  const [resolver, node] = (await client.readContract({
    address: ENSV2_SEPOLIA.universalResolverV2,
    abi: universalResolverV2Abi,
    functionName: "findResolver",
    args: [dnsName],
  })) as [Address, Hex, bigint];
  if (resolver === "0x0000000000000000000000000000000000000000") {
    throw new Error(`no resolver set for ${name}`);
  }
  return { resolver, node };
}

export class RootReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RootReadError";
  }
}

/** Read the live root record for `cfg.rootName`, resolving the resolver fresh each time. */
export async function readRootRecord(client: PublicClient, cfg: BoundEnsConfig): Promise<RootRecord> {
  const { resolver } = await findResolver(client, cfg.rootName);
  if (resolver.toLowerCase() !== cfg.resolverAddress.toLowerCase()) {
    // The name no longer points at BOUND's pinned resolver. Treat exactly like "unreachable" —
    // never silently trust whatever resolver now answers for the name (plan §3: pin the resolver).
    throw new RootReadError(`resolver for ${cfg.rootName} is ${resolver}, expected pinned ${cfg.resolverAddress}`);
  }
  // PermissionedResolver (post-audit-2) derives the record node from the DNS-encoded name
  // passed to UniversalResolverV2.resolve(), NOT from the node argument in the text()
  // calldata. Direct calls to text(node, key) on the resolver will revert because the
  // resolver has no name context — only the UniversalResolver supplies that.
  const dnsName = toHex(packetToBytes(cfg.rootName));
  const node = namehash(cfg.rootName) as Hex;
  const textCalldata = encodeFunctionData({
    abi: permissionedResolverAbi,
    functionName: "text",
    args: [node, ROOT_RECORD_KEY],
  });
  let resolveResult: readonly [Hex, Address];
  try {
    resolveResult = (await client.readContract({
      address: ENSV2_SEPOLIA.universalResolverV2,
      abi: universalResolverV2Abi,
      functionName: "resolve",
      args: [dnsName, textCalldata],
    })) as [Hex, Address];
  } catch {
    throw new RootReadError(`no root record set at ${cfg.rootName} / ${ROOT_RECORD_KEY} (resolver returned revert)`);
  }
  const [returnData] = resolveResult;
  if (!returnData || returnData === "0x") {
    throw new RootReadError(`empty return data from resolve() for ${cfg.rootName} / ${ROOT_RECORD_KEY}`);
  }
  const [value] = decodeAbiParameters([{ type: "string" }], returnData) as [string];
  if (value === "") throw new RootReadError(`empty root record at ${cfg.rootName} / ${ROOT_RECORD_KEY}`);
  return parseRootRecord(value); // throws SchemaError on malformed content
}

/**
 * Publish a new root record. Caller's wallet must hold ROLE_SET_TEXT on the
 * `textResource("bound.root.v1")` resource (least-privilege; see `grantCuratorRole` below)
 * or a root role. One call = one record update (plan §3).
 *
 * setText takes a DNS-encoded `bytes name` (post-audit-2), not the bytes32 node — reads
 * still use the node (findResolver gives us both).
 */
export async function publishRootRecord(
  walletClient: WalletClient<Transport, typeof sepolia, Account>,
  publicClient: PublicClient,
  cfg: BoundEnsConfig,
  record: RootRecord,
): Promise<Hex> {
  const { resolver } = await findResolver(publicClient, cfg.rootName);
  if (resolver.toLowerCase() !== cfg.resolverAddress.toLowerCase()) {
    throw new RootReadError(`resolver for ${cfg.rootName} is ${resolver}, expected pinned ${cfg.resolverAddress}`);
  }
  const value = encodeRootRecord(record);
  const dnsName = toHex(packetToBytes(cfg.rootName));
  return walletClient.writeContract({
    address: resolver,
    abi: permissionedResolverAbi,
    functionName: "setText",
    args: [dnsName, ROOT_RECORD_KEY, value],
  });
}

/** Read a live protocol self-attestation from the protocol's own ENS name (arch §5.5 / §9.1). */
export async function readAttestation(client: PublicClient, protocolName: string): Promise<Attestation> {
  // Use the same UniversalResolverV2.resolve() path — PermissionedResolver (post-audit-2)
  // derives the record from the DNS name, not the node in the calldata.
  const dnsName = toHex(packetToBytes(protocolName));
  const node = namehash(protocolName) as Hex;
  const textCalldata = encodeFunctionData({
    abi: permissionedResolverAbi,
    functionName: "text",
    args: [node, ATTESTATION_RECORD_KEY],
  });
  let resolveResult: readonly [Hex, Address];
  try {
    resolveResult = (await client.readContract({
      address: ENSV2_SEPOLIA.universalResolverV2,
      abi: universalResolverV2Abi,
      functionName: "resolve",
      args: [dnsName, textCalldata],
    })) as [Hex, Address];
  } catch {
    throw new RootReadError(`no attestation at ${protocolName} / ${ATTESTATION_RECORD_KEY} (resolver returned revert)`);
  }
  const [returnData] = resolveResult;
  if (!returnData || returnData === "0x") {
    throw new RootReadError(`empty return data from resolve() for ${protocolName} / ${ATTESTATION_RECORD_KEY}`);
  }
  const [value] = decodeAbiParameters([{ type: "string" }], returnData) as [string];
  if (value === "") throw new RootReadError(`empty attestation at ${protocolName} / ${ATTESTATION_RECORD_KEY}`);
  return parseAttestation(value);
}

export async function publishAttestation(
  walletClient: WalletClient<Transport, typeof sepolia, Account>,
  publicClient: PublicClient,
  protocolName: string,
  protocolResolver: Address,
  attestation: Attestation,
): Promise<Hex> {
  const { resolver } = await findResolver(publicClient, protocolName);
  if (resolver.toLowerCase() !== protocolResolver.toLowerCase()) {
    throw new RootReadError(`resolver for ${protocolName} is ${resolver}, expected ${protocolResolver}`);
  }
  const value = encodeAttestation(attestation);
  const dnsName = toHex(packetToBytes(protocolName));
  return walletClient.writeContract({
    address: resolver,
    abi: permissionedResolverAbi,
    functionName: "setText",
    args: [dnsName, ATTESTATION_RECORD_KEY, value],
  });
}

/**
 * Least-privilege curator setup (plan §3: "the curator receives only the scoped setter
 * role, never resolver admin/upgrade/link roles"). Caller must already hold a root/admin
 * role on the resolver to grant this.
 *
 * Post-audit-2 has no per-name scoping (docs.ens.domains/contracts/ensv2/permissioned-
 * resolver: "There is no per-name scoping. A role holder can write the covered records on
 * every name the resolver serves.") — the finest grain available is argument-scoped, via
 * `grantSetterRoles(setter, account)` where `setter` is ABI-encoded setter calldata and
 * only the selector + the key argument are read to derive the resource; the name and value
 * positions are ignored, so any placeholder works there. This still satisfies "curator
 * cannot edit unrelated keys" because this resolver is dedicated to exactly one name.
 */
export async function grantCuratorRole(
  adminWallet: WalletClient<Transport, typeof sepolia, Account>,
  resolverAddress: Address,
  curator: Address,
): Promise<Hex> {
  const setterCalldata = encodeFunctionData({
    abi: permissionedResolverAbi,
    functionName: "setText",
    args: ["0x" as Hex, ROOT_RECORD_KEY, ""],
  });
  return adminWallet.writeContract({
    address: resolverAddress,
    abi: permissionedResolverAbi,
    functionName: "grantSetterRoles",
    args: [setterCalldata, curator],
  });
}

/** Proves the negative half of Phase 0's gate: an unauthorized key cannot write the root key. */
export async function canWriteRootKey(client: PublicClient, cfg: BoundEnsConfig, account: Address): Promise<boolean> {
  const res = textResource(ROOT_RECORD_KEY);
  const [onKey, onRoot] = await Promise.all([
    client.readContract({ address: cfg.resolverAddress, abi: permissionedResolverAbi, functionName: "hasRoles", args: [res, ROLE_SET_TEXT, account] }),
    client.readContract({ address: cfg.resolverAddress, abi: permissionedResolverAbi, functionName: "hasRootRoles", args: [ROLE_SET_TEXT, account] }),
  ]);
  return Boolean(onKey) || Boolean(onRoot);
}

export { namehash };
