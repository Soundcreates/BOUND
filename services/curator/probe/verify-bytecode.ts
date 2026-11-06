/**
 * verify-bytecode — check the trust seed against the chain it claims.
 *
 * Reads the compile input we actually ship and, for every trusted contract in it,
 * confirms the on-chain `keccak256(code)` equals the `codeHash` recorded as evidence.
 * Drives off the seed rather than a list kept here, so this probe cannot pass while
 * the shipped seed says something different.
 *
 * Two failures matter and are reported separately:
 *
 *   MISMATCH — the address holds code, but not the code we recorded. Either the
 *              protocol redeployed or the evidence was wrong. Either way the seed
 *              vouches for bytecode that is not there.
 *
 *   NO CODE  — the address holds nothing. This is the dangerous one, because the seed
 *              records keccak256("") for such an entry and a plain hash comparison
 *              therefore SUCCEEDS: the recorded hash matches reality exactly, and
 *              reality is "nothing is deployed here". BOUND would then tell a user
 *              that an empty address is a legitimate contract for that site, and if
 *              anyone later deploys there — CREATE2, or an EOA that becomes a
 *              contract — the seed vouches for whatever they deploy. Comparing
 *              hashes is not enough; emptiness has to be rejected on its own.
 *
 *   BOUND_SEPOLIA_RPC_URL=... node --experimental-strip-types \
 *     services/curator/probe/verify-bytecode.ts [path/to/compile-input.json]
 */
import { readFile } from "node:fs/promises";
import { createPublicClient, http, keccak256, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { normalizeAddress } from "@bound/snapshot";

const SEPOLIA_CHAIN_ID = 11155111;
const DEFAULT_SEED = "fixtures/snapshots/demo-seed.compile-input.json";

/** keccak256 of zero bytes — what an address with no deployed code hashes to. */
const EMPTY_CODE_HASH = keccak256("0x");

interface Evidence {
  address: string;
  kind?: string;
  sourceUrl?: string;
  codeHash?: string;
}
interface Site {
  host: string;
  chainId: number;
  trustedContracts: string[];
  evidence?: Evidence[];
}
interface SharedGroup {
  chainId: number;
  contracts: string[];
  evidence?: Evidence[];
}
interface CompileInput {
  network: string;
  sites: Site[];
  shared?: SharedGroup[];
}

interface Target {
  scope: string;
  chainId: number;
  address: string;
  recordedHash?: string;
  sourceUrl?: string;
}

function collectTargets(input: CompileInput): Target[] {
  const out: Target[] = [];
  const push = (scope: string, chainId: number, addrs: string[], evidence?: Evidence[]) => {
    for (const a of addrs) {
      const ev = evidence?.find((e) => e.address.toLowerCase() === a.toLowerCase());
      out.push({ scope, chainId, address: a, recordedHash: ev?.codeHash, sourceUrl: ev?.sourceUrl });
    }
  };
  for (const s of input.sites) push(s.host, s.chainId, s.trustedContracts, s.evidence);
  for (const g of input.shared ?? []) push("shared", g.chainId, g.contracts, g.evidence);
  return out;
}

async function main(): Promise<void> {
  const rpcUrl = process.env.BOUND_SEPOLIA_RPC_URL;
  if (!rpcUrl) {
    process.stderr.write("BOUND_SEPOLIA_RPC_URL is required\n");
    process.exit(2);
  }
  const seedPath = process.argv[2] ?? DEFAULT_SEED;
  const input = JSON.parse(await readFile(seedPath, "utf8")) as CompileInput;

  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
  const chainId = await client.getChainId();

  process.stdout.write(`seed:    ${seedPath}\n`);
  process.stdout.write(`network: ${input.network}\n`);
  process.stdout.write(`chainId: ${chainId}\n`);
  process.stdout.write(`empty-code hash: ${EMPTY_CODE_HASH}\n\n`);

  if (chainId !== SEPOLIA_CHAIN_ID) {
    process.stderr.write(
      `refusing to verify: RPC reports chainId ${chainId}, seed targets ${SEPOLIA_CHAIN_ID}.\n`,
    );
    process.exit(2);
  }

  const targets = collectTargets(input);
  const mismatched: Target[] = [];
  const empty: Target[] = [];
  const unevidenced: Target[] = [];
  let ok = 0;

  for (const t of targets) {
    if (t.chainId !== chainId) {
      process.stdout.write(`SKIP      ${t.scope.padEnd(22)} ${t.address}  seed chainId ${t.chainId} != ${chainId}\n`);
      continue;
    }

    let addr: Address;
    try {
      addr = normalizeAddress(t.address);
    } catch {
      process.stdout.write(`MALFORMED ${t.scope.padEnd(22)} ${t.address}  not a 40-hex address\n`);
      mismatched.push(t);
      continue;
    }

    const code = await client.getCode({ address: addr });
    const hasCode = Boolean(code && code !== "0x");
    const actualHash = hasCode ? keccak256(code as Hex) : EMPTY_CODE_HASH;
    const size = hasCode ? (code!.length - 2) / 2 : 0;

    // Emptiness is checked before the hash, deliberately. An empty address whose
    // recorded hash is keccak256("") would otherwise be reported as verified.
    if (!hasCode) {
      process.stdout.write(`NO CODE   ${t.scope.padEnd(22)} ${addr}  nothing deployed here\n`);
      if (t.recordedHash?.toLowerCase() === EMPTY_CODE_HASH.toLowerCase()) {
        process.stdout.write(`          recorded hash is the empty-code hash — the seed vouches for an empty address\n`);
      }
      empty.push(t);
      continue;
    }

    if (!t.recordedHash) {
      process.stdout.write(`NO EVIDENCE ${t.scope.padEnd(20)} ${addr}  ${size} bytes, actual ${actualHash}\n`);
      unevidenced.push(t);
      continue;
    }

    if (t.recordedHash.toLowerCase() !== actualHash.toLowerCase()) {
      process.stdout.write(`MISMATCH  ${t.scope.padEnd(22)} ${addr}  ${size} bytes\n`);
      process.stdout.write(`          recorded ${t.recordedHash}\n`);
      process.stdout.write(`          actual   ${actualHash}\n`);
      mismatched.push(t);
      continue;
    }

    process.stdout.write(`ok        ${t.scope.padEnd(22)} ${addr}  ${size} bytes  codeHash matches\n`);
    if (t.sourceUrl) process.stdout.write(`          source ${t.sourceUrl}\n`);
    ok++;
  }

  process.stdout.write(
    `\n${ok} verified, ${mismatched.length} mismatched, ${empty.length} with no code, ` +
      `${unevidenced.length} without recorded evidence (of ${targets.length} seed entries)\n`,
  );

  if (empty.length > 0) {
    process.stdout.write("\nAddresses with no deployed code — must not ship as trusted contracts:\n");
    for (const t of empty) process.stdout.write(`  ${t.scope}  ${t.address}  (${t.sourceUrl ?? "no source"})\n`);
  }
  if (mismatched.length > 0) {
    process.stdout.write("\nAddresses whose on-chain code is not what we recorded:\n");
    for (const t of mismatched) process.stdout.write(`  ${t.scope}  ${t.address}  (${t.sourceUrl ?? "no source"})\n`);
  }

  if (empty.length > 0 || mismatched.length > 0 || unevidenced.length > 0) process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
