/**
 * BOUND trust snapshot, schema version 1.
 *
 * Contract source: plan §3 "Trust snapshot". Until Developer 3 lands executable schemas in
 * packages/contracts, THIS validator is the reference implementation and
 * fixtures/snapshots/ holds the conformance vectors. Proposed additions over the plan text
 * (flagged for the Phase 0 contract freeze):
 *   - `rootName`: the ENS name whose root record anchors this snapshot (defence in depth
 *     against replaying a snapshot published under a different/test name).
 *   - per-site-chain `attestation.name`: which ENSv2 name may self-attest addresses for this
 *     site+chain (curator binds the name once; the protocol's own key controls the list).
 *   - structured `evidence` items (provenance for every seeded address; deployer lineage as
 *     an offline-verifiable CREATE nonce).
 *
 * Every object rejects unknown fields; every address is lowercase; every array is strictly
 * sorted (sorted + unique); every integer is a JSON-safe integer.
 */
import { isJsonObject, type JsonObject, type JsonValue } from "./strict-json.ts";
import { isCanonicalAddress, isHex32, isStrictlySorted, type Address, type Hex } from "./hex.ts";
import { isCanonicalHost } from "./host.ts";
import { createAddress } from "./lineage.ts";

export const SCHEMA_VERSION = 1 as const;

export type ChainKey = string; // canonical decimal chain id, e.g. "1", "11155111"

export type EvidenceKind = "counterparty" | "contract" | "deployer" | "shared";

export interface Evidence {
  address: Address;
  kind: EvidenceKind;
  /** Official source (protocol docs / deployment repo). https only. */
  sourceUrl: string;
  /** keccak256 of deployed runtime bytecode at verification time (`cast code | keccak`). */
  codeHash?: Hex;
  /** Counterparty that is an EOA (no code). Mutually exclusive with codeHash. */
  eoa?: true;
  /** Deployer lineage: the trusted contract this deployer created... */
  deployedContract?: Address;
  /** ...and the CREATE nonce that produced it (verified offline: createAddress(address, nonce)). */
  createNonce?: number;
  /** Creation transaction, for human audit. */
  creationTx?: Hex;
  note?: string;
}

export interface AttestationRef {
  /** ENSv2 name holding the protocol self-attestation text record. */
  name: string;
}

export interface SiteChainEntry {
  trustedCounterparties: Address[];
  trustedContracts: Address[];
  deployers: Address[];
  evidence: Evidence[];
  attestation?: AttestationRef;
}

export interface SharedChainEntry {
  contracts: Address[];
  evidence: Evidence[];
}

export interface Snapshot {
  schemaVersion: typeof SCHEMA_VERSION;
  epoch: number;
  generatedAt: string;
  expiresAt: string;
  network: string;
  rootName: string;
  sharedContracts: Record<ChainKey, SharedChainEntry>;
  sites: Record<string, Record<ChainKey, SiteChainEntry>>;
}

export const LIMITS = {
  maxSites: 2000,
  maxChainsPerSite: 16,
  maxAddressesPerList: 512,
  maxEvidencePerEntry: 2048,
  maxUrlLength: 2048,
  maxNoteLength: 512,
  /** A snapshot may not claim validity longer than this. */
  maxValidityMs: 90 * 24 * 3600 * 1000,
} as const;

export class SchemaError extends Error {
  readonly path: string;
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "SchemaError";
    this.path = path;
  }
}

const NETWORK_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const CHAIN_KEY_RE = /^[1-9][0-9]{0,15}$/;
// Root/attestation names are restricted to ASCII LDH labels so they need no ENS
// normalization step on the trust path (normalization is a big table to trust).
const ENS_NAME_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export function isNetworkLabel(v: unknown): v is string {
  return typeof v === "string" && NETWORK_RE.test(v);
}
export function isChainKey(v: unknown): v is string {
  return typeof v === "string" && CHAIN_KEY_RE.test(v) && Number.isSafeInteger(Number(v));
}
export function isAsciiEnsName(v: unknown): v is string {
  return typeof v === "string" && v.length <= 255 && ENS_NAME_RE.test(v);
}

/** RFC 3339 UTC, second precision, round-trippable. Returns epoch ms. */
export function parseTimestamp(v: unknown, path: string): number {
  if (typeof v !== "string" || !TIMESTAMP_RE.test(v)) throw new SchemaError(path, "timestamp must be YYYY-MM-DDTHH:MM:SSZ");
  const ms = Date.parse(v);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().replace(".000Z", "Z") !== v) {
    throw new SchemaError(path, "timestamp is not a real UTC instant");
  }
  return ms;
}

function obj(v: JsonValue | undefined, path: string, required: readonly string[], optional: readonly string[] = []): JsonObject {
  if (!isJsonObject(v)) throw new SchemaError(path, "expected object");
  const allowed = new Set([...required, ...optional]);
  for (const k of Object.keys(v)) if (!allowed.has(k)) throw new SchemaError(`${path}.${k}`, "unknown field");
  for (const k of required) if (!(k in v)) throw new SchemaError(`${path}.${k}`, "missing field");
  return v;
}

function int(v: JsonValue | undefined, path: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max) {
    throw new SchemaError(path, `expected integer in [${min}, ${max}]`);
  }
  return v;
}

function str(v: JsonValue | undefined, path: string, maxLen: number): string {
  if (typeof v !== "string" || v.length === 0 || v.length > maxLen) throw new SchemaError(path, `expected non-empty string ≤ ${maxLen}`);
  return v;
}

function httpsUrl(v: JsonValue | undefined, path: string): string {
  const s = str(v, path, LIMITS.maxUrlLength);
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new SchemaError(path, "invalid URL");
  }
  if (u.protocol !== "https:") throw new SchemaError(path, "source URL must be https");
  return s;
}

function addressList(v: JsonValue | undefined, path: string): Address[] {
  if (!Array.isArray(v)) throw new SchemaError(path, "expected array");
  if (v.length > LIMITS.maxAddressesPerList) throw new SchemaError(path, "too many addresses");
  v.forEach((a, i) => {
    if (!isCanonicalAddress(a)) throw new SchemaError(`${path}[${i}]`, "expected lowercase 0x address");
    if (a === "0x0000000000000000000000000000000000000000") throw new SchemaError(`${path}[${i}]`, "zero address cannot be trusted");
  });
  if (!isStrictlySorted(v as string[])) throw new SchemaError(path, "addresses must be sorted and unique");
  return v as Address[];
}

export function evidenceSortKey(e: Pick<Evidence, "address" | "kind" | "sourceUrl">): string {
  return `${e.address}|${e.kind}|${e.sourceUrl}`;
}

function evidenceItem(v: JsonValue, path: string): Evidence {
  const o = obj(v, path, ["address", "kind", "sourceUrl"], ["codeHash", "eoa", "deployedContract", "createNonce", "creationTx", "note"]);
  if (!isCanonicalAddress(o.address)) throw new SchemaError(`${path}.address`, "expected lowercase 0x address");
  const kind = o.kind;
  if (kind !== "counterparty" && kind !== "contract" && kind !== "deployer" && kind !== "shared") {
    throw new SchemaError(`${path}.kind`, "unknown evidence kind");
  }
  const e: Evidence = { address: o.address, kind, sourceUrl: httpsUrl(o.sourceUrl, `${path}.sourceUrl`) };
  if ("codeHash" in o) {
    if (!isHex32(o.codeHash)) throw new SchemaError(`${path}.codeHash`, "expected lowercase 32-byte hex");
    e.codeHash = o.codeHash;
  }
  if ("eoa" in o) {
    if (o.eoa !== true) throw new SchemaError(`${path}.eoa`, "eoa must be true when present");
    e.eoa = true;
  }
  if ("deployedContract" in o) {
    if (!isCanonicalAddress(o.deployedContract)) throw new SchemaError(`${path}.deployedContract`, "expected lowercase 0x address");
    e.deployedContract = o.deployedContract;
  }
  if ("createNonce" in o) e.createNonce = int(o.createNonce, `${path}.createNonce`, 0);
  if ("creationTx" in o) {
    if (!isHex32(o.creationTx)) throw new SchemaError(`${path}.creationTx`, "expected lowercase 32-byte hex");
    e.creationTx = o.creationTx;
  }
  if ("note" in o) e.note = str(o.note, `${path}.note`, LIMITS.maxNoteLength);

  switch (kind) {
    case "contract":
    case "shared":
      if (!e.codeHash) throw new SchemaError(path, `${kind} evidence requires codeHash (verify with cast code)`);
      if (e.eoa) throw new SchemaError(path, `${kind} evidence cannot be an EOA`);
      break;
    case "counterparty":
      if (!!e.codeHash === !!e.eoa) throw new SchemaError(path, "counterparty evidence requires exactly one of codeHash or eoa");
      break;
    case "deployer":
      if (e.deployedContract === undefined || e.createNonce === undefined || e.creationTx === undefined) {
        throw new SchemaError(path, "deployer evidence requires deployedContract, createNonce and creationTx");
      }
      if (createAddress(e.address, e.createNonce) !== e.deployedContract) {
        throw new SchemaError(path, "deployer lineage does not verify: createAddress(deployer, createNonce) != deployedContract");
      }
      break;
  }
  if (kind !== "deployer" && (e.deployedContract !== undefined || e.createNonce !== undefined)) {
    throw new SchemaError(path, "lineage fields only allowed on deployer evidence");
  }
  return e;
}

function evidenceList(v: JsonValue | undefined, path: string): Evidence[] {
  if (!Array.isArray(v)) throw new SchemaError(path, "expected array");
  if (v.length > LIMITS.maxEvidencePerEntry) throw new SchemaError(path, "too much evidence");
  const items = v.map((e, i) => evidenceItem(e, `${path}[${i}]`));
  const keys = items.map(evidenceSortKey);
  if (!isStrictlySorted(keys)) throw new SchemaError(path, "evidence must be sorted by address|kind|sourceUrl and unique");
  return items;
}

/** Every listed address needs evidence of the matching kind; no orphan evidence. */
function crossCheck(path: string, lists: Record<EvidenceKind, Address[] | undefined>, evidence: Evidence[]) {
  const covered = new Set(evidence.map((e) => `${e.kind}:${e.address}`));
  for (const kind of Object.keys(lists) as EvidenceKind[]) {
    for (const a of lists[kind] ?? []) {
      if (!covered.has(`${kind}:${a}`)) throw new SchemaError(path, `no ${kind} evidence for ${a}`);
    }
  }
  for (const e of evidence) {
    const list = lists[e.kind];
    if (!list || !list.includes(e.address)) throw new SchemaError(path, `evidence for ${e.address} (${e.kind}) not in a trusted list`);
  }
}

function siteChainEntry(v: JsonValue | undefined, path: string): SiteChainEntry {
  const o = obj(v, path, ["trustedCounterparties", "trustedContracts", "deployers", "evidence"], ["attestation"]);
  const entry: SiteChainEntry = {
    trustedCounterparties: addressList(o.trustedCounterparties, `${path}.trustedCounterparties`),
    trustedContracts: addressList(o.trustedContracts, `${path}.trustedContracts`),
    deployers: addressList(o.deployers, `${path}.deployers`),
    evidence: evidenceList(o.evidence, `${path}.evidence`),
  };
  if ("attestation" in o) {
    const a = obj(o.attestation, `${path}.attestation`, ["name"]);
    if (!isAsciiEnsName(a.name)) throw new SchemaError(`${path}.attestation.name`, "expected lowercase ASCII ENS name");
    entry.attestation = { name: a.name };
  }
  if (entry.trustedCounterparties.length + entry.trustedContracts.length === 0 && !entry.attestation) {
    throw new SchemaError(path, "site-chain entry trusts nothing");
  }
  crossCheck(path, {
    counterparty: entry.trustedCounterparties,
    contract: entry.trustedContracts,
    deployer: entry.deployers,
    shared: undefined,
  }, entry.evidence);
  const trusted = new Set<string>([...entry.trustedContracts, ...entry.trustedCounterparties]);
  for (const e of entry.evidence) {
    if (e.kind === "deployer" && !trusted.has(e.deployedContract!)) {
      throw new SchemaError(path, `deployer ${e.address} lineage names ${e.deployedContract}, which is not trusted for this site-chain`);
    }
  }
  return entry;
}

function sharedEntry(v: JsonValue | undefined, path: string): SharedChainEntry {
  const o = obj(v, path, ["contracts", "evidence"]);
  const entry: SharedChainEntry = {
    contracts: addressList(o.contracts, `${path}.contracts`),
    evidence: evidenceList(o.evidence, `${path}.evidence`),
  };
  crossCheck(path, { shared: entry.contracts, counterparty: undefined, contract: undefined, deployer: undefined }, entry.evidence);
  return entry;
}

function chainMap<T>(v: JsonValue | undefined, path: string, max: number, each: (v: JsonValue, p: string) => T): Record<ChainKey, T> {
  if (!isJsonObject(v)) throw new SchemaError(path, "expected object keyed by chain id");
  const keys = Object.keys(v);
  if (keys.length > max) throw new SchemaError(path, "too many chains");
  const out = Object.create(null) as Record<ChainKey, T>;
  for (const k of keys) {
    if (!isChainKey(k)) throw new SchemaError(`${path}.${k}`, "chain key must be canonical decimal chain id");
    out[k] = each(v[k]!, `${path}["${k}"]`);
  }
  return out;
}

/** Validate an already strictly-parsed JSON value as a v1 snapshot. Throws SchemaError. */
export function validateSnapshot(v: JsonValue): Snapshot {
  const o = obj(v, "$", ["schemaVersion", "epoch", "generatedAt", "expiresAt", "network", "rootName", "sharedContracts", "sites"]);
  if (o.schemaVersion !== SCHEMA_VERSION) throw new SchemaError("$.schemaVersion", `unsupported schema version`);
  const epoch = int(o.epoch, "$.epoch", 1);
  const gen = parseTimestamp(o.generatedAt, "$.generatedAt");
  const exp = parseTimestamp(o.expiresAt, "$.expiresAt");
  if (exp <= gen) throw new SchemaError("$.expiresAt", "must be after generatedAt");
  if (exp - gen > LIMITS.maxValidityMs) throw new SchemaError("$.expiresAt", "validity window too long");
  if (!isNetworkLabel(o.network)) throw new SchemaError("$.network", "invalid network label");
  if (!isAsciiEnsName(o.rootName)) throw new SchemaError("$.rootName", "expected lowercase ASCII ENS name");

  const sharedContracts = chainMap(o.sharedContracts, "$.sharedContracts", 64, sharedEntry);

  if (!isJsonObject(o.sites)) throw new SchemaError("$.sites", "expected object keyed by host");
  const hosts = Object.keys(o.sites);
  if (hosts.length > LIMITS.maxSites) throw new SchemaError("$.sites", "too many sites");
  const sites = Object.create(null) as Snapshot["sites"];
  for (const h of hosts) {
    if (!isCanonicalHost(h)) throw new SchemaError(`$.sites["${h}"]`, "site key is not a canonical host (IDNA/lowercase/port rules)");
    const chains = chainMap(o.sites[h], `$.sites["${h}"]`, LIMITS.maxChainsPerSite, siteChainEntry);
    if (Object.keys(chains).length === 0) throw new SchemaError(`$.sites["${h}"]`, "site has no chains");
    sites[h] = chains;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    epoch,
    generatedAt: o.generatedAt as string,
    expiresAt: o.expiresAt as string,
    network: o.network,
    rootName: o.rootName,
    sharedContracts,
    sites,
  };
}
