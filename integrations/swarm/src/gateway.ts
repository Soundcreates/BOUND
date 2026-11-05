/**
 * Read path: fetching a snapshot/report back from Swarm as a wallet-side consumer.
 *
 * Per arch §5.3, the trust model here is: "fetch the snapshot from Swarm through any gateway,
 * hash the received bytes, discard unless the hash matches the root." The hash in that rule is
 * BOUND's own application-level digest (keccak256 of the RFC-8785-canonicalized snapshot JSON,
 * computed by `@bound/snapshot`'s `canonical.ts`) — NOT Swarm's internal BMT content address.
 * A consumer never needs to validate or reimplement BMT: Swarm already guarantees that
 * `GET /bytes/<ref>` either returns the exact bytes addressed by `<ref>` or fails, for both a
 * Bee node and any gateway proxying one. What a consumer must still decide for itself is
 * whether to TRUST a given gateway's reachability/availability — a malicious or broken gateway
 * cannot forge content (BMT prevents that), but it can selectively withhold or stall it. That
 * is why this module requires several independent gateways to agree before treating a fetch as
 * successful: it is resilience against censorship/outage of any single gateway, not a
 * cryptographic integrity check (the digest check in `@bound/snapshot` is that).
 */

import { swarmGatewayUrl, assertCanonicalSwarmRef } from "@bound/snapshot";

export interface GatewayFetchOptions {
  /** How many gateways must return byte-identical content before it is trusted. Default 2. */
  readonly minAgree?: number;
  /** Per-gateway fetch timeout in milliseconds. Default 8000. */
  readonly timeoutMs?: number;
}

export interface GatewayAttempt {
  readonly gateway: string;
  readonly ok: boolean;
  readonly byteLength?: number;
  readonly error?: string;
}

export class GatewayFetchError extends Error {
  readonly attempts: readonly GatewayAttempt[];
  constructor(message: string, attempts: readonly GatewayAttempt[]) {
    super(message);
    this.name = "GatewayFetchError";
    this.attempts = attempts;
  }
}

export class GatewayMismatchError extends Error {
  readonly attempts: readonly GatewayAttempt[];
  constructor(message: string, attempts: readonly GatewayAttempt[]) {
    super(message);
    this.name = "GatewayMismatchError";
    this.attempts = attempts;
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

async function fetchOneGateway(
  gatewayBase: string,
  reference: string,
  timeoutMs: number,
): Promise<{ bytes: Uint8Array } | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = swarmGatewayUrl(gatewayBase, reference);
    const res = await fetch(url, { method: "GET", signal: controller.signal });
    if (!res.ok) {
      return { error: `HTTP ${res.status}` };
    }
    return { bytes: new Uint8Array(await res.arrayBuffer()) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches a Swarm reference from several independent gateways in parallel and requires at
 * least `minAgree` of them to return byte-identical content before returning it. This is the
 * "second gateway" requirement from the plan: a consumer must not trust a single gateway's
 * word for what a reference contains, even though BMT means that word, if wrong, can only be
 * a withheld/stale/wrong-reference answer — never a forged one that still matches the
 * reference hash.
 *
 * Returns the agreed-upon bytes. Throws `GatewayFetchError` if fewer than `minAgree` gateways
 * responded successfully at all, or `GatewayMismatchError` if enough responded but no group of
 * `minAgree` of them agreed byte-for-byte (which would indicate a gateway serving corrupted or
 * substituted content, or possibly a node still propagating a very recent upload).
 */
export async function fetchFromGateways(
  reference: string,
  gatewayBaseUrls: readonly string[],
  options: GatewayFetchOptions = {},
): Promise<Uint8Array> {
  assertCanonicalSwarmRef(reference, "fetchFromGateways");
  const minAgree = options.minAgree ?? 2;
  const timeoutMs = options.timeoutMs ?? 8000;
  if (gatewayBaseUrls.length < minAgree) {
    throw new RangeError(
      `fetchFromGateways: need at least ${minAgree} gateway URLs to require ${minAgree}-way agreement, got ${gatewayBaseUrls.length}`,
    );
  }

  const results = await Promise.all(gatewayBaseUrls.map((gw) => fetchOneGateway(gw, reference, timeoutMs)));

  const attempts: GatewayAttempt[] = [];
  const successes: { gateway: string; bytes: Uint8Array }[] = [];
  for (let i = 0; i < gatewayBaseUrls.length; i++) {
    const gateway = gatewayBaseUrls[i]!;
    const result = results[i]!;
    if ("bytes" in result) {
      attempts.push({ gateway, ok: true, byteLength: result.bytes.length });
      successes.push({ gateway, bytes: result.bytes });
    } else {
      attempts.push({ gateway, ok: false, error: result.error });
    }
  }

  if (successes.length < minAgree) {
    throw new GatewayFetchError(
      `only ${successes.length}/${gatewayBaseUrls.length} gateway(s) responded successfully, need ${minAgree}`,
      attempts,
    );
  }

  // Group successful responses by byte-equality and find the largest group.
  const groups: { bytes: Uint8Array; count: number }[] = [];
  for (const { bytes } of successes) {
    const group = groups.find((g) => bytesEqual(g.bytes, bytes));
    if (group) {
      group.count += 1;
    } else {
      groups.push({ bytes, count: 1 });
    }
  }
  groups.sort((a, b) => b.count - a.count);
  const best = groups[0];

  if (!best || best.count < minAgree) {
    throw new GatewayMismatchError(
      `gateways disagreed: largest agreeing group was ${best?.count ?? 0}/${successes.length}, need ${minAgree}`,
      attempts,
    );
  }

  return best.bytes;
}
