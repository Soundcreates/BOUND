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
  readonly blockNumber: bigint;
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

  // The extension binds a snapshot to the name it was published under:
  // `trust-engine.mjs:checkSnapshot` throws unless `snapshot.rootName === anchor.name`,
  // which stops a snapshot published for one name being replayed under another. Nothing
  // upstream of here enforced that, so a snapshot compiled with rootName "bound-demo.eth"
  // could be published to "bound-v2.eth", read back as verified by `curator read` (which
  // only compared digest and epoch), and then be rejected by every extension in the field.
  // Refuse it here, before the Swarm upload and the ENS write, per this codebase's rule
  // that a publisher must refuse exactly what any other reader would refuse.
  if (snapshot.rootName !== config.ens.rootName) {
    throw new PublishRefusedError(
      `snapshot is bound to rootName ${JSON.stringify(snapshot.rootName)} but this config publishes to ` +
        `${JSON.stringify(config.ens.rootName)}. The extension checks snapshot.rootName against the name it ` +
        `read the root from and would reject this snapshot. Recompile with rootName set to the publishing name.`,
    );
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
    const receipt = await publicClient.waitForTransactionReceipt({hash: txHash});
    if (receipt.status !== "success") throw new Error(`root publish tx ${txHash} reverted in block ${receipt.blockNumber}`);
    return { arkivKey: stored.key, arkivOwner: stored.owner, digest: compiled.digest, epoch: snapshot.epoch, txHash, blockNumber: receipt.blockNumber, previousEpoch };
  } finally {
    await archive.close();
  }
}
