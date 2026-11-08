// Pure simulation engine. No React, no DOM, no timers.
//
// The verdicts come from BOUND's own code, imported from the repository:
//   shared/decoder      classifyRequest()  → what the request would do
//   shared/policy-core  evaluate()         → score + verdict
// The routing rules mirror client/extension/sw.js (typed confirmation for the firewall tier, deadline behaviour).
// Everything the UI shows as a result must come from a function in this file.
import { classifyRequest } from '../../../../shared/decoder/index.mjs';
import { evaluate } from '../../../../shared/policy-core/index.mjs';
import { A, labelOf, short } from './requests.js';
import { SITE_POLICY } from './scenarios.js';

export const CONFIRM_PHRASE = 'I UNDERSTAND';        // sw.js: required for escalated verdicts
export const DEADLINE_MINUTES = 10;                  // sw.js DEADLINE_MS = 10 * 60_000
export const THRESHOLDS = { green: 70, amber: 40, red: 16 };

const TIER = {
  green:     { tone: 'pass',  title: 'Checks passed',         window: 'Review window',  summary: 'Every counterparty is on this site’s trusted list.' },
  amber:     { tone: 'warn',  title: 'Review this request',   window: 'Warning window', summary: 'Part of this request could not be matched to the site’s trusted list.' },
  red:       { tone: 'alert', title: 'Strong warning',        window: 'Warning window', summary: 'This gives rights or funds to an address this site does not normally use.' },
  escalated: { tone: 'stop',  title: 'Firewall',              window: 'Firewall window', summary: 'Strongest warning. You can still continue, after typing a confirmation.' },
  grey:      { tone: 'none',  title: 'No score',              window: 'Warning window', summary: 'BOUND had nothing to compare against. This is not a safe signal.' },
};

/** Runs one scenario through the real decoder and policy engine. */
export function assess(scenario) {
  const classification = classifyRequest(scenario.request);
  const e = scenario.eval ?? {};
  const baseline = e.baseline ?? null;
  const policy = scenario.policy ?? SITE_POLICY;
  const result = evaluate({
    classification, policy, baseline,
    signerAccounts: e.signerAccounts ?? [A.you],
    drift: Boolean(e.drift),
    witnessed: new Set((e.witnessed ?? []).map((x) => x.toLowerCase())),
    coverage: e.coverage ?? 'mediated',
  });
  const entries = (classification.entries ?? []).map((item) => {
    const address = item.address.toLowerCase();
    const listed = Boolean(policy[address]);
    return { address, shortAddress: short(address), label: labelOf(address), role: item.role, verified: item.verified !== false, listed };
  });
  const tier = TIER[result.verdict];
  return {
    scenarioId: scenario.id,
    mediated: scenario.mediated !== false,
    method: classification.method,
    kind: classification.kind,
    label: classification.label ?? null,
    approvals: classification.approvals ?? [],
    entries,
    verdict: result.verdict,
    score: result.score,
    reasons: result.reasons,
    coverage: result.coverage,
    counterpartyRisk: result.counterpartyRisk,
    tone: tier.tone, title: tier.title, window: tier.window, summary: tier.summary,
    requiresTyped: result.verdict === 'escalated',
    drift: Boolean(e.drift),
    baseline,
  };
}

/** A review decision. Mirrors sw.js: an escalated verdict needs the typed phrase to continue. */
export function decide(assessment, action, typed = '') {
  if (action === 'cancel') return { ok: true, forwarded: false, text: 'Cancelled. The page receives “User rejected the request”. Nothing reaches the wallet.' };
  if (action !== 'continue') return { ok: false, forwarded: false, text: 'Unknown action.' };
  if (assessment.requiresTyped && typed.trim() !== CONFIRM_PHRASE) {
    return { ok: false, forwarded: false, error: 'confirmation_required', text: `Type ${CONFIRM_PHRASE} to continue past the firewall.` };
  }
  return { ok: true, forwarded: true, text: 'Forwarded to your wallet unchanged. Your wallet still asks you.' };
}

/** What happens to a pending review without a user decision. */
export function lifecycleEvent(assessment, event) {
  if (event === 'deadline') {
    return assessment.requiresTyped
      ? { forwarded: false, text: `${DEADLINE_MINUTES} minutes passed with no answer. This tier needs a typed confirmation, so the request is cancelled.` }
      : { forwarded: true, text: `${DEADLINE_MINUTES} minutes passed with no answer. The request is handed to your wallet, which still asks you. Nothing was approved by BOUND.` };
  }
  if (event === 'stateChange') return { forwarded: false, text: 'The wallet account or chain changed during the review, so the decision no longer applies. The request is cancelled and must be sent again.' };
  if (event === 'spoofClick') return { forwarded: false, ignored: true, text: 'Ignored. Only a click inside the extension’s own window can resolve a review. A message from the page cannot.' };
  throw new Error(`Unknown lifecycle event: ${event}`);
}

/** The result of the wallet executing a forwarded request the user confirmed. */
export function walletOutcome(scenario, confirmed) {
  return confirmed ? scenario.consequence : { kind: 'none', text: 'Rejected in the wallet. Nothing changed.' };
}

/** Without BOUND the request goes straight to the wallet. */
export function withoutBound(scenario) {
  return { forwarded: true, text: 'The request goes straight to the wallet. Nothing checks it against the site’s own history.' };
}

/** Everything the coverage table shows, computed live from the real engine. */
export function coverageRow(scenario) {
  const a = assess(scenario);
  return { id: scenario.id, group: scenario.group, title: scenario.title, incident: scenario.incident ?? null, verdict: scenario.mediated === false ? 'unseen' : a.verdict, score: a.score, label: a.label, mediated: a.mediated, limit: Boolean(scenario.limit) };
}
