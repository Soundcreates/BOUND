/**
 * Curator setup flow: register an ENSv2 .eth name on Sepolia, deploy a DEDICATED
 * PermissionedResolver proxy for it (plan §3: "Default to a dedicated resolver"), and bind
 * the two. This is a one-time Phase 0 step, run from the CLI (services/curator), not from
 * the extension.
 *
 * Commit-reveal (ETHRegistrar): commit(keccak(label,owner,secret,...)) now, wait
 * MIN_COMMITMENT_AGE, then register(...) with the same arguments before MAX_COMMITMENT_AGE
 * elapses. This prevents front-running the registration.
 */
import { encodeFunctionData, zeroAddress, type Account, type Address, type Hex, type PublicClient, type Transport, type WalletClient } from "viem";
import { sepolia } from "viem/chains";
import { ethRegistrarAbi, verifiableFactoryAbi, permissionedResolverAbi } from "./abi.ts";
import { ENSV2_SEPOLIA } from "./addresses.ts";
import { ALL_ROLES_WITH_ADMIN } from "./roles.ts";

export interface CommitmentParams {
  label: string;
  owner: Address;
  secret: Hex;
  subregistry: Address;
  resolver: Address;
  durationSeconds: bigint;
  paymentToken: Address;
  referrer: Hex;
}

export async function isLabelAvailable(client: PublicClient, label: string): Promise<boolean> {
  return (await client.readContract({ address: ENSV2_SEPOLIA.ethRegistrar, abi: ethRegistrarAbi, functionName: "isAvailable", args: [label] })) as boolean;
}

export async function registerPrice(client: PublicClient, label: string, durationSeconds: bigint, paymentToken: Address): Promise<bigint> {
  return (await client.readContract({
    address: ENSV2_SEPOLIA.ethRegistrar,
    abi: ethRegistrarAbi,
    functionName: "getRegisterPrice",
    args: [label, durationSeconds, paymentToken],
  })) as bigint;
}

async function computeCommitment(client: PublicClient, p: CommitmentParams): Promise<Hex> {
  // makeCommitment's on-chain signature has NO paymentToken (unlike register, below) —
  // confirmed against the deployed ETHRegistrar ABI. Passing 8 args here would silently
  // commit to a different hash than register() produces, and `register` would then revert
  // with "commitment not found" instead of explaining why.
  return (await client.readContract({
    address: ENSV2_SEPOLIA.ethRegistrar,
    abi: ethRegistrarAbi,
    functionName: "makeCommitment",
    args: [p.label, p.owner, p.secret, p.subregistry, p.resolver, p.durationSeconds, p.referrer],
  })) as Hex;
}

/** Step 1: submit the commitment. Wait `MIN_COMMITMENT_AGE` seconds before calling `register`. */
export async function commitRegistration(
  wallet: WalletClient<Transport, typeof sepolia, Account>,
  client: PublicClient,
  p: CommitmentParams,
): Promise<{ commitment: Hex; txHash: Hex; minAgeSeconds: bigint }> {
  const commitment = await computeCommitment(client, p);
  const minAgeSeconds = (await client.readContract({ address: ENSV2_SEPOLIA.ethRegistrar, abi: ethRegistrarAbi, functionName: "MIN_COMMITMENT_AGE" })) as bigint;
  const txHash = await wallet.writeContract({ address: ENSV2_SEPOLIA.ethRegistrar, abi: ethRegistrarAbi, functionName: "commit", args: [commitment] });
  return { commitment, txHash, minAgeSeconds };
}

/** Step 2: after waiting past minAgeSeconds (and before MAX_COMMITMENT_AGE), register. */
export async function finishRegistration(wallet: WalletClient<Transport, typeof sepolia, Account>, p: CommitmentParams): Promise<Hex> {
  return wallet.writeContract({
    address: ENSV2_SEPOLIA.ethRegistrar,
    abi: ethRegistrarAbi,
    functionName: "register",
    args: [p.label, p.owner, p.secret, p.subregistry, p.resolver, p.durationSeconds, p.paymentToken, p.referrer],
  });
}

/**
 * Deploy a dedicated PermissionedResolver proxy, initialized with `admin` holding every
 * root role (the deployer). Returns the proxy's predicted address up front (CREATE2-style
 * via VerifiableFactory) so the caller can register the name pointing at it in the same
 * breath, then confirms it from the emitted event once mined.
 */
export async function deployDedicatedResolver(
  wallet: WalletClient<Transport, typeof sepolia, Account>,
  publicClient: PublicClient,
  admin: Address,
  salt: bigint,
): Promise<Address> {
  const initData = encodeInitialize(admin);
  // Simulate first (an eth_call — zero gas) so a still-wrong ABI guess fails cheaply
  // instead of as a real reverted transaction.
  await publicClient.simulateContract({
    address: ENSV2_SEPOLIA.verifiableFactory,
    abi: verifiableFactoryAbi,
    functionName: "deployProxy",
    args: [ENSV2_SEPOLIA.permissionedResolverImpl, salt, initData],
    account: admin,
  });
  const txHash = await wallet.writeContract({
    address: ENSV2_SEPOLIA.verifiableFactory,
    abi: verifiableFactoryAbi,
    functionName: "deployProxy",
    args: [ENSV2_SEPOLIA.permissionedResolverImpl, salt, initData],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  const log = receipt.logs.find((l) => l.address.toLowerCase() === ENSV2_SEPOLIA.verifiableFactory.toLowerCase());
  if (!log || log.topics.length < 3 || !log.topics[2]) {
    throw new Error("ProxyDeployed event not found in deployProxy receipt");
  }
  // `proxyAddress` is the 2nd indexed topic (sender, proxyAddress, salt-non-indexed...);
  // topics[0]=event sig, topics[1]=sender, topics[2]=proxyAddress.
  return `0x${log.topics[2].slice(26)}` as Address;
}

function encodeInitialize(admin: Address): Hex {
  // initialize((address,uint256)[] grants, bytes[] calls) — post-audit-2 signature
  // (contracts-v2 PR #417), verified against the live Sepolia contract by selector match
  // (0x33cc44a0 for initialize((address,uint256)[],bytes[])). Grant every root role (and
  // its admin counterpart) to `admin`, the curator's operational key during setup. The
  // day-to-day curator key is scoped down afterward via grantCuratorRole(), which grants
  // only ROLE_SET_TEXT on the single bound.root.v1 key resource — this broad grant is
  // never used again once that scoping is in place.
  return encodeFunctionData({
    abi: permissionedResolverAbi,
    functionName: "initialize",
    args: [[{ account: admin, roleBitmap: ALL_ROLES_WITH_ADMIN }], []],
  });
}

// NOTE (Phase 0 open item, see services/curator/README.md): re-pointing an
// ALREADY-REGISTERED label's resolver via ETHRegistry.setResolver(anyId, resolver)
// needs the exact `anyId` encoding verified against the live contract — the ABI alone
// doesn't say whether `anyId` is the plain label-token id, a composite (eid<<32|id), or
// something getTokenId/getState must first resolve. Rather than guess, the setup flow
// below sets the resolver ONCE, correctly, via the registrar's own `resolver` argument at
// registration time (finishRegistration). Do not add a re-bind helper until that encoding
// is confirmed on Sepolia — a wrong anyId here could write a resolver pointer onto the
// wrong token.

export const UNSET_RESOLVER = zeroAddress;
