/**
 * The signing-time hard budget (arch §9.5 step 8, §13): "Anon-RPC facts come with a 1.5
 * second budget; if it expires the request is scored without them... Signing never waits
 * beyond that budget." This module is the one place that deadline is enforced, so every
 * caller on the signing path gets the same behavior: never throw past the deadline, always
 * resolve with a tagged outcome the scorer can act on (an untrusted counterparty stays
 * capped — it must not read as "trusted because we didn't check in time").
 */

export const DEFAULT_SIGNING_BUDGET_MS = 1500;

export type BudgetOutcome<T> =
  | { ok: true; value: T; elapsedMs: number }
  | { ok: false; reason: "timeout"; elapsedMs: number }
  | { ok: false; reason: "error"; error: unknown; elapsedMs: number }
  | { ok: false; reason: "aborted"; elapsedMs: number };

/**
 * Runs `task` against a hard deadline. `task` receives an `AbortSignal` that fires exactly
 * when the budget expires, so a well-behaved fetch/provider call can cancel its own in-flight
 * request rather than leaking it after this function has already moved on.
 *
 * Never rejects: every path — success, timeout, thrown error, or an externally aborted
 * `signal` passed in via `options` — resolves to a tagged `BudgetOutcome`. That is deliberate:
 * a caller on the signing path must not need a try/catch to keep the "never block signing"
 * invariant; the type itself makes "no answer in time" a normal, handled case rather than an
 * exception path someone could forget to catch.
 */
export async function withBudget<T>(
  task: (signal: AbortSignal) => Promise<T>,
  budgetMs: number = DEFAULT_SIGNING_BUDGET_MS,
  options?: { signal?: AbortSignal },
): Promise<BudgetOutcome<T>> {
  const start = Date.now();
  const controller = new AbortController();
  const elapsed = () => Date.now() - start;

  if (options?.signal) {
    if (options.signal.aborted) {
      return { ok: false, reason: "aborted", elapsedMs: elapsed() };
    }
    options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  let timedOut = false;
  let rejectTimeout!: (err: Error) => void;
  // A task that ignores the AbortSignal (does not actually cancel its own network call)
  // must still not make `withBudget` wait past `budgetMs` — that is the entire point of a
  // signing-time hard deadline. Racing against a timeout promise, rather than only awaiting
  // `task()` and checking a flag afterward, is what actually enforces that: the earlier
  // version awaited `task()` unconditionally and only classified the outcome afterward, which
  // meant an unresponsive task silently blocked for its own full duration regardless of the
  // budget. `controller.abort()` is still signaled immediately, for any task that DOES
  // cooperate; `Promise.race` is what covers the ones that don't.
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    rejectTimeout = reject;
  });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    rejectTimeout(new Error("anon-rpc budget exceeded"));
  }, budgetMs);

  // Captured separately (not inlined into the `Promise.race` array) so that if the task
  // ignores the abort and later settles after the race has already resolved on the timeout,
  // a subsequent rejection has a handler attached and Node does not report it as unhandled.
  const taskPromise = task(controller.signal);
  taskPromise.catch(() => {});

  try {
    const value = await Promise.race([taskPromise, timeoutPromise]);
    return { ok: true, value, elapsedMs: elapsed() };
  } catch (error) {
    if (timedOut) {
      return { ok: false, reason: "timeout", elapsedMs: elapsed() };
    }
    if (options?.signal?.aborted) {
      return { ok: false, reason: "aborted", elapsedMs: elapsed() };
    }
    return { ok: false, reason: "error", error, elapsedMs: elapsed() };
  } finally {
    clearTimeout(timer);
  }
}

/** True for any outcome that did not produce a usable value — the caller should score "capped", not "trusted". */
export function isBudgetFailure<T>(outcome: BudgetOutcome<T>): outcome is Exclude<BudgetOutcome<T>, { ok: true }> {
  return !outcome.ok;
}
