/**
 * The root record: ONE ENSv2 text record holding digest + epoch + Swarm reference.
 *
 * Plan §3: "Prefer one versioned ENS text-record value containing digest, epoch, Swarm
 * reference, network and schema version so publication is one record update." One record
 * means there is no incoherent intermediate state to read, so no commit-pointer dance.
 *
 * Record key (frozen Phase 0):  bound.root.v1
 * Record value: canonical JCS JSON, so the published string is byte-reproducible:
 *   {"digest":"0x…64","epoch":7,"network":"sepolia","schemaVersion":1,"swarmRef":"…64"}
 *
 * The value is deliberately NOT signed: authority comes from WHO may write this record key
 * (the curator's EAC role on this resolver), which is exactly what a DNS attacker lacks.
 */
import { canonicalize } from "./canonical.ts";
import { decodeUtf8Strict, parseStrictJson, type JsonValue } from "./strict-json.ts";
import { isCanonicalAddress, isHex32, isStrictlySorted, type Hex } from "./hex.ts";
import { isCanonicalHost } from "./host.ts";
import { SchemaError, isChainKey, isNetworkLabel, parseTimestamp, SCHEMA_VERSION } from "./schema.ts";
import { isCanonicalSwarmRef } from "./swarm-ref.ts";

export const ROOT_RECORD_KEY = "bound.root.v1" as const;
export const ATTESTATION_RECORD_KEY = "bound.attest.v1" as const;

export interface RootRecord {
  digest: Hex;
  epoch: number;
  network: string;
  schemaVersion: number;
  /** Plain (never encrypted) Swarm reference, 64 lowercase hex chars, no 0x. */
  swarmRef: string;
}

export function encodeRootRecord(r: RootRecord): string {
  return canonicalize({
    digest: r.digest,
    epoch: r.epoch,
    network: r.network,
    schemaVersion: r.schemaVersion,
    swarmRef: r.swarmRef,
  });
}

export function parseRootRecord(value: string): RootRecord {
  if (typeof value !== "string" || value.length === 0) throw new SchemaError("root", "record is empty");
  if (value.length > 4096) throw new SchemaError("root", "record too large");
  const parsed: JsonValue = parseStrictJson(value, { maxDepth: 4, maxLength: 4096, maxStringLength: 512 });
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new SchemaError("root", "expected object");
  const allowed = new Set(["digest", "epoch", "network", "schemaVersion", "swarmRef"]);
  for (const k of Object.keys(parsed)) if (!allowed.has(k)) throw new SchemaError(`root.${k}`, "unknown field");
  for (const k of allowed) if (!(k in parsed)) throw new SchemaError(`root.${k}`, "missing field");

  const { digest, epoch, network, schemaVersion, swarmRef } = parsed as Record<string, JsonValue>;
  if (!isHex32(digest)) throw new SchemaError("root.digest", "expected lowercase 32-byte hex");
  if (typeof epoch !== "number" || !Number.isSafeInteger(epoch) || epoch < 1) throw new SchemaError("root.epoch", "expected positive integer");
  if (!isNetworkLabel(network)) throw new SchemaError("root.network", "invalid network label");
  if (schemaVersion !== SCHEMA_VERSION) throw new SchemaError("root.schemaVersion", "unsupported schema version");
  if (!isCanonicalSwarmRef(swarmRef)) throw new SchemaError("root.swarmRef", "expected 64 lowercase hex chars (plain, unencrypted reference)");

  const record: RootRecord = { digest, epoch, network, schemaVersion, swarmRef };
  // A record the curator did not produce byte-for-byte canonically is still usable, but
  // the canonical form is what the publisher writes and what the receipt records.
  return record;
}

/** Parse a record read as raw bytes (e.g. via data(key)); enforces strict UTF-8. */
export function parseRootRecordBytes(bytes: Uint8Array): RootRecord {
  return parseRootRecord(decodeUtf8Strict(bytes));
}

/**
 * Protocol self-attestation record (arch §5.5 / §9.1 source 2).
 *
 * Written by the PROTOCOL's own account into the PROTOCOL's own ENSv2 name, under key
 * `bound.attest.v1`. The curator cannot write it; the site's DNS cannot influence it.
 * Trust granted is scoped to (site, chain) pairs named inside the record, and the snapshot
 * must name this ENS name for that site-chain, so one protocol cannot attest for another.
 */
export interface Attestation {
  schemaVersion: number;
  /** Canonical site host this attestation speaks for. */
  site: string;
  /** chain id (decimal string) -> sorted lowercase addresses. */
  addresses: Record<string, string[]>;
  /** RFC 3339 UTC expiry; an expired attestation grants nothing. */
  expiresAt: string;
}

export function encodeAttestation(a: Attestation): string {
  return canonicalize({
    addresses: a.addresses,
    expiresAt: a.expiresAt,
    schemaVersion: a.schemaVersion,
    site: a.site,
  });
}

export function parseAttestation(value: string): Attestation {
  if (typeof value !== "string" || value.length === 0) throw new SchemaError("attest", "record is empty");
  if (value.length > 65536) throw new SchemaError("attest", "record too large");
  const parsed = parseStrictJson(value, { maxDepth: 6, maxLength: 65536, maxStringLength: 512 });
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new SchemaError("attest", "expected object");
  const allowed = new Set(["addresses", "expiresAt", "schemaVersion", "site"]);
  for (const k of Object.keys(parsed)) if (!allowed.has(k)) throw new SchemaError(`attest.${k}`, "unknown field");
  for (const k of allowed) if (!(k in parsed)) throw new SchemaError(`attest.${k}`, "missing field");
  const o = parsed as Record<string, JsonValue>;
  if (o.schemaVersion !== SCHEMA_VERSION) throw new SchemaError("attest.schemaVersion", "unsupported schema version");

  if (typeof o.site !== "string" || !isCanonicalHost(o.site)) throw new SchemaError("attest.site", "not a canonical host");
  parseTimestamp(o.expiresAt, "attest.expiresAt");

  if (typeof o.addresses !== "object" || o.addresses === null || Array.isArray(o.addresses)) {
    throw new SchemaError("attest.addresses", "expected object keyed by chain id");
  }
  const addresses = Object.create(null) as Record<string, string[]>;
  const chains = Object.keys(o.addresses);
  if (chains.length > 16) throw new SchemaError("attest.addresses", "too many chains");
  for (const c of chains) {
    if (!isChainKey(c)) throw new SchemaError(`attest.addresses.${c}`, "chain key must be canonical decimal chain id");
    const list = (o.addresses as Record<string, JsonValue>)[c];
    if (!Array.isArray(list) || list.length === 0 || list.length > 256) throw new SchemaError(`attest.addresses.${c}`, "expected non-empty address array");
    list.forEach((a, i) => {
      if (!isCanonicalAddress(a)) throw new SchemaError(`attest.addresses.${c}[${i}]`, "expected lowercase 0x address");
    });
    if (!isStrictlySorted(list as string[])) throw new SchemaError(`attest.addresses.${c}`, "addresses must be sorted and unique");
    addresses[c] = list as string[];
  }
  return { schemaVersion: SCHEMA_VERSION, site: o.site, addresses, expiresAt: o.expiresAt as string };
}
