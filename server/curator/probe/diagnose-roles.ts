/**
 * Diagnose PermissionedResolver role state.
 *
 * Phase 1 Dev 2: attest-grant reverts with MissingRole even using the owner key.
 * This script enumerates who actually holds what on which resource, so we can
 * find the account that holds adminOf(ROLE_SET_TEXT) and can grant roles.
 *
 * Run:
 *   BOUND_SEPOLIA_RPC_URL=... node --experimental-strip-types server/curator/probe/diagnose-roles.ts
 */
import { createPublicClient, http, keccak256, toHex, type Address } from "viem";
import { sepolia } from "viem/chains";

const RPC = process.env.BOUND_SEPOLIA_RPC_URL;
if (!RPC) throw new Error("BOUND_SEPOLIA_RPC_URL required");

// The dedicated PROXY for bound-v2.eth, NOT ENSV2_SEPOLIA.permissionedResolverImpl
// (0x115eb53f...) which is the shared implementation and holds no grants of ours.
const RESOLVER = (process.env.BOUND_RESOLVER_ADDRESS ??
  "0xf6efa18d24c108a060b0d2a0e715b9045e09ea0f") as Address;

const ROLE_SET_TEXT = 1n << 4n;
const ADMIN_SET_TEXT = ROLE_SET_TEXT << 128n;

const ACCOUNTS: Record<string, Address> = {
  "owner-key (0x081D48D)": "0x081D48D53b89D624063779A3dc48975E49F34b39",
  "protocol (0xf3cfb6cc)": "0xf3cfb6ccC0Cd5fb2d8e515A67b11425a121b0bc3",
};

const RESOURCES: Record<string, bigint> = {
  ROOT_RESOURCE: 0n,
  'textResource("bound.root.v1")': BigInt(keccak256(toHex("bound.root.v1"))),
  'textResource("bound.attest.v1")': BigInt(keccak256(toHex("bound.attest.v1"))),
};

const abi = [
  { name: "roles", type: "function", stateMutability: "view",
    inputs: [{ type: "uint256", name: "resource" }, { type: "address", name: "account" }],
    outputs: [{ type: "uint256" }] },
  { name: "hasRoles", type: "function", stateMutability: "view",
    inputs: [{ type: "uint256", name: "resource" }, { type: "uint256", name: "roleBitmap" }, { type: "address", name: "account" }],
    outputs: [{ type: "bool" }] },
  { name: "hasRootRoles", type: "function", stateMutability: "view",
    inputs: [{ type: "uint256", name: "roleBitmap" }, { type: "address", name: "account" }],
    outputs: [{ type: "bool" }] },
  { name: "ROOT_RESOURCE", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const client = createPublicClient({ chain: sepolia, transport: http(RPC) });

function fmtRoles(bits: bigint): string {
  if (bits === 0n) return "0x0 (none)";
  const parts: string[] = [];
  const low = bits & ((1n << 128n) - 1n);
  const high = bits >> 128n;
  if (low !== 0n) parts.push(`roles=0x${low.toString(16)}`);
  if (high !== 0n) parts.push(`admin=0x${high.toString(16)}`);
  const flags: string[] = [];
  if (low & ROLE_SET_TEXT) flags.push("ROLE_SET_TEXT");
  if (high & ROLE_SET_TEXT) flags.push("adminOf(ROLE_SET_TEXT)");
  return `${parts.join(" ")}${flags.length ? ` [${flags.join(", ")}]` : ""}`;
}

console.log(`resolver: ${RESOLVER}`);
console.log(`ROLE_SET_TEXT       = 0x${ROLE_SET_TEXT.toString(16)}`);
console.log(`adminOf(SET_TEXT)   = 0x${ADMIN_SET_TEXT.toString(16)}\n`);

try {
  const rootRes = await client.readContract({ address: RESOLVER, abi, functionName: "ROOT_RESOURCE" });
  console.log(`ROOT_RESOURCE() = ${rootRes} (0x${rootRes.toString(16)})\n`);
  RESOURCES.ROOT_RESOURCE = rootRes;
} catch (e) {
  console.log(`ROOT_RESOURCE() reverted: ${(e as Error).message.split("\n")[0]}\n`);
}

for (const [accLabel, account] of Object.entries(ACCOUNTS)) {
  console.log(`--- ${accLabel} ${account} ---`);
  for (const [resLabel, resource] of Object.entries(RESOURCES)) {
    try {
      const bits = await client.readContract({
        address: RESOLVER, abi, functionName: "roles", args: [resource, account],
      });
      console.log(`  ${resLabel.padEnd(34)} ${fmtRoles(bits)}`);
    } catch (e) {
      console.log(`  ${resLabel.padEnd(34)} READ FAILED: ${(e as Error).message.split("\n")[0]}`);
    }
  }
  try {
    const rootSetText = await client.readContract({
      address: RESOLVER, abi, functionName: "hasRootRoles", args: [ROLE_SET_TEXT, account],
    });
    const rootAdmin = await client.readContract({
      address: RESOLVER, abi, functionName: "hasRootRoles", args: [ADMIN_SET_TEXT, account],
    });
    console.log(`  hasRootRoles(ROLE_SET_TEXT)        ${rootSetText}`);
    console.log(`  hasRootRoles(adminOf(SET_TEXT))    ${rootAdmin}`);
  } catch (e) {
    console.log(`  hasRootRoles READ FAILED: ${(e as Error).message.split("\n")[0]}`);
  }
  console.log("");
}

console.log("Interpretation:");
console.log("  To call grantSetterRoles(setter, account) for ROLE_SET_TEXT on resource R,");
console.log("  the sender needs adminOf(ROLE_SET_TEXT) on R *or* on ROOT_RESOURCE.");
console.log("  Whichever account shows admin=0x10 above is the one that must run attest-grant.");
