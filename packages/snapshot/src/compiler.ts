/**
 * Curator-side snapshot assembly. Input is plain curation data (one entry per site-chain);
 * output is a validated, canonical, digestible Snapshot. This is the only path that is
 * allowed to construct a Snapshot from scratch — everywhere else only reads one.
 */
import { validateSnapshot, evidenceSortKey, type Evidence, type Snapshot, type SiteChainEntry, SCHEMA_VERSION } from "./schema.ts";
import { canonicalizeHost } from "./host.ts";
import { normalizeAddress, type Address } from "./hex.ts";
import { compileSnapshotBytes } from "./digest.ts";

export interface SiteChainInput {
  host: string;
  chainId: number;
  trustedCounterparties?: string[];
  trustedContracts?: string[];
  deployers?: string[];
  evidence: Evidence[];
  attestationName?: string;
}

export interface SharedChainInput {
  chainId: number;
  contracts: string[];
  evidence: Evidence[];
}

export interface CompileInput {
  epoch: number;
  network: string;
  rootName: string;
  generatedAt: Date;
  validityDays: number;
  sites: SiteChainInput[];
  shared: SharedChainInput[];
}

function sortAddrs(list: string[] | undefined): Address[] {
  const normalized = (list ?? []).map((a) => normalizeAddress(a));
  const deduped = [...new Set(normalized)].sort();
  return deduped;
}

function sortEvidence(list: Evidence[]): Evidence[] {
  return [...list].sort((a, b) => {
    const ka = evidenceSortKey(a);
    const kb = evidenceSortKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

function isoSeconds(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Assemble curation input into a validated Snapshot object (not yet canonical bytes). */
export function buildSnapshot(input: CompileInput): Snapshot {
  const expiresAt = new Date(input.generatedAt.getTime() + input.validityDays * 86_400_000);

  const sites: Record<string, Record<string, SiteChainEntry>> = {};
  for (const s of input.sites) {
    const host = canonicalizeHost(s.host);
    const chainKey = String(s.chainId);
    sites[host] ??= {};
    if (sites[host][chainKey]) {
      throw new Error(`duplicate site-chain entry: ${host} / ${chainKey}`);
    }
    const entry: SiteChainEntry = {
      trustedCounterparties: sortAddrs(s.trustedCounterparties),
      trustedContracts: sortAddrs(s.trustedContracts),
      deployers: sortAddrs(s.deployers),
      evidence: sortEvidence(s.evidence),
    };
    if (s.attestationName) entry.attestation = { name: s.attestationName.toLowerCase() };
    sites[host][chainKey] = entry;
  }

  const sharedContracts: Snapshot["sharedContracts"] = {};
  for (const s of input.shared) {
    const chainKey = String(s.chainId);
    if (sharedContracts[chainKey]) throw new Error(`duplicate shared entry for chain ${chainKey}`);
    sharedContracts[chainKey] = { contracts: sortAddrs(s.contracts), evidence: sortEvidence(s.evidence) };
  }

  const draft = {
    schemaVersion: SCHEMA_VERSION,
    epoch: input.epoch,
    generatedAt: isoSeconds(input.generatedAt),
    expiresAt: isoSeconds(expiresAt),
    network: input.network,
    rootName: input.rootName.toLowerCase(),
    sharedContracts,
    sites,
  };

  // Validate via the strict path so curator mistakes surface identically to a verifier's.
  return validateSnapshot(JSON.parse(JSON.stringify(draft)));
}

/** Build + canonicalize + digest in one call, for CLI convenience. */
export function compileSnapshot(input: CompileInput) {
  const snapshot = buildSnapshot(input);
  return { snapshot, ...compileSnapshotBytes(snapshot) };
}

/** A later snapshot must never trust strictly less than curation intends by accident; this
 *  only checks the mechanical epoch/rollback invariant the CLI must enforce before publishing. */
export function assertMonotonicEpoch(previousEpoch: number | undefined, nextEpoch: number): void {
  if (previousEpoch !== undefined && nextEpoch <= previousEpoch) {
    throw new Error(`refusing to compile epoch ${nextEpoch}: must be > previous published epoch ${previousEpoch}`);
  }
}
