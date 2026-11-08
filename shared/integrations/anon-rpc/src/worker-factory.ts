/**
 * Constructs and caches an `AnonRpcWorker` from `@anon-rpc/browser-extension-harness` inside
 * BOUND's extension service worker.
 *
 * This is the one module in this package that imports the actual harness, and it can only
 * run where that harness can run: inside a real MV3 extension's service worker (Chromium,
 * via an offscreen document) or background page (Firefox) — there is no DOM, no
 * `chrome.offscreen`, and no sandboxed iframe to boot a worker into under `node --test`, so
 * this file is typechecked but not unit-tested by this package (see test/README in this
 * directory's test folder for what IS covered). `transport.ts`, `budget.ts`, `telemetry.ts`
 * and `chain-facts.ts` hold every piece of logic that doesn't need a real browser, and all of
 * that is unit-tested.
 *
 * Mirrors the demo extension's `ensureWorker` pattern (same repo, `demo-extension/src/background.ts`):
 * boot is idempotent per (specifier, config) key, a worker that fails during `.ready` is never
 * cached, and the caller is expected to call this on every message rather than holding the
 * result in a module variable — a service worker is killed after ~30s idle, but the booted
 * worker itself lives on in the offscreen document and this function just reattaches to it.
 */

import { AnonRpcWorker, type ExtensionWorkerInit } from "@anon-rpc/browser-extension-harness";
import type { PlainValue, RpcProvider } from "@anon-rpc/browser-harness";
import { assertKnownWorker, type KnownWorker } from "./known-workers.ts";
import { createWorkerLifecycle } from "./worker-lifecycle.ts";

export interface AnonRpcWorkerHandle {
  readonly worker: AnonRpcWorker;
  readonly knownWorker: KnownWorker;
  /** True if this call booted a new worker; false if an already-running one was reattached. */
  readonly cold: boolean;
  readonly bootMs: number;
}

export interface EnsureAnonRpcWorkerOptions {
  /** One of `KNOWN_WORKERS`' ids (known-workers.ts). */
  readonly workerId: string;
  /** Worker-defined config (spec §7.1), e.g. `nox`'s gateway list. Opaque to this function. */
  readonly config?: PlainValue;
  /**
   * BOUND's own bootstrap RPC connection, used ONLY for the harness's §4 specifier read (an
   * on-chain read of the specifier contract itself) — never for the anonymized calls the
   * booted worker will go on to make. Required because an `AnonRpcWorker` with no
   * `preExisting.rpcProvider` falls back to the harness's own default RPC resolution, which
   * BOUND should not rely on implicitly.
   */
  readonly bootstrapRpc: RpcProvider;
}

/**
 * Per-incarnation cache, matching the demo's module-level `worker`/`workerKey`. A new service
 * worker incarnation starts with nothing here — that's fine; the offscreen document (not this
 * module) is what actually survives, and the first call in a fresh incarnation just pays the
 * cost of one message to discover that a worker is already running there and reattach,
 * which the harness itself handles. This cache only saves BOUND from redundantly calling
 * `new AnonRpcWorker(...)` twice within the SAME incarnation for the same key.
 */
const lifecycle = createWorkerLifecycle<AnonRpcWorker, AnonRpcWorkerHandle>();

export function cacheKey(workerId: string, config: PlainValue): string {
  const encode = (v: any): string => {
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (v instanceof ArrayBuffer) return "ab:" + Array.from(new Uint8Array(v)).join(",");
    if (ArrayBuffer.isView(v)) return v.constructor.name + ":" + Array.from(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)).join(",");
    if (Array.isArray(v)) return "[" + v.map(encode).join(",") + "]";
    return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + encode(v[k])).join(",") + "}";
  };
  return workerId + "|" + encode(config ?? null);
}

/**
 * Ensures a booted, ready `AnonRpcWorker` for `workerId` and returns it along with timing
 * info. Throws if `workerId` is not in `KNOWN_WORKERS`, or if the harness's own boot fails
 * (bad specifier read, hash mismatch, worker signalled failure, etc.) — this function does
 * NOT apply the signing-time budget (budget.ts) to the boot itself, only call sites that use
 * the resulting `worker.fetch` for actual chain reads should do that, since booting is a
 * one-time cost best paid once and reused, not re-attempted under a 1.5s deadline every time.
 */
export async function ensureAnonRpcWorker(options: EnsureAnonRpcWorkerOptions): Promise<AnonRpcWorkerHandle> {
  const knownWorker = assertKnownWorker(options.workerId);
  const key = cacheKey(knownWorker.id, options.config);

  let created = false;
  return lifecycle.ensure(key, () => {
    created = true;
    const t0 = Date.now();
    const init: ExtensionWorkerInit = {
      address: knownWorker.specifier,
      config: options.config,
      preExisting: { rpcProvider: options.bootstrapRpc },
    };
    const worker = new AnonRpcWorker(init);
    return { worker, ready: worker.ready.then(() => ({ worker, knownWorker, cold: true, bootMs: Date.now() - t0 })) };
  }).then((handle) => created ? handle : { ...handle, cold: false, bootMs: 0 });
}

/** Releases the cached worker, if any. Call on extension disable/settings change. */
export function closeAnonRpcWorker(): void {
  lifecycle.close();
}
