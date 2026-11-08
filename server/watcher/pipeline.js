import {createHash} from 'node:crypto';
import {queryBundle} from '../../shared/integrations/arkiv/index.js';

const HOUR_MS = 60 * 60 * 1000;

// Composition boundary for the durable watcher and an Arkiv-compatible archive.
// Writes are injected so tests can use fakes and production can supply its signer.
export function createObservationPipeline({watcher, archive, owner, currentBlock, now = Date.now}) {
  if (!watcher || ['flush', 'baseline', 'scopes'].some(name => typeof watcher[name] !== 'function') ||
      !archive || ['writeBaseline', 'query'].some(name => typeof archive[name] !== 'function') ||
      typeof archive.writeObservation !== 'function' || typeof owner !== 'string' ||
      typeof currentBlock !== 'function' || typeof now !== 'function') throw new Error('pipeline adapters required');

  async function aggregateHourly() {
    const time = now();
    if (!Number.isSafeInteger(time) || time < 0) throw new Error('invalid pipeline clock');
    const hour = Math.floor(time / HOUR_MS) * HOUR_MS;
    await watcher.flush();
    const published = [];
    for (const {site, chainId} of watcher.scopes()) {
      const computed = await watcher.baseline(site, chainId);
      const record = {...computed, updatedAt: new Date(hour).toISOString()};
      const operationId = createHash('sha256').update(JSON.stringify(['hourly-baseline', record])).digest('hex');
      await archive.writeBaseline(record, operationId);
      published.push({site, chainId, operationId, record});
    }
    return published;
  }

  async function refreshBundle() {
    const block = await currentBlock();
    if (!Number.isSafeInteger(block) || block < 0) throw new Error('invalid Arkiv block');
    return queryBundle({client: archive, owner, currentBlock: block, now});
  }

  async function runHourly() {
    const published = await aggregateHourly();
    const bundle = await refreshBundle();
    return {published, bundle};
  }

  return {aggregateHourly, refreshBundle, runHourly};
}
