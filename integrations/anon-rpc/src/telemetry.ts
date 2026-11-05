/**
 * Local-only call telemetry for the Anon-RPC path.
 *
 * Arch §12.3 "what never leaves the browser" and §7 "publish nothing that identifies a
 * user" both apply here: this records counts and latencies of BOUND's own anon-rpc calls
 * for its own popup/diagnostics (how often the budget is being hit, is the worker even
 * booting) — it is never transmitted anywhere, never keyed by site, wallet or counterparty
 * address, and holds no request content. It is the in-memory counterpart to the harness's
 * own §13.1 log buffer (acceptLog()), which is prose for a human; this is numbers for a
 * dashboard.
 */

import type { BudgetOutcome } from "./budget.ts";

export interface AnonRpcTelemetrySnapshot {
  readonly attempts: number;
  readonly successes: number;
  readonly timeouts: number;
  readonly errors: number;
  readonly aborted: number;
  /** Milliseconds. undefined if there have been no successful calls yet. */
  readonly lastLatencyMs?: number;
  /** Simple running mean over successful calls only. undefined with no successes yet. */
  readonly meanLatencyMs?: number;
}

export class AnonRpcTelemetry {
  #attempts = 0;
  #successes = 0;
  #timeouts = 0;
  #errors = 0;
  #aborted = 0;
  #lastLatencyMs: number | undefined;
  #latencySum = 0;

  /** Feed the outcome of one `withBudget`-wrapped call. Call exactly once per attempt. */
  record<T>(outcome: BudgetOutcome<T>): void {
    this.#attempts += 1;
    if (outcome.ok) {
      this.#successes += 1;
      this.#lastLatencyMs = outcome.elapsedMs;
      this.#latencySum += outcome.elapsedMs;
      return;
    }
    switch (outcome.reason) {
      case "timeout":
        this.#timeouts += 1;
        return;
      case "aborted":
        this.#aborted += 1;
        return;
      case "error":
        this.#errors += 1;
        return;
    }
  }

  snapshot(): AnonRpcTelemetrySnapshot {
    return {
      attempts: this.#attempts,
      successes: this.#successes,
      timeouts: this.#timeouts,
      errors: this.#errors,
      aborted: this.#aborted,
      lastLatencyMs: this.#lastLatencyMs,
      meanLatencyMs: this.#successes > 0 ? this.#latencySum / this.#successes : undefined,
    };
  }

  reset(): void {
    this.#attempts = 0;
    this.#successes = 0;
    this.#timeouts = 0;
    this.#errors = 0;
    this.#aborted = 0;
    this.#lastLatencyMs = undefined;
    this.#latencySum = 0;
  }
}
