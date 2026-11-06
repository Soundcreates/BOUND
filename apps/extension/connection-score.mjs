import { SCORE_SETTINGS } from './score-settings.mjs';
export const CONNECTION_THRESHOLD = SCORE_SETTINGS.connectionThreshold;

// Connection confidence only. Transaction trust scores and caps are separate.
export function scoreConnection({ origins, providerValid, now = Date.now(), config = SCORE_SETTINGS }) {
  const scopes = (origins || []).map(({ origin, status }) => {
    let accepted = false;
    try {
      const url = new URL(origin);
      accepted = url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
    } catch { /* Invalid origins fail the origin check. */ }
    const fresh = Number.isFinite(Date.parse(status?.expiresAt)) && Date.parse(status.expiresAt) > now;
    const evidence = status?.evidence || {};
    const checks = [];
    const add = (id, label, weight, passed) => checks.push({ id, label, weight, outcome: passed === true ? 'passed' : passed === false ? 'failed' : 'unavailable', points: passed === true ? weight : passed === false ? -weight : 0 });
    add('origin', 'HTTPS or local demo origin', config.weights.origin, accepted);
    add('snapshot', 'Verified current ENS/Arkiv snapshot', config.weights.snapshot, evidence.snapshotVerified);
    add('domain', 'Exact domain and port in snapshot', config.weights.domain, evidence.siteMatched);
    add('arkiv', 'Arkiv watcher lookup returned valid data', config.weights.arkiv, evidence.watcherLookup);
    add('watcher', 'Current normal watcher status', config.weights.watcher, fresh && status?.status === 'normal' ? true : fresh && ['active', 'drift'].includes(status?.status) ? false : null);
    add('wallet', 'Wallet chain/account state available', config.weights.wallet, providerValid);
    const blockers = [];
    if (!accepted) blockers.push('Unsupported page origin');
    if (!providerValid) blockers.push('Wallet state unavailable');
    if (fresh && status?.status === 'active') blockers.push('Active site incident');
    if (fresh && status?.status === 'drift') blockers.push('Infrastructure drift');
    return { origin, score: Math.max(0, Math.min(100, checks.reduce((sum, check) => sum + check.points, 0))), checks, blockers };
  });
  const score = scopes.length ? Math.min(...scopes.map(scope => scope.score)) : 0;
  const blockers = [...new Set(scopes.flatMap(scope => scope.blockers))];
  // Only positive evidence of a problem refuses a connection: an unsupported origin,
  // unusable wallet state, or an active incident or drift. A low score from missing
  // data (a new site, or trust data that is not published) still connects, marked
  // unverified, and the transaction checks keep warning on what they cannot verify.
  const allowed = scopes.length > 0 && blockers.length === 0;
  const verified = allowed && score >= config.connectionThreshold;
  return { version: 1, score, threshold: config.connectionThreshold, allowed, verified, blockers, scopes };
}
