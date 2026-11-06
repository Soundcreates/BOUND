#!/usr/bin/env node
/**
 * One-shot script: revoke the old curator grant on a PermissionedResolver and issue a
 * fresh one to a new address. Run this whenever the curator keypair is rotated.
 *
 *   BOUND_SEPOLIA_RPC_URL=...
 *   BOUND_OWNER_PRIVATE_KEY=0x...       # the admin who deployed the resolver
 *   BOUND_RESOLVER_ADDRESS=0x...
 *   BOUND_OLD_CURATOR_ADDRESS=0x...     # may be omitted if the old key is simply lost
 *   BOUND_NEW_CURATOR_ADDRESS=0x...
 *   node --experimental-strip-types probe/regrant-curator.ts
 */
import { privateKeyToAccount } from "viem/accounts";
import {
  makePublicClient,
  makeWalletClient,
  grantCuratorRole,
  ROLE_SET_TEXT,
} from "@bound/integrations-ens";
import { type Address } from "viem";
import { permissionedResolverAbi } from "@bound/integrations-ens";

function need(name: string): string {
  const v = process.env[name];
  if (!v) { console.error(`missing ${name}`); process.exit(2); }
  return v;
}

async function main() {
  const rpcUrl = need("BOUND_SEPOLIA_RPC_URL");
  const ownerKey = need("BOUND_OWNER_PRIVATE_KEY") as `0x${string}`;
  const resolverAddress = need("BOUND_RESOLVER_ADDRESS") as Address;
  const newCurator = need("BOUND_NEW_CURATOR_ADDRESS") as Address;
  const oldCurator = process.env.BOUND_OLD_CURATOR_ADDRESS as Address | undefined;

  const owner = privateKeyToAccount(ownerKey);
  const publicClient = makePublicClient(rpcUrl);
  const walletClient = makeWalletClient(rpcUrl, owner);

  console.log(`owner: ${owner.address}`);
  console.log(`resolver: ${resolverAddress}`);

  if (oldCurator) {
    console.log(`\n--- revoking old curator ${oldCurator} ---`);
    // textResource("bound.root.v1") resource — matches what grantCuratorRole scopes to
    const { keccak256, toHex } = await import("viem");
    const resource = BigInt(keccak256(toHex("bound.root.v1")));
    const tx = await walletClient.writeContract({
      address: resolverAddress,
      abi: permissionedResolverAbi,
      functionName: "revokeRoles",
      args: [resource, ROLE_SET_TEXT, oldCurator],
    });
    console.log(`revoke tx ${tx} — waiting...`);
    await publicClient.waitForTransactionReceipt({ hash: tx });
    console.log("revoked");
  } else {
    console.log("BOUND_OLD_CURATOR_ADDRESS not set — skipping revoke (old key is lost, no-op)");
  }

  console.log(`\n--- granting new curator ${newCurator} ---`);
  const tx = await grantCuratorRole(walletClient, resolverAddress, newCurator);
  console.log(`grant tx ${tx} — waiting...`);
  await publicClient.waitForTransactionReceipt({ hash: tx });
  console.log("granted");

  console.log("\ndone — update services/curator/.env:");
  console.log(`  BOUND_CURATOR_ADDRESS=${newCurator}`);
}

void main();
