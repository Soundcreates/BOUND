/** Read ENS's Arkiv pointer, then verify the owner, entity lifetime and snapshot digest. */
import { makePublicClient, readRootRecord, type RootReadError } from "@bound/integrations-ens";
import { readArkivEntity } from "../../../integrations/arkiv/read.js";
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

export async function readAndVerifyRoot(config: CuratorConfig): Promise<ReadResult> {
  const publicClient = makePublicClient(config.rpcUrl);
  const root = await readRootRecord(publicClient, config.ens);
  if (root.arkivOwner !== config.arkiv.owner) throw new RootVerificationError("ENS root names an unexpected Arkiv owner");

  const entity = await readArkivEntity({
    url: config.arkiv.url,
    accessKey: config.arkiv.accessKey,
    owner: root.arkivOwner,
    chainId: config.arkiv.chainId,
    schemaTag: config.arkiv.schemaTag,
    entityKey: root.arkivKey,
  });
  if (!entity || entity.key !== root.arkivKey || entity.owner !== root.arkivOwner || entity.record.kind !== "trust_snapshot") {
    throw new RootVerificationError("ENS Arkiv snapshot entity is missing, expired or has the wrong owner or kind");
  }
  const record = entity.record;
  if (record.digest !== root.digest || record.epoch !== root.epoch || record.network !== root.network || typeof record.canonical !== "string") {
    throw new RootVerificationError("Arkiv snapshot metadata does not match the ENS root");
  }

  let decoded;
  try {
    decoded = decodeSnapshotBytes(new TextEncoder().encode(record.canonical));
  } catch (error) {
    throw new RootVerificationError(`Arkiv snapshot bytes are not valid canonical data: ${(error as Error).message}`);
  }
  if (decoded.digest !== root.digest || decoded.snapshot.epoch !== root.epoch || decoded.snapshot.network !== root.network) {
    throw new RootVerificationError("Arkiv snapshot digest, epoch or network does not match the ENS root");
  }
  return { root, snapshot: decoded.snapshot };
}

export type { RootReadError };
