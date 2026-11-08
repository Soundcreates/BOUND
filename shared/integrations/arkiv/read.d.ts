export interface ArkivReadEntity {
  key: string;
  owner: string;
  expiresAt: number;
  record: Record<string, unknown>;
}

export function readArkivEntity(options: {
  url: string;
  accessKey?: string;
  owner: string;
  chainId: number;
  schemaTag: string;
  entityKey: string;
  fetchImpl?: typeof fetch;
}): Promise<ArkivReadEntity | null>;
