/**
 * The curator's own read-back check: read the live root, fetch the referenced bytes from
 * at least two independent gateways, and confirm they decode to exactly that root's digest.
 * This is the curator side of plan §5 Phase 1 Developer 2 gate: "an independent Swarm
 * gateway returns bytes whose digest matches" — run right after `publish` as a sanity
 * check, and independently by anyone auditing a live root.
 */
import { makePublicClient, readRootRecord, type RootReadError } from "@bound/integrations-ens";
import { fetchFromGateways } from "@bound/integrations-swarm";
import { decodeSnapshotBytes, type RootRecord, type Snapshot } from "@bound/snapshot";
import type { CuratorConfig } from "./env.ts";

export class RootVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RootVerificationError";
  }
}

export interface ReadResult {
  readonly root: RootRecord;
  readonly snapshot: Snapshot;
}

/**
 * Reads the live root, fetches its referenced bytes from `config.gatewayUrls` (requiring
 * agreement from at least 2, per plan §3's second-gateway requirement), and verifies the
 * decoded digest and epoch match the root exactly. Throws `RootVerificationError` naming
 * the mismatch rather than returning a boolean — "which field disagreed" is the entire
 * point of running this as a diagnostic.
 */
export async function readAndVerifyRoot(config: CuratorConfig): Promise<ReadResult> {
  const publicClient = makePublicClient(config.rpcUrl);
  const root = await readRootRecord(publicClient, config.ens);

  if (!root.swarmRef) {
    throw new RootVerificationError("live root record does not contain a swarm reference");
  }

  const bytes = await fetchFromGateways(root.swarmRef, config.gatewayUrls, { minAgree: Math.min(2, config.gatewayUrls.length) });

  let decoded;
  try {
    decoded = decodeSnapshotBytes(bytes);
  } catch (e) {
    throw new RootVerificationError(`fetched bytes for ${root.swarmRef} do not decode to a valid canonical snapshot: ${(e as Error).message}`);
  }
  if (decoded.digest !== root.digest) {
    throw new RootVerificationError(`fetched snapshot digest ${decoded.digest} does not match root digest ${root.digest}`);
  }
  if (decoded.snapshot.epoch !== root.epoch) {
    throw new RootVerificationError(`fetched snapshot epoch ${decoded.snapshot.epoch} does not match root epoch ${root.epoch}`);
  }
  // The three checks below exist because this function previously verified only digest and
  // epoch while `client/extension/trust-engine.mjs:checkSnapshot` verifies digest, epoch,
  // network (against both the root and the configured anchor), rootName, and generatedAt.
  // A weaker reader is worse than no reader: it reported "live root verified" for a
  // snapshot every extension would reject. Keep this in step with checkSnapshot.
  if (decoded.snapshot.network !== root.network) {
    throw new RootVerificationError(
      `fetched snapshot network ${JSON.stringify(decoded.snapshot.network)} does not match root network ${JSON.stringify(root.network)}`,
    );
  }
  if (decoded.snapshot.rootName !== config.ens.rootName) {
    throw new RootVerificationError(
      `fetched snapshot is bound to rootName ${JSON.stringify(decoded.snapshot.rootName)} but was read from ` +
        `${JSON.stringify(config.ens.rootName)} — the extension would reject this snapshot`,
    );
  }
  if (Date.parse(decoded.snapshot.generatedAt) > Date.now()) {
    throw new RootVerificationError(`fetched snapshot generatedAt ${decoded.snapshot.generatedAt} is in the future`);
  }

  return { root, snapshot: decoded.snapshot };
}

export type { RootReadError };
