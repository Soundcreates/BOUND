import { createHash, randomUUID } from 'node:crypto';
import { open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseUniqueJSON, validateRecord } from '../../packages/contracts/index.js';

const keys = (object, names) => object && typeof object === 'object' && !Array.isArray(object) && Object.keys(object).length === names.length && names.every(key => Object.hasOwn(object,key));
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
const digest = record => createHash('sha256').update(JSON.stringify([record.schemaVersion,record.kind,record.site,record.chainId,record.value,record.reporterKey,record.event])).digest('hex');
const validRecord = record => validateRecord(record) && record.kind === 'observation';
const validEntry = item => keys(item,['id','hash','record','status']) && validId(item.id) && typeof item.hash === 'string' && /^[0-9a-f]{64}$/.test(item.hash) && ['pending','delivered'].includes(item.status) && (item.status === 'pending' ? validRecord(item.record) && digest(item.record) === item.hash : item.record === null);
function validateState(state) {
  if (!keys(state,['version','entries']) || state.version !== 1 || !Array.isArray(state.entries) || state.entries.length > 100000 || !state.entries.every(validEntry)) return false;
  return new Set(state.entries.map(entry => entry.id)).size === state.entries.length;
}
async function save(path, state) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let file;
  try {
    file = await open(temporary,'wx',0o600);
    await file.writeFile(JSON.stringify(state),'utf8');
    await file.sync();
    await file.close(); file = undefined;
    await rename(temporary,path);
    const directory = await open(dirname(path),'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally {
    if (file) await file.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

// Single-process durable at-least-once outbox. The receiver must deduplicate by id.
export async function openOutbox({path, deliver}) {
  if (typeof path !== 'string' || !path || typeof deliver !== 'function') throw new Error('outbox configuration required');
  let state;
  try { state = parseUniqueJSON(await readFile(path,'utf8')); }
  catch (error) { if (error.code === 'ENOENT') state = {version:1,entries:[]}; else throw new Error('invalid outbox state', {cause:error}); }
  if (!validateState(state)) throw new Error('invalid outbox state');
  let queue = Promise.resolve();
  let storageFailure = false;
  async function persist(next) {
    if (JSON.stringify(next).length > 1000000) throw new Error('outbox full');
    try { await save(path,next); } catch (error) { storageFailure = true; throw error; }
  }
  function serialize(action) {
    const result = queue.then(() => {
      if (storageFailure) throw new Error('outbox persistence uncertain; reopen required');
      return action();
    });
    queue = result.catch(() => {});
    return result;
  }
  function enqueue(id, record) {
    return serialize(async () => {
      if (!validId(id) || !validRecord(record)) throw new Error('invalid outbox entry');
      const hash = digest(record);
      const prior = state.entries.find(entry => entry.id === id);
      if (prior) { if (prior.hash !== hash) throw new Error('outbox id conflict'); return; }
      if (state.entries.length >= 100000) throw new Error('outbox full');
      const entry = {id,hash,record:structuredClone(record),status:'pending'};
      const next = {version:1,entries:[...state.entries,entry]};
      await persist(next); state = next;
    });
  }
  function flush() {
    return serialize(async () => {
      for (let i=0; i<state.entries.length; i++) {
        const entry = state.entries[i];
        if (entry.status !== 'pending') continue;
        await deliver(structuredClone(entry.record),entry.id);
        const entries = state.entries.slice();
        entries[i] = {...entry,record:null,status:'delivered'};
        const next = {version:1,entries};
        await persist(next); state = next;
      }
    });
  }
  const pending = () => serialize(async () => structuredClone(state.entries.filter(entry => entry.status === 'pending')));
  return {enqueue,flush,pending};
}
