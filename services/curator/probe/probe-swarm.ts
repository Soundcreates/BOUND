#!/usr/bin/env node
/**
 * Phase 0 feasibility probe (plan §5, Developer 2): "upload/read/hash a snapshot through
 * the team's Bee/postage batch and a second gateway."
 *
 * Talks to a real Bee node and real public gateways — cannot run in this repo's sandboxed
 * test environment. Run it yourself:
 *
 *   BOUND_BEE_API_URL=http://localhost:1633 \
 *   BOUND_POSTAGE_BATCH_ID=... \
 *   BOUND_SWARM_GATEWAYS=https://gateway1.example,https://gateway2.example \
 *   node --experimental-strip-types probe/probe-swarm.ts
 */
import { assertUsablePostageBatch, uploadAndSelfVerify, downloadBytes, fetchFromGateways } from "@bound/integrations-swarm";
import { keccak256Hex } from "@bound/snapshot";

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
  const beeApiUrl = need("BOUND_BEE_API_URL");
  const postageBatchId = need("BOUND_POSTAGE_BATCH_ID");
  const gatewayUrls = need("BOUND_SWARM_GATEWAYS")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (gatewayUrls.length < 2) {
    console.error("need at least 2 gateway URLs in BOUND_SWARM_GATEWAYS for the second-gateway check");
    process.exit(2);
  }

  section("1. postage batch usability");
  const status = await assertUsablePostageBatch(beeApiUrl, postageBatchId);
  console.log(`batch ${status.batchID}: usable=${status.usable}, depth=${status.depth}, ttl=${status.batchTTL}s`);

  section("2. upload a disposable test payload, self-verified against the same node");
  const payload = new TextEncoder().encode(
    JSON.stringify({ probe: "bound-swarm-phase0", at: new Date().toISOString(), nonce: Math.random().toString(36).slice(2) }),
  );
  const localDigest = keccak256Hex(payload);
  const reference = await uploadAndSelfVerify({ apiUrl: beeApiUrl, batchId: postageBatchId }, payload);
  console.log(`uploaded ${payload.length} bytes, reference ${reference}`);
  console.log(`local digest of payload: ${localDigest}`);

  section("3. read back from the SAME node directly");
  const directReadBack = await downloadBytes(beeApiUrl, reference);
  const directMatches = directReadBack.length === payload.length && keccak256Hex(directReadBack) === localDigest;
  console.log(`direct read-back: ${directMatches ? "OK: byte-identical" : "MISMATCH"}`);

  section("4. read back through at least 2 independent gateways, requiring agreement");
  const gatewayBytes = await fetchFromGateways(reference, gatewayUrls, { minAgree: 2 });
  const gatewayMatches = keccak256Hex(gatewayBytes) === localDigest;
  console.log(`fetched from ${gatewayUrls.length} gateway(s): ${gatewayMatches ? "OK: digest matches" : "MISMATCH"}`);

  section("done");
  console.log(
    `Phase 0 Swarm probe complete. Record this run's reference (${reference}), postage batch ` +
      `(${postageBatchId}), and gateway list in the Phase 0 evidence log.`,
  );
}

void main();
