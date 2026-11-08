// Rebuilds the aggregator's local state from what it has already published on Arkiv,
// so a replacement container with no disk resumes exactly where the old one stopped.
//
// - Report journal (durable.js): every live observation entity becomes a delivered
//   entry, with its original time taken from the timestamp of its creation block, so
//   the incident counting window and the retention period carry over.
// - Upsert registry (shared/integrations/arkiv/upsert.js): each site's current baseline and
//   status entity is registered as already written. Without this, the next publish
//   would create a second baseline/status per site instead of patching the existing
//   one, and readers that require exactly one would treat every site as unchecked.
//
// Only entities owned by the configured writer and tagged with the BOUND schema are
// read. Nothing is written to Arkiv here.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { decodeArkivPayload } from '../../shared/integrations/arkiv/rpc.js';

const KEY = /^0x[0-9a-f]{64}$/, ENTRY_ID = /^[0-9a-f]{64}$/, OPERATION_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/;
const PAGE = 100, MAX_PAGES = 1000, MAX_JOURNAL_BYTES = 900_000;

const quantity = value => {
  if (typeof value !== 'string' || !QUANTITY.test(value)) throw new Error('invalid Arkiv quantity');
  const n = Number(BigInt(value));
  if (!Number.isSafeInteger(n)) throw new Error('invalid Arkiv quantity');
  return n;
};
// The two journals fingerprint records differently; each must match its own loader.
const durableDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
const upsertDigest = value => createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex');

async function persist(path, state) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  let file;
  try {
    file = await open(temporary, 'wx', 0o600);
    await file.writeFile(JSON.stringify(state), 'utf8');
    await file.sync();
    await file.close(); file = undefined;
    await rename(temporary, path);
  } finally {
    if (file) await file.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

function createRpc({ url, accessKey, timeoutMs = 20000 }) {
  return async function rpc(method, params) {
    let body;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(accessKey ? { 'x-api-key': accessKey } : {}) },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(timeoutMs)
      });
      body = await response.json();
    } catch { throw new Error(`Arkiv ${method} unavailable`); }
    if (body?.error) throw new Error(`Arkiv ${method} failed: ${body.error.message ?? body.error}`);
    if (!body || !Object.hasOwn(body, 'result')) throw new Error(`Arkiv ${method} returned no result`);
    return body.result;
  };
}

// Lists every live entity of one kind. A listing that spans a new block (Rabdi makes
// one every ~2s) is restarted so the result is one consistent snapshot.
async function listKind(rpc, { owner, schemaTag, kind }) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const rows = []; let cursor = null, block = null, moved = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      const expression = `$owner = addr(${owner}) AND arkiv.schema = str('${schemaTag}') AND kind = str('${kind}')${cursor ? ` AND $key > key(${cursor})` : ''} ORDER BY $key ASC`;
      const result = await rpc('arkiv_query', [expression, { select: { key: true, owner: true, createdAt: true, expiresAt: true, attributes: true }, limit: `0x${PAGE.toString(16)}` }]);
      if (!result || !Array.isArray(result.data) || result.data.length > PAGE) throw new Error('invalid Arkiv query response');
      const current = quantity(result.blockNumber);
      if (block !== null && current !== block) { moved = true; break; }
      block = current;
      for (const row of result.data) {
        if (typeof row?.key !== 'string' || !KEY.test(row.key) || (cursor && row.key <= cursor)) throw new Error('invalid Arkiv pagination');
        cursor = row.key;
        if (typeof row.owner !== 'string' || row.owner.toLowerCase() !== owner) continue;
        rows.push(row);
      }
      if (result.data.length < PAGE) return { rows, block };
    }
    if (!moved) throw new Error('too many Arkiv entities to rebuild from');
  }
  throw new Error('Arkiv kept advancing during the rebuild listing');
}

function decodeRow(row, schemaTag) {
  const record = decodeArkivPayload(row.attributes, schemaTag);
  const operation = row.attributes.filter(attribute => attribute?.name === 'operation');
  if (operation.length !== 1 || operation[0].type !== 'str' || !OPERATION_ID.test(operation[0].value)) throw new Error('entity has no operation id');
  return { key: row.key, record, operationId: operation[0].value, createdAt: quantity(row.createdAt), expiresAt: quantity(row.expiresAt) };
}

/** Rebuilds the report journal. Returns the number of entries restored. */
export async function rebuildJournal({ rpc, owner, schemaTag, path, windowMs, retentionMs, k, now = Date.now, log = console.log }) {
  const { rows } = await listKind(rpc, { owner, schemaTag, kind: 'observation' });
  const blockTimes = new Map();
  const timeOf = async block => {
    if (!blockTimes.has(block)) {
      const header = await rpc('eth_getBlockByNumber', [`0x${block.toString(16)}`, false]);
      blockTimes.set(block, quantity(header?.timestamp) * 1000);
    }
    return blockTimes.get(block);
  };
  const time = now();
  const entries = [];
  let skipped = 0;
  for (const row of rows) {
    let item;
    try { item = decodeRow(row, schemaTag); } catch { skipped++; continue; }
    if (item.record.kind !== 'observation' || !ENTRY_ID.test(item.operationId)) { skipped++; continue; }
    // A block can be stamped a few seconds ahead of this machine's clock; never let a
    // restored entry sit in the future, or the journal refuses the clock.
    const acceptedAt = Math.min(await timeOf(item.createdAt), time);
    if (time - acceptedAt >= retentionMs) continue;
    entries.push({ id: item.operationId, fingerprint: durableDigest(item.record), acceptedAt, record: item.record, delivered: true });
  }
  entries.sort((a, b) => a.acceptedAt - b.acceptedAt);
  const unique = [...new Map(entries.map(entry => [entry.id, entry])).values()];
  // Keep the newest entries if the journal would not fit its size limit.
  const state = { version: 1, config: { windowMs, retentionMs, k }, lastNow: 0, entries: unique };
  while (state.entries.length && JSON.stringify(state).length > MAX_JOURNAL_BYTES) state.entries.shift();
  state.lastNow = state.entries.reduce((latest, entry) => Math.max(latest, entry.acceptedAt), 0);
  await persist(path, state);
  log(`[Rebuild] Report journal: ${state.entries.length} observation${state.entries.length === 1 ? '' : 's'} restored from Arkiv${skipped ? `, ${skipped} unreadable skipped` : ''}`);
  return state.entries.length;
}

/** Rebuilds the upsert registry from the live baseline and status entities. */
export async function rebuildRegistry({ rpc, owner, schemaTag, path, log = console.log, warn = console.warn }) {
  const latest = new Map();
  for (const kind of ['baseline', 'status']) {
    const { rows } = await listKind(rpc, { owner, schemaTag, kind });
    for (const row of rows) {
      let item;
      try { item = decodeRow(row, schemaTag); } catch { continue; }
      if (item.record.kind !== kind) continue;
      const scope = JSON.stringify([kind, item.record.site, item.record.chainId]);
      const previous = latest.get(scope);
      if (previous) {
        warn(`[Rebuild] Duplicate ${kind} for ${item.record.site} chainId=${item.record.chainId}: ${previous.key} and ${item.key}. Keeping the newer; remove the other so readers see exactly one.`);
        if (Date.parse(previous.record.updatedAt) >= Date.parse(item.record.updatedAt)) continue;
      }
      latest.set(scope, item);
    }
  }
  const operations = [...latest.values()].map(item => ({
    id: item.operationId, record: item.record, fingerprint: upsertDigest(item.record),
    action: 'create', entityKey: null, resultKey: item.key, done: true, expiresAt: item.expiresAt, rollover: null
  }));
  if (new Set(operations.map(op => op.id)).size !== operations.length) throw new Error('Arkiv entities share an operation id; cannot rebuild the registry');
  await persist(path, { version: 2, owner, operations });
  log(`[Rebuild] Upsert registry: ${operations.length} current baseline/status entit${operations.length === 1 ? 'y' : 'ies'} registered`);
  return operations.length;
}

/**
 * Waits until the writer has no transaction in flight, so a replacement does not race a
 * transaction its predecessor broadcast just before it stopped. Gives up after maxMs.
 */
export async function waitForIdleWriter({ rpc, owner, maxMs = 120_000, pollMs = 2000, log = console.log, warn = console.warn }) {
  const started = Date.now();
  for (;;) {
    const [pending, latest] = await Promise.all([rpc('eth_getTransactionCount', [owner, 'pending']), rpc('eth_getTransactionCount', [owner, 'latest'])]);
    if (quantity(pending) === quantity(latest)) return true;
    if (Date.now() - started >= maxMs) { warn('[Rebuild] Writer still has a transaction in flight; continuing anyway'); return false; }
    log('[Rebuild] Waiting for the previous writer\'s transaction to settle…');
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}

export { createRpc };
