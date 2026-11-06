/**
 * seed-codehash — measure the on-chain keccak256(code) for addresses we are about to put
 * in the trust seed.
 *
 * `schema.ts` requires a `codeHash` on every piece of contract evidence and is right to:
 * an address in the seed is an address BOUND tells users is safe to transact with, and the
 * recorded hash is what later proves the code has not been swapped underneath us. That
 * hash must therefore be measured, never transcribed from a docs page or guessed.
 *
 * This prints the measurement only. The other half of the provenance — the official
 * deployment page the address came from — is human-supplied and goes in `sourceUrl` by
 * hand, because no script can vouch for where an address was sourced.
 *
 * Refuses to emit a hash for an address with no deployed code. keccak256("") is a
 * perfectly valid-looking 32-byte hash, which is exactly how the seed came to vouch for
 * 0xfed6a969aaa60e4961fcd3ebf1a2e8913ac65b16 — an address holding nothing at all.
 *
 *   BOUND_SEPOLIA_RPC_URL=... node --experimental-strip-types \
 *     services/curator/probe/seed-codehash.ts 0xaddr1 0xaddr2 ...
 */
import { createPublicClient, http, keccak256, type Hex } from "viem";
import { sepolia } from "viem/chains";

const SEPOLIA_CHAIN_ID = 11155111;
const EMPTY_CODE_HASH = keccak256("0x");

async function main(): Promise<void> {
  const rpcUrl = process.env.BOUND_SEPOLIA_RPC_URL;
  if (!rpcUrl) {
    process.stderr.write("set BOUND_SEPOLIA_RPC_URL\n");
    process.exit(2);
  }
  const addresses = process.argv.slice(2);
  if (addresses.length === 0) {
    process.stderr.write("usage: seed-codehash.ts <address> [address...]\n");
    process.exit(2);
  }

  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const chainId = await client.getChainId();
  if (chainId !== SEPOLIA_CHAIN_ID) {
    process.stderr.write(`refusing to measure: RPC is chain ${chainId}, expected ${SEPOLIA_CHAIN_ID}\n`);
    process.exit(1);
  }
  process.stdout.write(`chainId ${chainId}\nempty-code hash ${EMPTY_CODE_HASH}\n\n`);

  let bad = 0;
  for (const raw of addresses) {
    const lower = raw.trim().toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(lower)) {
      process.stdout.write(`MALFORMED  ${raw}  not a 40-hex address\n`);
      bad++;
      continue;
    }
    const code = await client.getCode({ address: lower as `0x${string}` });
    if (!code || code === "0x") {
      process.stdout.write(`NO CODE    ${lower}  nothing deployed — do NOT put this in the seed\n`);
      bad++;
      continue;
    }
    const hash = keccak256(code as Hex);
    // Belt and braces: a non-empty `code` can still hash to the empty-code hash only if it
    // literally is "0x", which the check above caught. Assert it anyway — a seed entry that
    // vouches for emptiness is the one failure this whole script exists to prevent.
    if (hash.toLowerCase() === EMPTY_CODE_HASH.toLowerCase()) {
      process.stdout.write(`SUSPECT    ${lower}  hashes to the empty-code hash — refusing\n`);
      bad++;
      continue;
    }
    const size = (code.length - 2) / 2;
    process.stdout.write(`OK         ${lower}  ${String(size).padStart(6)} bytes  ${hash}\n`);
  }

  process.stdout.write(bad === 0 ? "\nall measured\n" : `\n${bad} address(es) unusable\n`);
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write(`${e instanceof Error ? (e.stack ?? e.message) : String(e)}\n`);
  process.exit(1);
});
