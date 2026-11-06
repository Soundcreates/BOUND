export interface ArkivEntity {
  key: string;
  owner: string;
  expiresAt: number;
  record: Record<string, unknown>;
}

export interface ArkivArchive {
  writeTrustSnapshot(record: Record<string, unknown>, id: string): Promise<ArkivEntity>;
  readEntity(key: string): Promise<ArkivEntity | null>;
  currentBlock(): Promise<number>;
  close(): Promise<void>;
}

export function openArkivArchive(options: Record<string, unknown>): Promise<ArkivArchive>;
