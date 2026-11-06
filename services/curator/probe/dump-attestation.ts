/**
 * dump-attestation — print the RAW attestation string as stored on-chain, without
 * parsing it, plus the same value fetched by both read routes.
 *
 * Why: attest-read kept failing with `attest.addresses.11155111[1]: expected
 * lowercase 0x address` even after a write whose own output showed three valid
 * lowercase sorted addresses. Either the read is served stale/other data, or the
 * stored string differs from what the writer believed it sent. Parsing hides the
 * answer; this prints the bytes.
 *
 * Fetches the record three ways and compares:
 *   1. findResolver(name)                      -> which resolver the read path picks
 *   2. text(node, key) direct on that resolver -> what that contract stores
 *   3. UniversalResolverV2.resolve(dnsName, …) -> what attest-read actually sees
 *
 *   BOUND_SEPOLIA_RPC_URL=... node --experimental-strip-types \
 *     services/curator/probe/dump-attestation.ts [ens-name]
 */
import { createPublicClient, http, namehash, toHex, encodeFunctionData, decodeAbiParameters, type Hex, type Address } from "viem";
import { sepolia } from "viem/chains";
import { packetToBytes } from "viem/ens";
import { ENSV2_SEPOLIA, permissionedResolverAbi, universalResolverV2Abi } from "@bound/integrations-ens";

const ATTESTATION_RECORD_KEY = "bound.attest.v1";
const PINNED_PROXY = "0xf6efa18d24c108a060b0d2a0e715b9045e09ea0f";

function describeAddresses(raw: string): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    process.stdout.write(`    (not valid JSON: ${e instanceof Error ? e.message : String(e)})\n`);
    return;
  }
  const o = parsed as { addresses?: Record<string, string[]> };
  if (!o.addresses) {
    process.stdout.write("    (no .addresses field)\n");
    return;
  }
  const RE = /^0x[0-9a-f]{40}$/;
  for (const [chain, list] of Object.entries(o.addresses)) {
    process.stdout.write(`    chain ${chain}:\n`);
    list.forEach((a, i) => {
      const hexchars = typeof a === "string" ? a.length - 2 : -1;
      const ok = typeof a === "string" && RE.test(a);
      process.stdout.write(`      [${i}] ${a}  hexchars=${hexchars}  ${ok ? "valid" : "*** INVALID ***"}\n`);
    });
    const sorted = [...list].every((v, i, arr) => i === 0 || arr[i - 1]! < v);
    process.stdout.write(`      strictly sorted: ${sorted}\n`);
  }
}

async function main(): Promise<void> {
  const rpcUrl = process.env.BOUND_SEPOLIA_RPC_URL;
  if (!rpcUrl) {
    process.stderr.write("BOUND_SEPOLIA_RPC_URL is required\n");
    process.exit(2);
  }
  const name = process.argv[2] ?? "bound-v2.eth";
  const client = createPublicClient({ chain: sepolia, transport: http(rpcUrl) });

  const dnsName = toHex(packetToBytes(name));
  const node = namehash(name) as Hex;

  process.stdout.write(`name:    ${name}\n`);
  process.stdout.write(`node:    ${node}\n`);
  process.stdout.write(`dnsName: ${dnsName}\n`);
  process.stdout.write(`key:     ${ATTESTATION_RECORD_KEY}\n\n`);

  // 1. which resolver does the read path pick?
  const [resolver] = (await client.readContract({
    address: ENSV2_SEPOLIA.universalResolverV2,
    abi: universalResolverV2Abi,
    functionName: "findResolver",
    args: [dnsName],
  })) as [Address, Hex, bigint];
  const matches = resolver.toLowerCase() === PINNED_PROXY.toLowerCase();
  process.stdout.write(`findResolver -> ${resolver}\n`);
  process.stdout.write(`pinned proxy    ${PINNED_PROXY}\n`);
  process.stdout.write(`MATCH: ${matches ? "yes" : "*** NO — read and write target different contracts ***"}\n\n`);

  // 2. direct text() on that resolver
  process.stdout.write("--- 2. direct text(node, key) on that resolver ---\n");
  try {
    const direct = (await client.readContract({
      address: resolver,
      abi: permissionedResolverAbi,
      functionName: "text",
      args: [node, ATTESTATION_RECORD_KEY],
    })) as string;
    process.stdout.write(`  length: ${direct.length}\n  raw: ${direct}\n`);
    describeAddresses(direct);
  } catch (e) {
    process.stdout.write(`  ERROR: ${e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : String(e)}\n`);
  }

  // 3. the exact path attest-read uses
  process.stdout.write("\n--- 3. UniversalResolverV2.resolve(dnsName, text calldata) ---\n");
  const textCalldata = encodeFunctionData({
    abi: permissionedResolverAbi,
    functionName: "text",
    args: [node, ATTESTATION_RECORD_KEY],
  });
  try {
    const res = (await client.readContract({
      address: ENSV2_SEPOLIA.universalResolverV2,
      abi: universalResolverV2Abi,
      functionName: "resolve",
      args: [dnsName, textCalldata],
    })) as [Hex, Address];
    const [returnData, via] = res;
    process.stdout.write(`  resolved via: ${via}\n`);
    const [value] = decodeAbiParameters([{ type: "string" }], returnData) as [string];
    process.stdout.write(`  length: ${value.length}\n  raw: ${value}\n`);
    describeAddresses(value);
  } catch (e) {
    process.stdout.write(`  ERROR: ${e instanceof Error ? (e as { shortMessage?: string }).shortMessage ?? e.message : String(e)}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
