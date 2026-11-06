import { test } from "node:test";
import assert from "node:assert/strict";
import { AnonRpcTelemetry } from "../src/telemetry.ts";
import type { BudgetOutcome } from "../src/budget.ts";

test("starts at all zeros with undefined latencies", () => {
  const t = new AnonRpcTelemetry();
  assert.deepEqual(t.snapshot(), {
    attempts: 0,
    successes: 0,
    timeouts: 0,
    errors: 0,
    aborted: 0,
    lastLatencyMs: undefined,
    meanLatencyMs: undefined,
  });
});

test("records a mix of outcomes into the right buckets", () => {
  const t = new AnonRpcTelemetry();
  t.record<number>({ ok: true, value: 1, elapsedMs: 100 });
  t.record<number>({ ok: true, value: 2, elapsedMs: 300 });
  t.record<number>({ ok: false, reason: "timeout", elapsedMs: 1500 });
  t.record<number>({ ok: false, reason: "error", error: new Error("x"), elapsedMs: 5 });
  t.record<number>({ ok: false, reason: "aborted", elapsedMs: 2 });

  const snap = t.snapshot();
  assert.equal(snap.attempts, 5);
  assert.equal(snap.successes, 2);
  assert.equal(snap.timeouts, 1);
  assert.equal(snap.errors, 1);
  assert.equal(snap.aborted, 1);
  assert.equal(snap.lastLatencyMs, 300);
  assert.equal(snap.meanLatencyMs, 200);
});

test("reset clears every counter back to the initial state", () => {
  const t = new AnonRpcTelemetry();
  const ok: BudgetOutcome<string> = { ok: true, value: "x", elapsedMs: 50 };
  t.record(ok);
  t.reset();
  assert.deepEqual(t.snapshot(), {
    attempts: 0,
    successes: 0,
    timeouts: 0,
    errors: 0,
    aborted: 0,
    lastLatencyMs: undefined,
    meanLatencyMs: undefined,
  });
});
