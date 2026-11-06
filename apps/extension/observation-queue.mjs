const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_QUEUE = 500;
let lastOperation = Promise.resolve();

function serialized(operation) {
  const current = lastOperation.then(operation);
  lastOperation = current.catch(() => {});
  return current;
}

export async function enqueue(records, storage = chrome.storage.local, now = Date.now()) {
  if (!records.length) return;
  return serialized(async () => {
    const week = Math.floor(now / WEEK_MS);
    const keys = await storage.get(["boundReporter", "boundObservationSeen", "boundObservationQueue"]);
    const reporter = keys.boundReporter?.week === week ? keys.boundReporter : { week, key: crypto.randomUUID() };
    const seen = { ...keys.boundObservationSeen };
    const queue = [...(keys.boundObservationQueue || [])];
    const initialLength = queue.length;
    for (const record of records) {
      if (!record || !["observation", "warned"].includes(record.kind) || typeof record.site !== "string" || !record.site || record.site.length > 253 || typeof record.chain !== "string" || !record.chain || record.chain.length > 80 ||
        (record.value !== undefined && (typeof record.value !== "string" || !/^0x[0-9a-f]{40}$/i.test(record.value))) || (record.kind === "observation" && !record.value)) throw new TypeError("Invalid observation record");
      const value = record.value?.toLowerCase();
      const dedupeKey = JSON.stringify([record.site, record.chain, record.kind, value || null]);
      const previous = seen[dedupeKey] ?? seen[`${record.site}:${record.chain}:${value || record.kind}`];
      if (previous !== undefined && now - previous < WEEK_MS) continue;
      if (queue.length >= MAX_QUEUE) throw new Error("Observation queue is full");
      seen[dedupeKey] = now;
      queue.push({ site: record.site, kind: record.kind, ...(value ? { value } : {}), chain: record.chain, reporterKey: reporter.key });
    }
    await storage.set({
      boundReporter: reporter,
      boundObservationSeen: seen,
      boundObservationQueue: queue,
      ...(queue.length !== initialLength ? { boundObservationGeneration: crypto.randomUUID() } : {})
    });
  });
}

export async function flush(send, storage = chrome.storage.local, batchSize = 20) {
  return serialized(async () => {
    const { boundObservationQueue = [] } = await storage.get("boundObservationQueue");
    if (!boundObservationQueue.length) return 0;
    const batch = boundObservationQueue.slice(0, batchSize);
    await send(batch);
    await storage.set({ boundObservationQueue: boundObservationQueue.slice(batch.length) });
    return batch.length;
  });
}
