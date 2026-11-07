import {createHash, randomUUID} from 'node:crypto';
import {open, readFile, rename, unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {parseUniqueJSON, validateObservation, validateObservationBatch, validateRecord} from '../../packages/contracts/index.js';

const exact = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const validId = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const recordOnly = record => validateRecord(record) && record.kind === 'observation';
const validEntry = entry => exact(entry, ['id', 'fingerprint', 'acceptedAt', 'record', 'delivered']) &&
  validId(entry.id) && validId(entry.fingerprint) && Number.isSafeInteger(entry.acceptedAt) && entry.acceptedAt >= 0 &&
  recordOnly(entry.record) && entry.fingerprint === digest(entry.record) && typeof entry.delivered === 'boolean';
const validState = state => exact(state, ['version', 'config', 'lastNow', 'entries']) && state.version === 1 && exact(state.config, ['windowMs','retentionMs','k']) && Number.isSafeInteger(state.lastNow) && state.lastNow >= 0 && Array.isArray(state.entries) &&
  state.entries.length <= 100000 && state.entries.every(validEntry) && new Set(state.entries.map(entry => entry.id)).size === state.entries.length;

async function persist(path, state) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let file;
  try {
    file = await open(temporary, 'wx', 0o600);
    await file.writeFile(JSON.stringify(state), 'utf8');
    await file.sync();
    await file.close(); file = undefined;
    await rename(temporary, path);
    const directory = await open(dirname(path), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    if (file) await file.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

// Single-process durable watcher. The adapter must deduplicate writes by operation ID.
export async function openDurableWatcher({path, windowMs, retentionMs, k, now = Date.now, writeObservation, isIncidentActive, hasCorroboratedDrift}) {
  if (typeof path !== 'string' || !path || !Number.isSafeInteger(windowMs) || windowMs < 1 ||
      !Number.isSafeInteger(retentionMs) || retentionMs < windowMs || !Number.isSafeInteger(k) || k < 2 ||
      typeof now !== 'function' || typeof writeObservation !== 'function' || typeof isIncidentActive !== 'function' ||
      typeof hasCorroboratedDrift !== 'function') throw new Error('explicit durable watcher configuration required');

  const config = {windowMs,retentionMs,k};
  let state;
  try { state = parseUniqueJSON(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') state = {version: 1, config, lastNow: 0, entries: []}; else throw new Error('invalid watcher state', {cause: error}); }
  if (!validState(state)) throw new Error('invalid watcher state');
  if (state.config.windowMs !== windowMs || state.config.retentionMs !== retentionMs || state.config.k !== k) throw new Error('watcher configuration mismatch');
  let queue = Promise.resolve();
  let uncertain = false;
  const serialize = action => {
    const result = queue.then(() => {
      if (uncertain) throw new Error('watcher persistence uncertain; reopen required');
      return action();
    });
    queue = result.catch(() => {});
    return result;
  };
  const save = async next => {
    next = {...next, config};
    if (JSON.stringify(next).length > 1_000_000 || next.entries.length > 100_000) throw new Error('watcher state full');
    try { await persist(path, next); state = next; }
    catch (error) { uncertain = true; throw error; }
  };
  let maxObservedTime = state.lastNow;
  const clock = () => {
    const time = now();
    if (!Number.isSafeInteger(time) || time < 0 || time > 8640000000000000 || time < maxObservedTime || state.entries.some(entry => entry.acceptedAt > time)) throw new Error('invalid or reversed watcher clock');
    maxObservedTime = time;
    return time;
  };
  const eventKey = event => JSON.stringify([event.site, event.chainId, event.value, event.reporterKey, event.kind === 'warned' ? 'warned' : 'positive', ...(event.kind === 'warned' && event.observedAt ? [event.observedAt] : [])]);
  const toRecord = event => ({schemaVersion: 1, kind: 'observation', site: event.site, chainId: event.chainId, value: event.value, reporterKey: event.reporterKey, event: event.kind, ...(event.score !== undefined ? {score:event.score,observedAt:event.observedAt} : {})});

  async function intake(batch) {
    batch = structuredClone(batch);
    return serialize(async () => {
      if (!validateObservationBatch(batch)) return {schemaVersion: 1, result: 'rejected'};
      const time = clock();
      if (time < state.lastNow) throw new Error('watcher clock moved backwards');
      const liveEntries = state.entries.filter(entry => !entry.delivered || time - entry.acceptedAt < retentionMs);
      // Deduplicate across everything retained, not only the counting window: a replayed
      // batch must not add entries (and Arkiv writes) for as long as the original is kept.
      const seen = new Set(liveEntries.map(entry => eventKey({
        site: entry.record.site, chainId: entry.record.chainId, value: entry.record.value,
        reporterKey: entry.record.reporterKey, kind: entry.record.event, observedAt: entry.record.observedAt,
      })));
      const additions = [];
      for (const event of batch.events) {
        if (event.observedAt && Date.parse(event.observedAt) > time) return {schemaVersion: 1, result: 'rejected'};
        const active = await isIncidentActive(event.site, event.chainId);
        if (typeof active !== 'boolean') throw new Error('incident status unavailable');
        if (active) continue;
        const fingerprint = eventKey(event);
        if (seen.has(fingerprint)) continue;
        seen.add(fingerprint);
        const record = toRecord(event);
        const acceptedAt = time;
        const id = digest([acceptedAt, record, randomUUID()]);
        additions.push({id, fingerprint: digest(record), acceptedAt, record, delivered: false});
      }
      await save({version: 1, lastNow: time, entries: [...liveEntries, ...additions]});
      return {schemaVersion: 1, result: 'accepted'};
    });
  }

  async function flush() {
    return serialize(async () => {
      for (let index = 0; index < state.entries.length; index++) {
        const entry = state.entries[index];
        if (entry.delivered) continue;
        await writeObservation(structuredClone(entry.record), entry.id);
        const entries = state.entries.slice();
        entries[index] = {...entry, delivered: true};
        await save({version: 1, lastNow: state.lastNow, entries});
      }
    });
  }

  const pending = () => serialize(async () => state.entries.filter(entry => !entry.delivered).map(({id, record}) => ({id, record: structuredClone(record)})));
  async function evaluateTriggers(site, chainId) {
    return serialize(async () => {
      const time = clock();
      const groups = new Map();
      for (const entry of state.entries) {
        const record = entry.record;
        if (!entry.delivered || time - entry.acceptedAt >= windowMs || record.site !== site || record.chainId !== chainId || record.event !== 'warned') continue;
        if (!groups.has(record.value)) groups.set(record.value, new Set());
        groups.get(record.value).add(record.reporterKey);
      }
      let drift = null;
      try { const value = await hasCorroboratedDrift(site, chainId); if (typeof value === 'boolean') drift = value; } catch { /* unavailable drift never invents corroboration */ }
      const triggers = [...groups].filter(([, reporters]) => drift === true || reporters.size >= k)
        .map(([counterparty]) => ({counterparty, trigger: drift === true ? 'drift+warned' : 'K-same-counterparty-warned'}));
      return {triggers, driftStatus: drift === null ? 'unavailable' : 'available'};
    });
  }

  async function triggers(site, chainId) { return (await evaluateTriggers(site, chainId)).triggers; }

  const recoveryQuiet=(site,chainId)=>serialize(()=>{
    if(!validateObservation({site,chainId,value:'0x'+'0'.repeat(40),kind:'warned',reporterKey:'validation'}))throw new Error('invalid recovery scope');
    const time=clock();
    return !state.entries.some(entry=>time-entry.acceptedAt<windowMs&&entry.record.site===site&&entry.record.chainId===chainId&&entry.record.event==='warned');
  });

  async function baseline(site, chainId) {
    return serialize(async () => {
      const time = clock();
      const warnings = new Set(state.entries.filter(entry => time - entry.acceptedAt < retentionMs && entry.record.site === site && entry.record.chainId === chainId && entry.record.event === 'warned').map(entry => entry.record.value));
      const positive = state.entries.filter(entry => entry.delivered && time - entry.acceptedAt < retentionMs && entry.record.site === site && entry.record.chainId === chainId && entry.record.event !== 'warned' && !warnings.has(entry.record.value));
      const values = event => [...new Set(positive.filter(entry => entry.record.event === event).map(entry => entry.record.value))].sort();
      return {schemaVersion: 1, kind: 'baseline', site, chainId, counterparties: values('counterparty'), calledContracts: values('called-contract'), updatedAt: new Date(time).toISOString()};
    });
  }
  const scopes = () => [...new Set(state.entries.map(entry => JSON.stringify([entry.record.site, entry.record.chainId])))].map(value => {
    const [site, chainId] = JSON.parse(value);
    return {site, chainId};
  }).sort((a, b) => a.site.localeCompare(b.site) || a.chainId - b.chainId);
  return {intake, flush, pending, triggers, evaluateTriggers, recoveryQuiet, baseline, scopes};
}
