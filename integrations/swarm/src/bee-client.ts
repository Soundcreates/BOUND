/**
 * Upload path: curator's own Bee node, `/bytes` raw-data API.
 *
 * BOUND stores exactly one kind of object in Swarm: a single canonical-JSON blob (a compiled
 * snapshot, or a verification report) with no filename and no directory structure. That maps
 * directly onto Bee's `/bytes` endpoint rather than `/bzz` (which is for file/directory
 * manifests and wants a `name` + `Content-Type` and manifest-path semantics on read).
 *
 * Reference: Bee API — `POST /bytes` (body: raw bytes; required header
 * `swarm-postage-batch-id: <64-hex-char batch id>`; optional `swarm-tag`, `swarm-pin`,
 * `swarm-deferred-upload`) → `{ reference: <64-hex-char swarm reference> }`.
 * `GET /bytes/:reference` → raw bytes back.
 */

import { assertCanonicalSwarmRef, isCanonicalSwarmRef } from "@bound/snapshot";
import { assertPostageBatchId } from "./postage.ts";

export interface BeeClientConfig {
  readonly apiUrl: string;
  /** Our own postage batch. Omit ONLY together with `stampedByHost: true`. */
  readonly batchId?: string;
  /**
   * Let the upload host apply its own postage batch: a public Bee gateway stamps an
   * unstamped `POST /bytes` for free. This is opt-in and never inferred from a missing
   * `batchId`, for two reasons. An accidentally unstamped upload to a real Bee node is
   * rejected outright, and an intentionally unstamped upload to a gateway buys no
   * persistence guarantee — the host's batch, not ours, decides how long the bytes
   * survive. Integrity is unaffected either way: the root record's digest is what makes
   * served bytes unforgeable, so what is traded away here is availability, never trust.
   */
  readonly stampedByHost?: boolean;
  /** Defaults to false: wait for the upload to be synced before returning the reference. */
  readonly deferred?: boolean;
  /** Pin the content on this node so garbage collection cannot evict it. Defaults to true. */
  readonly pin?: boolean;
}

export class BeeUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BeeUploadError";
  }
}

export class BeeDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BeeDownloadError";
  }
}

function trimBase(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/** Uploads raw bytes to the curator's own Bee node and returns the resulting Swarm reference. */
export async function uploadBytes(config: BeeClientConfig, bytes: Uint8Array): Promise<string> {
  const base = trimBase(config.apiUrl);
  const headers: Record<string, string> = { "Content-Type": "application/octet-stream" };
  if (config.stampedByHost) {
    if (config.batchId !== undefined) {
      throw new TypeError(
        "uploadBytes: pass either batchId (our own batch) or stampedByHost (the host's), not both — " +
          "the two describe different payers and silently preferring one would hide which was used",
      );
    }
    // Deliberately no swarm-* headers at all. A public gateway stamps with its own batch and
    // ignores or rejects pin/deferred directives from an anonymous caller, so sending them
    // would turn a working upload into an opaque 4xx.
  } else {
    if (config.batchId === undefined) {
      throw new TypeError(
        "uploadBytes: no batchId. Pass our own postage batch id, or set stampedByHost: true to let " +
          "a public Bee gateway stamp the upload (free, but the host's batch decides persistence)",
      );
    }
    assertPostageBatchId(config.batchId, "uploadBytes");
    headers["swarm-postage-batch-id"] = config.batchId;
    headers["swarm-deferred-upload"] = String(config.deferred ?? false);
    headers["swarm-pin"] = String(config.pin ?? true);
  }
  const res = await fetch(`${base}/bytes`, { method: "POST", headers, body: bytes });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new BeeUploadError(`Bee upload failed: HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
  }
  const body = (await res.json()) as unknown;
  if (typeof body !== "object" || body === null || typeof (body as { reference?: unknown }).reference !== "string") {
    throw new BeeUploadError("Bee upload response missing a string 'reference' field");
  }
  const reference = (body as { reference: string }).reference;
  if (!isCanonicalSwarmRef(reference)) {
    throw new BeeUploadError(`Bee returned a malformed reference: ${JSON.stringify(reference)}`);
  }
  return reference;
}

/** Downloads raw bytes for a reference from a given Bee node (or any Bee-compatible gateway). */
export async function downloadBytes(apiUrl: string, reference: string): Promise<Uint8Array> {
  assertCanonicalSwarmRef(reference, "downloadBytes");
  const base = trimBase(apiUrl);
  const res = await fetch(`${base}/bytes/${reference}`, { method: "GET" });
  if (!res.ok) {
    throw new BeeDownloadError(`Bee download failed: HTTP ${res.status} for reference ${reference}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/**
 * Uploads to the curator's own node, then immediately downloads the same reference from the
 * same node and compares bytes. This is NOT redundant with Swarm's own content-addressing
 * (Bee computes and checks its internal BMT hash on every request already) — it is a defense
 * against the upload/response path itself: a misbehaving proxy, a truncated request body, or
 * a Bee-side bug returning a reference that does not actually resolve to what was sent. The
 * curator must not publish an ENS root record pointing at a reference it has not confirmed,
 * byte-for-byte, resolves back to its own compiled snapshot.
 */
export async function uploadAndSelfVerify(config: BeeClientConfig, bytes: Uint8Array): Promise<string> {
  const reference = await uploadBytes(config, bytes);
  const roundTripped = await downloadBytes(config.apiUrl, reference);
  if (!bytesEqual(bytes, roundTripped)) {
    throw new BeeUploadError(
      `self-verification failed: uploaded ${bytes.length} bytes but re-downloaded ${roundTripped.length} bytes that did not match for reference ${reference}`,
    );
  }
  return reference;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
