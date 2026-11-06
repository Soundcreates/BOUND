import { canonicalSite } from "../../packages/policy-core/index.mjs";

const ADDRESS = /^0x[0-9a-f]{40}$/;
const MAX_UINT256 = (1n << 256n) - 1n;
const TRUST_SOURCES = new Set(["snapshot", "ens_attestation", "shared_contract", "deployer_lineage"]);
// A snapshot can require several ENS/Arkiv RPCs, and an Arkiv status query may
// span multiple pages. Both budgets fit within the hook's 50-second deadline.
const BULK_READ_TIMEOUT_MS = 20_000;
const BUNDLE_READ_TIMEOUT_MS = 2_000;
const frontendReadTimeoutMs = 1_750;
const anonymousReads = new Map();
const ANON_READ_TIMEOUT_MS = 20_000;
const ENS_SOURCES = new Set(["live", "memory", "arkiv_unconfirmed", "unavailable", "not_configured"]);

const unavailableCommunity = () => ({ state: "unavailable", fetchedAt: null, ageMs: null, verifiedAt: null, block: null, frontend: null, rawDrift: false, corroboratedDrift: false, activeIncident: false, ambiguous: false });

export async function readFrontendContext({ siteOrigin, chainId, watcherOwner, adapters, now = Date.now() }) {
  const site = canonicalHttpsHost(siteOrigin), chain = normalizeChain(chainId), owner = normalizeAddress(watcherOwner);
  if (!site || !chain || !owner || !Number.isSafeInteger(now) || now < 0 || typeof adapters?.readFrontendCommunity !== "function") return unavailableCommunity();
  try { return await withTimeout(() => adapters.readFrontendCommunity({ site, chain, budgetMs: 1500 }), frontendReadTimeoutMs); }
  catch { return unavailableCommunity(); }
}

/**
 * Compose extension-owned trust and watcher data for policy-core.evaluate.
 *
 * Adapter contract (all functions are extension-owned):
 * - readVerifiedSnapshot() returns { snapshot, root: { epoch } }. The adapter
 *   verifies ENS/root coherence and the Arkiv snapshot digest before returning.
 * - readWatcherBundle() returns the complete cached seeded-site record bundle
 *   with {owner, kind, site, chain, expiresAt}; records are filtered locally.
 * - readUncuratedViaAnonRpc({site, chain}) optionally returns exact-scope
 *   records for an uncurated site through the anonymizing worker.
 * - readProtocolAttestationsViaAnonRpc({site, chain}) optionally returns
 *   verified [{address, site, chain}] protocol ENS attestation rows.
 * - readVerifiedDeploymentsViaAnonRpc({site, chain}) optionally returns
 *   verified [{address, deployer, site, chain}] creation-evidence rows.
 *
 * Snapshot and whole-bundle reads time out after 5 seconds. On-demand
 * anonymous reads time out after 1.5 seconds. Exactly one current matching
 * baseline is required; its optional `observed` array lists previously seen
 * addresses but does not establish trust. `witnessed` contains only addresses
 * whose reporter thresholds were independently established. Drift uses {kind:"drift",
 * corroborated:true, active:true}. Incident state requires exactly one
 * current {kind:"status", status:"active"|"normal"} record; otherwise it
 * is unknown. Observation records are ignored.
 *
 * The baseline/status bundle shapes are explicit local assumptions until the
 * Arkiv schemas are frozen. Arkiv never supplies trust; only verified
 * snapshots, protocol attestations, and deployment evidence add policy sources.
 */
export async function createDecisionContext({ siteOrigin, chainId, watcherOwner, adapters, now = Date.now(), elapsedNow = () => performance.now() }) {
  const started = elapsedNow();
  const currentTime = () => now + Math.max(0, elapsedNow() - started);
  const site = canonicalHttpsHost(siteOrigin);
  const chain = normalizeChain(chainId);
  const owner = normalizeAddress(watcherOwner);
  const frontendRead = readFrontendContext({ siteOrigin, chainId, watcherOwner, adapters, now });
  if (!site || !chain || !owner || !adapters || typeof adapters.readVerifiedSnapshot !== "function") {
    return { ...emptyContext("invalid_context"), frontendCommunity: await frontendRead };
  }

  let verified = null, verifiedSource = null;
  try { verifiedSource = await withTimeout(() => adapters.readVerifiedSnapshot(), BULK_READ_TIMEOUT_MS); verified = validateVerifiedSnapshot(verifiedSource, currentTime()); }
  catch { /* No site-specific requests are made without a current verified snapshot. */ }
  if (!verified) return { ...emptyContext("snapshot_unavailable"), site, chain, frontendCommunity: await frontendRead };

  const siteEntry = snapshotEntry(verified.snapshot, site, chain);
  if (!siteEntry && typeof adapters.readUncuratedViaAnonRpc !== "function") {
    return { ...emptyContext("watcher_baseline_unavailable"), site, chain, snapshotAvailable: true, frontendCommunity: await frontendRead };
  }
  const baselineRead = siteEntry
    ? typeof adapters.readWatcherBundle === "function"
      ? withTimeout(() => adapters.readWatcherBundle(), BULK_READ_TIMEOUT_MS)
      : Promise.resolve(null)
    : typeof adapters.readUncuratedViaAnonRpc === "function"
      ? withTimeout(() => adapters.readUncuratedViaAnonRpc({ site, chain }), ANON_READ_TIMEOUT_MS)
      : Promise.resolve(null);
  const [watcherResult, attestationsResult, deploymentsResult] = await Promise.allSettled([
    baselineRead,
    typeof adapters.readProtocolAttestations === "function"
      ? withTimeout(() => adapters.readProtocolAttestations({ site, chain, verifiedSource }), ANON_READ_TIMEOUT_MS)
      : typeof adapters.readProtocolAttestationsViaAnonRpc === "function"
        ? withTimeout(() => adapters.readProtocolAttestationsViaAnonRpc({ site, chain, verifiedSource }), ANON_READ_TIMEOUT_MS)
        : Promise.resolve([]),
    typeof adapters.readVerifiedDeploymentsViaAnonRpc === "function"
      ? withTimeout(() => adapters.readVerifiedDeploymentsViaAnonRpc({ site, chain, verifiedSource }), ANON_READ_TIMEOUT_MS)
      : Promise.resolve([])
  ]);

  const completedAt = currentTime();
  if (!Number.isFinite(completedAt) || !validateVerifiedSnapshot(verifiedSource, completedAt)) return { ...emptyContext("snapshot_unavailable"), site, chain, frontendCommunity: await frontendRead };

  const policy = Object.create(null);
  for (const address of verified.snapshot.sharedContracts[chain] || []) addSource(policy, address, "shared_contract", ["rights", "destination", "called", "token"]);
  if (siteEntry) {
    for (const address of siteEntry.trustedCounterparties) addSource(policy, address, "snapshot", ["rights", "destination"]);
    for (const address of siteEntry.trustedContracts) addSource(policy, address, "snapshot", ["called", "token"]);
  }

  // {rows, source} from the cached reader, or a bare row array from the legacy one.
  // Only rows are trust input; `source` is reported for the warning and never scored.
  const attestationValue = attestationsResult.status === "fulfilled" ? attestationsResult.value : null;
  const attestationRows = Array.isArray(attestationValue) ? attestationValue : Array.isArray(attestationValue?.rows) ? attestationValue.rows : null;
  const ensLookup = {
    attestation: attestationsResult.status === "rejected"
      ? (attestationsResult.reason?.message === "Adapter timeout" ? "timeout" : "unavailable")
      : Array.isArray(attestationValue) ? "live" : ENS_SOURCES.has(attestationValue?.source) ? attestationValue.source : "unavailable",
    ...(attestationValue?.inconsistent === true ? { inconsistent: true } : {})
  };
  if (attestationRows) {
    for (const attestation of attestationRows) {
      const address = normalizeAddress(attestation?.address);
      if (address && attestation.site === site && normalizeChain(attestation.chain) === chain) addSource(policy, address, "ens_attestation", ["rights", "destination", "called", "token"]);
    }
  }

  if (siteEntry && deploymentsResult.status === "fulfilled" && Array.isArray(deploymentsResult.value)) {
    for (const deployment of deploymentsResult.value) {
      const address = normalizeAddress(deployment?.address);
      const deployer = normalizeAddress(deployment?.deployer);
      if (address && deployer && siteEntry.deployers.includes(deployer) && deployment.site === site && normalizeChain(deployment.chain) === chain) {
        addSource(policy, address, "deployer_lineage", ["rights", "destination", "called", "token"]);
      }
    }
  }

  let records = [];
  if (watcherResult.status === "fulfilled" && Array.isArray(watcherResult.value)) {
    try {
      records = watcherResult.value.filter((record) => typeof record?.owner === "string" && record.owner.toLowerCase() === owner && record.site === site && normalizeChain(record.chain) === chain && isCurrent(record, completedAt));
    } catch { records = []; }
  }
  const baselines = records.filter((record) => record.kind === "baseline");
  const baselineRecord = baselines.length === 1 ? baselines[0] : null;
  const baselinePresent = !!baselineRecord;
  const observed = new Set(
    baselineRecord && Array.isArray(baselineRecord.observed)
      ? baselineRecord.observed.map(normalizeAddress).filter(Boolean)
      : []
  );
  const witnessed = new Set(
    baselineRecord && Array.isArray(baselineRecord.witnessed)
      ? baselineRecord.witnessed.map(normalizeAddress).filter(Boolean)
      : []
  );
  const drift = records.some((record) => record.kind === "drift" && record.corroborated === true && record.active === true);
  const statuses = records.filter((record) => record.kind === "status");
  const incidentStatus = statuses.some((record) => record.status === "active")
    ? "active"
    : statuses.length === 1 && statuses[0].status === "normal" ? "normal" : "unknown";
  const usable = baselinePresent;

  return {
    frontendCommunity: await frontendRead,
    policy: usable ? policy : Object.create(null),
    baseline: usable ? (siteEntry ? "seeded" : "uncurated") : null,
    drift: usable && drift,
    observed: usable ? observed : new Set(),
    witnessed: usable ? witnessed : new Set(),
    site,
    chain,
    snapshotAvailable: true,
    watcherBaselineAvailable: baselinePresent,
    incidentStatus: usable ? incidentStatus : "unknown",
    ensLookup,
    status: usable ? "ready" : "watcher_baseline_unavailable"
  };
}

/** Read site status before wallet connection, using anonymous RPC when available. */
export async function readPreconnectionSiteStatus({ siteOrigin, watcherOwner, adapters, now = Date.now(), elapsedNow = () => performance.now() }) {
  const started = elapsedNow();
  const currentTime = () => now + Math.max(0, elapsedNow() - started);
  const site = canonicalHttpsHost(siteOrigin);
  const owner = normalizeAddress(watcherOwner);
  const checkedAt = Number.isFinite(now) ? new Date(now).toISOString() : new Date().toISOString();
  const evidence = { snapshotVerified: null, siteMatched: null, watcherLookup: null };
  const result = (status, expiresAt = null) => ({ site, status, checkedAt, expiresAt, evidence: { ...evidence } });
  if (!Number.isFinite(now) || !site || !owner || !adapters || typeof adapters.readVerifiedSnapshot !== "function" || (typeof adapters.readSiteStatusViaAnonRpc !== "function" && typeof adapters.readWatcherBundle !== "function")) return result("unknown");

  let verified;
  try {
    verified = validateVerifiedSnapshot(await withTimeout(() => adapters.readVerifiedSnapshot(), BULK_READ_TIMEOUT_MS), currentTime());
  } catch { return result("unknown"); }
  evidence.snapshotVerified = Boolean(verified);
  const siteChains = verified?.snapshot.sites[site];
  evidence.siteMatched = Boolean(siteChains && Object.keys(siteChains).length);
  if (!siteChains || Object.keys(siteChains).length === 0) return result("unknown");

  let records;
  try {
    if (typeof adapters.readWatcherBundle === "function") {
      try { records = await withTimeout(() => adapters.readWatcherBundle(), BUNDLE_READ_TIMEOUT_MS); } catch { /* Try anonymous fallback. */ }
    }
    if (!Array.isArray(records) && typeof adapters.readSiteStatusViaAnonRpc === "function") {
      records = await readAnonymousStatus(owner, site, adapters);
    }
  } catch { return result("unknown"); }
  evidence.watcherLookup = Array.isArray(records);
  if (!Array.isArray(records)) return result("unknown");

  const completedAt = currentTime();
  if (!Number.isFinite(completedAt) || Date.parse(verified.snapshot.expiresAt) <= completedAt) { evidence.snapshotVerified = false; return result("unknown"); }

  const expectedChains = Object.keys(siteChains);
  const snapshotExpiry = Date.parse(verified.snapshot.expiresAt);
  const byChain = new Map(expectedChains.map((chain) => [chain, []]));
  try {
    for (const record of records) {
      if (record?.kind !== "status" || record.site !== site) continue;
      const chain = normalizeChain(record.chain);
      if (!chain || !byChain.has(chain) || typeof record.owner !== "string" || record.owner.toLowerCase() !== owner) continue;
      if (isCurrent(record, completedAt)) byChain.get(chain).push(record);
    }
  } catch { return result("unknown"); }

  let active = false;
  const activeRecords = [];
  for (const chain of expectedChains) {
    const current = byChain.get(chain);
    const matchingActive = current.filter((record) => record.status === "active");
    if (matchingActive.length) {
      active = true;
      activeRecords.push(...matchingActive);
    }
  }
  if (active) return result("active", earliestExpiry(snapshotExpiry, activeRecords));
  const driftRecords=[...byChain.values()].flat().filter(record=>record.status==="drift");
  if(driftRecords.length)return result("drift",earliestExpiry(snapshotExpiry,driftRecords));
  const normalRecords = [];
  const normal = expectedChains.every((chain) => {
    const current = byChain.get(chain);
    if (current.length !== 1 || current[0].status !== "normal") return false;
    normalRecords.push(current[0]);
    return true;
  });
  return normal ? result("normal", earliestExpiry(snapshotExpiry, normalRecords)) : result("unknown");
}

function readAnonymousStatus(owner, site, adapters) {
  const key = `${owner}:${site}`;
  let pending = anonymousReads.get(key);
  if (!pending) {
    pending = withTimeout(() => adapters.readSiteStatusViaAnonRpc({ site }), ANON_READ_TIMEOUT_MS)
      .finally(() => { if (anonymousReads.get(key) === pending) anonymousReads.delete(key); });
    anonymousReads.set(key, pending);
  }
  return pending;
}

function earliestExpiry(snapshotExpiry, records) {
  let expiry = snapshotExpiry;
  for (const record of records) expiry = Math.min(expiry, Date.parse(record.expiresAt));
  return new Date(expiry).toISOString();
}

async function withTimeout(operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Adapter timeout")), timeoutMs); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function emptyContext(status) {
  return { policy: Object.create(null), baseline: null, drift: false, observed: new Set(), witnessed: new Set(), site: null, chain: null, snapshotAvailable: false, watcherBaselineAvailable: false, incidentStatus: "unknown", status };
}

function canonicalHttpsHost(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) return null;
    return canonicalSite(url.origin);
  } catch { return null; }
}

function normalizeChain(value) {
  try {
    if (typeof value !== "string" || value.length > 78 || !/^(?:0x[0-9a-f]+|[0-9]+)$/i.test(value)) return null;
    const chain = BigInt(value);
    return chain <= MAX_UINT256 ? chain.toString(10) : null;
  } catch { return null; }
}

function normalizeEpoch(value) {
  if (typeof value === "number") return Number.isSafeInteger(value) && value >= 1 ? BigInt(value).toString(10) : null;
  try {
    if (typeof value !== "string" || value.length > 78 || !/^[0-9]+$/.test(value)) return null;
    const epoch = BigInt(value);
    return epoch > 0n && epoch <= MAX_UINT256 ? epoch.toString(10) : null;
  } catch { return null; }
}

function normalizeAddress(value) {
  return typeof value === "string" && ADDRESS.test(value.toLowerCase()) ? value.toLowerCase() : null;
}

function validateVerifiedSnapshot(result, now) {
  const snapshot = result?.snapshot;
  const snapshotEpoch = normalizeEpoch(snapshot?.epoch);
  const rootEpoch = normalizeEpoch(result?.root?.epoch);
  if (!snapshot || snapshot.schemaVersion !== 1 || !snapshotEpoch || snapshotEpoch !== rootEpoch ||
      typeof snapshot.network !== "string" || !snapshot.network || typeof snapshot.sites !== "object" || !snapshot.sites || Array.isArray(snapshot.sites) ||
      typeof snapshot.sharedContracts !== "object" || !snapshot.sharedContracts || Array.isArray(snapshot.sharedContracts)) return null;
  if (Object.keys(snapshot).some((key) => !["schemaVersion", "epoch", "generatedAt", "expiresAt", "network", "sharedContracts", "sites"].includes(key))) return null;
  const generated = Date.parse(snapshot.generatedAt), expires = Date.parse(snapshot.expiresAt);
  if (!Number.isFinite(generated) || !Number.isFinite(expires) || generated > now || expires <= now) return null;
  if (!validAddressLists(snapshot.sharedContracts)) return null;
  for (const [host, chains] of Object.entries(snapshot.sites)) {
    if (canonicalHttpsHost(`https://${host}`) !== host || !chains || typeof chains !== "object" || Array.isArray(chains)) return null;
    for (const [chain, entry] of Object.entries(chains)) {
      if (normalizeChain(chain) !== chain) return null;
      if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
          Object.keys(entry).some((key) => !["trustedCounterparties", "trustedContracts", "deployers", "source"].includes(key)) ||
          !["trustedCounterparties", "trustedContracts", "deployers"].every((key) => validAddressArray(entry[key])) ||
          typeof entry.source !== "string" || !entry.source) return null;
    }
  }
  return { snapshot };
}

function validAddressLists(value) {
  return Object.entries(value).every(([chain, addresses]) => normalizeChain(chain) === chain && validAddressArray(addresses));
}

function validAddressArray(value) {
  return Array.isArray(value) && value.every((address, index) => ADDRESS.test(address) && address === address.toLowerCase() && (index === 0 || value[index - 1] < address));
}

function snapshotEntry(snapshot, site, chain) {
  const entry = snapshot.sites[site]?.[chain];
  return entry || null;
}

function addSource(policy, address, source, roles) {
  if (!TRUST_SOURCES.has(source)) return;
  const current = policy[address] || (policy[address] = { sources: [], rolesBySource: Object.create(null) });
  if (!current.sources.includes(source)) current.sources.push(source);
  const existing = current.rolesBySource[source] || (current.rolesBySource[source] = []);
  for (const role of roles) if (!existing.includes(role)) existing.push(role);
}

function isCurrent(record, now) {
  const expiry = Date.parse(record?.expiresAt);
  return Number.isFinite(expiry) && expiry > now;
}
