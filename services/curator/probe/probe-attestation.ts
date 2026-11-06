#!/usr/bin/env node
/**
 * Phase 1 Dev 2 attestation probe — write-then-read round trip for
 * `integrations/ens/src/resolver-client.ts` publishAttestation/readAttestation.
 *
 * Run from the BOUND repo root on a machine with network access to Sepolia:
 *
 *   BOUND_SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/... \
 *   BOUND_PROTOCOL_PRIVATE_KEY=0x...   \  # the protocol account key (separate from curator)
 *   BOUND_PROTOCOL_ENS_NAME=bound-v2.eth  \  # the name this protocol attestation lives under
 *   node --experimental-strip-types services/curator/probe/probe-attestation.ts
 *
 * Optional (if running against a non-default resolver):
 *   BOUND_RESOLVER_ADDRESS=0x...
 *
 * This writes a DISPOSABLE test attestation — it does NOT write to any curator root record.
 * The protocol account needs ROLE_SET_TEXT on textResource("bound.attest.v1") granted by
 * the resolver admin. If that grant has not been done, §2 will fail with a revert — that
 * is expected and the error message will say so.
 */

import { privateKeyToAccount } from "viem/accounts";
import {
  makePublicClient,
  makeWalletClient,
  publishAttestation,
  readAttestation,
  findResolver,
  ENSV2_SEPOLIA,
} from "@bound/integrations-ens";
import type { Attestation } from "@bound/snapshot";

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    process.stderr.write(`missing required env var ${name}\n`);
    process.exit(2);
  }
  return v;
}

function section(title: string): void {
  console.log(`\n--- ${title} ---`);
}

function ok(msg: string): void {
  console.log(`  ✓ ${msg}`);
}

function fail(msg: string): void {
  console.log(`  ✗ ${msg}`);
}

async function main(): Promise<void> {
  const rpcUrl = need("BOUND_SEPOLIA_RPC_URL");
  const protocolKey = need("BOUND_PROTOCOL_PRIVATE_KEY") as `0x${string}`;
  const protocolName = need("BOUND_PROTOCOL_ENS_NAME"); // e.g. "bound-v2.eth"
  const resolverAddress = (process.env.BOUND_RESOLVER_ADDRESS ?? ENSV2_SEPOLIA.permissionedResolverImpl) as `0x${string}`;

  const protocolAccount = privateKeyToAccount(protocolKey);
  const publicClient = makePublicClient(rpcUrl);
  const walletClient = makeWalletClient(rpcUrl, protocolAccount);

  console.log(`Protocol account: ${protocolAccount.address}`);
  console.log(`Protocol ENS name: ${protocolName}`);
  console.log(`Resolver: ${resolverAddress}`);

  // --- §1: Resolver lookup ---
  section("§1 — resolver lookup for protocol name");
  let liveResolver: string;
  try {
    const r = await findResolver(publicClient, protocolName);
    liveResolver = r.resolver;
    ok(`resolver for ${protocolName}: ${liveResolver}`);
    if (liveResolver.toLowerCase() !== resolverAddress.toLowerCase()) {
      fail(`resolver mismatch: live=${liveResolver} expected=${resolverAddress}`);
      console.log("  → check BOUND_RESOLVER_ADDRESS or that the name uses the right resolver");
      process.exit(1);
    }
    ok(`resolver address matches BOUND_RESOLVER_ADDRESS`);
  } catch (e) {
    fail(`findResolver threw: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  // --- §2: Publish attestation ---
  section("§2 — publish attestation (protocol account → bound.attest.v1)");

  // Expiry 7 days out; this is a probe record, not a live attestation
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

  const attestation: Attestation = {
    schemaVersion: 1,
    site: protocolName.replace(/\.eth$/, "").replace(/-v2$/, ".app.demo"), // synthetic site host for the probe
    addresses: {
      "11155111": ["0x000000000000000000000000000000000000dead"], // placeholder addr on Sepolia
    },
    expiresAt,
  };

  console.log(`  Attestation: ${JSON.stringify(attestation)}`);

  let txHash: string;
  try {
    txHash = await publishAttestation(walletClient, publicClient, protocolName, resolverAddress, attestation);
    ok(`setText(bound.attest.v1) tx: ${txHash}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    fail(`publishAttestation threw: ${msg}`);
    if (msg.includes("revert") || msg.toLowerCase().includes("unauthorized")) {
      console.log("  → protocol account does not hold ROLE_SET_TEXT on textResource('bound.attest.v1')");
      console.log("  → run: bound-curator attest-grant <protocol-address>  first");
    }
    process.exit(1);
  }

  // --- §3: Wait for inclusion then read back ---
  section("§3 — read back attestation through UniversalResolverV2.resolve()");
  console.log("  Waiting ~15s for Sepolia inclusion...");
  await new Promise((r) => setTimeout(r, 15000));

  let readBack: Attestation;
  try {
    readBack = await readAttestation(publicClient, protocolName);
    ok(`readAttestation succeeded`);
    console.log(`  schemaVersion: ${readBack.schemaVersion}`);
    console.log(`  site:          ${readBack.site}`);
    console.log(`  expiresAt:     ${readBack.expiresAt}`);
    console.log(`  addresses:     ${JSON.stringify(readBack.addresses)}`);
  } catch (e) {
    fail(`readAttestation threw: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  // --- §4: Round-trip field verification ---
  section("§4 — round-trip field verification");
  let allOk = true;

  if (readBack.schemaVersion !== attestation.schemaVersion) {
    fail(`schemaVersion mismatch: got ${readBack.schemaVersion}, expected ${attestation.schemaVersion}`);
    allOk = false;
  } else {
    ok(`schemaVersion matches (${readBack.schemaVersion})`);
  }

  if (readBack.site !== attestation.site) {
    fail(`site mismatch: got '${readBack.site}', expected '${attestation.site}'`);
    allOk = false;
  } else {
    ok(`site matches ('${readBack.site}')`);
  }

  if (readBack.expiresAt !== attestation.expiresAt) {
    fail(`expiresAt mismatch: got '${readBack.expiresAt}', expected '${attestation.expiresAt}'`);
    allOk = false;
  } else {
    ok(`expiresAt matches`);
  }

  const readAddrs = readBack.addresses["11155111"] ?? [];
  const expectAddrs = attestation.addresses["11155111"] ?? [];
  if (JSON.stringify(readAddrs) !== JSON.stringify(expectAddrs)) {
    fail(`addresses[11155111] mismatch: got ${JSON.stringify(readAddrs)}`);
    allOk = false;
  } else {
    ok(`addresses[11155111] matches`);
  }

  // --- §5: Expiry check ---
  section("§5 — expiry sanity (record is not yet expired)");
  const now = new Date();
  const expiry = new Date(readBack.expiresAt);
  if (expiry > now) {
    ok(`attestation expires at ${readBack.expiresAt} — not yet expired ✓`);
  } else {
    fail(`attestation already expired! expiresAt=${readBack.expiresAt} now=${now.toISOString()}`);
    allOk = false;
  }

  // --- §6: Governance separation note ---
  section("§6 — governance separation note");
  console.log(`  Protocol account: ${protocolAccount.address}`);
  console.log(`  This account holds ROLE_SET_TEXT on textResource('bound.attest.v1')`);
  console.log(`  The curator account holds ROLE_SET_TEXT on textResource('bound.root.v1')`);
  console.log(`  These are DIFFERENT resource IDs → neither can overwrite the other's key`);
  ok(`role separation confirmed by design (plan §3 governance key table)`);

  // --- Result ---
  console.log("\n========================================");
  if (allOk) {
    console.log("ATTESTATION PROBE: ALL SECTIONS PASSED");
    console.log(`  tx hash: ${txHash}`);
  } else {
    console.log("ATTESTATION PROBE: SOME SECTIONS FAILED");
    process.exit(1);
  }
}

void main();
