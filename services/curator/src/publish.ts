/**
 * The curator's publish path: compile -> upload to Swarm -> publish the ENS root record.
 *
 * Plan §5 Phase 1, Developer 2 gate (verbatim): "Make the curator CLI refuse an epoch less
 * than or equal to the published epoch." That is enforced here, against the LIVE published
 * root — not just against whatever epoch the curator last compiled locally — because the
 * live root is the thing a rollback/equivocation attempt would actually be judged against.
 * `@bound/snapshot`'s `assertMonotonicEpoch` is the same guard `compile.ts` uses against a
 * caller-supplied "previous epoch"; this module is what supplies that previous epoch from
 * the real chain instead of trusting a local file.
 */
import { makePublicClient, makeWalletClient, readRootRecord, publishRootRecord, RootReadError } from "@bound/integrations-ens";
import { uploadAndSelfVerify } from "@bound/integrations-swarm";
import { assertMonotonicEpoch, type Snapshot } from "@bound/snapshot";
import type { CuratorConfig } from "./env.ts";

export class PublishRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishRefusedError";
  }
}

export interface PublishResult {
  readonly swarmRef: string;
  readonly digest: `0x${string}`;
  readonly epoch: number;
  readonly txHash: `0x${string}`;
  /** Block the root write was confirmed in. Present because publish waits for the receipt. */
  readonly blockNumber: bigint;
  /** undefined if this is the first-ever publish for this name (no live root to compare against). */
  readonly previousEpoch?: number;
}

/**
 * Reads the live root (if any), refuses a non-advancing epoch, uploads the compiled bytes
 * to Swarm (our own Bee node, or unstamped to a public gateway; self-verified round-trip either way), and publishes the new root
 * record. Every step is sequential and each failure is specific — a caller must be able to
 * tell "refused due to rollback" apart from "Swarm upload failed" apart from "ENS write
 * reverted," since the three call for different operator responses.
 */
export async function publishSnapshot(
  config: CuratorConfig,
  snapshot: Snapshot,
  compiled: { bytes: Uint8Array; digest: `0x${string}` },
): Promise<PublishResult> {
  const publicClient = makePublicClient(config.rpcUrl);

  let previousEpoch: number | undefined;
  try {
    const current = await readRootRecord(publicClient, config.ens);
    previousEpoch = current.epoch;
  } catch (e) {
    // No live root yet (first publish for this name) is fine and expected; anything else —
    // wrong pinned resolver, a malformed existing record — must NOT be silently treated as
    // "no root," or a publish could paper over a real problem with the live name.
    if (!(e instanceof RootReadError) || !/empty root record/.test(e.message)) {
      throw e;
    }
  }

  try {
    assertMonotonicEpoch(previousEpoch, snapshot.epoch);
  } catch (e) {
    throw new PublishRefusedError((e as Error).message);
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

  const swarmRef = await uploadAndSelfVerify(
    config.swarmUpload.mode === "bee"
      ? { apiUrl: config.swarmUpload.apiUrl, batchId: config.swarmUpload.batchId }
      : { apiUrl: config.swarmUpload.apiUrl, stampedByHost: true },
    compiled.bytes,
  );

  const walletClient = makeWalletClient(config.rpcUrl, config.curatorAccount);
  const txHash = await publishRootRecord(walletClient, publicClient, config.ens, {
    digest: compiled.digest,
    epoch: snapshot.epoch,
    network: snapshot.network,
    schemaVersion: snapshot.schemaVersion,
    swarmRef,
  });

  // `writeContract` resolves as soon as the transaction is accepted into the mempool, not
  // when it is mined. Returning that hash as if the publish were done means anything that
  // reads the root immediately afterwards — `curator read`, the extension, a demo script —
  // resolves the PREVIOUS epoch and reports a mismatch against data that is seconds away
  // from being correct. That failure is maximally confusing because every value it prints
  // is real, just one epoch stale.
  //
  // This is the third time this exact race has been fixed in this codebase: `attest-write`
  // (05a3891) and `attest-grant` (9513545) both had it. It lives in the library this time
  // rather than in the CLI, so a new caller cannot reintroduce it by forgetting to wait.
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`root publish tx ${txHash} reverted in block ${receipt.blockNumber} — the root was NOT updated`);
  }

  return { swarmRef, digest: compiled.digest, epoch: snapshot.epoch, txHash, blockNumber: receipt.blockNumber, previousEpoch };
}
