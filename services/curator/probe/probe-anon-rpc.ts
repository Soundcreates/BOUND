#!/usr/bin/env node
/**
 * Phase 0 feasibility probe (plan §5, Developer 2): "verify Anon-RPC worker configuration."
 *
 * Plan §5's shared exit gate is explicit that this alone is not sufficient: "The Anon-RPC
 * path works in the built MV3 extension's offscreen host; a standalone worker probe alone
 * does not pass." `AnonRpcWorker` needs `chrome.offscreen` or a background-page DOM, which
 * Node does not have — so this script checks only what IS verifiable from Node: that the
 * chosen worker's specifier contract is real, deployed, and on the chain BOUND expects. The
 * actual boot — fetching the bundle, verifying its hash, running it in the sandboxed iframe,
 * and making one real anonymized call — is `integrations/anon-rpc/probe-extension/`, which
 * MUST also be run and recorded before this gate can be marked passed.
 *
 * Run it yourself:
 *
 *   BOUND_SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com \
 *   node --experimental-strip-types probe/probe-anon-rpc.ts
 */
import { KNOWN_WORKERS, networkWorkersOnChain, isContract } from "@bound/integrations-anon-rpc";
import { SEPOLIA_CHAIN_ID } from "@bound/integrations-ens";

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

function jsonRpcProvider(rpcUrl: string) {
  let id = 0;
  return {
    async request({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params ?? [] }),
      });
      const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (body.error) throw new Error(body.error.message ?? "RPC error");
      return body.result;
    },
  };
}

async function main(): Promise<void> {
  const rpcUrl = need("BOUND_SEPOLIA_RPC_URL");
  const provider = jsonRpcProvider(rpcUrl);

  section("1. known workers inventory");
  for (const w of KNOWN_WORKERS) {
    console.log(`  ${w.id.padEnd(12)} chain=${w.chainId.toString().padEnd(10)} kind=${w.kind.padEnd(9)} ${w.specifier}`);
  }

  section(`2. genuinely anonymizing ("network") workers on Sepolia (chain ${SEPOLIA_CHAIN_ID})`);
  const sepoliaWorkers = networkWorkersOnChain(SEPOLIA_CHAIN_ID);
  if (sepoliaWorkers.length === 0) {
    console.error("FAIL: no genuinely anonymizing worker published on BOUND's target chain — see plan §7: mark the Anon-RPC integration incomplete");
    process.exit(1);
  }
  console.log(`found ${sepoliaWorkers.length}: ${sepoliaWorkers.map((w) => w.id).join(", ")}`);

  section("3. default worker's specifier is real deployed bytecode on Sepolia");
  const chosen = sepoliaWorkers[0]!;
  const connectedChainId = Number(await provider.request({ method: "eth_chainId", params: [] }));
  console.log(`bootstrap RPC chainId=${connectedChainId} (expect ${SEPOLIA_CHAIN_ID})`);
  if (connectedChainId !== SEPOLIA_CHAIN_ID) {
    console.error("FAIL: BOUND_SEPOLIA_RPC_URL is not actually on Sepolia");
    process.exit(1);
  }
  const deployed = await isContract(provider, chosen.specifier);
  console.log(`${chosen.id} specifier ${chosen.specifier}: contract deployed = ${deployed}`);
  if (!deployed) {
    console.error("FAIL: specifier address has no code on-chain — this worker cannot be booted; re-check adopters.json5 against upstream");
    process.exit(1);
  }

  section("done — Node-side checks only");
  console.log(
    "This confirms the specifier contract exists and is reachable. It does NOT confirm the worker boots, " +
      "the bundle hash-verifies, or a real anonymized call succeeds — run " +
      "integrations/anon-rpc/probe-extension/ in a real Chromium browser for that half, and record BOTH " +
      "results in the Phase 0 evidence log before marking this gate passed.",
  );
}

void main();
