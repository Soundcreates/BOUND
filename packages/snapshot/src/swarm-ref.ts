/**
 * Swarm content reference formatting.
 *
 * A Swarm reference is a 32-byte BMT/manifest hash, written as 64 lowercase hex chars with
 * NO `0x` prefix (that is the form Bee's API and gateways use in URLs:
 * `https://gateway/bzz/<ref>/`). Root records and Arkiv `incident.swarmRef` fields use this
 * exact form so a reference can be pasted into a gateway URL without transformation.
 *
 * Security note (plan §3, arch §10.4): this must always be a PLAIN reference. An encrypted
 * Swarm reference embeds its own decryption key, so one must never be written into a public
 * Arkiv entity or ENS record. Nothing in this module can express an encrypted reference —
 * that is enforced structurally, not by a runtime flag.
 *
 * Endpoint choice: BOUND uploads the snapshot/report as RAW BYTES (one canonical JSON blob,
 * no filename, no directory), via Bee's `/bytes` API — not `/bzz`, which is for file/
 * directory manifests and expects a `name`/Content-Type and, on read, a trailing-slash path
 * convention for resolving a manifest's default entry. `swarmGatewayUrl` therefore builds a
 * `/bytes/<ref>` URL, which every Bee node and public gateway serves identically for a plain
 * reference.
 */

const SWARM_REF_RE = /^[0-9a-f]{64}$/;

export function isCanonicalSwarmRef(v: unknown): v is string {
  return typeof v === "string" && SWARM_REF_RE.test(v);
}

export function assertCanonicalSwarmRef(v: string, context: string): string {
  if (!isCanonicalSwarmRef(v)) {
    throw new TypeError(`${context}: expected a 64-char lowercase hex Swarm reference (no 0x), got ${JSON.stringify(v)}`);
  }
  return v;
}

export function swarmGatewayUrl(gatewayBase: string, ref: string): string {
  assertCanonicalSwarmRef(ref, "swarmGatewayUrl");
  const base = gatewayBase.endsWith("/") ? gatewayBase.slice(0, -1) : gatewayBase;
  return `${base}/bytes/${ref}`;
}
