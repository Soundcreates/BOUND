// Interactive judge cases.
//
// Every INPUT here is a simulated fixture (fictional addresses, a fictional community record, a
// fixed clock). Every RESULT comes from BOUND's own code, imported from the repository:
//   shared/decoder               classifyRequest()  → what the request would do
//   shared/policy-core           evaluate()         → score + verdict
//   shared/policy-core/frontend  assessFrontend()   → script comparison + fallback eligibility
// The wiring mirrors client/extension/sw.js: evaluate() runs first and its counterpartyRisk is passed
// to assessFrontend() as one of the corroborating signals. No score in this file is hard-coded.
import { classifyRequest } from '../../../../shared/decoder/index.mjs';
import { evaluate } from '../../../../shared/policy-core/index.mjs';
import { assessFrontend, FRONTEND_K, FRONTEND_MATURITY_MS } from '../../../../shared/policy-core/frontend.mjs';
import { A, approve } from '../sim/requests.js';
import { THRESHOLDS } from '../sim/engine.js';
import { SITE_POLICY } from '../sim/scenarios.js';

export const SIMULATED = true;
export const SITE = 'vault.example';
export const NOW = Date.parse('2026-11-01T12:00:00.000Z');   // fixed clock so results are reproducible
const iso = (ms) => new Date(ms).toISOString();

// Valid sha256 SRI strings without Node's Buffer (this file also runs in the browser).
const sri = (byte) => `sha256-${btoa(String.fromCharCode(...new Array(32).fill(byte)))}`;
export const HASH = { published: sri(1), tampered: sri(2) };
const SCRIPT_PATH = '/app.js';

/** What the page actually loaded (simulated). */
function observedFixture(hash) {
  const scripts = [{ path: SCRIPT_PATH, hash }];
  return {
    version: 1, documentUrl: `https://${SITE}/`, scripts,
    coverage: { total: 1, compared: 1, inlineExcluded: 0, queryExcluded: 0, crossOriginExcluded: 0, privatePathExcluded: 0, unavailable: 0, overCap: 0 },
  };
}

/** The community frontend record (simulated). `immature` = first seen too recently; `unconfirmed` = too few reporters. */
function recordFixture({ immature, unconfirmed }) {
  const firstSeen = immature ? NOW - (FRONTEND_MATURITY_MS - 60_000) : NOW - 4 * FRONTEND_MATURITY_MS;
  const reporters = unconfirmed ? FRONTEND_K - 1 : FRONTEND_K;
  return {
    schemaVersion: 1, kind: 'frontend', site: SITE, chainId: 1, updatedAt: iso(NOW),
    scripts: [{ path: SCRIPT_PATH, hash: HASH.published, reporters, firstSeen: iso(firstSeen), lastSeen: iso(NOW), established: !immature && !unconfirmed }],
  };
}

// Base settings per case. Overrides passed to runCase() are merged on top.
const DEFAULTS = {
  spender: 'trusted',          // 'trusted' (router on the site list) | 'unknown' (unlisted address)
  baseline: 'seeded',          // 'seeded' | 'uncurated' | null (no baseline)
  drift: false,                // corroborated drift from the watcher
  incident: false,
  coverage: 'mediated',        // 'mediated' | 'bypass_possible'
  frontend: 'match',           // 'match' | 'mismatch' | 'none' (no community record)
  stale: false,                // community data stale
  immature: false,             // published hash not yet past the maturity window
  unconfirmed: false,          // published hash has fewer than K reporters
  frame: { isTop: true, sameOrigin: true },
};

export const CASES = [
  {
    id: 'trusted-normal',
    title: 'Trusted approval on a normal day',
    question: 'Does a routine approval to the site’s own router pass cleanly?',
    description: 'Unlimited TOKEN approval to the swap router, which the curated snapshot lists. Page scripts match the established community hash. No drift.',
    settings: {},
    expected: { score: 100, verdict: 'green', redirectEligible: false },
  },
  {
    id: 'no-baseline',
    title: 'Site with nothing to compare against',
    question: 'What does BOUND say when it has no baseline for the site?',
    description: 'Same approval, but the site has no snapshot and no community record. BOUND must say “no score”, not “safe”.',
    settings: { baseline: null, frontend: 'none' },
    expected: { score: null, verdict: 'grey', redirectEligible: false },
  },
  {
    id: 'unknown-spender',
    title: 'Unknown spender, no drift',
    question: 'Is an unlisted spender flagged even when nothing else looks wrong?',
    description: 'Approval to an address the site does not normally use. Scripts match, no watcher drift. Expect a warning, not a fallback redirect.',
    settings: { spender: 'unknown' },
    expected: { score: 35, verdict: 'red', redirectEligible: false },
  },
  {
    id: 'corroborated-conflict',
    title: 'Tampered frontend plus drift',
    question: 'When the scripts conflict with the established hash AND the watcher saw drift, is fallback offered?',
    description: 'Unknown spender, page script hash differs from the mature community hash, and drift is corroborated. All three signals line up.',
    settings: { spender: 'unknown', drift: true, frontend: 'mismatch' },
    expected: { score: 15, verdict: 'escalated', redirectEligible: true },
  },
  {
    id: 'weak-evidence',
    title: 'Same mismatch, weak evidence',
    question: 'Does stale or immature community data still trigger a redirect?',
    description: 'Identical to the previous case, but the community data is stale. Toggle immature / unconfirmed to see the same suppression for other reasons.',
    settings: { spender: 'unknown', drift: true, frontend: 'mismatch', stale: true },
    expected: { score: 15, verdict: 'escalated', redirectEligible: false },
  },
].map(Object.freeze);

const byId = Object.fromEntries(CASES.map((c) => [c.id, c]));

const isOverridden = (overrides) => Object.keys(overrides).length > 0;

/** Runs one case through the real decoder, policy engine and frontend assessment. Output is JSON-serialisable. */
export function runCase(id, overrides = {}) {
  const def = byId[id];
  if (!def) throw new Error(`Unknown case: ${id}`);
  const s = { ...DEFAULTS, ...def.settings, ...overrides };

  const spender = s.spender === 'unknown' ? A.attacker : A.router;
  const request = approve(A.token, spender);
  const classification = classifyRequest(request);
  const result = evaluate({
    classification, policy: SITE_POLICY, baseline: s.baseline,
    signerAccounts: [A.you], drift: Boolean(s.drift), witnessed: new Set(), coverage: s.coverage,
  });

  const observedHash = s.frontend === 'mismatch' ? HASH.tampered : HASH.published;
  const record = s.frontend === 'none' ? null : recordFixture(s);
  const assessment = assessFrontend({
    observed: observedFixture(observedHash), record, now: NOW,
    drift: Boolean(s.drift), incident: Boolean(s.incident), counterpartyRisk: result.counterpartyRisk,
    frame: s.frame, dataState: s.stale ? 'stale' : 'fresh', ageMs: s.stale ? 6 * 3_600_000 : 0,
  });

  // frontend-redirect.mjs also requires a low numeric score before creating a ticket.
  const redirectEligible = Number.isInteger(result.score) && result.score >= 0 && result.score < THRESHOLDS.red && assessment.redirectEligible;
  const checks = {
    spenderListed: spender === A.router,
    baseline: s.baseline,
    drift: Boolean(s.drift),
    coverage: result.coverage,
    counterpartyRisk: result.counterpartyRisk,
    dataState: assessment.dataState,
    corroborated: assessment.corroborated,
    corroboratedBy: assessment.reasons,
    frontendRecord: s.frontend === 'none' ? 'absent' : s.immature ? 'immature' : s.unconfirmed ? 'unconfirmed' : 'established',
  };

  const out = {
    id,
    simulated: SIMULATED,
    score: result.score,
    verdict: result.verdict,
    comparison: assessment.comparison,
    redirectEligible,
    reasons: result.reasons,
    checks,
    request,
    classification,
    assessment,
    explanation: explain(result, {...assessment, redirectEligible}, checks),
  };
  // Expectations describe the unmodified case only; a judge toggling inputs gets live results with no stale claim.
  if (!isOverridden(overrides)) out.expected = def.expected;
  return JSON.parse(JSON.stringify(out));
}

/** Plain-language summary, derived only from the computed results. */
function explain(result, assessment, checks) {
  const parts = [];
  if (result.score === null) parts.push(`No score (${result.reasons[0] ?? result.verdict}). This is not a safe signal.`);
  else parts.push(`Policy score ${result.score} → ${result.verdict}.`);
  if (assessment.comparison === 'agree') parts.push('Page scripts match the established community hash.');
  else if (assessment.comparison === 'conflict') parts.push('Page script hash conflicts with the established community hash.');
  else if (assessment.comparison === 'unfamiliar') parts.push(`Page script has no established hash to compare against (${checks.frontendRecord}).`);
  else parts.push('No frontend comparison was possible.');
  if (assessment.redirectEligible) parts.push(`Fallback eligible: conflict corroborated by ${assessment.reasons.join(', ')}.`);
  else if (assessment.comparison === 'conflict' && !assessment.corroborated) parts.push(`Fallback suppressed: community data is ${assessment.dataState}, so nothing corroborates the conflict.`);
  else parts.push('No fallback redirect.');
  return parts.join(' ');
}
