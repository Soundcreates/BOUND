import test from 'node:test';
import assert from 'node:assert/strict';
import { CASES, runCase, SIMULATED } from './cases.js';

const ids = CASES.map((c) => c.id);

test('five cases with the documented shape', () => {
  assert.equal(CASES.length, 5);
  assert.equal(new Set(ids).size, 5);
  for (const c of CASES) for (const key of ['id', 'title', 'question', 'description']) assert.equal(typeof c[key], 'string', `${c.id}.${key}`);
});

test('results are JSON-serialisable and labelled as simulated inputs', () => {
  assert.equal(SIMULATED, true);
  for (const id of ids) {
    const r = runCase(id);
    assert.deepEqual(JSON.parse(JSON.stringify(r)), r, id);
    assert.equal(r.simulated, true);
    for (const key of ['id', 'score', 'verdict', 'comparison', 'redirectEligible', 'reasons', 'request', 'classification', 'assessment', 'explanation']) assert.ok(key in r, `${id} missing ${key}`);
  }
});

test('each unmodified case meets its stated expectation (computed, not copied)', () => {
  for (const id of ids) {
    const r = runCase(id);
    assert.ok(r.expected, id);
    assert.deepEqual({ score: r.score, verdict: r.verdict, redirectEligible: r.redirectEligible }, r.expected, id);
  }
});

test('outcomes per case', () => {
  const trusted = runCase('trusted-normal');
  assert.deepEqual([trusted.score, trusted.comparison, trusted.redirectEligible, trusted.reasons], [100, 'agree', false, []]);

  const none = runCase('no-baseline');
  assert.equal(none.score, null);
  assert.equal(none.verdict, 'grey');
  assert.equal(none.comparison, 'none');
  assert.equal(none.redirectEligible, false);
  assert.match(none.explanation, /not a safe signal/);

  const unknown = runCase('unknown-spender');
  assert.equal(unknown.score, 35);
  assert.equal(unknown.checks.counterpartyRisk, true);
  assert.equal(unknown.comparison, 'agree');
  assert.equal(unknown.redirectEligible, false, 'a risky spender alone never redirects');

  const conflict = runCase('corroborated-conflict');
  assert.equal(conflict.score, 15);
  assert.equal(conflict.comparison, 'conflict');
  assert.equal(conflict.assessment.corroborated, true);
  assert.ok(conflict.assessment.reasons.includes('drift'));
  assert.equal(conflict.redirectEligible, true);

  const weak = runCase('weak-evidence');
  assert.equal(weak.score, 15, 'weak frontend evidence does not change the policy score');
  assert.equal(weak.comparison, 'conflict');
  assert.equal(weak.redirectEligible, false);
});

test('stale, immature and unconfirmed evidence each suppress fallback', () => {
  assert.equal(runCase('weak-evidence', { stale: false }).redirectEligible, true, 'control: fresh mature evidence redirects');
  const stale = runCase('corroborated-conflict', { stale: true });
  assert.deepEqual([stale.assessment.dataState, stale.assessment.corroborated, stale.redirectEligible], ['stale', false, false]);
  for (const flag of ['immature', 'unconfirmed']) {
    const r = runCase('corroborated-conflict', { [flag]: true });
    assert.equal(r.comparison, 'unfamiliar', flag);
    assert.equal(r.redirectEligible, false, flag);
    assert.equal(r.checks.frontendRecord, flag);
  }
});

test('mismatch without corroboration does not redirect', () => {
  const r = runCase('trusted-normal', { frontend: 'mismatch' });
  assert.equal(r.comparison, 'conflict');
  assert.equal(r.assessment.corroborated, false);
  assert.equal(r.redirectEligible, false);
});

test('non-top or cross-origin frame never redirects', () => {
  for (const frame of [{ isTop: false, sameOrigin: true }, { isTop: true, sameOrigin: false }, { isTop: true, sameOrigin: true, ambiguous: true }]) {
    assert.equal(runCase('corroborated-conflict', { frame }).redirectEligible, false, JSON.stringify(frame));
  }
});

test('overrides drive the real engine', () => {
  assert.equal(runCase('corroborated-conflict', { drift: false }).score, 35);
  const bypass = runCase('trusted-normal', { coverage: 'bypass_possible' });
  assert.equal(bypass.verdict, 'grey', 'green is withheld when a wallet path may bypass BOUND');
  assert.equal(bypass.score, null);
  assert.equal('expected' in runCase('trusted-normal', { drift: true }), false, 'overridden runs carry no expectation');
});

test('unknown case id throws', () => {
  assert.throws(() => runCase('nope'), /Unknown case/);
});

test('frontend conflict cannot redirect when the policy score is above the red threshold', () => {
 const result=runCase('corroborated-conflict',{drift:false});
 assert.equal(result.score,35);
 assert.equal(result.assessment.redirectEligible,true);
 assert.equal(result.redirectEligible,false);
});
