#!/usr/bin/env node
/**
 * One-time Phase 0 setup: register BOUND's ENSv2 Sepolia root name, deploy a DEDICATED
 * PermissionedResolver proxy for it, and scope the curator key down to exactly
 * ROLE_SET_TEXT on the bound.root.v1 key (plan §3: "Default to a dedicated resolver").
 *
 * This is NOT probe-ens.ts. probe-ens.ts assumes the name/resolver/role already exist;
 * this script is what creates them, once, using the OWNER/ADMIN key (never the curator
 * key — plan's governance table keeps those separate: "ENS name owner/admin: ... highest-
 * trust key, separate from curator").
 *
 * IMPORTANT — price is not yet confirmed as plain Sepolia ETH. ENSv2 registration is
 * USD-denominated and docs.ens.domains/ensv2/eth-registrar's own example passes a
 * paymentToken that is NOT address(0) (an ERC20, e.g. a mock USDC/DAI on Sepolia). This
 * script PROBES which paymentToken actually works (read-only, zero cost) before spending
 * anything, and refuses to register until BOUND_SETUP_CONFIRM=yes is set — per plan's own
 * "never guess an address or a tx effect" discipline. Run the probe step first:
 *
 *   BOUND_SEPOLIA_RPC_URL=... \
 *   BOUND_OWNER_PRIVATE_KEY=0x... \
 *   BOUND_CURATOR_ADDRESS=0x... \
 *   BOUND_LABEL=your-label-without-dot-eth \
 *   node --experimental-strip-types probe/setup-root-name.ts
 *
 * Then re-run with BOUND_SETUP_CONFIRM=yes and (if an ERC20 path is required)
 * BOUND_PAYMENT_TOKEN=0x... once you've confirmed you hold/approved enough of that token.
 */
import { privateKeyToAccount } from "viem/accounts";
import { zeroAddress, parseAbi, type Address } from "viem";
import {
  makePublicClient,
  makeWalletClient,
  isLabelAvailable,
  registerPrice,
  deployDedicatedResolver,
  commitRegistration,
  finishRegistration,
  grantCuratorRole,
  ENSV2_SEPOLIA,
  SEPOLIA_CHAIN_ID,
} from "@bound/integrations-ens";

// Candidate payment tokens to probe, in the order the registration will try them.
// MockDAI / MockUSDC come from the same docs.ens.domains Sepolia deployment list as the
// rest of ENSV2_SEPOLIA (verified 2026-11-06) — publicly-mintable test tokens, not real
// money. address(0) is tried first on the chance this deployment still accepts native ETH.
const CANDIDATE_PAYMENT_TOKENS: { label: string; address: Address }[] = [
  { label: "native ETH (address(0))", address: zeroAddress },
  { label: "MockUSDC", address: "0x240b0316df57887dbbe58b586508b19e633a14aa" },
  { label: "MockDAI", address: "0xf6fac8a58a0be13b9197f27c41b73162fe32572b" },
];

const erc20ReadAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

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
  const ownerKey = need("BOUND_OWNER_PRIVATE_KEY") as `0x${string}`;
  const curatorAddress = need("BOUND_CURATOR_ADDRESS") as Address;
  const label = need("BOUND_LABEL");
  const confirmed = process.env.BOUND_SETUP_CONFIRM === "yes";
  const chosenPaymentToken = process.env.BOUND_PAYMENT_TOKEN as Address | undefined;
  const durationSeconds = BigInt(process.env.BOUND_DURATION_SECONDS ?? 60 * 60 * 24 * 365); // 1 year default

  if (label.includes(".")) {
    console.error(`BOUND_LABEL should be the label only (e.g. "bound-demo"), not "${label}" — do not include ".eth"`);
    process.exit(2);
  }

  const owner = privateKeyToAccount(ownerKey);
  const publicClient = makePublicClient(rpcUrl);
  const walletClient = makeWalletClient(rpcUrl, owner);

  section("0. network reachability");
  const chainId = await publicClient.getChainId();
  console.log(`connected, chainId=${chainId} (expect ${SEPOLIA_CHAIN_ID})`);
  if (chainId !== SEPOLIA_CHAIN_ID) {
    console.error("WRONG CHAIN — stopping");
    process.exit(1);
  }

  section("1. label availability");
  const available = await isLabelAvailable(publicClient, label);
  console.log(`"${label}.eth" available: ${available}`);
  if (!available) {
    console.error("label is taken — choose another BOUND_LABEL and re-run");
    process.exit(1);
  }

  section("2. probe which paymentToken this deployment actually accepts (read-only, zero cost)");
  const working: { label: string; address: Address; price: bigint }[] = [];
  for (const candidate of CANDIDATE_PAYMENT_TOKENS) {
    try {
      const price = await registerPrice(publicClient, label, durationSeconds, candidate.address);
      console.log(`  ${candidate.label} (${candidate.address}): OK, price = ${price.toString()} base units`);
      working.push({ ...candidate, price });
    } catch (e) {
      console.log(`  ${candidate.label} (${candidate.address}): REJECTED (${(e as Error).message.slice(0, 120)})`);
    }
  }
  if (working.length === 0) {
    console.error(
      "no candidate paymentToken was accepted by getRegisterPrice — this deployment needs a token this " +
        "script doesn't know about. Check https://docs.ens.domains/learn/deployments for the current mock " +
        "payment token address and add it to CANDIDATE_PAYMENT_TOKENS, then re-run.",
    );
    process.exit(1);
  }

  if (!confirmed) {
    section("DRY RUN COMPLETE — no transaction submitted");
    console.log(
      "Re-run with BOUND_SETUP_CONFIRM=yes to actually register. If an ERC20 path is required (anything " +
        "other than native ETH above), also set BOUND_PAYMENT_TOKEN to the address you want to pay with, and " +
        "make sure the owner account (" + owner.address + ") holds and has approved enough of that token for " +
        "the ETHRegistrar (" + ENSV2_SEPOLIA.ethRegistrar + ") to pull — this script does not mint or approve " +
        "tokens for you, since a test token's mint function is not yet verified against the live contract.",
    );
    return;
  }

  const paymentToken = chosenPaymentToken ?? working[0]!.address;
  if (!working.some((w) => w.address.toLowerCase() === paymentToken.toLowerCase())) {
    console.error(`BOUND_PAYMENT_TOKEN ${paymentToken} was not one of the tokens that passed the probe above`);
    process.exit(1);
  }
  console.log(`\nproceeding with paymentToken = ${paymentToken}`);

  if (paymentToken !== zeroAddress) {
    const priceEntry = working.find((w) => w.address.toLowerCase() === paymentToken.toLowerCase())!;
    const [balance, allowance] = await Promise.all([
      publicClient.readContract({ address: paymentToken, abi: erc20ReadAbi, functionName: "balanceOf", args: [owner.address] }),
      publicClient.readContract({ address: paymentToken, abi: erc20ReadAbi, functionName: "allowance", args: [owner.address, ENSV2_SEPOLIA.ethRegistrar] }),
    ]);
    if (balance < priceEntry.price || allowance < priceEntry.price) {
      console.error(
        `REFUSING to continue: owner holds ${balance} / needs ${priceEntry.price}, and has approved ${allowance} / needs ` +
          `${priceEntry.price} of ${paymentToken} for the ETHRegistrar to pull. Run acquire-mock-usdc.ts first (it mints ` +
          "and approves via a signature it verified by simulation, never a guess), then re-run this script.",
      );
      process.exit(1);
    }
    console.log(`owner holds ${balance} and has approved ${allowance} of ${paymentToken} — sufficient.`);
  }

  section("3. deploy dedicated PermissionedResolver proxy (admin = owner, scoped down after registration)");
  const salt = BigInt(Date.now());
  const resolverAddress = await deployDedicatedResolver(walletClient, publicClient, owner.address, salt);
  console.log(`dedicated resolver deployed at ${resolverAddress}`);

  section("4. commit");
  const secret = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex")}` as `0x${string}`;
  const { minAgeSeconds } = await commitRegistration(walletClient, publicClient, {
    label,
    owner: owner.address,
    secret,
    subregistry: zeroAddress,
    resolver: resolverAddress,
    durationSeconds,
    paymentToken,
    referrer: ("0x" + "00".repeat(32)) as `0x${string}`,
  });
  console.log(`commitment submitted, minAgeSeconds=${minAgeSeconds} — waiting...`);
  await new Promise((r) => setTimeout(r, Number(minAgeSeconds) * 1000 + 5000));

  section("5. register");
  const registerTx = await finishRegistration(walletClient, {
    label,
    owner: owner.address,
    secret,
    subregistry: zeroAddress,
    resolver: resolverAddress,
    durationSeconds,
    paymentToken,
    referrer: ("0x" + "00".repeat(32)) as `0x${string}`,
  });
  console.log(`register tx ${registerTx} — waiting for receipt`);
  await publicClient.waitForTransactionReceipt({ hash: registerTx });
  console.log(`"${label}.eth" is registered, resolver = ${resolverAddress}`);

  section("6. scope the curator down to ROLE_SET_TEXT on bound.root.v1 only");
  const grantTx = await grantCuratorRole(walletClient, resolverAddress, curatorAddress);
  console.log(`grant tx ${grantTx} — waiting for receipt`);
  await publicClient.waitForTransactionReceipt({ hash: grantTx });

  section("done");
  console.log(`BOUND_ROOT_NAME=${label}.eth`);
  console.log(`BOUND_RESOLVER_ADDRESS=${resolverAddress}`);
  console.log("Save both into server/curator/.env, then run probe-ens.ts to verify the curator can write and nothing else can.");
}

void main();
