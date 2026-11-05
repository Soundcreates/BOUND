const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_QUEUE = 500;

export async function enqueue(records, storage = chrome.storage.local, now = Date.now()) {
  if (!records.length) return;
  const week = Math.floor(now / WEEK_MS);
  const keys = await storage.get(["boundReporter", "boundObservationSeen", "boundObservationQueue"]);
  const reporter = keys.boundReporter?.week === week ? keys.boundReporter : { week, key: crypto.randomUUID() };
  const seen = keys.boundObservationSeen || {};
  const queue = keys.boundObservationQueue || [];
  for (const record of records) {
    const dedupeKey = `${record.site}:${record.chain}:${record.value || record.kind}`;
    if (seen[dedupeKey] && now - seen[dedupeKey] < WEEK_MS) continue;
    seen[dedupeKey] = now;
    queue.push({ ...record, reporterKey: reporter.key });
  }
  await storage.set({
    boundReporter: reporter,
    boundObservationSeen: seen,
    boundObservationQueue: queue.slice(-MAX_QUEUE)
  });
}

export async function flush(send, storage = chrome.storage.local, batchSize = 20) {
  const { boundObservationQueue = [] } = await storage.get("boundObservationQueue");
  if (!boundObservationQueue.length) return 0;
  const batch = boundObservationQueue.slice(0, batchSize);
  await send(batch);
  await storage.set({ boundObservationQueue: boundObservationQueue.slice(batch.length) });
  return batch.length;
}
