// Display evidence only; these rows do not change a request's policy score.
const labels = [
  ['origin', 'HTTPS or local demo origin'],
  ['snapshot', 'ENS/Arkiv snapshot'],
  ['domain', 'Domain and port match'],
  ['arkiv', 'Arkiv watcher lookup'],
  ['watcher', 'Watcher status'],
  ['wallet', 'Wallet chain/account available']
];
export function warningChecks(data) {
  const scopes = data.connectionScore?.scopes;
  const evidence = data.checkEvidence || {};
  let origin;
  try { const u = new URL(data.topOrigin); origin = u.protocol === 'https:' || u.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname); } catch { /* unavailable */ }
  const values = {origin, snapshot:evidence.snapshotVerified, domain:evidence.siteMatched, arkiv:evidence.watcherLookup,
    watcher:evidence.watcherStatus === 'normal' ? true : ['active','drift'].includes(evidence.watcherStatus) ? false : undefined,
    wallet:evidence.walletAvailable};
  return labels.map(([id,label]) => {
    let outcome;
    if (Array.isArray(scopes) && scopes.length) {
      const outcomes = scopes.map(s => s.checks?.find(c => c.id === id)?.outcome);
      outcome = outcomes.includes('failed') ? 'failed' : outcomes.every(o => o === 'passed') ? 'passed' : 'unavailable';
    } else outcome = values[id] === true ? 'passed' : values[id] === false ? 'failed' : 'unavailable';
    return {id,label,outcome};
  });
}
