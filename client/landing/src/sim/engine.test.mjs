import test from 'node:test';
import assert from 'node:assert/strict';
import { scenarios, byId } from './scenarios.js';
import { assess, decide, lifecycleEvent, coverageRow, walletOutcome, CONFIRM_PHRASE } from './engine.js';
import { incidents } from '../proof/incidents.js';

// The verdicts below come from BOUND's real decoder + policy-core. If a rule changes upstream,
// this table fails and the simulation copy must be reviewed before the site claims anything.
const EXPECTED = {
  badger: ['red', 35], curve: ['escalated', 15], ledger: ['red', 35], squarespace: ['escalated', 15], bybit: ['amber', 65],
  'eth-sign': ['escalated', 0], delegation: ['escalated', 0], malformed: ['red', 35], 'hidden-address': ['amber', 65],
  'personal-sign': ['amber', 65], unsupported: ['grey', null],
  'trusted-unlimited': ['green', 100], bypass: ['red', 35],
  deadline: ['red', 35], 'state-change': ['red', 35], spoof: ['red', 35],
};

test('every scenario has an expectation and vice versa', () => {
  assert.deepEqual(Object.keys(EXPECTED).sort(), scenarios.map((s) => s.id).sort());
});

test('scenario verdicts match the real engine', () => {
  for (const s of scenarios) {
    const a = assess(s);
    assert.deepEqual([a.verdict, a.score], EXPECTED[s.id], s.id);
  }
});

test('the Bybit-style Safe transaction is NOT decoded: it is an unrecognised-typed-data amber, never red or green', () => {
  const a = assess(byId.bybit);
  assert.equal(a.kind, 'opaque');
  assert.equal(a.label, 'Typed-data fields not recognized');
  assert.equal(a.verdict, 'amber');
  assert.ok(a.entries.every((e) => !e.verified), 'no address in the typed data is verified');
});

test('a trusted counterparty with an unlimited allowance still scores green (the documented limit)', () => {
  const a = assess(byId['trusted-unlimited']);
  assert.equal(a.verdict, 'green');
  assert.equal(byId['trusted-unlimited'].limit, true);
});

test('hidden address in unknown calldata cannot score green', () => {
  assert.notEqual(assess(byId['hidden-address']).verdict, 'green');
});

test('a detected bypass can never be green', () => {
  const s = { ...byId['trusted-unlimited'], eval: { baseline: 'seeded', coverage: 'bypass_possible' } };
  const a = assess(s);
  assert.equal(a.verdict, 'grey');
  assert.equal(a.score, null);
});

test('requests that never reach BOUND are reported as unseen, not scored', () => {
  assert.equal(coverageRow(byId.bypass).verdict, 'unseen');
  assert.equal(assess(byId.bypass).mediated, false);
});

test('firewall tier needs the typed phrase; cancel never does', () => {
  const a = assess(byId.curve);
  assert.equal(a.requiresTyped, true);
  assert.equal(decide(a, 'continue').error, 'confirmation_required');
  assert.equal(decide(a, 'continue', 'i understand').ok, false, 'phrase is exact');
  assert.equal(decide(a, 'continue', CONFIRM_PHRASE).forwarded, true);
  assert.equal(decide(a, 'cancel').forwarded, false);
  const red = assess(byId.badger);
  assert.equal(red.requiresTyped, false);
  assert.equal(decide(red, 'continue').forwarded, true, 'BOUND warns, the user decides');
});

test('lifecycle: deadline forwards non-typed requests and cancels firewall ones', () => {
  assert.equal(lifecycleEvent(assess(byId.deadline), 'deadline').forwarded, true);
  assert.equal(lifecycleEvent(assess(byId.curve), 'deadline').forwarded, false);
});

test('lifecycle: state change cancels; page-drawn dialog is ignored', () => {
  assert.equal(lifecycleEvent(assess(byId['state-change']), 'stateChange').forwarded, false);
  const spoof = lifecycleEvent(assess(byId.spoof), 'spoofClick');
  assert.equal(spoof.forwarded, false);
  assert.equal(spoof.ignored, true);
  assert.throws(() => lifecycleEvent(assess(byId.spoof), 'nope'));
});

test('wallet outcome only reports a consequence when the user confirms in the wallet', () => {
  assert.equal(walletOutcome(byId.badger, true).kind, 'loss');
  assert.equal(walletOutcome(byId.badger, false).kind, 'none');
});

test('every scenario that cites an incident cites a real entry, with sources', () => {
  const ids = new Set(incidents.map((i) => i.id));
  for (const s of scenarios.filter((x) => x.incident)) assert.ok(ids.has(s.incident), s.id);
  for (const i of incidents) {
    assert.ok(i.sources.length >= 2, `${i.id} needs at least two sources`);
    for (const src of i.sources) assert.match(src.url, /^https:\/\//);
  }
});
