/**
 * Trust lookups and the v2 cap rule (plan §3 "Decision and coverage" + §9 of the
 * architecture doc). This module answers two questions for shared/policy-core:
 *   1. is this address trusted for (site, chain), and from which of the four sources?
 *   2. given the roles found on a request, what is the score cap?
 * It does NOT compute the full score (signals, weights) — that is Developer 1's decoder/
 * policy-core, which calls `capFor` after it has tagged roles and gathered drift/witness
 * facts. Keeping the cap law here (next to the data it reads) means Developer 1 builds
 * against one pure function instead of re-deriving §9.3 from prose.
 */
import type { ChainKey, Snapshot } from "./schema.ts";
import type { Address } from "./hex.ts";
import type { Attestation } from "./root-record.ts";

export type TrustSource = "snapshot" | "attestation" | "shared" | "deployer-lineage";

export type Role = "rights" | "destination" | "called" | "token";

/** Per-address trust state, pre-resolved for this (site, chain) before scoring. */
export interface AddressTrust {
  address: Address;
  trusted: boolean;
  sources: TrustSource[];
}

export interface BaselinePresence {
  /** Whether Arkiv/watcher ever observed this site+chain at all (plan §3: "no baseline means grey"). */
  hasBaseline: boolean;
}

/**
 * Build a (site, chain) -> trusted-address lookup from a validated snapshot plus any
 * live, already-verified attestations. Call once per snapshot/attestation refresh; the
 * result is a plain Map, cheap to query per request.
 */
export class TrustIndex {
  private readonly snapshot: Snapshot;
  private readonly bySite = new Map<string, Map<ChainKey, Map<Address, TrustSource[]>>>();
  private readonly shared = new Map<ChainKey, Set<Address>>();

  constructor(snapshot: Snapshot) {
    this.snapshot = snapshot;
    for (const [chain, entry] of Object.entries(snapshot.sharedContracts)) {
      this.shared.set(chain, new Set(entry.contracts as Address[]));
    }
    for (const [site, chains] of Object.entries(snapshot.sites)) {
      const chainMap = new Map<ChainKey, Map<Address, TrustSource[]>>();
      for (const [chain, entry] of Object.entries(chains)) {
        const m = new Map<Address, TrustSource[]>();
        for (const a of entry.trustedCounterparties as Address[]) addSource(m, a, "snapshot");
        for (const a of entry.trustedContracts as Address[]) addSource(m, a, "snapshot");
        chainMap.set(chain, m);
      }
      this.bySite.set(site, chainMap);
    }
  }

  /** Fold in a live, already ENS-verified attestation. Idempotent; call per refresh. */
  applyAttestation(site: string, chain: ChainKey, attestation: Attestation): void {
    const expected = this.snapshot.sites[site]?.[chain]?.attestation;
    if (!expected) return; // snapshot did not bind this site+chain to any attestation name
    const list = attestation.addresses[chain];
    if (!list) return;
    let chainMap = this.bySite.get(site);
    if (!chainMap) {
      chainMap = new Map();
      this.bySite.set(site, chainMap);
    }
    let m = chainMap.get(chain);
    if (!m) {
      m = new Map();
      chainMap.set(chain, m);
    }
    for (const a of list) addSource(m, a as Address, "attestation");
  }

  /** §9.1(4): deployer lineage. Caller has already verified createAddress(deployer, nonce) == address. */
  applyDeployerLineage(site: string, chain: ChainKey, address: Address): void {
    const m = this.bySite.get(site)?.get(chain);
    if (m) addSource(m, address, "deployer-lineage");
  }

  hasBaseline(site: string, chain: ChainKey): boolean {
    return this.bySite.get(site)?.has(chain) ?? false;
  }

  lookup(site: string, chain: ChainKey, address: Address): AddressTrust {
    const sharedSources: TrustSource[] = this.shared.get(chain)?.has(address) ? ["shared"] : [];
    const siteSources = this.bySite.get(site)?.get(chain)?.get(address) ?? [];
    const sources = [...sharedSources, ...siteSources];
    return { address, trusted: sources.length > 0, sources };
  }

  isDeployerTrustedForSite(site: string, chain: ChainKey, deployer: Address): boolean {
    // A deployer is itself trusted-as-counterparty iff it appears as a seeded deployer for
    // this site-chain (schema §deployers); lineage grants trust to what it DEPLOYED, not
    // to the deployer address acting as a counterparty.
    return this.snapshot.sites[site]?.[chain]?.deployers.includes(deployer) ?? false;
  }
}

function addSource(m: Map<Address, TrustSource[]>, a: Address, s: TrustSource): void {
  const list = m.get(a);
  if (list) {
    if (!list.includes(s)) list.push(s);
  } else {
    m.set(a, [s]);
  }
}

// ---------------------------------------------------------------------------------------
// §9.3 cap rule
// ---------------------------------------------------------------------------------------

export interface CapInput {
  /** True iff the (site,chain) has ANY baseline/snapshot entry. No baseline => grey upstream. */
  hasBaseline: boolean;
  /** Every address found by the decoder, each tagged with its role(s) and trust state. */
  taggedAddresses: ReadonlyArray<{ role: Role; trust: AddressTrust }>;
  /** True iff drift for this site has met the §9.7 corroboration bar. */
  corroboratedDrift: boolean;
  /** Uncurated-site witness state (never relevant on a seeded/curated site). */
  uncurated: {
    isUncurated: boolean;
    anyWitnessed: boolean;
  };
  /** For a `destination` role: is this address one of the signer's own accounts? */
  isSignerOwnAccount: (address: Address) => boolean;
  /** Permit2 SignatureTransfer: recipient is never fixed by the signature (arch §8.4). */
  destinationNotFixedBySignature: boolean;
}

export type CapReason =
  | "trusted-every-role"
  | "untrusted-rights-seeded"
  | "untrusted-destination"
  | "uncurated-witnessed"
  | "uncurated-unwitnessed"
  | "destination-not-fixed";

export interface CapResult {
  cap: number; // 100 means "no cap"
  reason: CapReason;
}

const NO_CAP = 100;

/**
 * §9.3, exactly as specified — corroborated drift drops a 35 cap to 15, and a 65 cap is
 * never lowered by drift (only a rights-role cap is). The caller still clamps the summed
 * signal score into [0,100] and then takes min(score, cap); this function only computes
 * the cap.
 */
export function capFor(input: CapInput): CapResult {
  if (input.destinationNotFixedBySignature) {
    // §8.4: "destination not fixed by this signature" — capped at 65 regardless of what
    // the decoder could tag, because the real recipient is not in the signed message.
    return { cap: 65, reason: "destination-not-fixed" };
  }

  if (!input.hasBaseline) {
    // Grey is decided upstream (no score at all); if this is reached anyway, treat as the
    // most restrictive uncurated case rather than silently granting no-cap.
    return input.uncurated.anyWitnessed
      ? { cap: 65, reason: "uncurated-witnessed" }
      : { cap: input.corroboratedDrift ? 15 : 35, reason: "uncurated-unwitnessed" };
  }

  let worst: CapResult = { cap: NO_CAP, reason: "trusted-every-role" };

  for (const { role, trust } of input.taggedAddresses) {
    if (trust.trusted) continue; // trusted addresses never restrict the cap
    if (input.uncurated.isUncurated) {
      const cap = input.uncurated.anyWitnessed ? 65 : input.corroboratedDrift ? 15 : 35;
      const reason: CapReason = input.uncurated.anyWitnessed ? "uncurated-witnessed" : "uncurated-unwitnessed";
      worst = tighter(worst, { cap, reason });
      continue;
    }
    if (role === "rights") {
      const cap = input.corroboratedDrift ? 15 : 35;
      worst = tighter(worst, { cap, reason: "untrusted-rights-seeded" });
    } else if (role === "destination") {
      if (!input.isSignerOwnAccount(trust.address)) {
        worst = tighter(worst, { cap: 65, reason: "untrusted-destination" });
      }
      // destination == signer's own account restricts nothing (sending to yourself).
    }
    // "called" / "token" roles alone (with no rights/destination tag) do not independently
    // cap here — an untrusted called contract instead lowers the ADDITIVE score (§9.2,
    // "Called contract never seen ... -30"), which is policy-core's concern, not the cap's.
  }

  return worst;
}

function tighter(a: CapResult, b: CapResult): CapResult {
  return b.cap < a.cap ? b : a;
}
