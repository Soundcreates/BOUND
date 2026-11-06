/** Store the canonical snapshot in Arkiv, then publish its owner-checked pointer through ENS. */
import { keccak256 } from "ethers";
import { makePublicClient, makeWalletClient, readRootRecord, publishRootRecord, RootReadError } from "@bound/integrations-ens";
import { openArkivArchive } from "../../../integrations/arkiv/archive.js";
import { assertMonotonicEpoch, type Snapshot } from "@bound/snapshot";
import type { CuratorConfig } from "./env.ts";

const MAX_SNAPSHOT_BYTES = 61_440;
const utf8 = new TextDecoder("utf-8", { fatal: true });

export class PublishRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishRefusedError";
  }
}

export interface PublishResult {
  readonly arkivKey: string;
  readonly arkivOwner: string;
  readonly digest: `0x${string}`;
  readonly epoch: number;
  readonly txHash: `0x${string}`;
  readonly previousEpoch?: number;
}

export async function publishSnapshot(
  config: CuratorConfig,
  snapshot: Snapshot,
  compiled: { bytes: Uint8Array; digest: `0x${string}` },
): Promise<PublishResult> {
  if (compiled.bytes.length > MAX_SNAPSHOT_BYTES) {
    throw new PublishRefusedError(`snapshot is ${compiled.bytes.length} bytes; the Arkiv record limit is ${MAX_SNAPSHOT_BYTES} bytes`);
  }
  if (typeof config.arkiv.prepare !== "function" || typeof config.arkiv.inspect !== "function" || !config.arkiv.senderJournal || !config.arkiv.registryJournal) {
    throw new Error("Arkiv publishing requires BOUND_ARKIV_PRIVATE_KEY and distinct Arkiv journal paths");
  }

  const publicClient = makePublicClient(config.rpcUrl);
  let previousEpoch: number | undefined;
  try {
    previousEpoch = (await readRootRecord(publicClient, config.ens)).epoch;
  } catch (error) {
    if (!(error instanceof RootReadError) || !/empty root record/.test(error.message)) throw error;
  }
  try {
    assertMonotonicEpoch(previousEpoch, snapshot.epoch);
  } catch (error) {
    throw new PublishRefusedError((error as Error).message);
  }

  const archive = await openArkivArchive({
    ...config.arkiv,
    hash: keccak256,
    confirmTimeoutMs: 20_000,
    confirmPollMs: 1_000,
  });
  try {
    const canonical = utf8.decode(compiled.bytes);
    const stored = await archive.writeTrustSnapshot({
      schemaVersion: 1,
      kind: "trust_snapshot",
      network: snapshot.network,
      epoch: snapshot.epoch,
      digest: compiled.digest,
      canonical,
    }, compiled.digest.slice(2));
    if (stored.owner !== config.arkiv.owner || stored.record.kind !== "trust_snapshot" || stored.record.digest !== compiled.digest || stored.record.canonical !== canonical) {
      throw new Error("Arkiv snapshot write did not return the expected owner-checked record");
    }

    const walletClient = makeWalletClient(config.rpcUrl, config.curatorAccount);
    const txHash = await publishRootRecord(walletClient, publicClient, config.ens, {
      arkivKey: stored.key as `0x${string}`,
      arkivOwner: stored.owner as `0x${string}`,
      digest: compiled.digest,
      epoch: snapshot.epoch,
      network: snapshot.network,
      schemaVersion: snapshot.schemaVersion,
    });
    return { arkivKey: stored.key, arkivOwner: stored.owner, digest: compiled.digest, epoch: snapshot.epoch, txHash, previousEpoch };
  } finally {
    await archive.close();
  }
}
