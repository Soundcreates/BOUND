#!/usr/bin/env node
/**
 * One-time Phase 0 helper: get enough MockUSDC into the owner account to pay for
 * BOUND_LABEL's registration, then approve the ETHRegistrar to pull it.
 *
 * MockUSDC's real mint function isn't pinned anywhere in BOUND's verified ABI set — this
 * is exactly the case plan.md §4 point 3 warns about ("never copy an address from a stale
 * snippet without verification"). Rather than guess and send a live tx, this script tries
 * each candidate signature via simulateContract first (an eth_call — zero gas, zero risk,
 * reverts just tell you "no"). Only a signature that SIMULATES clean gets sent for real.
 */
import { privateKeyToAccount } from "viem/accounts";
import { parseAbi, type Address } from "viem";
import { makePublicClient, makeWalletClient, ENSV2_SEPOLIA, registerPrice } from "@bound/integrations-ens";

const MOCK_USDC: Address = "0x240b0316df57887dbbe58b586508b19e633a14aa";

const erc20ReadAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

const erc20ApproveAbi = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);

// Candidates, most-common-pattern first. Each is tried via simulateContract (no gas) before
// anything is sent. Add more here if all of these fail to simulate.
const MINT_CANDIDATES = [
  { abi: parseAbi(["function mint(address to, uint256 amount) external"]), args: (to: Address, amt: bigint) => [to, amt] },
  { abi: parseAbi(["function mint(uint256 amount) external"]), args: (_to: Address, amt: bigint) => [amt] },
  { abi: parseAbi(["function faucet() external"]), args: (_to: Address, _amt: bigint) => [] },
  { abi: parseAbi(["function faucet(uint256 amount) external"]), args: (_to: Address, amt: bigint) => [amt] },
] as const;

function need(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`missing required env var ${name}`);
    process.exit(2);
  }
  return v;
}

async function main(): Promise<void> {
  const rpcUrl = need("BOUND_SEPOLIA_RPC_URL");
  const ownerKey = need("BOUND_OWNER_PRIVATE_KEY") as `0x${string}`;
  const label = need("BOUND_LABEL");
  const durationSeconds = BigInt(process.env.BOUND_DURATION_SECONDS ?? 60 * 60 * 24 * 365);
  const confirmed = process.env.BOUND_SETUP_CONFIRM === "yes";

  const owner = privateKeyToAccount(ownerKey);
  const publicClient = makePublicClient(rpcUrl);
  const walletClient = makeWalletClient(rpcUrl, owner);

  console.log("--- current state ---");
  const [balance, decimals] = await Promise.all([
    publicClient.readContract({ address: MOCK_USDC, abi: erc20ReadAbi, functionName: "balanceOf", args: [owner.address] }),
    publicClient.readContract({ address: MOCK_USDC, abi: erc20ReadAbi, functionName: "decimals" }),
  ]);
  const price = await registerPrice(publicClient, label, durationSeconds, MOCK_USDC);
  console.log(`owner ${owner.address} MockUSDC balance: ${balance} (decimals=${decimals})`);
  console.log(`price for "${label}.eth" (${durationSeconds}s): ${price}`);

  if (balance >= price) {
    console.log("balance already covers the price — skipping mint, checking allowance only.");
  } else {
    console.log("\n--- probing mint signatures (simulate only, zero gas) ---");
    const need_ = price - balance;
    let working: (typeof MINT_CANDIDATES)[number] | undefined;
    for (const candidate of MINT_CANDIDATES) {
      try {
        await publicClient.simulateContract({
          address: MOCK_USDC,
          abi: candidate.abi,
          functionName: candidate.abi[0].name,
          args: candidate.args(owner.address, need_) as never,
          account: owner.address,
        });
        console.log(`  ${candidate.abi[0].name}(${candidate.args(owner.address, need_).join(", ")}): SIMULATES OK`);
        working = candidate;
        break;
      } catch (e) {
        console.log(`  ${candidate.abi[0].name}: fails simulation (${(e as Error).message.slice(0, 100)})`);
      }
    }
    if (!working) {
      console.error(
        "\nNo candidate mint/faucet signature simulates cleanly against this contract. Open " +
          `https://sepolia.etherscan.io/address/${MOCK_USDC}#code yourself, find the real mint/faucet ` +
          "function, and tell me its exact signature — I'll add it rather than guess further.",
      );
      process.exit(1);
    }
    if (!confirmed) {
      console.log("\nDRY RUN — would mint via the signature above. Re-run with BOUND_SETUP_CONFIRM=yes to send it.");
      return;
    }
    console.log(`\nminting via ${working.abi[0].name}...`);
    const mintTx = await walletClient.writeContract({
      address: MOCK_USDC,
      abi: working.abi,
      functionName: working.abi[0].name,
      args: working.args(owner.address, need_) as never,
    });
    console.log(`mint tx ${mintTx} — waiting for receipt`);
    await publicClient.waitForTransactionReceipt({ hash: mintTx });
  }

  if (!confirmed) {
    console.log("\nDRY RUN COMPLETE for the approve step too — re-run with BOUND_SETUP_CONFIRM=yes to approve the registrar.");
    return;
  }

  console.log("\n--- approving ETHRegistrar to pull payment ---");
  const allowance = await publicClient.readContract({
    address: MOCK_USDC,
    abi: erc20ReadAbi,
    functionName: "allowance",
    args: [owner.address, ENSV2_SEPOLIA.ethRegistrar],
  });
  if (allowance >= price) {
    console.log(`allowance ${allowance} already covers price ${price} — nothing to do.`);
    return;
  }
  const approveTx = await walletClient.writeContract({
    address: MOCK_USDC,
    abi: erc20ApproveAbi,
    functionName: "approve",
    args: [ENSV2_SEPOLIA.ethRegistrar, price],
  });
  console.log(`approve tx ${approveTx} — waiting for receipt`);
  await publicClient.waitForTransactionReceipt({ hash: approveTx });
  console.log("done — owner now holds and has approved enough MockUSDC. Re-run setup-root-name.ts with BOUND_PAYMENT_TOKEN set to MockUSDC and BOUND_SETUP_CONFIRM=yes.");
}

void main();
