import { validateObservationBatch } from '../../packages/contracts/index.js';

// In-memory fixture implementation. State must be persisted by a production service.
export function createWatcher({ windowMs, k, now, writeObservation, isIncidentActive, hasCorroboratedDrift }) {
  if (!Number.isSafeInteger(windowMs) || windowMs <= 0 || !Number.isSafeInteger(k) || k < 2 || typeof now !== 'function' || typeof writeObservation !== 'function' || typeof isIncidentActive !== 'function' || typeof hasCorroboratedDrift !== 'function') throw new Error('explicit watcher configuration required');
  const seen = new Map();
  const accepted = [];
  const tuple = e => JSON.stringify([e.site, e.chainId, e.value, e.reporterKey, e.kind === 'warned' ? 'warned' : 'positive']);
  let intakeQueue = Promise.resolve();
  function intake(batch) {
    const result = intakeQueue.then(() => processBatch(batch));
    intakeQueue = result.catch(() => {});
    return result;
  }
  async function processBatch(batch) {
    if (!validateObservationBatch(batch)) return { schemaVersion: 1, result: 'rejected' };
    for (const event of batch.events) {
      const time = now();
      for (const [key, at] of seen) if (time - at >= windowMs) seen.delete(key);
      if (await isIncidentActive(event.site, event.chainId)) continue;
      const key = tuple(event);
      if (seen.has(key)) continue;
      const record = { schemaVersion: 1, kind: 'observation', site: event.site, chainId: event.chainId, value: event.value, reporterKey: event.reporterKey, event: event.kind };
      try { await writeObservation(record); } catch { return { schemaVersion: 1, result: 'retry' }; }
      seen.set(key, time);
      accepted.push({ record, time });
    }
    return { schemaVersion: 1, result: 'accepted' };
  }
  async function triggers(site, chainId) {
    const time = now();
    const groups = new Map();
    for (const { record: r, time: at } of accepted) {
      if (time - at >= windowMs || r.site !== site || r.chainId !== chainId || r.event !== 'warned') continue;
      if (!groups.has(r.value)) groups.set(r.value, new Set());
      groups.get(r.value).add(r.reporterKey);
    }
    const drift = await hasCorroboratedDrift(site, chainId);
    return [...groups].filter(([, keys]) => drift || keys.size >= k).map(([counterparty]) => ({ counterparty, trigger: drift ? 'drift+warned' : 'K-same-counterparty-warned' }));
  }
  function baseline(site, chainId) {
    const warned = new Set(accepted.filter(x => x.record.site === site && x.record.chainId === chainId && x.record.event === 'warned').map(x => x.record.value));
    const entries = accepted.filter(x => x.record.site === site && x.record.chainId === chainId && x.record.event !== 'warned' && !warned.has(x.record.value));
    const values = kind => [...new Set(entries.filter(x => x.record.event === kind).map(x => x.record.value))].sort();
    return { schemaVersion: 1, kind: 'baseline', site, chainId, counterparties: values('counterparty'), calledContracts: values('called-contract'), updatedAt: new Date(now()).toISOString() };
  }
  return { intake, triggers, baseline };
}
