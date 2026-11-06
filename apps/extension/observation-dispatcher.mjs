import { enqueue as queueObservations, flush } from "./observation-queue.mjs";

const ALARM = "bound-observation-dispatch";
// Short send delay (2–10 s), chosen for testing over the 30 s–30 min privacy delay:
// a report now lands close to its on-chain transaction, so timing can link them.
const MIN_DELAY_MS = 2_000;
const MAX_DELAY_MS = 10_000;
const MAX_RETRY_MS = 60 * 60_000;
const SEND_TIMEOUT_MS = 15_000;

export function createObservationDispatcher({
  storage = chrome.storage.local,
  alarms = chrome.alarms,
  send,
  sendTimeoutMs = SEND_TIMEOUT_MS,
  random = Math.random,
  now = Date.now
}) {
  if (typeof send !== "function") throw new TypeError("Observation transport is required");
  if (!Number.isFinite(sendTimeoutMs) || sendTimeoutMs < 0) throw new RangeError("Invalid observation transport timeout");
  let lastOperation = Promise.resolve();

  function serialized(operation) {
    const current = lastOperation.then(operation);
    lastOperation = current.catch(() => {});
    return current;
  }

  async function arm(at, generation) {
    await storage.set({ boundObservationDispatchAt: at, boundObservationGeneration: generation, boundObservationScheduledGeneration: generation });
    await alarms.create(ALARM, { when: at });
  }

  async function scheduleQueued() {
    const { boundObservationQueue = [], boundObservationGeneration, boundObservationDispatchAt, boundObservationScheduledGeneration } = await storage.get([
      "boundObservationQueue", "boundObservationGeneration", "boundObservationDispatchAt", "boundObservationScheduledGeneration"
    ]);
    if (!boundObservationQueue.length) return;
    const generation = boundObservationGeneration || crypto.randomUUID();
    if (boundObservationDispatchAt != null && boundObservationScheduledGeneration === generation) return;
    await arm(now() + randomDelay(), generation);
  }

  function randomDelay(max = MAX_DELAY_MS) {
    return MIN_DELAY_MS + Math.floor(random() * (max - MIN_DELAY_MS));
  }

  async function sendWithTimeout(batch) {
    const controller = new AbortController();
    let timer;
    try {
      await Promise.race([
        Promise.resolve().then(() => send(batch, { signal: controller.signal })),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("Observation transport timed out"));
          }, sendTimeoutMs);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function schedule() {
    return serialized(async () => {
      const { boundObservationQueue = [], boundObservationGeneration } = await storage.get(["boundObservationQueue", "boundObservationGeneration"]);
      // Refresh the delay so a newly queued report cannot ride an older alarm.
      if (boundObservationQueue.length) {
        const generation = boundObservationGeneration || crypto.randomUUID();
        await arm(now() + randomDelay(), generation);
      }
    });
  }

  async function enqueue(records, queuedAt = now()) {
    return serialized(async () => {
      const { boundObservationQueue = [] } = await storage.get("boundObservationQueue");
      const before = boundObservationQueue.length;
      await queueObservations(records, storage, queuedAt);
      const { boundObservationQueue: updated = [], boundObservationGeneration } = await storage.get(["boundObservationQueue", "boundObservationGeneration"]);
      if (updated.length > before) {
        const generation = boundObservationGeneration || crypto.randomUUID();
        await arm(now() + randomDelay(), generation);
      }
      else await scheduleQueued();
    });
  }

  async function resumeNow() {
    const { boundObservationGeneration, boundObservationDispatchAt, boundObservationScheduledGeneration } = await storage.get([
      "boundObservationGeneration", "boundObservationDispatchAt", "boundObservationScheduledGeneration"
    ]);
    if (boundObservationDispatchAt != null && boundObservationScheduledGeneration === boundObservationGeneration && boundObservationGeneration != null) {
      // A send time scheduled under an older, longer delay is pulled in to the current maximum.
      await alarms.create(ALARM, { when: Math.max(now(), Math.min(boundObservationDispatchAt, now() + MAX_DELAY_MS)) });
    } else await scheduleQueued();
  }

  async function resume() {
    return serialized(resumeNow);
  }

  async function dispatchNow() {
    const { boundObservationQueue = [], boundObservationGeneration, boundObservationDispatchAt, boundObservationScheduledGeneration, boundObservationRetry = 0 } = await storage.get([
      "boundObservationQueue", "boundObservationGeneration", "boundObservationDispatchAt", "boundObservationScheduledGeneration", "boundObservationRetry"
    ]);
    if (!boundObservationQueue.length) return storage.set({ boundObservationDispatchAt: null });
    if (boundObservationDispatchAt == null || boundObservationGeneration == null || boundObservationScheduledGeneration !== boundObservationGeneration) return scheduleQueued();
    if (boundObservationDispatchAt > now()) return alarms.create(ALARM, { when: boundObservationDispatchAt });
    try {
      await flush(sendWithTimeout, storage);
      await storage.set({ boundObservationRetry: 0 });
    } catch (error) {
      const retry = boundObservationRetry + 1;
      const cap = Math.min(MAX_RETRY_MS, MIN_DELAY_MS * 2 ** Math.min(retry, 7));
      await storage.set({ boundObservationRetry: retry });
      await arm(now() + randomDelay(cap), boundObservationGeneration);
      throw error;
    }
    await storage.set({ boundObservationDispatchAt: null });
    const { boundObservationQueue: remaining = [] } = await storage.get("boundObservationQueue");
    if (remaining.length) await arm(now() + randomDelay(), boundObservationGeneration);
    else await storage.set({ boundObservationDispatchAt: null });
  }

  async function dispatch() {
    return serialized(dispatchNow);
  }

  return { enqueue, schedule, resume, dispatch, alarmName: ALARM };
}
