import http from 'node:http';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseUniqueJSON, validateObservationBatch, validateIntakeResponse } from '../../packages/contracts/index.js';
import { createHash } from 'node:crypto';
import { FetchRequest, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes } from 'ethers';
import { openDurableWatcher } from './durable.js';
import { openArkivArchive } from '../../integrations/arkiv/archive.js';
import { createArkivSigner } from '../../integrations/arkiv/signer.js';

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
  if (!site || !Number.isSafeInteger(chainId) || chainId < 1) throw new Error(`invalid BOUND_LOCAL_INTAKE_SCOPES entry: ${entry}`);
  return { site, chainId };
});

async function openArchive() {
  if (process.env.BOUND_LOCAL_INTAKE_ARKIV === 'off') return null;
  const url = process.env.BOUND_ARKIV_RPC_URL;
  const owner = process.env.BOUND_ARKIV_OWNER?.toLowerCase();
  const target = (process.env.BOUND_ARKIV_SYSTEM_ADDRESS ?? '0x4400000000000000000000000000000000000044').toLowerCase();
  const chainId = Number(process.env.BOUND_ARKIV_CHAIN_ID);
  const privateKey = process.env.BOUND_ARKIV_PRIVATE_KEY;
  const accessKey = process.env.ARKIV_ACCESS_KEY || undefined;
  if (!url || !/^0x[0-9a-f]{40}$/.test(owner ?? '') || !Number.isSafeInteger(chainId) || !/^(?:0x)?[0-9a-fA-F]{64}$/.test(privateKey ?? '')) {
    throw new Error('Arkiv writer not configured: set BOUND_ARKIV_RPC_URL, BOUND_ARKIV_OWNER, BOUND_ARKIV_CHAIN_ID and BOUND_ARKIV_PRIVATE_KEY (or BOUND_LOCAL_INTAKE_ARKIV=off)');
  }
  const wallet = new Wallet(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);
  if (wallet.address.toLowerCase() !== owner) throw new Error('BOUND_ARKIV_PRIVATE_KEY does not derive BOUND_ARKIV_OWNER');
  const request = new FetchRequest(url);
  if (accessKey) request.setHeader('x-api-key', accessKey);
  const provider = new JsonRpcProvider(request, chainId, { staticNetwork: true });
  if (Number((await provider.getNetwork()).chainId) !== chainId) throw new Error('unexpected Arkiv chain');
  // Dedicated journals: the curator's journals stay untouched.
  const stateDir = path.join(boundDir, 'watcher-arkiv');
  await mkdir(stateDir, { recursive: true, mode: 0o700 });
  // Rabdi produces a block every ~2s. Observations live ~4h, which outlasts
  // the watcher's 2h retention; the other kinds are unused here but required.
  const archive = await openArkivArchive({
    url, accessKey, owner, target, chainId, schemaTag: 'bound.record.v1',
    senderJournal: path.join(stateDir, 'sender.json'),
    registryJournal: path.join(stateDir, 'registry.json'),
    lifetimes: { observation: 7200, baseline: 43200, drift: 43200, incident: 43200, status: 43200 },
    ...createArkivSigner({ wallet, provider, owner, target, chainId }),
    hash: keccak256, confirmTimeoutMs: 120000, confirmPollMs: 1500
  });
  console.log(`[Watcher] Arkiv writer ready: owner=${owner} chainId=${chainId}`);
  return archive;
}

const archive = await openArchive();

const watcher = await openDurableWatcher({
  path: journalPath,
  windowMs: 3600000,
  retentionMs: 7200000,
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

// What the watcher knows about a site, derived from the observations it holds:
// durable.js builds the baseline from delivered non-warned reports and drops any
// address that was ever warned, and reports corroborated warned counterparties as
// triggers. Nothing here comes from a fixture.
const operationId = (...parts) => createHash('sha256').update(JSON.stringify(['bound-local-intake-v1', ...parts])).digest('hex');
// Hour-bucketed, so republishing unchanged state is byte-identical and costs no transaction.
const hourBucket = () => new Date(Math.floor(Date.now() / 3600000) * 3600000).toISOString();
const feedReference = (site, chainId) => keccak256(toUtf8Bytes(JSON.stringify(['bound-local-intake-feed-v1', site, chainId])));
const publishedState = new Map();

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
      // A return to normal is a status regression, so it must carry the version the
      // decision was made against; anything else cannot clear a newer committed state.
      const version = await archive.getStatusVersion(site, chainId);
      const statusId = operationId('status', status);
      const storedStatus = state === 'normal' && version !== null
        ? await archive.writeRecoveryStatus(status, statusId, version)
        : await archive.writeStatus(status, statusId);
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
      catch (err) { console.error(`[Watcher] Arkiv flush failed, will retry: ${err.message}`); break; }
    } while (flushAgain);
  })().finally(() => { flushing = null; });
  return flushing;
}
const retryTimer = setInterval(async () => {
  if ((await watcher.pending()).length) scheduleFlush();
}, FLUSH_RETRY_MS);
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
      batch = parseUniqueJSON(text);
    } catch {
      return respond(400, { error: 'Invalid JSON' });
    }

    if (!validateObservationBatch(batch)) {
      console.warn('[Watcher] Rejected invalid observation batch:', batch);
      return respond(400, { error: 'Invalid observation batch' });
    }

    console.log(`[Watcher] Received observation batch (${batch.events.length} event${batch.events.length === 1 ? '' : 's'}):`);
    for (const evt of batch.events) {
      console.log(`  -> site=${evt.site} chainId=${evt.chainId} kind=${evt.kind} value=${evt.value} (key=${evt.reporterKey})`);
    }

    const result = await watcher.intake(batch);
    if (!validateIntakeResponse(result)) {
      return respond(503, { schemaVersion: 1, result: 'retry' });
    }

    if (result.result === 'accepted') scheduleFlush();
    return respond(result.result === 'accepted' ? 202 : 400, result);
  } catch (err) {
    console.error('[Watcher] Intake error:', err);
    return respond(400, { error: err.message });
  }
});

server.listen(port, host, () => {
  console.log(`Watcher intake server listening on http://${host}:${port}/v1/observations`);
});

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(retryTimer);
  server.close();
  server.closeAllConnections();
  await flushing;
  await archive?.close();
  process.exit(0);
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
