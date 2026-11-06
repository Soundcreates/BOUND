/**
 * verify-bytecode — confirm every address we are about to attest actually has
 * deployed bytecode on the chain we claim it is on.
 *
 * Why this exists: `attest-write` publishes trust data. A typo'd, truncated, or
 * simply wrong address would be published as "this contract is legitimate for
 * this site", which is precisely the failure mode BOUND exists to prevent. A
 * 39-hex-char address was written on-chain during Phase 1 bring-up before this
 * check existed (txs 0x6ae2890a…, 0xc5f5ff77…, 0x8956de11…), so the seed list is
 * verified against the chain, not against a docs page or anyone's memory.
 *
 * Provenance for each entry is recorded alongside it: source URL + chain, as the
 * Dev 2 gate requires.
 *
 *   BOUND_SEPOLIA_RPC_URL=... node --experimental-strip-types \
 *     services/curator/probe/verify-bytecode.ts
 */
import { createPublicClient, http, type Address } from "viem";
import { sepolia } from "viem/chains";
import { normalizeAddress } from "@bound/snapshot";

const SEPOLIA_CHAIN_ID = 11155111;

interface Candidate {
  readonly site: string;
  readonly label: string;
  readonly address: string;
  /** Where this address came from — required gate evidence, not decoration. */
  readonly source: string;
}

/**
 * Sepolia (chainId 11155111) only. Mainnet addresses are deliberately NOT here:
 * attesting a mainnet address from a Sepolia probe would be unverified data.
 */
const CANDIDATES: readonly Candidate[] = [
  {
    site: "app.uniswap.org",
    label: "UniswapV3Factory",
    address: "0x0227628f3F023bb0B980b67D528571c95c6DaC1c",
    source: "https://developers.uniswap.org/docs/protocols/v3/deployments/v3-ethereum-deployments",
  },
  {
    site: "app.uniswap.org",
    label: "SwapRouter02",
    address: "0x3bFA4769FB09eefC5a80d6E87c3B9C650f7Ae48E",
    source: "https://developers.uniswap.org/docs/protocols/v3/deployments/v3-ethereum-deployments",
  },
  {
    site: "app.uniswap.org",
    label: "WETH9",
    address: "0xfff9976782d46cc05630d1f6ebab18b2324d6b14",
    source: "https://developers.uniswap.org/docs/protocols/v3/deployments/v3-ethereum-deployments",
  },
];

async function main(): Promise<void> {
  const rpcUrl = process.env.BOUND_SEPOLIA_RPC_URL;
  if (!rpcUrl) {
    process.stderr.write("BOUND_SEPOLIA_RPC_URL is required\n");
    process.exit(2);
  }

  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const chainId = await client.getChainId();
  process.stdout.write(`chainId: ${chainId}\n`);
  // The seed list below is Sepolia-only and its output is fed straight into an attestation
  // keyed "11155111". Pointed at a mainnet RPC this would confirm mainnet bytecode and then
  // emit those addresses as Sepolia trust data, which is worse than not checking at all.
  if (chainId !== SEPOLIA_CHAIN_ID) {
    process.stderr.write(
      `refusing to verify: RPC reports chainId ${chainId}, but this seed list is for ` +
        `${SEPOLIA_CHAIN_ID} (Sepolia). Point BOUND_SEPOLIA_RPC_URL at Sepolia.\n`,
    );
    process.exit(2);
  }
  process.stdout.write("\n");

  const verified: { site: string; address: Address }[] = [];
  let failures = 0;

  for (const c of CANDIDATES) {
    // normalizeAddress throws on a malformed address, so a bad literal in this
    // file fails the probe instead of silently reaching the attestation.
    let addr: Address;
    try {
      addr = normalizeAddress(c.address);
    } catch {
      process.stdout.write(`FAIL  ${c.label.padEnd(18)} ${c.address}  malformed (${c.address.length - 2} hex chars, need 40)\n`);
      failures++;
      continue;
    }

    const code = await client.getCode({ address: addr });
    const size = code && code !== "0x" ? (code.length - 2) / 2 : 0;
    if (size === 0) {
      process.stdout.write(`FAIL  ${c.label.padEnd(18)} ${addr}  no bytecode at this address on chain ${chainId}\n`);
      failures++;
      continue;
    }

    process.stdout.write(`ok    ${c.label.padEnd(18)} ${addr}  ${size} bytes\n`);
    process.stdout.write(`      site=${c.site}  source=${c.source}\n`);
    verified.push({ site: c.site, address: addr });
  }

  process.stdout.write(`\n${verified.length} verified, ${failures} failed\n`);

  if (failures > 0) process.exit(1);

  // Emit the exact CSV attest-write wants: sorted, unique, lowercase.
  const bySite = new Map<string, Address[]>();
  for (const v of verified) {
    const list = bySite.get(v.site) ?? [];
    list.push(v.address);
    bySite.set(v.site, list);
  }
  process.stdout.write("\nattest-write arguments:\n");
  for (const [site, addrs] of bySite) {
    const csv = [...new Set(addrs)].sort().join(",");
    process.stdout.write(`  ${site}\n    ${csv}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
