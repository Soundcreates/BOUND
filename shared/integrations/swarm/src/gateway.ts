/**
 * Read path: fetching a snapshot/report back from Swarm as a wallet-side consumer.
 *
 * This module fetches bytes from HTTP gateways and checks only whether multiple gateway URLs
 * return byte-identical content. A gateway is untrusted and can return arbitrary bytes; this
 * module does not verify Swarm's BMT or prove that bytes match the requested Swarm reference.
 * Callers must check the anchored application digest (BOUND uses keccak256 of the
 * RFC-8785-canonicalized snapshot JSON, computed by `@bound/snapshot`'s `canonical.ts`) before
 * trusting the content. Agreement is useful for detecting disagreement and improving
 * availability, but does not establish integrity: gateways may collude, and distinct origins
 * do not prove independent operators.
 */

import { swarmGatewayUrl, assertCanonicalSwarmRef } from "@bound/snapshot";

export interface GatewayFetchOptions {
  /** How many gateways must return byte-identical content before it is trusted. Default 2. */
  readonly minAgree?: number;
  /** Per-gateway fetch timeout in milliseconds. Default 8000. */
  readonly timeoutMs?: number;
  /** Maximum accepted response size per gateway. Defaults to 16 MiB. */
  readonly maxBytes?: number;
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
  maxBytes: number,
): Promise<{ bytes: Uint8Array } | { error: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = swarmGatewayUrl(gatewayBase, reference);
    const res = await fetch(url, { method: "GET", redirect: "error", signal: controller.signal });
    if (!res.ok) {
      return { error: `HTTP ${res.status}` };
    }
    const header = res.headers.get("content-length");
    const declared = header !== null && /^\d+$/.test(header) ? Number(header) : NaN;
    if (Number.isSafeInteger(declared) && declared > maxBytes) {
      await res.body?.cancel();
      return { error: `response exceeds ${maxBytes} byte limit` };
    }
    if (!res.body) return { bytes: new Uint8Array() };
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          return { error: `response exceeds ${maxBytes} byte limit` };
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return { bytes };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches a Swarm reference through several gateway URLs in parallel and requires at least
 * `minAgree` of them to return byte-identical content before returning it. This checks agreement
 * only: an untrusted gateway can return arbitrary bytes, and this function does not verify
 * Swarm's BMT or establish that the bytes match the reference. Distinct origins also do not
 * prove that the gateways have independent operators. Callers must verify the anchored
 * application digest before trusting returned bytes.
 *
 * Returns the agreed-upon bytes. Throws `GatewayFetchError` if fewer than `minAgree` gateways
 * responded successfully at all, or `GatewayMismatchError` if enough responded but no group of
 * `minAgree` of them agreed byte-for-byte. A mismatch indicates differing gateway responses;
 * it does not identify which response, if any, is valid.
 */
export async function fetchFromGateways(
  reference: string,
  gatewayBaseUrls: readonly string[],
  options: GatewayFetchOptions = {},
): Promise<Uint8Array> {
  assertCanonicalSwarmRef(reference, "fetchFromGateways");
  const minAgree = options.minAgree ?? 2;
  const timeoutMs = options.timeoutMs ?? 8000;
  const maxBytes = options.maxBytes ?? 16 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError("fetchFromGateways: maxBytes must be a non-negative safe integer");
  if (gatewayBaseUrls.length < minAgree) {
    throw new RangeError(
      `fetchFromGateways: need at least ${minAgree} gateway URLs to require ${minAgree}-way agreement, got ${gatewayBaseUrls.length}`,
    );
  }

  // Count each origin once to reject duplicate URLs at the same origin. Distinct origins do
  // not prove that gateways are operated independently.
  const origins = new Set<string>();
  for (const gateway of gatewayBaseUrls) {
    let origin: string;
    try { origin = new URL(gateway).origin; } catch { throw new TypeError(`fetchFromGateways: invalid gateway URL: ${gateway}`); }
    if (origins.has(origin)) throw new RangeError(`fetchFromGateways: duplicate gateway origin ${origin}`);
    origins.add(origin);
  }

  const results = await Promise.all(gatewayBaseUrls.map((gw) => fetchOneGateway(gw, reference, timeoutMs, maxBytes)));

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
