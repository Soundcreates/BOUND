// Two-tier ENS lookup cache.
//
//   L1  in-memory Map, mirrored into chrome.storage.session (RAM-only, survives
//       MV3 service-worker restarts, cleared when the browser closes). Holds only
//       values this extension itself read live from ENS. Trusted like a live read
//       until its TTL ends.
//   L2  watcher-owned Arkiv `ens_record`, read from the already-downloaded bundle
//       (no per-site request). Watcher-asserted, NOT ENS-proven: it is returned as
//       "arkiv_unconfirmed" and callers must not let it grant trust or move a score.
//   L3  live ENS through Anon-RPC: the source of truth. It runs on every L1 miss,
//       in parallel with L2, and always wins.
//
// Live "no record" answers are cached for a shorter TTL so repeated misses do not
// pay for a slow anonymous read on every request.

const STORAGE_KEY = "boundEnsCacheV1";
const MAX_ENTRIES = 256;

export function createEnsLookupCache({ storage, now = Date.now, ttlMs = 60 * 60_000, negativeTtlMs = 5 * 60_000 } = {}) {
  if (!storage || typeof storage.get !== "function" || typeof storage.set !== "function" || typeof now !== "function" ||
      !Number.isSafeInteger(ttlMs) || ttlMs < 1 || !Number.isSafeInteger(negativeTtlMs) || negativeTtlMs < 1) throw new Error("Invalid ENS cache configuration");
  const memory = new Map();
  const inflight = new Map();
  let loaded = null;

  const fresh = (entry, time) => entry && typeof entry === "object" && Number.isSafeInteger(entry.storedAt) && Number.isSafeInteger(entry.expiresAt) && entry.storedAt <= time && time < entry.expiresAt;

  async function load() {
    loaded ??= (async () => {
      try {
        const saved = (await storage.get(STORAGE_KEY))[STORAGE_KEY];
        if (saved && typeof saved === "object" && !Array.isArray(saved)) {
          const time = now();
          for (const [key, entry] of Object.entries(saved)) if (!memory.has(key) && fresh(entry, time)) memory.set(key, entry);
        }
      } catch { /* A broken mirror only costs a live read. */ }
    })();
    return loaded;
  }

  async function persist() {
    const time = now();
    for (const [key, entry] of memory) if (!fresh(entry, time)) memory.delete(key);
    while (memory.size > MAX_ENTRIES) memory.delete(memory.keys().next().value);
    try { await storage.set({ [STORAGE_KEY]: Object.fromEntries(memory) }); } catch { /* memory still holds it */ }
  }

  /**
   * key: stable string identifying (ENS scope, name, record).
   * readLive(): resolves to {value} (value null = live "no record"); throws when unavailable.
   * readArkiv(): resolves to {value} or null; never trusted.
   * timeoutMs: budget for the live read.
   * Returns {source:"memory"|"live"|"arkiv_unconfirmed"|"unavailable", value, inconsistent?}.
   */
  async function lookup({ key, readLive, readArkiv = async () => null, timeoutMs = 1_500 }) {
    if (typeof key !== "string" || !key || typeof readLive !== "function" || typeof readArkiv !== "function") throw new Error("Invalid ENS cache lookup");
    await load();
    const hit = memory.get(key);
    if (fresh(hit, now())) return { source: "memory", value: structuredClone(hit.value) };
    if (hit) memory.delete(key);
    if (inflight.has(key)) return structuredClone(await inflight.get(key));

    const run = (async () => {
      // A stalled local storage adapter must not defeat the lookup budget.
      const arkiv = withTimeout(readArkiv, timeoutMs).catch(() => null);
      let live;
      try {
        live = await withTimeout(readLive, timeoutMs);
        if (!live || typeof live !== "object" || !Object.hasOwn(live, "value")) throw new Error("Invalid live ENS result");
      } catch {
        const cached = await arkiv;
        return cached && Object.hasOwn(cached, "value") ? { source: "arkiv_unconfirmed", value: cached.value } : { source: "unavailable", value: null };
      }
      const time = now();
      memory.delete(key);
      memory.set(key, { value: structuredClone(live.value), storedAt: time, expiresAt: time + (live.value === null ? negativeTtlMs : ttlMs) });
      await persist();
      const cached = await arkiv;
      const inconsistent = !!cached && Object.hasOwn(cached, "value") && JSON.stringify(cached.value) !== JSON.stringify(live.value);
      return { source: "live", value: live.value, ...(inconsistent ? { inconsistent: true } : {}) };
    })();
    inflight.set(key, run);
    try { return structuredClone(await run); } finally { inflight.delete(key); }
  }

  async function clear() { memory.clear(); loaded = Promise.resolve(); await storage.set({ [STORAGE_KEY]: {} }).catch(() => {}); }

  return { lookup, clear };
}

function withTimeout(fn, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("ENS read timed out")), ms);
    Promise.resolve().then(fn).then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}
