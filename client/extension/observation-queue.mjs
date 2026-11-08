import { FRONTEND_DEDUPE_MS, isFrontendPath, isFrontendHash } from '../../shared/contracts/frontend.js';
import { encodeObservationBatch, toIntakeEvent } from './watcher-adapter.mjs';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_QUEUE = 500;
let lastOperation = Promise.resolve();

function serialized(operation) {
  const current = lastOperation.then(operation);
  lastOperation = current.catch(() => {});
  return current;
}

function recordKey(record) {
  return JSON.stringify([record.site, record.chain, record.kind, record.value?.toLowerCase() || null, ...(record.observationKind ? [record.observationKind] : []), ...(record.kind === 'warned' && record.observedAt ? [record.observedAt] : [])]);
}

async function load(storage) {
  const data = await storage.get(["boundReporter", "boundObservationSeen", "boundObservationQueue", "boundObservationQueueVersion"]);
  const queue = data.boundObservationQueue === undefined ? [] : data.boundObservationQueue;
  const seen = data.boundObservationSeen === undefined ? {} : data.boundObservationSeen;
  if ((data.boundObservationQueueVersion !== undefined && data.boundObservationQueueVersion !== 2) || !Array.isArray(queue) || queue.length > MAX_QUEUE || !seen || typeof seen !== "object" || Array.isArray(seen) || Object.values(seen).some(v => !Number.isSafeInteger(v) || v < 0)) throw new Error("Invalid observation queue storage");
  if (data.boundReporter !== undefined && (!data.boundReporter || !Number.isSafeInteger(data.boundReporter.week) || typeof data.boundReporter.key !== "string" || !data.boundReporter.key)) throw new Error("Invalid observation queue reporter");
  for (const item of queue) {
    if (!item || typeof item !== "object" || typeof item.reporterKey !== "string" || !item.reporterKey || typeof item.site !== "string" || !item.site || item.site.length > 253 || typeof item.chain !== "string" || !item.chain || item.chain.length > 80 || !["observation", "warned", "frontend"].includes(item.kind) || (item.kind === "frontend" ? !isFrontendPath(item.path) || !isFrontendHash(item.hash) : (item.value !== undefined && (typeof item.value !== "string" || !/^0x[0-9a-f]{40}$/i.test(item.value))) || (item.kind === "observation" && !item.value) || (item.observationKind !== undefined && (item.kind !== "observation" || item.observationKind !== "called-contract")))) throw new Error("Invalid observation queue entry");
    if (item.kind === "frontend") { try { toIntakeEvent(item); } catch { throw new Error("Invalid observation queue entry"); } }
  }
  return { ...data, queue: [...queue], seen: { ...seen } };
}
function frontendKey(key) {
  try { const parsed = JSON.parse(key); return Array.isArray(parsed) && parsed.length === 5 && parsed[0] === "frontend"; } catch { return false; }
}
export async function enqueue(records, storage = chrome.storage.local, now = Date.now()) {
  if (!Array.isArray(records) || !Number.isSafeInteger(now) || now < 0) throw new TypeError("Invalid observation records");
  if (!records.length) return;
  return serialized(async () => {
    const data = await load(storage), {queue, seen} = data;
    const week = Math.floor(now / WEEK_MS);
    const reporter = data.boundReporter?.week === week ? data.boundReporter : { week, key: crypto.randomUUID() };
    const initialLength = queue.length;
    for (const key of Object.keys(seen)) if (frontendKey(key) && now >= seen[key] && now - seen[key] >= FRONTEND_DEDUPE_MS) delete seen[key];
    for (const record of records) {
      if (record?.kind === "frontend") {
        if (Object.keys(record).sort().join(",") !== "chain,hash,kind,path,site") throw new TypeError("Invalid frontend observation record");
        const item = {site: record.site, kind: "frontend", chain: record.chain, reporterKey: reporter.key, path: record.path, hash: record.hash};
        const event = toIntakeEvent(item);
        const key = JSON.stringify(["frontend", record.site, String(event.chainId), record.path, record.hash]);
        if (seen[key] !== undefined && now >= seen[key] && now - seen[key] < FRONTEND_DEDUPE_MS) continue;
        if (queue.length >= MAX_QUEUE) throw new Error("Observation queue is full");
        seen[key] = now; queue.push(item); continue;
      }
      if (!record || !["observation", "warned"].includes(record.kind) || typeof record.site !== "string" || !record.site || record.site.length > 253 || typeof record.chain !== "string" || !record.chain || record.chain.length > 80 ||
        (record.value !== undefined && (typeof record.value !== "string" || !/^0x[0-9a-f]{40}$/i.test(record.value))) || (record.kind === "observation" && !record.value) || (record.observationKind !== undefined && (record.kind !== "observation" || record.observationKind !== "called-contract"))) throw new TypeError("Invalid observation record");
      if ((record.score !== undefined || record.observedAt !== undefined) && (record.kind !== "warned" || !Number.isSafeInteger(record.score) || record.score < 0 || record.score > 100 || typeof record.observedAt !== "string" || !Number.isFinite(Date.parse(record.observedAt)) || new Date(record.observedAt).toISOString() !== record.observedAt)) throw new TypeError("Invalid warning score");
      const value = record.value?.toLowerCase();
      const dedupeKey = recordKey({ ...record, value });
      const previous = seen[dedupeKey] ?? seen[`${record.site}:${record.chain}:${value || record.kind}`];
      if (previous !== undefined && now - previous < WEEK_MS) continue;
      // Not yet marked as seen: that happens only once the report is actually sent,
      // so a report dropped from the queue (Stop, consent withdrawn) can be made again.
      if (queue.some(item => recordKey(item) === dedupeKey)) continue;
      if (queue.length >= MAX_QUEUE) throw new Error("Observation queue is full");
      queue.push({ site: record.site, kind: record.kind, ...(value ? { value } : {}), ...(record.observationKind ? { observationKind: record.observationKind } : {}), ...(record.score !== undefined ? {score:record.score,observedAt:record.observedAt} : {}), chain: record.chain, reporterKey: reporter.key });
    }
    await storage.set({boundReporter: reporter, boundObservationSeen: seen, boundObservationQueue: queue, boundObservationQueueVersion: 2, ...(queue.length !== initialLength ? {boundObservationGeneration: crypto.randomUUID()} : {})});
  });
}

export async function flush(send, storage = chrome.storage.local, batchSize = 20, now = Date.now) {
  return serialized(async () => {
    if (!Number.isSafeInteger(batchSize) || batchSize < 1) throw new RangeError("Invalid observation batch size");
    const data = await load(storage), queue = data.queue;
    if (data.boundObservationQueueVersion !== 2) await storage.set({boundObservationQueueVersion: 2});
    if (!queue.length) return 0;
    let batch = [];
    for (const item of queue.slice(0, Math.min(batchSize, 100))) {
      try { encodeObservationBatch([...batch, item]); }
      catch (error) { if (batch.length && /exceeds 60000 bytes/.test(error.message)) break; throw error; }
      batch.push(item);
    }
    await send(batch);
    const seen = {...data.seen}, sentAt = now();
    for (const record of batch) if(record.kind!=="frontend") seen[recordKey(record)] = sentAt;
    await storage.set({boundObservationQueue: queue.slice(batch.length), boundObservationSeen: seen});
    return batch.length;
  });
}
