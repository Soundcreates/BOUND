import { test } from "node:test";
import assert from "node:assert/strict";
import { withBudget, isBudgetFailure } from "../src/budget.ts";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("withBudget returns ok:true with the value when the task finishes in time", async () => {
  const outcome = await withBudget(async () => 42, 100);
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.value, 42);
    assert.equal(typeof outcome.elapsedMs, "number");
  }
  assert.equal(isBudgetFailure(outcome), false);
});

test("withBudget returns ok:false reason:timeout when the task is still running past the budget", async () => {
  const outcome = await withBudget(async () => {
    await delay(200);
    return "too late";
  }, 20);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.reason, "timeout");
  assert.equal(isBudgetFailure(outcome), true);
});

test("withBudget aborts the task's signal exactly when the budget expires", async () => {
  let sawAbort = false;
  await withBudget(async (signal) => {
    await new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => {
        sawAbort = true;
        resolve();
      });
    });
  }, 10);
  assert.equal(sawAbort, true);
});

test("withBudget returns ok:false reason:error when the task throws before the budget expires", async () => {
  const outcome = await withBudget(async () => {
    throw new Error("boom");
  }, 100);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.reason, "error");
    if (outcome.reason === "error") assert.equal((outcome.error as Error).message, "boom");
  }
});

test("withBudget never rejects, even when the task throws", async () => {
  await assert.doesNotReject(() =>
    withBudget(async () => {
      throw new Error("still never rejects");
    }, 50),
  );
});

test("withBudget honors an externally supplied signal that is already aborted", async () => {
  const controller = new AbortController();
  controller.abort();
  const outcome = await withBudget(async () => "unreachable", 1000, { signal: controller.signal });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.reason, "aborted");
});

test("withBudget defaults to the 1.5s signing budget when none is given", async () => {
  const t0 = Date.now();
  const outcome = await withBudget(async () => "fast");
  assert.equal(outcome.ok, true);
  assert.ok(Date.now() - t0 < 1500, "a fast task should not wait out the default budget");
});
