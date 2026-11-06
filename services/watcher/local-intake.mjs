import http from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import {localArkivConfig} from './local-arkiv-config.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseUniqueJSON, validateObservationBatch, validateIntakeResponse } from '../../packages/contracts/index.js';
import { createHash } from 'node:crypto';
import { FetchRequest, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes } from 'ethers';
import { openDurableWatcher } from './durable.js';
import { openFrontendAggregator } from './frontend.js';
import { createIntakeRouter } from './intake-router.js';
import { parseNormalScopes, createScopeSafety, publishLocalStatus } from './scope-safety.js';
import { createRecoveryApprovalPolicy } from './recovery-approval.js';
import { openArkivArchive } from '../../integrations/arkiv/archive.js';
import { createArkivSigner } from '../../integrations/arkiv/signer.js';
import { importPrivateKey, openReport } from '../../integrations/report-crypto/index.mjs';

// Run from the repo root with: node --env-file=.env services/watcher/local-intake.mjs
// Accepted observations are journaled first, then flushed to Arkiv in the
// background. Set BOUND_LOCAL_INTAKE_ARKIV=off to journal only.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const boundDir = path.join(root, '.bound');
await mkdir(boundDir, { recursive: true });

const journalPath = path.join(boundDir, 'watcher-local-journal.json');
const port = 8787;
const host = '127.0.0.1';
const FLUSH_RETRY_MS = 30000;
// Reports stay in the baseline for 8 days. The extension re-reports a (site, address)
// pair at most once a week, so a shorter retention would empty baselines between reports.
const RETENTION_MS = 8 * 24 * 3600000;
const WINDOW_MS = 3600000;
const CHAIN_ID = Number(process.env.BOUND_LOCAL_INTAKE_CHAIN_ID ?? 11155111);
const corroborationK = Number(process.env.BOUND_LOCAL_INTAKE_K ?? 3);
if (!Number.isSafeInteger(corroborationK) || corroborationK < 2) throw new Error('BOUND_LOCAL_INTAKE_K must be an integer of 2 or more');


// Scopes the operator declares, as "host:port" or "host:port@chainId". A declared
// scope is published with an empty baseline before any traffic, which is the only
// way to start a brand-new local site: until a baseline record exists the extension
// scores every request grey, and a grey request produces no observation to build a
// baseline from. Leave it unset to publish only what real traffic has produced.
const declaredScopes = (process.env.BOUND_LOCAL_INTAKE_SCOPES ?? '').split(',').map(value => value.trim()).filter(Boolean).map(entry => {
  const [site, chain] = entry.split('@');
  const chainId = chain === undefined ? CHAIN_ID : Number(chain);
  if (!site || (!Number.isSafeInteger(chainId) || chainId < 1) || chainId < 1) throw new Error(`invalid BOUND_LOCAL_INTAKE_SCOPES entry: ${entry}`);
  return { site, chainId };
});

async function openArchive() {
  if (process.env.BOUND_LOCAL_INTAKE_ARKIV === 'off') return null;
  const {url, owner, chainId, privateKey} = localArkivConfig(process.env);
  const target = (process.env.BOUND_ARKIV_SYSTEM_ADDRESS ?? '0x4400000000000000000000000000000000000044').toLowerCase();
  const accessKey = process.env.ARKIV_ACCESS_KEY || undefined;
  if (!url || !/^0x[0-9a-f]{40}$/.test(owner ?? '') || (!Number.isSafeInteger(chainId) || chainId < 1) || !/^(?:0x)?[0-9a-fA-F]{64}$/.test(privateKey ?? '')) {
    throw new Error('Arkiv writer not configured: set BOUND_ARKIV_RPC_URL, BOUND_ARKIV_OWNER, BOUND_ARKIV_CHAIN_ID and BOUND_ARKIV_PRIVATE_KEY; also accepts ARKIV_RPC_URL, ARKIV_TEST_WRITER_ADDRESS, ARKIV_CHAIN_ID and ARKIV_TEST_WRITER_PRIVATE_KEY (or BOUND_LOCAL_INTAKE_ARKIV=off)');
  }
  const wallet = new Wallet(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);
  if (wallet.address.toLowerCase() !== owner) throw new Error('Arkiv writer key/address mismatch: watcher-specific BOUND_ARKIV_* values override ARKIV_TEST_WRITER_*; configure a matching pair');
  const request = new FetchRequest(url);
  if (accessKey) request.setHeader('x-api-key', accessKey);
  const provider = new JsonRpcProvider(request, chainId, { staticNetwork: true });
  if (Number((await provider.getNetwork()).chainId) !== chainId) throw new Error('unexpected Arkiv chain');
  // Dedicated journals: the curator's journals stay untouched.
  const stateDir = path.join(boundDir, 'watcher-arkiv');
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  // Rabdi produces a block every ~2s. Observations live 8 days (345600 blocks), matching
  // the watcher's retention. Baselines and statuses live ~24h and are republished hourly.
  const archive = await openArkivArchive({
    url, accessKey, owner, target, chainId, schemaTag: 'bound.record.v1',
    senderJournal: path.join(stateDir, 'sender.json'),
    registryJournal: path.join(stateDir, 'registry.json'),
    lifetimes: { observation: 345600, baseline: 43200, frontend: 43200, drift: 43200, incident: 43200, status: 43200 },
    ...createArkivSigner({ wallet, provider, owner, target, chainId }),
    getFrontendSafety: async ({site,chainId}, status) => {
      const rawDrift = status?.state === 'drift' || (await watcher.triggers(site,chainId)).length > 0;
      const incident = status?.state === 'incident';
      return {known: normalScopes.some(s => s.site === site && s.chainId === chainId), rawDrift, incident};
    },
    hash: keccak256, confirmTimeoutMs: 120000, confirmPollMs: 1500
  });
  console.log(`[Watcher] Arkiv writer ready: owner=${owner} chainId=${chainId}`);
  return archive;
}

// Reports arrive sealed to this key (HPKE, see integrations/report-crypto). There is
// no plaintext path: without the key the intake does not start.
async function loadReportKey() {
  const file = path.resolve(process.env.BOUND_INTAKE_KEY_FILE ?? path.join(boundDir, 'intake-key.json'));
  let stored;
  try { stored = JSON.parse(await readFile(file, 'utf8')); }
  catch { throw new Error(`report key not found at ${file}: run node scripts/integration/intake-keygen.mjs`); }
  if (stored?.version !== 1 || typeof stored.keyId !== 'string' || !/^[0-9a-f]{16}$/.test(stored.keyId)) throw new Error(`invalid report key file ${file}`);
  return { keyId: stored.keyId, privateKey: await importPrivateKey(stored.privateKey) };
}
const reportKey = await loadReportKey();
console.log(`[Watcher] Report key loaded: keyId=${reportKey.keyId}`);

const normalScopes = parseNormalScopes(process.env.BOUND_LOCAL_INTAKE_NORMAL_SCOPES ?? '', CHAIN_ID);
const archive = await openArchive();

// An existing journal records the retention it was opened with; widening it only keeps
// entries longer, so the stored setting is raised in place (window and k must match).
async function widenJournalRetention() {
  let state;
  try { state = JSON.parse(await readFile(journalPath, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const config = state?.config;
  if (!config || config.retentionMs >= RETENTION_MS || config.windowMs !== WINDOW_MS || config.k !== corroborationK) return;
  const temporary = `${journalPath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify({ ...state, config: { ...config, retentionMs: RETENTION_MS } }), { mode: 0o600 });
  await rename(temporary, journalPath);
  console.log(`[Watcher] Journal retention raised from ${config.retentionMs} ms to ${RETENTION_MS} ms`);
}
await widenJournalRetention();

let watcher, scopeSafety, frontendAggregator;
try {
watcher = await openDurableWatcher({
  path: journalPath,
  windowMs: WINDOW_MS,
  retentionMs: RETENTION_MS,
  // Corroboration needs at least two independent reporters, so k cannot go below 2:
  // one browser profile holds one reporter key per week and can never corroborate itself.
  k: corroborationK,
  now: () => Date.now(),
  isIncidentActive: async () => false,
  hasCorroboratedDrift: async () => false,
  writeObservation: async (record, id) => {
    const where = `site=${record.site} chainId=${record.chainId} value=${record.value}`;
    if (!archive) return console.log(`[Watcher] Journaled observation (Arkiv off): ${where}`);
    const entity = await archive.writeObservation(record, id);
    console.log(`[Watcher] Arkiv observation written: ${where} key=${entity.key} expiresAt=${entity.expiresAt}`);
  }
});

scopeSafety = createScopeSafety({normalScopes, watcher, archive});
frontendAggregator = await openFrontendAggregator({
  path: path.join(boundDir, 'watcher-frontend-journal.json'),
  now: () => Date.now(),
  getScopeSafety: async scope => {
    let safety;
    try { safety = await scopeSafety(scope); } catch (error) {
      await archive?.quarantineFrontend(scope.site, scope.chainId);
      throw error;
    }
    if (!safety || safety.known !== true || safety.rawDrift !== false || safety.incident !== false) await archive?.quarantineFrontend(scope.site, scope.chainId);
    return safety;
  },
  reconcileFrontend: archive ? (record, id) => archive.reconcileFrontend(record, id) : undefined,
  writeFrontend: archive ? (record, id) => archive.writeFrontend(record, id) : async () => { throw new Error('Arkiv disabled; frontend publication remains pending'); }
});
} catch (error) {
  await frontendAggregator?.close();
  await archive?.close();
  throw error;
}
const router = createIntakeRouter({addressWatcher: watcher, frontendAggregator});

// What the watcher knows about a site, derived from the observations it holds:
// durable.js builds the baseline from delivered non-warned reports and drops any
// address that was ever warned, and reports corroborated warned counterparties as
// triggers. Nothing here comes from a fixture.
const operationId = (...parts) => createHash('sha256').update(JSON.stringify(['bound-local-intake-v1', ...parts])).digest('hex');
// Hour-bucketed, so republishing unchanged state is byte-identical and costs no transaction.
const hourBucket = () => new Date(Math.floor(Date.now() / 3600000) * 3600000).toISOString();
const feedReference = (site, chainId) => keccak256(toUtf8Bytes(JSON.stringify(['bound-local-intake-feed-v1', site, chainId])));
const publishedState = new Map();
const canRecover = process.env.BOUND_LOCAL_INTAKE_RECOVERY_APPROVAL_FILE
  ? createRecoveryApprovalPolicy({path: process.env.BOUND_LOCAL_INTAKE_RECOVERY_APPROVAL_FILE}) : async () => false;

async function publishWatcherState() {
  if (!archive) return;
  const scopes = new Map();
  for (const scope of [...declaredScopes, ...watcher.scopes()]) scopes.set(`${scope.site}|${scope.chainId}`, scope);
  for (const [key, { site, chainId }] of scopes) {
    try {
      const updatedAt = hourBucket();
      const baseline = { ...await watcher.baseline(site, chainId), updatedAt };
      const triggers = await watcher.triggers(site, chainId);
      const state = triggers.length ? 'drift' : 'normal';
      const status = { schemaVersion: 1, kind: 'status', site, chainId, state, feedReference: feedReference(site, chainId), incidentReference: null, updatedAt };
      const fingerprint = JSON.stringify([baseline, status]);
      if (publishedState.get(key) === fingerprint) continue;
      const storedBaseline = await archive.writeBaseline(baseline, operationId('baseline', baseline));
      if (storedBaseline.state !== 'current') throw new Error('baseline was superseded while publishing');
      const statusId = operationId('status', status);
      const storedStatus = await publishLocalStatus({site,chainId,state,status,statusId,watcher,archive,canRecover,operationId:record=>operationId('status',record)});
      if (!storedStatus || storedStatus === true) continue;
      publishedState.set(key, fingerprint);
      console.log(`[Watcher] Published ${site} chainId=${chainId}: baseline ${baseline.counterparties.length} counterparties / ${baseline.calledContracts.length} contracts key=${storedBaseline.key}; status=${state} key=${storedStatus.key}`);
      for (const trigger of triggers) console.log(`[Watcher] Corroborated trigger on ${site}: ${trigger.counterparty} (${trigger.trigger})`);
    } catch (err) {
      publishedState.delete(key);
      console.error(`[Watcher] Publish failed for ${site} chainId=${chainId}, will retry: ${err.message}`);
    }
  }
}

// One flush at a time; a failed flush leaves entries undelivered for the next try.
let flushing = null;
let flushAgain = false;
function scheduleFlush() {
  if (flushing) { flushAgain = true; return flushing; }
  flushing = (async () => {
    do {
      flushAgain = false;
      try { await watcher.flush(); await publishWatcherState(); }
      catch (err) { console.error(`[Watcher] Arkiv flush failed, will retry: ${err.message}`); }
      try { await frontendAggregator.prune(); }
      catch (err) { console.error(`[Watcher] Frontend prune failed, will retry: ${err.message}`); }
      try { await frontendAggregator.publish(); }
      catch (err) { console.error(`[Watcher] Frontend publish failed, will retry: ${err.message}`); }
    } while (flushAgain);
  })().finally(() => { flushing = null; });
  return flushing;
}
// Baselines and statuses live ~24h on Arkiv. Republish every hour even without
// traffic (a new hour bucket changes updatedAt), so a quiet site never expires to grey.
let lastPublishedHour = hourBucket();
const retryTimer = setInterval(async () => {
  const hour = hourBucket();
  if (hour !== lastPublishedHour) { lastPublishedHour = hour; scheduleFlush(); }
  else if ((await watcher.pending()).length) scheduleFlush();
}, FLUSH_RETRY_MS);
const frontendTimer = setInterval(scheduleFlush, 3600000);
if (declaredScopes.length) console.log(`[Watcher] Operator-declared scopes: ${declaredScopes.map(s => `${s.site}@${s.chainId}`).join(', ')}`);
scheduleFlush();

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const isExtension = typeof origin === 'string' && /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
  const isLoopback = typeof origin === 'string' && /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(origin);

  const headers = {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'vary': 'Origin'
  };

  // Only a BOUND extension origin or loopback may talk to the intake. Any other
  // origin gets no CORS grant, and its writes are refused outright below, so a
  // hostile page cannot post observations the watcher would treat as reports.
  const allowed = isExtension || isLoopback;
  if (allowed) headers['access-control-allow-origin'] = origin;

  const respond = (status, body) => {
    if (res.headersSent) return;
    // One line per request, never the body: shows whether the extension reaches the intake at all.
    console.log(`[Watcher] ${req.method} ${req.url} origin=${origin ?? 'none'} -> ${status}`);
    if (body !== undefined) headers['content-type'] = 'application/json; charset=utf-8';
    res.writeHead(status, headers);
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };

  if (origin && !allowed) return respond(403, { error: 'Origin not allowed' });
  const url = new URL(req.url, `http://${host}:${port}`);
  if (url.pathname !== '/v1/observations') return respond(404, { error: 'Not found' });

  if (req.method === 'OPTIONS') {
    headers['access-control-allow-methods'] = 'POST, OPTIONS';
    headers['access-control-allow-headers'] = req.headers['access-control-request-headers'] || 'content-type';
    return respond(204);
  }

  if (req.method !== 'POST') return respond(405, { error: 'Method not allowed' });

  const chunks = [];
  let size = 0;
  const maxBodyBytes = 65536;

  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBodyBytes) {
        headers.connection = 'close';
        req.resume();
        return respond(413, { error: 'Payload too large' });
      }
      chunks.push(chunk);
    }

    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    let batch;
    try {
      // Only sealed v2 envelopes are accepted; a plaintext batch is refused.
      batch = parseUniqueJSON(await openReport(reportKey.privateKey, reportKey.keyId, parseUniqueJSON(text)));
    } catch {
      return respond(400, { error: 'Invalid report' });
    }

    if (!validateObservationBatch(batch)) {
      console.warn('[Watcher] Rejected invalid observation batch');
      return respond(400, { error: 'Invalid observation batch' });
    }

    const result = await router.intake(batch);
    if (!validateIntakeResponse(result)) {
      return respond(503, { schemaVersion: 1, result: 'retry' });
    }

    if (result.result === 'accepted') scheduleFlush();
    return respond(result.result === 'accepted' ? 200 : result.result === 'retry' ? 503 : 400, result);
  } catch (err) {
    console.error('[Watcher] Intake failed');
    return respond(503, { schemaVersion: 1, result: 'retry' });
  }
});

server.once('error', error => {
  console.error(`[Watcher] Server startup failed: ${error.code || error.message}`);
  void stop(1);
});
server.listen(port, host, () => {
  console.log(`Watcher intake server listening on http://${host}:${port}/v1/observations`);
});

let stopping = false;
async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  clearInterval(retryTimer);
  clearInterval(frontendTimer);
  server.close();
  server.closeAllConnections();
  await flushing;
  await frontendAggregator.close();
  await archive?.close();
  process.exit(exitCode);
}
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
