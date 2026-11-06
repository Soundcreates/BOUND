import { isFrontendPath, isFrontendHash, validateFrontendRecord } from './frontend.js';
// Phase 0 wire contract. Validation does not authenticate an Arkiv owner.
const ADDRESS_RE = /^0x[0-9a-f]{40}$/;
const DIGEST_RE = /^0x[0-9a-f]{64}$/;
const ARKIV_ENTITY_REFERENCE_RE = /^[0-9a-f]{64}$/;
const integer = n => Number.isSafeInteger(n) && n >= 0;
const wellFormed = s => {
  for (let i = 0; i < s.length; i++) {
    const unit = s.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = s.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
};
const nonempty = s => typeof s === 'string' && s.length > 0 && wellFormed(s);
const isAddress = v => typeof v === 'string' && ADDRESS_RE.test(v);
const isDigest = v => typeof v === 'string' && DIGEST_RE.test(v);
const isArkivEntityReference = v => typeof v === 'string' && ARKIV_ENTITY_REFERENCE_RE.test(v);
const exact = (v, keys) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const host = s => {
  if (!nonempty(s)) return false;
  try {
    const u = new URL('https://' + s);
    return u.host === s && u.pathname === '/' && !u.username && !u.password && !u.search && !u.hash;
  } catch { return false; }
};
const network = v => typeof v === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(v);
const timestamp = s => {
  if (typeof s !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(s)) return false;
  const date = new Date(s);
  if (Number.isNaN(date.getTime())) return false;
  const canonical = date.toISOString();
  return s === canonical || s === canonical.replace('.000Z', 'Z');
};
const chainKey = s => typeof s === 'string' && /^[1-9][0-9]*$/.test(s) && Number.isSafeInteger(Number(s));
const sortedUnique = (xs, predicate) => Array.isArray(xs) && xs.every((x, i) => predicate(x) && (i === 0 || xs[i - 1] < x));
const stringMap = (obj, key, value) => obj !== null && typeof obj === 'object' && !Array.isArray(obj) && Object.entries(obj).every(([k, v]) => key(k) && value(v));
const addresses = xs => sortedUnique(xs, isAddress);
const evidence = v => exact(v, ['address', 'sources']) && isAddress(v.address) && sortedUnique(v.sources, nonempty) && v.sources.length > 0;
const lineage = v => exact(v, ['address', 'creator', 'creationTransaction', 'evidence']) && isAddress(v.address) && isAddress(v.creator) && isDigest(v.creationTransaction) && sortedUnique(v.evidence, nonempty) && v.evidence.length > 0;
const siteChain = v => exact(v, ['trustedCounterparties', 'trustedCalledContracts', 'deployerLineage', 'sourceEvidence']) &&
  addresses(v.trustedCounterparties) && addresses(v.trustedCalledContracts) &&
  Array.isArray(v.deployerLineage) && v.deployerLineage.every((x, i) => lineage(x) && (!i || v.deployerLineage[i - 1].address < x.address)) &&
  Array.isArray(v.sourceEvidence) && v.sourceEvidence.every((x, i) => evidence(x) && (!i || v.sourceEvidence[i - 1].address < x.address)) &&
  [...v.trustedCounterparties, ...v.trustedCalledContracts, ...v.deployerLineage.map(x => x.address)].every(a => v.sourceEvidence.some(e => e.address === a));

export function validateRoot(v) {
  return exact(v, ['schemaVersion', 'network', 'epoch', 'digest', 'arkivKey', 'arkivOwner']) &&
    v.schemaVersion === 1 && network(v.network) && integer(v.epoch) && v.epoch > 0 &&
    isDigest(v.digest) && isDigest(v.arkivKey) && isAddress(v.arkivOwner);
}

export function validateSnapshot(v) {
  return exact(v, ['schemaVersion', 'network', 'epoch', 'generatedAt', 'expiresAt', 'sharedContracts', 'sites']) &&
    v.schemaVersion === 1 && network(v.network) && integer(v.epoch) && v.epoch > 0 &&
    timestamp(v.generatedAt) && timestamp(v.expiresAt) && Date.parse(v.generatedAt) < Date.parse(v.expiresAt) &&
    stringMap(v.sharedContracts, chainKey, entries => Array.isArray(entries) && entries.every((x, i) => evidence(x) && (!i || entries[i - 1].address < x.address))) &&
    stringMap(v.sites, host, chains => stringMap(chains, chainKey, siteChain));
}

export function validateRootSnapshotPair(root, snapshot) {
  return validateRoot(root) && validateSnapshot(snapshot) &&
    root.schemaVersion === snapshot.schemaVersion && root.network === snapshot.network && root.epoch === snapshot.epoch;
}

// This is the extension-to-watcher intake. Its kind is the observation subtype.
export function validateObservation(v) {
  if (v?.kind === 'frontend') return exact(v, ['site', 'kind', 'chainId', 'reporterKey', 'path', 'hash']) && host(v.site) && v.site.length <= 253 && integer(v.chainId) && v.chainId > 0 && typeof v.reporterKey === 'string' && /^[\x20-\x7e]{1,128}$/.test(v.reporterKey) && isFrontendPath(v.path) && isFrontendHash(v.hash);
  return exact(v, ['site', 'kind', 'value', 'chainId', 'reporterKey']) &&
    host(v.site) && ['counterparty', 'called-contract', 'warned'].includes(v.kind) &&
    isAddress(v.value) && integer(v.chainId) && v.chainId > 0 && nonempty(v.reporterKey);
}

export const READ_ONLY_METHODS = Object.freeze(['eth_accounts', 'eth_chainId', 'eth_blockNumber', 'eth_call', 'eth_getBalance', 'eth_getCode', 'eth_getTransactionCount', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getLogs', 'net_version']);
// Already signed; this broadcasts a transaction and is not a read.
export const ALREADY_SIGNED_METHODS = Object.freeze(['eth_sendRawTransaction']);

// ENS text-record keys the watcher may mirror. An empty string records a live
// "no record" answer.
export const ENS_CACHE_KEYS = Object.freeze(['bound.attest.v1', 'bound.frontend.v1']);
const ENS_CACHE_VALUE_MAX = 16384;
const ensName = s => nonempty(s) && s.length <= 255 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(s);
const baseRecord = (v, keys) => exact(v, ['schemaVersion', 'kind', 'site', 'chainId', ...keys]) &&
  v.schemaVersion === 1 && host(v.site) && integer(v.chainId) && v.chainId > 0;
const change = v => exact(v, ['kind', 'before', 'after']) &&
  ['ns', 'cert', 'a-record'].includes(v.kind) &&
  sortedUnique(v.before, nonempty) && v.before.length > 0 &&
  sortedUnique(v.after, nonempty) && v.after.length > 0 &&
  JSON.stringify(v.before) !== JSON.stringify(v.after);

// These are public payloads only. Arkiv $owner, $key and $expiresAt remain metadata.
export function validateRecord(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  switch (v.kind) {
    case 'frontend': return validateFrontendRecord(v);
    case 'observation':
      return baseRecord(v, ['value', 'reporterKey', 'event']) &&
        isAddress(v.value) && nonempty(v.reporterKey) &&
        ['counterparty', 'called-contract', 'warned'].includes(v.event);
    case 'baseline':
      return baseRecord(v, ['counterparties', 'calledContracts', 'updatedAt']) &&
        addresses(v.counterparties) && addresses(v.calledContracts) && timestamp(v.updatedAt);
    case 'drift':
      return baseRecord(v, ['changes', 'corroborated', 'evidenceReference', 'detectedAt']) &&
        Array.isArray(v.changes) && v.changes.length > 0 &&
        v.changes.every((item, i) => change(item) && (!i || v.changes[i - 1].kind < item.kind)) &&
        typeof v.corroborated === 'boolean' && isArkivEntityReference(v.evidenceReference) && timestamp(v.detectedAt);
    case 'incident':
      return baseRecord(v, ['trigger', 'severity', 'counterparty', 'reportDigest', 'reportReference', 'createdAt']) &&
        ['drift+warned', 'K-same-counterparty-warned'].includes(v.trigger) &&
        v.severity === 'high' && isAddress(v.counterparty) && isDigest(v.reportDigest) &&
        /^[0-9a-f]{64}$/.test(v.reportReference) && timestamp(v.createdAt);
    case 'evidence':
      return baseRecord(v, ['digest', 'payload', 'createdAt']) && isDigest(v.digest) &&
        typeof v.payload === 'string' && v.payload.length > 0 && new TextEncoder().encode(v.payload).length <= 61_440 && timestamp(v.createdAt);
    case 'trust_snapshot':
      return exact(v, ['schemaVersion', 'kind', 'network', 'epoch', 'digest', 'canonical']) &&
        v.schemaVersion === 1 && network(v.network) && integer(v.epoch) && v.epoch > 0 && isDigest(v.digest) &&
        typeof v.canonical === 'string' && v.canonical.length > 0 && new TextEncoder().encode(v.canonical).length <= 61_440;
    case 'status':
      return baseRecord(v, ['state', 'feedReference', 'incidentReference', 'updatedAt']) &&
        ['normal', 'drift', 'incident'].includes(v.state) && isDigest(v.feedReference) &&
        (v.state === 'incident' ? v.incidentReference === null || isDigest(v.incidentReference) : v.incidentReference === null) &&
        timestamp(v.updatedAt);
    // Watcher-asserted copy of ENS text records for one curated site. It is a
    // cache for availability and display only; it never establishes trust.
    case 'ens_record':
      return baseRecord(v, ['name', 'resolver', 'records', 'resolvedAt']) &&
        ensName(v.name) && isAddress(v.resolver) && timestamp(v.resolvedAt) &&
        v.records !== null && typeof v.records === 'object' && !Array.isArray(v.records) &&
        Object.keys(v.records).length > 0 &&
        Object.entries(v.records).every(([k, text]) => ENS_CACHE_KEYS.includes(k) && typeof text === 'string' && text.length <= ENS_CACHE_VALUE_MAX && wellFormed(text));
    default: return false;
  }
}

// Each bundle entry preserves the Arkiv entity envelope. The owner value must be
// copied from Arkiv metadata, not from the payload. Callers supply the configured
// watcher and a current Arkiv block so foreign or expired entities are rejected.
export function validateBundle(v, watcherAddress, currentBlock) {
  if (!exact(v, ['schemaVersion', 'generatedAt', 'records']) || v.schemaVersion !== 1 ||
      !timestamp(v.generatedAt) || !isAddress(watcherAddress) || !integer(currentBlock)) return false;
  if (!Array.isArray(v.records)) return false;
  const keys = new Set();
  for (const entry of v.records) {
    if (!exact(entry, ['key', 'owner', 'expiresAt', 'record']) ||
        !isDigest(entry.key) || keys.has(entry.key) ||
        !isAddress(entry.owner) || entry.owner !== watcherAddress ||
        !integer(entry.expiresAt) || entry.expiresAt <= currentBlock ||
        !validateRecord(entry.record) || !['baseline', 'drift', 'incident', 'status', 'ens_record', 'frontend'].includes(entry.record.kind)) return false;
    keys.add(entry.key);
  }
  return true;
}

// JSON.parse alone silently overwrites duplicate object keys. Reject them first.
export function parseUniqueJSON(text) {
  if (typeof text !== 'string' || text.length > 1_000_000) throw new Error('invalid JSON size');
  const value = JSON.parse(text);
  let i = 0;
  const ws = () => { while (i < text.length && /\s/.test(text[i])) i++; };
  const str = () => {
    const start = i++;
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i++] === '"') {
        const value = JSON.parse(text.slice(start, i));
        if (!wellFormed(value)) throw new Error('invalid Unicode string');
        return value;
      }
    }
    throw new Error('unterminated string');
  };
  const scan = depth => {
    if (depth > 100) throw new Error('JSON nesting limit');
    ws();
    if (text[i] === '"') { str(); return; }
    if (text[i] === '{') {
      i++; ws(); const keys = new Set();
      if (text[i] === '}') { i++; return; }
      for (;;) {
        ws(); const key = str();
        if (keys.has(key)) throw new Error('duplicate JSON key');
        keys.add(key); ws(); i++; scan(depth + 1); ws();
        if (text[i++] === '}') return;
      }
    }
    if (text[i] === '[') {
      i++; ws(); if (text[i] === ']') { i++; return; }
      for (;;) { scan(depth + 1); ws(); if (text[i++] === ']') return; }
    }
    while (i < text.length && !/[\s,\]}]/.test(text[i])) i++;
  };
  scan(0);
  return value;
}

// Adapter state is explicit; this shape does not validate the returned payload.
export function validateAdapterResult(v) {
  if (!exact(v, ['service', 'status', 'source', 'data'])) return false;
  if (!['snapshot', 'arkiv', 'anon-rpc', 'swarm'].includes(v.service)) return false;
  if (!['ok', 'stale', 'unavailable', 'timeout', 'invalid'].includes(v.status)) return false;
  if (v.status === 'timeout' && v.service !== 'anon-rpc') return false;
  if (v.status === 'ok') return v.source === 'live' && v.data !== null && typeof v.data === 'object' && !Array.isArray(v.data);
  if (v.status === 'stale') return ['snapshot', 'arkiv'].includes(v.service) && v.source === 'cache' && v.data !== null && typeof v.data === 'object' && !Array.isArray(v.data);
  return v.source === null && v.data === null;
}

// Local decision state; this is never a page-provided authorization.
export function validateDecision(v) {
  if (!exact(v, ['coverage', 'evaluated', 'bypassPossible', 'verdict', 'score'])) return false;
  if (!['mediated', 'unsupported'].includes(v.coverage) || typeof v.evaluated !== 'boolean' || typeof v.bypassPossible !== 'boolean') return false;
  if (v.coverage === 'unsupported' || !v.evaluated) return v.verdict === null && v.score === null;
  if (v.verdict === 'grey') return v.score === null;
  if (v.bypassPossible && v.verdict === 'green') return false;
  if (!Number.isInteger(v.score)) return false;
  const ranges = {green: [70, 100], amber: [40, 69], red: [16, 39], escalated: [0, 15]};
  if (!Object.hasOwn(ranges, v.verdict)) return false;
  const [min, max] = ranges[v.verdict];
  return v.score >= min && v.score <= max;
}
export function validateObservationBatch(v) {
  return exact(v, ['schemaVersion', 'events']) && v.schemaVersion === 1 && Array.isArray(v.events) && v.events.length > 0 && v.events.length <= 100 && v.events.every(validateObservation);
}
export function validateIntakeResponse(v) {
  return exact(v, ['schemaVersion', 'result']) && v.schemaVersion === 1 && ['accepted', 'retry', 'rejected'].includes(v.result);
}
