# Watcher and intake

`createWatcher` is an in-memory fixture for fast deterministic tests. The durable implementation is `openDurableWatcher`: it validates the public observation batch, rejects missing incident status, suppresses active-incident observations, persists accepted events before acknowledgement, deduplicates by site/chain/value/reporter/event lane, and retries writes with stable operation IDs. Its local journal is single-process, mode 0600, atomically replaced, and limited to 1 MiB. Use one watcher process per journal. A writer must durably deduplicate operation IDs because a crash can happen after the remote write but before its local acknowledgement is saved.

Baselines are built only from delivered positive observations. Pending or delivered warnings suppress that address; an override choice is not part of the wire record. K counts distinct rotating keys during the configured window. It does not establish distinct people and has no Sybil resistance. Active accounts, transaction senders and typed-data owners must be removed in the extension before intake; the watcher cannot infer those private values.

`createIntakeServer` exposes a bounded JSON endpoint for configured Chromium extension origins. CORS origin checks are not authentication. Bind it to an explicitly configured interface, use TLS for remote deployment, and add deployment-level abuse controls before public exposure. Intake errors return a generic retry response without internal details.

`createObservationPipeline` composes durable delivery, hourly baseline aggregation and an owner-checked bundle refresh. `createWatcherRuntime` provides non-overlapping poll/flush/baseline timers. `scripts/integration/local.test.js` proves this flow against fakes only.

`pollSite` takes a complete DNS/TLS sample for a configured host and its explicitly configured parent nameserver zone. `classifyDrift` corroborates a nameserver change, a certificate issuer/SAN change, or an A-record move with known different ASNs. `createCymruLookup` uses Team Cymru's public DNS service; failures or multi-origin results cannot corroborate. `createDriftMonitor` uses an externally supplied baseline and publishes a stable evidence ID. Drift and incident details are stored as Arkiv `evidence` entities and referenced by their Arkiv entity keys. DNS/TLS and ASN data are visible to their respective providers.

`createNetworkPollAdapters` provides DNS-over-HTTPS and TLS collectors. `demo/hijack-server` is a loopback-only HTTP cutover rehearsal. Neither performs a controlled public DNS/TLS change. The live Arkiv writer/expiry, controlled-domain drift, Arkiv incident/status publication, extension consumer and other project lanes remain integration gates; see [feasibility evidence](../../packages/contracts/feasibility.md) and the [project plan](../../Docs/plan.md).

`service.js` composes the durable watcher, loopback-only HTTP intake and scheduled jobs. `application.js` connects it to durable drift and incident handling with one per-site status guard and exclusive journal locks. `deployment.js` wires the Arkiv archive, DNS/TLS and ASN pollers. Run `node services/watcher/run.mjs /absolute/path/to/config.mjs`; the configuration module exports an async `createConfig()` returning the deployment options below. Keep it and its credentials outside version control, and use a secure reverse proxy for remote intake. The runtime has not yet been proven against live services.

The deployment configuration contains `arkiv` (the options in `openArkivArchive`, including dedicated signer `prepare` and `inspect` callbacks), `zones` (site to parent DNS zone), `readBaseline(site, chainId)` (a curated infrastructure reference), `canRecover(site, chainId, {incidentId})` (an independent trusted recovery decision), and `watcher`. The latter supplies `paths` with distinct `watcher`, `drift`, `publication`, and `incidents` files in an existing private directory; `feeds` with site, chainId, feedReference and evidenceReferences; `allowedOrigins`, `windowMs`, `retentionMs`, `k`, `maxDriftAgeMs`, `renewalWindowMs`, and `intervals` for poll, flush, baseline and optional renew in milliseconds. Renewal defaults to the flush interval; set it short enough to allow repeated attempts within the configured Arkiv block threshold, including network outages and confirmation time. The command-line runner reports failed jobs without logging private error details; operators should monitor these reports. Optional `listen` selects the loopback port. `integrations/arkiv/signer.js` creates scoped signing callbacks from an ethers wallet and provider. Use a dedicated key and do not run another writer with it. Recovery additionally requires a fresh normal infrastructure poll and no accepted warning for the configured counting window. Warnings during an active incident are suppressed, so this quiet period alone does not prove the site is safe. These settings are operator decisions; do not substitute observed infrastructure for the curated reference.

`config-example.mjs` illustrates loading those options and curated `{site, chainId, sample}` baseline entries from a private JSON file named by `BOUND_WATCHER_CONFIG`, and a dedicated key from `ARKIV_PRIVATE_KEY`. With no `recoveryApprovalFile`, it never approves incident recovery. An operator may configure a private, access-controlled JSON file of the form `{"version":1,"approvals":[{"site":"example.org","chainId":1,"incidentId":"<64 hex characters>","expiresAt":1760000000000}]}`. Each entry authorizes one incident episode until the specified Unix millisecond expiry; the primary incident ID is in the local incidents journal. Update the file only after independent review. Missing approvals fail closed; malformed files surface a failure. This is local operator authorization, not proof of a safe site. Use reviewed key custody and never commit the configuration, approvals, or credentials.

`lifecycle.js` persists incident episodes before external publication. Multiple counterparties in one site episode get separate incident reports; the site's status points to the first report. Recovery requires an injected trusted health decision and a successfully written normal status. `incident-binding.js` connects this lifecycle to the incident composer and archive using explicit site feeds. The recovery adapter must independently require restored infrastructure and appropriate normal behavior; incoming observations are not accepted during an active incident. The single-reference status representation and the choice of primary incident need cross-lane acceptance. If a pending status is superseded after a crash, the binding accepts it only after owner-checked reads show that the current status references the incident for the same operation ID. Other superseded states fail closed and require reconciliation.

When drift information is unavailable, the watcher reports that condition and still evaluates the independent K-distinct-key trigger. It does not infer corroborated drift. The runtime suppresses an empty-trigger recovery signal while drift state is unavailable; the deployment must surface the stale state to consumers.

`drift-state.js` persists the latest successful infrastructure observation and its freshness; a poll failure or age limit makes the signal unavailable while retaining its last known state. `drift-binding.js` connects this store to the monitor. Successful polling updates local drift state before publication, so an Arkiv publication outage does not erase a freshly detected local signal. The service test exercises drift plus one warned report and a later recovery with fake adapters. It does not prove real DNS cutover or live publication.

`drift-publisher.js` journals public drift evidence before writing it to Arkiv, pins the hour-rounded publication time across retries, verifies the returned entity key and digest, and renews continuing drift in configured windows. Completed entries from earlier windows are compacted; pending entries are retained for retry. `guarded-flows.js` supplies a single-process status guard that serializes drift publication and incident transitions when all site operations use its wrappers. Live Arkiv publication remains to be verified.

Status timestamps are hour-rounded for privacy. Same-hour recovery uses a separate capability that is called only inside the per-site guard after a clean infrastructure check and, for incidents, the configured recovery decision. The caller captures the current status version, and the upsert coordinator rejects a recovery based on an outdated version; retries of an already superseded recovery cannot overwrite a newer status. Ordinary status writes still reject same-hour severity regressions. Chain publication is asynchronous, so the public status may lag local detection or recovery. This ordering has local unit coverage and still needs live verification.

## Encrypted reports (local intake)

The extension seals every observation batch to the aggregator's public key with HPKE (RFC 9180, base mode: DHKEM(P-256, HKDF-SHA256), HKDF-SHA256, AES-128-GCM; `integrations/report-crypto`). Relays, proxies and TLS-terminating front ends see only ciphertext. The encryption key is a dedicated P-256 key, separate from the Arkiv writer key.

1. `node scripts/integration/intake-keygen.mjs` writes the private key to `.bound/intake-key.json` (mode 0600; override with `BOUND_INTAKE_KEY_FILE`) and prints `BOUND_INTAKE_PUBLIC_KEY=…`. `--rotate` replaces an existing key.
2. Put that line in `.env` and rebuild the extension. The public key is pinned in the build and shown read-only (as its key ID) in Options; it cannot be changed from settings.
3. `local-intake.mjs` refuses to start without the key file and accepts only sealed envelopes:
   `{"schemaVersion":2,"suite":"hpke-p256-sha256-aes128gcm","keyId":"<16 hex>","enc":"<base64url>","ct":"<base64url>"}`.
   A plaintext `schemaVersion: 1` batch is rejected with 400. The decrypted payload is the unchanged `{schemaVersion:1, events}` batch, validated as before.

Without a pinned key the extension keeps reports queued and sends nothing. Batches are sealed at send time, so after a rotation and rebuild, queued reports go out under the new key; only an extension still running the old build is rejected until it is updated.

## Deploy the aggregator as a container (Docker Hub image, e.g. on Render)

The image (`Dockerfile` at the repo root) holds no state and no secrets. On start, `local-intake.mjs` rebuilds its state from what its writer key already published on Arkiv (`rebuild-from-arkiv.mjs`):

- **Report journal:** every live `observation` entity, with its original time from its creation block, so the 1-hour incident window and the 8-day retention survive a restart.
- **Upsert registry:** each site's current `baseline` and `status` entity, so the next publish patches it instead of creating a duplicate that readers would reject.

It then waits for any transaction its predecessor left in flight to settle. A replacement container is therefore an exact copy of the one that stopped, on any host.

**Run exactly one aggregator per writer key.** Two at once collide on transaction nonces.
- Use one instance, and stop the laptop aggregator before a hosted one starts.
- On hosts with zero-downtime deploys (Render keeps the old instance until the new one is healthy), set `BOUND_STARTUP_WRITE_DELAY_MS=60000`. The new instance then writes nothing for its first minute; `POST`s get `503 retry` and the extension resends.
- Render's free plan sleeps idle services, which stops the hourly republish. Use an always-on instance.

### Build and publish the image

```bash
docker buildx build --platform linux/amd64,linux/arm64 -t <dockerhub-user>/bound-aggregator:<tag> --push .
```

### Environment (hosting secrets)

Put these in one env file. On Render, add it under **Secret Files** with the filename `.env`; Render mounts it at `/etc/secrets/.env`, which the aggregator reads on start. `BOUND_ENV_FILE` points it elsewhere. Ordinary environment variables also work and win over the file.

| Variable | Value |
|---|---|
| `BOUND_ARKIV_RPC_URL` | `https://rpc.rabdi.db-chain.testnet.arkiv.network` |
| `BOUND_ARKIV_CHAIN_ID` | `7794095` |
| `BOUND_ARKIV_OWNER` | the writer address |
| `BOUND_ARKIV_PRIVATE_KEY` | the writer key |
| `ARKIV_ACCESS_KEY` | an Arkiv API key. Required: the anonymous Rabdi query budget is exhausted |
| `BOUND_INTAKE_PRIVATE_JWK` | output of `node scripts/integration/intake-keygen.mjs --print-env` (a private key: never paste it into chat or logs) |
| `BOUND_INTAKE_PUBLIC_KEY` | same as in `.env`. Optional: the container refuses to start if the JWK doesn't match it |
| `BOUND_LOCAL_INTAKE_SCOPES` | sites to publish before any traffic, e.g. `127.0.0.1:8005,app.uniswap.org` |
| `BOUND_TRUST_PROXY` | `1` behind a hosting proxy, so the per-IP limit sees client addresses |
| `BOUND_STARTUP_WRITE_DELAY_MS` | `60000` on Render (see above) |

The host's `PORT` is honoured; the image binds `0.0.0.0` and defaults to 8787.

### On Render

1. **New → Web Service → Existing image**, `docker.io/<dockerhub-user>/bound-aggregator:<tag>`.
2. Set **Instances: 1**, add the variables above as a secret file named `.env`, and set the **Health Check Path** to `/healthz`. No disk.
3. After deploy, `https://<service>.onrender.com/healthz` returns `{"ok":true}`.
4. In BOUND → Options, set **Watcher intake URL** to `https://<service>.onrender.com/v1/observations`. The extension build must pin the matching `BOUND_INTAKE_PUBLIC_KEY`.

### Behaviour

- `POST /v1/observations` replies `202` only once the batch's reports are on Arkiv. Otherwise it replies `503 retry`, and the extension retries; duplicates are dropped.
- More than `BOUND_INTAKE_RATE` (default 30) batches per address in 10 minutes gets `429`.
- `GET /healthz` reports `503` until the rebuild and Arkiv writer are ready.
- `BOUND_REBUILD=always` forces a rebuild even when state files exist. With `BOUND_LOCAL_INTAKE_ARKIV=off` the rebuild still runs, read-only, as a dry run.
- Duplicate baseline/status entities found during a rebuild are logged, never deleted automatically.
