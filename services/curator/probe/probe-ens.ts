#!/usr/bin/env node
/**
 * Phase 0 feasibility probe (plan §5, Developer 2): "validate ENSv2 test-network
 * availability and record-key permissions, deploy/use a dedicated resolver, prove curator
 * cannot edit unrelated keys, publish/read a disposable root and protocol self-attestation."
 *
 * This talks to real Sepolia RPC + a real deployed PermissionedResolver — it cannot run in
 * a network-sandboxed environment, and it is not run by `npm test`. Run it yourself:
 *
 *   BOUND_SEPOLIA_RPC_URL=... \
 *   BOUND_CURATOR_PRIVATE_KEY=0x... \
 *   BOUND_ROOT_NAME=your-disposable-test-name.eth \
 *   BOUND_UNAUTHORIZED_PRIVATE_KEY=0x... \
 *   node --experimental-strip-types probe/probe-ens.ts
 *
 * Use a DISPOSABLE test name here, never BOUND's live demo root — this probe publishes a
 * throwaway epoch and attempts a write that is EXPECTED to fail.
 *
 * Plan §5: "finish each external feasibility probe within one hour." This script is scoped
 * to exactly the checks that bound — it does not retry indefinitely or explore the contract
 * beyond what the gate asks for.
 */
import { privateKeyToAccount } from "viem/accounts";
import {
  makePublicClient,
  makeWalletClient,
  findResolver,
  readRootRecord,
  publishRootRecord,
  readAttestation,
  canWriteRootKey,
  RootReadError,
  ENSV2_SEPOLIA,
  SEPOLIA_CHAIN_ID,
  type BoundEnsConfig,
} from "@bound/integrations-ens";

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`missing required env var ${name}`);
    process.exit(2);
  }
  return v;
}

function section(title: string): void {
  console.log(`\n--- ${title} ---`);
}

async function main(): Promise<void> {
  const rpcUrl = need("BOUND_SEPOLIA_RPC_URL");
  const curatorKey = need("BOUND_CURATOR_PRIVATE_KEY") as `0x${string}`;
  const rootName = need("BOUND_ROOT_NAME");
  const resolverAddress = (process.env.BOUND_RESOLVER_ADDRESS ?? ENSV2_SEPOLIA.permissionedResolverImpl) as `0x${string}`;
  const unauthorizedKey = process.env.BOUND_UNAUTHORIZED_PRIVATE_KEY as `0x${string}` | undefined;

  const curator = privateKeyToAccount(curatorKey);
  const publicClient = makePublicClient(rpcUrl);
  const walletClient = makeWalletClient(rpcUrl, curator);
  const ens: BoundEnsConfig = { chainId: SEPOLIA_CHAIN_ID, rootName, resolverAddress };

  section("1. network reachability");
  const chainId = await publicClient.getChainId();
  console.log(`connected, chainId=${chainId} (expect ${SEPOLIA_CHAIN_ID})`);
  if (chainId !== SEPOLIA_CHAIN_ID) {
    console.error("WRONG CHAIN — stopping");
    process.exit(1);
  }

  section("2. resolver lookup for rootName");
  const { resolver } = await findResolver(publicClient, rootName);
  console.log(`resolver for ${rootName}: ${resolver} (pinned: ${resolverAddress})`);
  console.log(resolver.toLowerCase() === resolverAddress.toLowerCase() ? "OK: matches pinned resolver" : "MISMATCH — update BOUND_RESOLVER_ADDRESS or re-point the name");

  section("3. curator role check (should currently hold ROLE_SET_TEXT on the root key)");
  const curatorCanWrite = await canWriteRootKey(publicClient, ens, curator.address);
  console.log(`curator (${curator.address}) can write root key: ${curatorCanWrite}`);

  section("4. publish a disposable root record");
  const previous = await readRootRecord(publicClient, ens).catch((e) => {
    if (e instanceof RootReadError) return undefined;
    throw e;
  });
  const nextEpoch = (previous?.epoch ?? 0) + 1;
  const disposableDigest = ("0x" + "ab".repeat(32)) as `0x${string}`;
  const disposableKey = ("0x" + "cd".repeat(32)) as `0x${string}`;
  const txHash = await publishRootRecord(walletClient, publicClient, ens, {
    digest: disposableDigest,
    epoch: nextEpoch,
    network: "sepolia",
    schemaVersion: 1,
    arkivKey: disposableKey,
    arkivOwner: curator.address.toLowerCase() as `0x${string}`,
  });
  console.log(`published disposable epoch ${nextEpoch}, tx ${txHash} — waiting for receipt`);
  await publicClient.waitForTransactionReceipt({ hash: txHash });

  section("5. read it back");
  const readBack = await readRootRecord(publicClient, ens);
  const matches = readBack.epoch === nextEpoch && readBack.digest === disposableDigest;
  console.log(`read back epoch ${readBack.epoch}, digest ${readBack.digest} — ${matches ? "OK: matches what was published" : "MISMATCH"}`);

  section("6. unauthorized write must fail (if BOUND_UNAUTHORIZED_PRIVATE_KEY is set)");
  if (!unauthorizedKey) {
    console.log("skipped — set BOUND_UNAUTHORIZED_PRIVATE_KEY to exercise this check");
  } else {
    const unauthorized = privateKeyToAccount(unauthorizedKey);
    const unauthorizedCanWrite = await canWriteRootKey(publicClient, ens, unauthorized.address);
    console.log(`unauthorized account (${unauthorized.address}) can write root key: ${unauthorizedCanWrite} (expect false)`);
    if (unauthorizedCanWrite) {
      console.error("FAIL: an unauthorized account holds write access — role scoping is broken");
    } else {
      const unauthorizedWallet = makeWalletClient(rpcUrl, unauthorized);
      try {
        await publishRootRecord(unauthorizedWallet, publicClient, ens, {
          digest: ("0x" + "ff".repeat(32)) as `0x${string}`,
          epoch: nextEpoch + 1,
          network: "sepolia",
          schemaVersion: 1,
          arkivKey: ("0x" + "ee".repeat(32)) as `0x${string}`,
          arkivOwner: curator.address.toLowerCase() as `0x${string}`,
        });
        console.error("FAIL: unauthorized write SUCCEEDED — this must not happen");
      } catch {
        console.log("OK: unauthorized write reverted, as required");
      }
    }
  }

  section("7. protocol self-attestation round trip (optional, needs BOUND_PROTOCOL_NAME)");
  const protocolName = process.env.BOUND_PROTOCOL_NAME;
  if (!protocolName) {
    console.log("skipped — set BOUND_PROTOCOL_NAME (+ its own resolver/key) to exercise this check");
  } else {
    try {
      const existing = await readAttestation(publicClient, protocolName);
      console.log(`existing attestation at ${protocolName}:`, existing);
    } catch (e) {
      console.log(`no existing attestation at ${protocolName} (${(e as Error).message}) — this is fine for a fresh name`);
    }
    console.log(
      "NOTE: publishing a NEW attestation here requires the protocol's OWN key, which this probe does not assume " +
        "it holds — see publishAttestation() in @bound/integrations-ens, exercised against your own protocol test name.",
    );
  }

  section("done");
  console.log("Phase 0 ENS probe complete. Record this run's tx hashes and chain id in the Phase 0 evidence log.");
}

void main();
