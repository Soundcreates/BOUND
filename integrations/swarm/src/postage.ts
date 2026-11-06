/**
 * Postage batch validation.
 *
 * Every Swarm upload is paid for by a postage batch: a pre-purchased allowance of storage
 * depth/time, identified by a 32-byte batch id. Bee's `/stamps/:batchId` endpoint reports
 * whether a given batch id is known to the node and still usable. BOUND's curator CLI must
 * check this *before* attempting an upload — a stale/exhausted/unknown batch id otherwise
 * fails with an opaque 422 deep inside the upload call.
 *
 * Reference: Bee API, `GET /stamps/{batch_id}` → PostageBatch schema (batchID, utilization,
 * usable, label, depth, amount, bucketDepth, blockNumber, immutableFlag, exists, batchTTL).
 */

const BATCH_ID_RE = /^[0-9a-f]{64}$/;

export function isPostageBatchId(v: unknown): v is string {
  return typeof v === "string" && BATCH_ID_RE.test(v);
}

export function assertPostageBatchId(v: string, context: string): string {
  if (!isPostageBatchId(v)) {
    throw new TypeError(`${context}: expected a 64-char lowercase hex postage batch id (no 0x), got ${JSON.stringify(v)}`);
  }
  return v;
}

export interface PostageBatchStatus {
  readonly batchID: string;
  readonly exists: boolean;
  readonly usable: boolean;
  readonly utilization: number;
  readonly depth: number;
  readonly bucketDepth: number;
  readonly amount: string;
  readonly batchTTL: number;
  readonly immutableFlag: boolean;
}

export class PostageBatchError extends Error {
  readonly batchId: string;
  constructor(message: string, batchId: string) {
    super(message);
    this.name = "PostageBatchError";
    this.batchId = batchId;
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  if (typeof v !== "object" || v === null) {
    throw new TypeError("expected an object");
  }
  return v as Record<string, unknown>;
}

function requireBoolean(obj: Record<string, unknown>, key: string): boolean {
  const v = obj[key];
  if (typeof v !== "boolean") throw new TypeError(`expected boolean field "${key}"`);
  return v;
}

function requireNumber(obj: Record<string, unknown>, key: string): number {
  const v = obj[key];
  if (typeof v !== "number" || !Number.isFinite(v)) throw new TypeError(`expected numeric field "${key}"`);
  return v;
}

function requireString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== "string") throw new TypeError(`expected string field "${key}"`);
  return v;
}

/** Parses a Bee `/stamps/:batchId` JSON response body into a typed, validated status. */
export function parsePostageBatchStatus(body: unknown): PostageBatchStatus {
  const obj = asRecord(body);
  return {
    batchID: requireString(obj, "batchID"),
    exists: requireBoolean(obj, "exists"),
    usable: requireBoolean(obj, "usable"),
    utilization: requireNumber(obj, "utilization"),
    depth: requireNumber(obj, "depth"),
    bucketDepth: requireNumber(obj, "bucketDepth"),
    amount: requireString(obj, "amount"),
    batchTTL: requireNumber(obj, "batchTTL"),
    immutableFlag: requireBoolean(obj, "immutableFlag"),
  };
}

/**
 * Fetches and validates a postage batch's status from a Bee node's own API (this is a local
 * admin-plane call against the curator's own node — not a public gateway call).
 *
 * Throws `PostageBatchError` if the batch does not exist or is not currently usable, so callers
 * get a clear failure before attempting an upload rather than a confusing upload-time 422.
 */
export async function assertUsablePostageBatch(beeApiUrl: string, batchId: string): Promise<PostageBatchStatus> {
  assertPostageBatchId(batchId, "assertUsablePostageBatch");
  const base = beeApiUrl.endsWith("/") ? beeApiUrl.slice(0, -1) : beeApiUrl;
  const res = await fetch(`${base}/stamps/${batchId}`, { method: "GET" });
  if (!res.ok) {
    throw new PostageBatchError(`stamps lookup failed: HTTP ${res.status}`, batchId);
  }
  const status = parsePostageBatchStatus(await res.json());
  if (!status.exists) {
    throw new PostageBatchError("postage batch does not exist on this node", batchId);
  }
  if (!status.usable) {
    throw new PostageBatchError("postage batch exists but is not usable (likely expired or still syncing)", batchId);
  }
  return status;
}
