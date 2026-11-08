/**
 * Extension-side snapshot verification state machine.
 *
 * Plan §3 "Trust snapshot" + §"Dependency failure outcomes" + arch §5.4, frozen rules:
 *  - require snapshot epoch == root epoch;
 *  - reject digest mismatch, lower/conflicting-same-epoch, malformed schema, wrong
 *    network/rootName, or an already-expired snapshot;
 *  - persist the highest FULLY VALIDATED epoch, keyed by (chain, ensName, resolver,
 *    recordKey) — a restart must not permit rollback;
 *  - on root/network failure: use a cached snapshot only while unexpired;
 *  - on hash mismatch: retain the prior snapshot only if it is still current;
 *  - with no current verified snapshot: grey, no trust granted.
 *
 * This module has no network code. It is a pure function of
 * (persisted state, new root record, new snapshot bytes, now) -> (new state, outcome).
 * shared/integrations/ens and the extension's service worker call it; shared/policy-core reads
 * only the `trusted` outcome's Snapshot.
 */
import { decodeSnapshotBytes, SnapshotBytesError } from "./digest.ts";
import type { Snapshot } from "./schema.ts";
import type { RootRecord } from "./root-record.ts";
import type { Hex } from "./hex.ts";

/** The identity a persisted epoch is keyed on. Changing any field resets rollback history. */
export interface AnchorKey {
  chainId: number;
  ensName: string;
  resolver: `0x${string}`;
  recordKey: string;
}

export function anchorKeyId(k: AnchorKey): string {
  return `${k.chainId}|${k.ensName.toLowerCase()}|${k.resolver.toLowerCase()}|${k.recordKey}`;
}

export interface PersistedAnchorState {
  anchor: AnchorKey;
  /** Highest epoch that ever passed full validation. Monotonic; never decreases. */
  highestValidatedEpoch: number;
  /** The last snapshot that passed full validation, kept until it expires. */
  current?: {
    digest: Hex;
    epoch: number;
    expiresAtMs: number;
    /** When this snapshot itself passed validation — the basis for the "stale" age shown to the user. */
    validatedAtMs: number;
    snapshot: Snapshot;
  };
}

export function freshAnchorState(anchor: AnchorKey): PersistedAnchorState {
  return { anchor, highestValidatedEpoch: 0 };
}

export type VerifyOutcome =
  | { status: "trusted"; snapshot: Snapshot; epoch: number; stale: false }
  | { status: "trusted-cached"; snapshot: Snapshot; epoch: number; stale: true; ageMs: number }
  | { status: "grey"; reason: GreyReason };

export type GreyReason =
  | "no-verified-snapshot"
  | "expired-no-fallback"
  | "root-unreachable-no-cache"
  | "digest-mismatch-no-fallback"
  | "rollback-rejected-no-fallback";

export class VerifierError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "VerifierError";
    this.code = code;
  }
}

/** Step 1: a root record was read live. Validates it against persisted state (no bytes yet). */
export function checkRootRecord(
  state: PersistedAnchorState,
  root: RootRecord,
  expectedNetwork: string,
  expectedRootName: string,
  nowMs: number,
): { accept: true } | { accept: false; reason: "lower-epoch" | "conflicting-epoch" | "wrong-network" } {
  if (root.network !== expectedNetwork) return { accept: false, reason: "wrong-network" };
  if (root.epoch < state.highestValidatedEpoch) return { accept: false, reason: "lower-epoch" };
  if (
    root.epoch === state.highestValidatedEpoch &&
    state.current &&
    state.current.epoch === root.epoch &&
    state.current.digest !== root.digest
  ) {
    // Same epoch, different digest = equivocation (plan §Trust snapshot "reject ... lower
    // or conflicting same epoch"). Expected rootName is checked by the caller's root-record
    // read path (it is tied to which ENS name was queried, not to the record's own bytes).
    return { accept: false, reason: "conflicting-epoch" };
  }
  void expectedRootName; // enforced by caller via which (name, resolver, key) it read
  return { accept: true };
}

/**
 * Step 2: snapshot bytes were fetched for an already root-record-accepted root. Runs the
 * full digest+schema pipeline and folds the result into persisted state.
 */
export function applySnapshotBytes(
  state: PersistedAnchorState,
  root: RootRecord,
  bytes: Uint8Array,
  nowMs: number,
): { state: PersistedAnchorState; outcome: VerifyOutcome } {
  let decoded;
  try {
    decoded = decodeSnapshotBytes(bytes);
  } catch (e) {
    if (!(e instanceof SnapshotBytesError)) throw e; // decodeSnapshotBytes normalizes every failure to this type
    return { state, outcome: fallback(state, nowMs, "digest-mismatch-no-fallback") };
  }
  if (decoded.digest !== root.digest) {
    return { state, outcome: fallback(state, nowMs, "digest-mismatch-no-fallback") };
  }
  if (decoded.snapshot.epoch !== root.epoch) {
    // "Require snapshot epoch to equal root epoch." A mismatch here means the publisher
    // broke the invariant, not that the transport is hostile — still refused identically.
    return { state, outcome: fallback(state, nowMs, "digest-mismatch-no-fallback") };
  }
  if (decoded.snapshot.epoch < state.highestValidatedEpoch) {
    return { state, outcome: fallback(state, nowMs, "rollback-rejected-no-fallback") };
  }

  const expiresAtMs = Date.parse(decoded.snapshot.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return { state, outcome: fallback(state, nowMs, "digest-mismatch-no-fallback") };
  }
  if (expiresAtMs <= nowMs) {
    // A snapshot that is already expired on arrival is never adopted, even though its
    // epoch is new — adopting it would just move the staleness problem one step later.
    return { state, outcome: fallback(state, nowMs, "expired-no-fallback") };
  }

  const next: PersistedAnchorState = {
    anchor: state.anchor,
    highestValidatedEpoch: Math.max(state.highestValidatedEpoch, decoded.snapshot.epoch),
    current: { digest: decoded.digest, epoch: decoded.snapshot.epoch, expiresAtMs, validatedAtMs: nowMs, snapshot: decoded.snapshot },
  };
  return { state: next, outcome: { status: "trusted", snapshot: decoded.snapshot, epoch: decoded.snapshot.epoch, stale: false } };
}

/** Root or Swarm was unreachable this cycle. Use cache only while it remains unexpired. */
export function applyTransportFailure(state: PersistedAnchorState, nowMs: number): VerifyOutcome {
  return fallback(state, nowMs, "root-unreachable-no-cache");
}

/**
 * Shared "what do we show while we cannot adopt something new" path. If a prior verified
 * snapshot exists and has not yet reached its own `expiresAt`, keep showing it with its
 * age; an expired cache is never reused regardless of why the new attempt failed. With no
 * prior snapshot at all, the caller's specific failure reason is surfaced so the popup can
 * explain why (unreachable vs. tampered vs. rollback attempt), all still rendering grey.
 */
function fallback(state: PersistedAnchorState, nowMs: number, reasonIfNoCache: GreyReason): VerifyOutcome {
  if (state.current) {
    if (state.current.expiresAtMs > nowMs) {
      return {
        status: "trusted-cached",
        snapshot: state.current.snapshot,
        epoch: state.current.epoch,
        stale: true,
        ageMs: nowMs - state.current.validatedAtMs,
      };
    }
    return { status: "grey", reason: "expired-no-fallback" };
  }
  return { status: "grey", reason: reasonIfNoCache };
}

/** True if `outcome` carries a usable snapshot (trusted or stale-but-current). */
export function hasSnapshot(outcome: VerifyOutcome): outcome is Extract<VerifyOutcome, { snapshot: Snapshot }> {
  return outcome.status === "trusted" || outcome.status === "trusted-cached";
}
