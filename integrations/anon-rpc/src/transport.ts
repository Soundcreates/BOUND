/**
 * JSON-RPC-over-anon-fetch transport adapter.
 *
 * `AnonRpcWorker#fetch` (spec §5) is "a standard fetch, this-bound" — the harness's own
 * words, and its type (`AnonFetch`) is declared "assignable to `typeof fetch`". That is the
 * entire anonymization boundary from this package's point of view: everything below this
 * line is ordinary JSON-RPC-over-HTTP code that does not know or care that the fetch it was
 * handed is actually tunnelled through a sandboxed worker instead of going out directly.
 *
 * This wraps that fetch into the same minimal EIP-1193-ish shape anon-rpc's own harness uses
 * for its *pre-existing* provider (`RpcProvider = { request({method, params}): Promise<unknown> }`,
 * from `@anon-rpc/browser-harness`'s spec types) — so `@bound/integrations-ens`'s viem clients,
 * or any other BOUND chain-read code, can take either a direct provider or an anon-rpc-backed
 * one through the identical call shape, and the §9.5-step-8 budget/telemetry wrapping lives in
 * exactly one place rather than being re-implemented at every call site.
 */

import { withBudget, DEFAULT_SIGNING_BUDGET_MS, type BudgetOutcome } from "./budget.ts";
import { AnonRpcTelemetry } from "./telemetry.ts";

/** The minimal fetch shape BOUND needs from a worker: this-bound, same signature as `fetch`. */
export type AnonFetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** Matches `@anon-rpc/browser-harness`'s `RpcProvider` exactly: the shape anon-rpc's own §4 read uses. */
export interface RpcProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

export class JsonRpcError extends Error {
  readonly code?: number;
  readonly data?: unknown;
  constructor(message: string, code?: number, data?: unknown) {
    super(message);
    this.name = "JsonRpcError";
    this.code = code;
    this.data = data;
  }
}

interface JsonRpcResponseBody {
  readonly result?: unknown;
  readonly error?: { readonly code?: number; readonly message?: string; readonly data?: unknown };
}

function isJsonRpcResponseBody(v: unknown): v is JsonRpcResponseBody {
  return typeof v === "object" && v !== null;
}

export interface AnonRpcProviderOptions {
  /** Per-call hard budget in ms (arch §9.5 step 8 / §13). Default 1500. */
  readonly budgetMs?: number;
  /** Shared counters; pass the same instance across calls to accumulate across a session. */
  readonly telemetry?: AnonRpcTelemetry;
}

/**
 * An `RpcProvider` that sends every `request()` as one JSON-RPC POST through `anonFetch`,
 * enforced against the signing-time budget, with every attempt recorded to `telemetry`.
 *
 * `request()` never rejects with a timeout as an opaque hang — on budget expiry it rejects
 * with `JsonRpcError`/`Error` promptly (because an `RpcProvider.request` by its own type must
 * return a result or reject), so a caller still needs its own try/catch; what this guarantees
 * is that the catch fires within `budgetMs`, every time, which is what makes "scored without
 * them after the 1.5s budget" (arch §13) actually hold rather than being aspirational.
 */
export function createAnonRpcProvider(
  anonFetch: AnonFetchLike,
  endpointUrl: string,
  options: AnonRpcProviderOptions = {},
): RpcProvider {
  const budgetMs = options.budgetMs ?? DEFAULT_SIGNING_BUDGET_MS;
  const telemetry = options.telemetry;
  let nextId = 0;

  return {
    async request({ method, params }): Promise<unknown> {
      const id = ++nextId;
      const outcome: BudgetOutcome<unknown> = await withBudget(async (signal) => {
        const res = await anonFetch(endpointUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? [] }),
          signal,
        });
        if (!res.ok) {
          throw new JsonRpcError(`HTTP ${res.status} from anon-rpc endpoint`);
        }
        const body: unknown = await res.json();
        if (!isJsonRpcResponseBody(body)) {
          throw new JsonRpcError("malformed JSON-RPC response body");
        }
        if (body.error) {
          throw new JsonRpcError(body.error.message ?? "JSON-RPC error", body.error.code, body.error.data);
        }
        return body.result;
      }, budgetMs);

      telemetry?.record(outcome);

      if (outcome.ok) return outcome.value;
      if (outcome.reason === "timeout") {
        throw new JsonRpcError(`anon-rpc call to ${method} exceeded its ${budgetMs}ms budget`);
      }
      if (outcome.reason === "aborted") {
        throw new JsonRpcError(`anon-rpc call to ${method} was aborted`);
      }
      throw outcome.error instanceof Error ? outcome.error : new JsonRpcError(String(outcome.error));
    },
  };
}
