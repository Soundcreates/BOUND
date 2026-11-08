/**
 * Snapshot bytes -> root digest, and the one place "bytes we received" gets turned into
 * "bytes we trust".
 *
 * Pipeline (plan §3, frozen): raw bytes -> strict UTF-8 decode -> strict JSON parse
 * (duplicate-key / depth / number rejecting) -> schema validation -> re-canonicalize (JCS)
 * -> require the RECEIVED bytes already equal the canonical bytes -> keccak256.
 *
 * The "received bytes == canonical bytes" check is what makes digesting safe to call on
 * attacker-supplied bytes: we never hash a snapshot after re-serializing it through a
 * DIFFERENT serializer than the one that produced the trusted copy (that reordering/
 * reformatting is exactly the bug class JCS exists to close, and checking equality here
 * means we don't even depend on our own canonicalizer being bug-for-bug compatible with
 * whatever produced the original bytes — we simply refuse non-canonical bytes outright).
 */
import { bytesEqual, canonicalBytes, rootDigest } from "./canonical.ts";
import { decodeUtf8Strict, parseStrictJson } from "./strict-json.ts";
import { validateSnapshot, type Snapshot } from "./schema.ts";
import type { Hex } from "./hex.ts";

export class SnapshotBytesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnapshotBytesError";
  }
}

export interface DecodedSnapshot {
  snapshot: Snapshot;
  digest: Hex;
  bytes: Uint8Array;
}

/**
 * Decode, validate and digest raw snapshot bytes (as fetched from Swarm).
 *
 * Every failure mode along this path — invalid UTF-8, a malformed BOM, unparseable JSON,
 * a schema violation, or non-canonical bytes — is normalized to SnapshotBytesError. This
 * is deliberate: callers on the trust path (the verifier, the extension) need exactly one
 * exception type to mean "these bytes cannot be trusted, treat as a hash-mismatch-shaped
 * failure"; they must never have to enumerate every decoder's private error class to stay
 * safe, since an uncaught one there would propagate instead of failing closed to grey.
 */
export function decodeSnapshotBytes(bytes: Uint8Array, maxBytes = 8 * 1024 * 1024): DecodedSnapshot {
  if (bytes.length === 0) throw new SnapshotBytesError("empty snapshot bytes");
  if (bytes.length > maxBytes) throw new SnapshotBytesError(`snapshot exceeds ${maxBytes} bytes`);
  let snapshot;
  try {
    const text = decodeUtf8Strict(bytes); // throws (native TypeError) on invalid UTF-8 / BOM
    const parsed = parseStrictJson(text, { maxDepth: 12, maxLength: maxBytes, maxStringLength: 4096 });
    snapshot = validateSnapshot(parsed); // throws SchemaError
  } catch (e) {
    throw new SnapshotBytesError(`snapshot bytes rejected: ${(e as Error).message ?? e}`);
  }
  const canonical = canonicalBytes(snapshot);
  if (!bytesEqual(canonical, bytes)) {
    throw new SnapshotBytesError("received bytes are not canonical JCS encoding of their own content — refusing to hash a re-serialized object");
  }
  return { snapshot, digest: rootDigest(canonical), bytes };
}

/** Compile a validated snapshot object to its canonical publishable bytes + digest. */
export function compileSnapshotBytes(snapshot: Snapshot): { bytes: Uint8Array; digest: Hex } {
  // Re-validate: compileSnapshot is the curator's last line of defense before publication.
  const revalidated = validateSnapshot(JSON.parse(JSON.stringify(snapshot)));
  const bytes = canonicalBytes(revalidated);
  return { bytes, digest: rootDigest(bytes) };
}
