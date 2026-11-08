# Frontend mismatch / Swarm implementation contract — round 2

## Accepted requirement amendment — shared domain cache

The owner subsequently requested Swarm as a persistent second cache layer, in addition to hosting the safe page. The cache lookup order is extension local storage, then a shared Swarm cache, then fresh source verification on a miss or expiry. The logical key is the normalized domain URL (origin, retaining scheme, subdomain and port); it contains no wallet address or route/query/fragment. The JSON value scopes evidence by chain and script fingerprints and includes an exclusive TTL deadline bounded by source expiry. Cache hits remain subject to current document comparison and trust validation. Tickets, wallet payloads, typed approvals and permission grants never become shared cache data. The Swarm feed/publisher implementation and configuration are specified separately in `swarm-domain-cache-plan.md`. All implementation and review delegation uses GPT models only, as requested by the owner.

Review: 2026-11-06, branch `swarm-integration`. Scope: planning review only; source line citations refer to this checkout before implementation. The plan is `Docs/frontend-mismatch-swarm-plan.md` v2. This document supplies implementation decisions where v2 is ambiguous; it does not claim those decisions are already implemented. No build, live publication, commit, or source mutation was performed during this review.

## 1. Verdict and round-1 disposition

**Conditional proceed, in batches below.** V2 addresses the intent of all 19 findings, but several security protocols remain incomplete. Implement the clarifications below before enabling redirects. “Resolved” means resolved in the proposed design, not verified in running code.

| Round-1 finding | V2 disposition | Remaining work / qualification |
|---|---|---|
| 1. Ordinary deploy triggers gate (b) | Resolved | Old-hash-recency gate removed; conflict alone only warns. |
| 2. Collector evasion and false assurance | Partially | Blind spots documented, but collector lacks exclusion counters and still truncates paths; phase 1/6 fixes. |
| 3. Contradictory aggregate precedence | Resolved | Conflict wins; candidate hash cannot suppress it. Select top 128 before sorting wire rows. |
| 4. Frame/top-level evidence mismatch | Partially | No iframe redirect; iframe evidence must also never train the top site's baseline. |
| 5. Navigation invalidates its own ticket | Partially | Expected hops stated; durable exact-URL navigation intents and restart reconciliation absent. |
| 6. Ticket persistence and atomicity | Partially | Session storage/serialization adopted; settings revision, delivery state, duplicate requests and crash windows need schemas. |
| 7. Cancel before navigate delivery | Partially | Ack proposed but no transport contract, timeout policy or hook implementation. |
| 8. Typed confirmation tied to verdict | Partially | Flag adopted; existing timeouts, UI-open failure, rate limits and monitoring shutdown can bypass it. |
| 9. Observation queue rejects frontend | Resolved | Exact variant and migration specified in principle; define mixed-batch persistence below. |
| 10. Reporting gate / poisoning | Partially | Conflict suppression adopted. Quarantine callbacks in local intake are currently constant false, and K keys remain Sybil-vulnerable. |
| 11. Weekly dedupe / freshness mismatch | Partially | 24 h dedupe adopted; reporter counting window and old-hash retirement missing. |
| 12. Arkiv allowlists | Partially | Also change `shared/integrations/arkiv/index.js:7` and archive lifetime composition, not just contracts/upsert/renewal. |
| 13. Bundle lacks records / still performs network reads | Partially | New kinds adopted; cached reader still invokes anonymous RPC; frontend needs an independent snapshot-free path. |
| 14. Safe-page query and budgets | Partially | Query proposed, but exact cumulative bounds, transport config, consistency retry and incident activity undefined. |
| 15. WAR exposure / CSP | Partially | Private confirmation adopted; origin-wide handoff and Swarm gateway paths need tightening. Frame protection needs browser verification. |
| 16. Fragment sensitivity | Partially | Addresses removed; path identity rejection must include percent-encoded identity and fragment must have fixed budgets. |
| 17. Inline MV3 scripts / remote failure detection | Partially | External scripts adopted; successful error HTML or missing JS needs readiness detection, not navigation errors alone. |
| 18. Publication scheduling and bounds | Partially | Hourly task/caps named but unspecified; quiet queues currently stop publication. |
| 19. Demo bypasses detector | Partially | Stable asset adopted; real browser-cache collection and one-hour maturity still need an executable demo procedure. |

**Promotion objection:** retain automatic promotion to meet the owner's community-cache requirement, with K=3 and M=1 h fixed for frontend schema v1. Withdraw seeded-only as a prerequisite for implementing that product requirement. Do not describe K keys as independent users or authentication. A single attacker can create K keys and wait; poisoning can manufacture expected hashes, suppress detection or cause false conflicts. Independent corroboration reduces some false redirects, not baseline poisoning. Quarantine must use actual status and fail closed for promotion on unknown status. A further availability limitation follows from the reporting gate: an established path's legitimate new hash is a conflict, so compliant extensions cannot train its replacement. This iteration keeps the gate; after old rows age out (48 h below), it can learn again. Faster recovery requires an owner-reviewed reset or a later versioned migration mechanism; do not silently allow conflict reports or bypass maturity to solve this.

## 2. New or still underspecified problems in v2

| Severity | Evidence | Problem and required fix |
|---|---|---|
| High | `client/extension/arkiv-reader.mjs:62–67`, `trust-adapter.mjs:28`, `sw.js:551–554` | No in-flight handle exists. Concurrent alarms/settings/navigation/request work can start duplicate refreshes; adapter `allSettled` hides failure. Add keyed single-flight at reader boundary and an explicit watcher refresh result; requests join that exact operation without waiting for the trust refresh. |
| High | `arkiv-reader.mjs:74–75`, `:68–70`, `decision-context.mjs:51–64` | Five-minute cache is rejected wholesale when stale, and every fresh read still calls two anonymous RPCs. Sequential trust work can consume 20 s before bundle access. Start frontend data work independently and immediately, use a local envelope plus shared block verification, bound request waiting to 1.5 s. Never use stale records as address-policy trust. |
| High | V2 §2.4; `arkiv-reader.mjs:40`, `:74` | Timeout says “none” while another row permits stale display. Define priority: after refresh timeout, an existing 5–60 min validated bundle remains display-only; otherwise none. At 60 min discard. Freshness of fetch, aggregate receipts, entity expiry and current block are distinct. |
| High | `relay.js:23–34`, `hook.js:444–473` | Worker currently responds once, relay strips safePage, hook only rejects and emits no ack. Worker cannot wait inside the original response callback for a message relay has not received. Return cancellation first, then use a separate nonce-bound ack message and persisted delivery intent. No ack means no automatic navigation. |
| High | `relay.js:3–18`, `hook.js:436–440` | Channel is hook/relay rendezvous, not page identity or a secret against MAIN-world code. Safe-page branch must run before wallet-channel dispatch and not require channel. Authorize with browser sender metadata and exact expected document URL; message possession never approves. |
| High | `sw.js:299`, `:350–354`, `:439–458`, `:61–69`; `hook.js:112–115` | Typed retry can be forwarded on timeout, popup failure, queue pressure or disable; hook also eventually forwards. Add a retry guard in hook before consuming, reject guarded request on expiry/transport failure, and make every worker finish path respect required typing. A flag only on final warning details is insufficient. |
| High | `shared/contracts/index.js:107–111`, `arkiv-reader.mjs:45–49` | Incident record has no active bit; old immutable incidents can outlive recovery. Require one current status linked by incidentReference to one unexpired incident key. Raw status, null pointer, orphan or duplicates do not corroborate. Retain existing status-only policy warnings separately. |
| High | `server/watcher/local-intake.mjs:85–86`, `:151–153` | Existing callbacks always deny incident/drift and timer flushes only pending reports. Wire real scope safety lookup, quarantine raw drift as well as corroborated drift, schedule maturity publication even with no traffic. Unknown safety never promotes. |
| High | `frontend-collector.mjs:18–29`, `sw.js:373–384` | Path truncation aliases distinct resources; coverage categories impossible from old shape. Canonical path validator shared across collection/intake/aggregate; reject overlong/private paths, count exclusions, preserve same-frame provenance. Bound total collector duration (currently 32 sequential 750 ms fetches). |
| High | `sw.js:189–205`, `:42`; v2 §4.1/4.4 | In-memory revision resets after worker restart; update events can fire multiple times per hop. Persist settings revision and exact navigation intent, validate on committed document, reconcile before serving tickets. Same-document navigation must not consume a ticket. |
| Medium | `shared/integrations/arkiv/archive.js:13–31`, `shared/integrations/arkiv/index.js:7` | New kind still lacks lifetime/writer/bundle support outside three named allowlists. Add all four paths and old-journal compatibility tests. |
| Medium | V2 §3.2, `shared/contracts/index.js:92` | Validator cannot infer configurable K/M from record. Fix frontend v1 constants, compare maturity at updatedAt, require timestamps <= updatedAt; consumers also reject future updatedAt. Select bounded entries by priority then sort by path/hash. |
| Medium | V2 §5; `settings.mjs:12–26` | Safe page has no specified RPC configuration, fragment cap or silent-load detection. Compile a public RPC/chain/owner allowlist into both builds; send READY through relay; timeout to packaged page on missing readiness. No arbitrary fragment-controlled network destination. |

These are source-derived design findings; external API/CSP behavior still requires phase-8/9 browser validation. Do not claim a live Arkiv or Bee compatibility result from this review.

## 3. Shared contracts and constants (normative for all phases)

New `shared/policy-core/frontend.mjs` exports `FRONTEND_K=3`, `FRONTEND_MATURITY_MS=3_600_000`, `FRONTEND_REPORT_WINDOW_MS=172_800_000`, `FRONTEND_DEDUPE_MS=86_400_000`, `FRONTEND_MAX_ROWS=128`. Put path/hash wire validators and identical constants in `shared/contracts/frontend.js`; policy imports/re-exports them to avoid divergent definitions. No frontend K environment override in v1; address corroboration K remains configurable and unchanged.

Other constants: `BUNDLE_FRESH_MS=300_000`, `BUNDLE_DISPLAY_MS=3_600_000`, `BLOCK_VERIFY_MS=30_000`, `FRONTEND_REFRESH_WAIT_MS=1500`, `COLLECT_MS=1200`, `MAX_SCRIPTS=32`, `SCRIPT_BYTES=2_097_152`, `INTAKE_BYTES=60_000` (UTF-8 bytes of complete JSON batch), `CANCEL_ACK_MS=500`, `NAV_COMMIT_MS=5000`, `SAFE_READY_MS=5000`, `TICKET_CREATED_MS=600_000`, `TICKET_APPROVED_MS=300_000`, `MAX_TICKETS=16`, `PHRASE="I UNDERSTAND"`. Expiry is exclusive: now >= deadline is expired. All injected clocks return nonnegative safe integer milliseconds; backward clock invalidates eligibility.

Exact local types (JSON unless stated otherwise):

```ts
type Coverage = {total:number, compared:number, inlineExcluded:number,
 queryExcluded:number, crossOriginExcluded:number, privatePathExcluded:number,
 unavailable:number, overCap:number};
type Evidence = {version:1, documentUrl:string,
 scripts:Array<{path:string,hash:string}>, coverage:Coverage};
type Conflict = {path:string, observed:string, expected:string[]};
type Community = {state:'fresh'|'stale'|'unavailable', fetchedAt:number|null,
 ageMs:number|null, verifiedAt:number|null, block:number|null,
 frontend:FrontendRecord|null, rawDrift:boolean, corroboratedDrift:boolean,
 activeIncident:boolean, ambiguous:boolean};
type Assessment = {comparison:'agree'|'conflict'|'unfamiliar'|'none',
 coverage:Coverage, conflicts:Conflict[], unfamiliar:Array<{path:string,hash:string}>,
 corroborated:boolean, redirectEligible:boolean,
 reasons:Array<'drift'|'incident'|'counterparty'>,
 dataState:'fresh'|'stale'|'unavailable', ageMs:number|null};
```

Coverage partitions total script elements: compared counts eligible successfully hashed elements, not unique paths and not only matching hashes. Sum of compared plus all exclusions/unavailable/overCap equals total. Duplicate elements may share a hash; dedupe comparison/report tuples only. A script with query/fragment is queryExcluded before cross-origin classification; inline first; over-cap counts all elements after first 32. Path rejection includes >256 characters, nonprintable ASCII, query/fragment delimiters, backslash, encoded slash/backslash, dot-segment/noncanonical URL forms. Require URL-normalized pathname equals supplied pathname. Decode each segment safely and reject any segment containing a 20-byte hex address with or without 0x, or >64 decoded characters; reject invalid percent encodings/control characters. Hash must round-trip canonical SHA-256 base64 (32 bytes; `sha256-` plus 44 base64 characters), not just match a permissive regex.

FrontendRecord is exactly v2 §3.2's object and script-row keys. Empty scripts allowed for withdrawal. `updatedAt` is publication time, not receipt freshness. All rows require >=2 reporters, firstSeen <= lastSeen <= updatedAt, lastSeen within 48 h of updatedAt, established iff reporters>=3 and updatedAt-firstSeen>=1 h. Consumers additionally discard rows whose lastSeen is >=48 h old at decision time, even if republished/renewed. No future timestamps allowed at receipt/consumption; structural validator uses updatedAt as time reference so historic journals remain readable.

All new runtime messages require `sender.id===chrome.runtime.id`. Content messages additionally require integer sender.tab.id, frameId=0 when redirect/ticket related, nonempty browser documentId, URL from sender, current committed document check, exact keys/types and bounded strings. Never accept tab/origin/return URL/chain supplied by a safe page. IDs are lowercase 32 hex characters (16 random bytes), not UUIDs; request IDs/digests retain existing formats. Relay channel is transport correlation only. No `externally_connectable` or `web_accessible_resources` addition.

## 4. Phase implementation specifications

### Phase 1 — semantics and tests

Create `shared/contracts/frontend.js`, `shared/policy-core/frontend.mjs`, `shared/policy-core/frontend.test.mjs`, `shared/contracts/frontend.test.js`. Modify `shared/policy-core/index.mjs` only to expose counterparty risk consistently. Keep score/verdict arithmetic byte-for-byte equivalent in meaning.

Exports:

```ts
isFrontendPath(value:unknown):boolean
isFrontendHash(value:unknown):boolean
validateFrontendRecord(value:unknown):boolean
assessFrontend({observed, record, k=3, maturityMs=3600000, now,
 drift=false, incident=false, counterpartyRisk=false, frame,
 dataState='unavailable', ageMs=null}):Assessment
// observed: Evidence|null; record: FrontendRecord|null;
// frame: {isTop:boolean, sameOrigin:boolean}; drift/incident are verified active flags.
frontendObservationCandidates({site,chain,observed,assessment,verdict,
 incidentStatus,action,rawDrift,incident,overrideUsed}):Array<{
 site:string,chain:string,kind:'frontend',path:string,hash:string}>
```

Reject non-v1 K/M rather than reinterpret established flags. Invalid input produces none/no redirect and zero or validated coverage; do not throw into wallet mediation. DataState unavailable always none. Stale can compare but never corroborate/redirect. Recompute established eligibility, don't blindly trust boolean. Conflict beats agree beats none only under the v2 rule: agree requires no unfamiliar. Corroborated iff fresh and one of drift/incident/counterparty true; redirectEligible additionally requires conflict, isTop, sameOrigin, no ambiguity. Caller must pass counterpartyRisk=false for connections. Candidates require `mayRecordObservation` plus all §3.3 gates, fresh community state and top/same-origin provenance; unique eligible tuples, maximum32. Inline bytes never hashed or reported.

`evaluate` returns `counterpartyRisk:boolean` on every return. Calculate with the same role/source/signer rules before early score returns: true only for verified decoded rights/destination/called entries lacking applicable trusted source or accepted lineage; exclude signer-owned destinations; tokens/unknown/unverified alone do not qualify. Require a usable policy context/baseline; unknown policy is not evidence of maliciousness. Do not derive from warnedAddresses. Tests cover amber untrusted called/destination cases, trusted role mismatch, trusted role match, signer, lineage, early grey/escalated/unsupported returns, unchanged scores.

Gate: `node --experimental-strip-types --test shared/contracts/frontend.test.js shared/policy-core/frontend.test.mjs shared/policy-core/index.test.mjs shared/policy-core/observations.test.mjs`.

Truth-table tests: zero/one/max evidence, partial coverage, weak competing hash, two established hashes, unseen path, ordinary deploy/no corroboration, each corroboration and raw drift negative, stale/missing/future/expired rows, iframe, malformed record, K/M boundary, every reporting veto. Non-goals: network, ticket routing, new score formula.

### Phase 2 — detectable demo and seeding

Modify `server/demo/hijack-server/server.js`, `server.test.js`; create `server/demo/hijack-server/seed-frontend.mjs`, `seed-frontend.test.mjs`; update its README. Extend `createHijackServer` without breaking existing mode/token/spender/scannerClean inputs. Serve `/app.js` with deterministic clean/attack bytes, JS MIME, `Cache-Control: public,max-age=60`, mode-specific ETag; `/` remains no-store and references that path externally. Clean mode has a user-click benign interactive request; passive eth_accounts does not generate reporting. Use trusted local demo request fixtures for normal/amber score so the existing reporting gate can pass. Attack still restricts signing to local chain 31337. Preserve scannerClean semantics for both HTML and asset or explicitly test consistent asset selection.

Export `seedFrontend({watcherUrl,site,chainId,scriptBytes,k=3,fetchImpl=fetch}):Promise<{hash:string,accepted:number}>`; only permit loopback intake and local demo site, use three clearly labelled generated demo reporter keys, validate exact intake batch and compute hash from served clean bytes. No timestamps supplied to intake and no backdating journal. CLI requires explicit site/chain/asset URL, fetches clean bytes, posts reports, prints earliest maturity time. Run >=1 h before demo (or use injected-clock fixtures for automated tests); promotion/publication must actually occur afterwards. Seed-only posting is not proof of automatic extension reporting.

Gate: `node --experimental-strip-types --test server/demo/hijack-server/server.test.js server/demo/hijack-server/seed-frontend.test.mjs client/extension/frontend-collector.test.mjs`. Unit test same-path bytes/hash differ using the real collector with a cache-only fetch double; phase10 must independently prove actual Chrome cache behavior and extension-generated clean reports. Negatives: attack assets not equal clean, query path not silently served as canonical asset, nonloopback seeding rejected, failed intake not counted. Non-goals: live wallet funds, backdated promotion, detector fixtures replacing collector.

### Phase 3 — contracts and reporting transport

Modify `shared/contracts/index.js` validateObservation/validateObservationBatch/validateRecord/validateBundle; `client/extension/observation-queue.mjs` enqueue/flush; `watcher-adapter.mjs` convert/sender; existing related tests. Import phase1 validators. Frontend intake exact keys are `{site,kind:'frontend',chainId,reporterKey,path,hash}`; old address variants retain exact keys/semantics. Frontend reporterKey printable ASCII 1–128 characters; frontend site <=253, chain positive safe integer. Reject extra `value`, URLs, timestamps or inline text.

Local queued frontend variant: `{site,kind:'frontend',chain,reporterKey,path,hash}`. Keep existing `enqueue(records,storage=chrome.storage.local,now=Date.now())` and `flush(send,storage=chrome.storage.local,batchSize=20)`. Export `toIntakeEvent(record)` from watcher-adapter (renamed convert, old behavior preserved), plus `encodeObservationBatch(records):string` used by both batch sizing and sender. Include wrapper in UTF-8 byte calculation; cap 100 events and 60,000 bytes, send longest fitting nonempty prefix. A single invalid/oversize item raises a diagnostic; never delete other queued records. Sender independently revalidates limit.

Storage: retain boundReporter `{week,key}`, boundObservationQueue array, boundObservationSeen timestamp map and existing generation keys. Add `boundObservationQueueVersion:2`. Serialize migration with enqueue/flush: preserve all valid legacy address entries and dedupe keys, introduce frontend keys JSON.stringify(['frontend',site,decimalChain,path,hash]); prune only frontend seen entries >=24 h old; address keys remain seven days. Normalize chain for frontend dedupe. Queue<=500, no truncation on migration; invalid existing data yields an explicit queue error, not silent loss. Failed sends leave exact prefix untouched. Retry idempotency is watcher tuple/reporter dedupe, not an exactly-once HTTP claim.

Gate: `node --experimental-strip-types --test shared/contracts/conformance.test.js shared/contracts/frontend.test.js client/extension/observation-queue.test.mjs client/extension/watcher-adapter.test.mjs client/extension/observation-dispatcher.test.mjs`.

Add cases to these filenames for mixed batches, restart migration, old address fields, namespaced dedupe, 24 h boundary, queue-full atomic failure, multibyte wrapper budget, lost response/retry, no extra-field forwarding. Non-goals: publishing individual frontend observations publicly on Arkiv, address dedupe migration to24 h.

### Phase 4 — durable aggregation / archive

Create `server/watcher/frontend.js`, `frontend.test.js`, `intake-router.js`, `intake-router.test.js`; modify `local-intake.mjs`, `shared/integrations/arkiv/archive.js`, `upsert.js`, `renewal.js`, `index.js` and their tests. Do not change old durable address-journal format (`durable.js:13–45`). Use a separate lock-protected `.bound/watcher-frontend-journal.json`.

```ts
openFrontendAggregator({path,now=Date.now,getScopeSafety,writeFrontend}):Promise<{
 intake(events:FrontendEvent[]):Promise<void>,
 publish():Promise<void>, prune():Promise<void>, close():Promise<void>,
 scopes():Array<{site:string,chainId:number}>
}>
// getScopeSafety({site,chainId}) -> Promise<{known:boolean,rawDrift:boolean,incident:boolean}>
// writeFrontend(record,id) -> Promise<UpsertResult>
createIntakeRouter({addressWatcher,frontendAggregator}):{
 intake(batch):Promise<{schemaVersion:1,result:'accepted'|'retry'|'rejected'}>
}
```

Journal exact schema `{version:1,lastNow,tuples,publications}`. Tuple `{site,chainId,path,hash,reporters:[{key,firstReceipt,lastReceipt}],quarantined:boolean}`; publication `{site,chainId,id,record,delivered:boolean}`. No raw script/URL/accounts. Reporter list unique/sorted by key; tuples sorted by site/chain/path/hash. Preserve firstReceipt across repeated same-key receipts while within48 h; retries within24 h do not change lastReceipt, a receipt after24 h may refresh it. Count keys with lastReceipt<48 h old; firstSeen=min(firstReceipt), lastSeen=max(lastReceipt) among counted keys. Remove expired reporters before maturity calculation. Never derive receipt time from page. Prune before capacity check.

Limits: 128 scopes, 256 tuples/scope, 128 reporters/tuple, 16,384 total reporter entries, 1,000,000 serialized journal bytes, 128 pending publications. Reject additions over capacity atomically; no eviction of established rows to admit attacker churn. Quarantined observations may be stored within these same caps but never promote; drop quarantined reporters on recovery, requiring new reports. Check safety at intake AND publication. Unknown status quarantines. Replace local-intake's constant-false callbacks with real extension-independent scope status resolver; declared local demo scopes can be explicitly operator-normal, never default all scopes normal. Do not overwrite known drift/incident with locally derived normal while publishing frontend data. Existing local status publisher (`local-intake.mjs:114–126`) needs this same safety barrier; no fabricated corroborated drift from frontend mismatch.

`createIntakeRouter` validates whole batch before splitting, routes address events through existing durable intake and frontend through new journal. Partial persistence + HTTP retry is safe because both paths dedupe; don't promise cross-journal atomicity. Accepted only after both persisted; failures return retry/503 (update local-intake's current accepted/otherwise400 mapping), invalid whole batch rejected/400. Never log reporter keys or whole rejected payloads (`local-intake.mjs:217–223`).

Publication chooses established rows first, reporter count desc, lastSeen desc, path/hash asc ties; take128 then sort path/hash asc for serialization. Drop rows until<=61,440 bytes. Durable outbox stores exact record, updatedAt and SHA256 canonical operation ID before network write. Retry byte-identical IDs/records; don't regenerate updatedAt on lost acknowledgement. Record delivered only after archive readback. Republish hourly (3,600,000 ms) including maturity and withdrawal transitions when idle, also publish after intake using existing serialized flush scheduling. Startup resumes pending publications, then recomputes; hourly prune+publish and renewal share serialized archive queue; one coalesced follow-up at most. Do not refresh receipt times during publish/renew. Publish empty aggregate when last previously published tuple expires.

Add archive `writeFrontend(record,id)` analogous to writeEnsRecord -> upsert.write; extend upsert and renewal validRecord lists and queryBundle allowlist. `recordLifetimes.frontend=lifetimes.frontend??lifetimes.baseline`, validated >renewBeforeBlocks and <=7,884,000; local config explicitly43200 blocks. Reject older frontend updatedAt replacing newer record. Preserve old journals and nonfrontend config defaults.

Gate: `node --experimental-strip-types --test server/watcher/frontend.test.js server/watcher/intake-router.test.js server/watcher/durable.test.js shared/integrations/arkiv/upsert.test.js shared/integrations/arkiv/renewal.test.js shared/integrations/arkiv/archive.test.js` (create archive test if absent). Cases: K-1/K, exact maturity, same-key replay, time reversal, 48 h retirement, unknown/drift/incident quarantine, recovery cannot promote quarantined history, hourly idle promotion, bounded caps, crash after network write, partial mixed intake retry, old journals, frontend upsert/renew/bundle. Live Rabdi readback is an integration gate with configured owner credentials; no paid operation during this review. Non-goals: Sybil proof, shortening maturity, using address reporter window for frontend.

### Phase 5 — reader / decision context

Modify `arkiv-reader.mjs`, `trust-adapter.mjs`, `decision-context.mjs`, corresponding tests; create `client/extension/frontend-context.test.mjs`. Keep existing reader API for policy callers; add:

```ts
// methods of createArkivReader:
refresh():Promise<{ok:true,fetchedAt:number}> // rejects failure; coalesced
readCommunityCache({site,chain,now}):Promise<Community> // storage only
ensureCommunity({site,chain,budgetMs=1500}):Promise<Community>
verifyBundleBlock():Promise<{block:number,verifiedAt:number}> // shared whole-network check
// decisionAdapters exports corresponding methods:
refreshWatcherBundle():Promise<{ok:true,fetchedAt:number}>
readFrontendCommunity({site,chain,budgetMs=1500}):Promise<Community>
// new export from decision-context:
readFrontendContext({siteOrigin,chainId,watcherOwner,adapters,now=Date.now()}):Promise<Community>
```

Single-flight keyed by normalized `{arkivRpcUrl,arkivChainId,watcherOwner}`; set promise synchronously before first await, clear in finally only if still same promise. Refresh reads chain ID, whole owner bundle and current block, checks monotonic block, validates all envelopes and total bounds, saves only if settings key still matches. A superseded operation must not overwrite new settings' cache. Direct reads are whole-bundle/background, not site RPC. Retain `decisionAdapters.refresh()` for startup bulk `allSettled`, but request path joins refreshWatcherBundle, not that aggregate.

Migrate boundWatcherBundle to `{version:2,owner,url,chainId,fetchedAt,block,verifiedAt,records}`; old v1 causes refresh rather than being silently treated verified. `verifyBundleBlock` coalesces one anonymous chain/block verification for all callers, persists verifiedAt and monotonically increasing block, reuses for30 s. On verify failure frontend state unavailable unless original cache qualifies for stale display. `readCommunityCache` has zero network; fresh requires bundle age<5 min, verifiedAt age<30 s, matching settings, valid envelopes, entity expiry>verified block. Map expiry horizon conservatively with existing30 s decision lifetime. At point of routing recheck now/freshness; crossing boundary disables redirect.

ensureCommunity starts missing/stale refresh or needed block verification immediately; race at1500 ms without aborting background operation, swallow/record later rejection, then reread local state. Old5–60 min valid data returns stale display even if refresh timed out; no data/age>=60 min/future clock/settings mismatch returns unavailable. Whole refresh hard bounds: 8 MB aggregate response bytes, 256 pages of32, 30 s total AbortController deadline; one pagination restart on changed block inside the same bounds. Network errors cannot become fresh empty baselines.

Map frontend and incident metadata including entity key, owner, expiresAt, fetchedAt/block. Exactly one frontend and one status per site/chain; duplicates make scope ambiguous. Drift requires unique drift with detectedAt==status.updatedAt AND corroborated true AND status drift. Incident active requires unique status incident whose nonnull incidentReference equals unique incident entity key (normalize0x format only as contracts require); no orphan counts. Receipt TTL filtering applies independently of bundle fetch age.

Start frontend read before verified snapshot attempt; `createDecisionContext` returns `frontendCommunity` on every early return, including invalid/missing trust snapshot, without supplying any new policy sources/baseline. Worker may also invoke readFrontendContext directly for connections; share same cached operation. Keep legacy incidentStatus semantics for ordinary address warnings; use new activeIncident only for frontend gate. For iframe frontend assessment pass originating frame URL scope and sameOrigin=false relative top when different; never attribute frame scripts to top site.

Change readPreconnectionSiteStatus at `decision-context.mjs:180`: try fresh bundle first, including empty valid result (negative cache). Fallback anonymous full query only if no usable bundle; coalesce fallback across concurrent navigation requests, whole-owner result cached, never query per-tab. `sw.js:551` refreshOpenSiteStatuses must reuse the just-fetched bundle. Existing anonymous uncurated policy path is unchanged except sharing safe whole-owner reads; do not broaden trust.

Gate: `node --experimental-strip-types --test client/extension/arkiv-reader.test.mjs client/extension/decision-context.test.mjs client/extension/frontend-context.test.mjs client/extension/trust-coalescing.test.mjs`. Test concurrent starts one download, same in-flight join,1500 ms timeout/background completion, stale display precedence,30 s/5 min/60 min boundaries, snapshot early return, owner/chain/expiry/future/duplicate violations, settings race, empty cache zero per-navigation RPC, orphan/recovered incident, mismatched drift timestamp, total pagination budgets. Non-goals: new ENS trust or frontend network requests per site.

### Phase 6 — warning-only integration

Modify `frontend-collector.mjs`, `sw.js` handleRequest/readFrontendEvidence/enqueueCurrentObservation/handleWarningMessage/finish, `warning.js`, `warning.html`, `build.mjs`; add `frontend-routing.mjs`, `frontend-routing.test.mjs`, `warning-integrity.test.mjs`; extend collector and worker tests.

Export `applyFrontendWarning({details,assessment,overrideUsed=false}):object` pure function from frontend-routing, returns copied details with frontendIntegrity assessment, severity tier=max(existing,huge) for conflict, `requireTypedConfirmation=existingFlag || verdict==='escalated' || overrideUsed`. Tier order pass<warning<huge<firewall; transaction details gain same tier field without rewriting score/verdict. UI heading/style uses tier for transactions as well as connections; explain conflict and coverage, stale age, all documented blind spots. Only textContent for evidence paths/hashes. None says “Community data unavailable: scripts not compared”; agree says “the observed subset agrees (n of m scripts compared)”. No green verified badge.

Collector returns Evidence instead of old labels/source objects. Process first32 with at most4 concurrent cache-only fetches; total deadline1100 ms, per fetch<=750 ms; abort pending fetches at deadline, finish missing elements as unavailable. Preserve2 MiB streaming byte cap. Skip inline without reading text. Reject path before fetch; `documentUrl` local-only provenance. Runtime BOUND_COLLECT_FRONTEND_V1 unchanged exact `{type}`; response bound total coverage<=100000 and serialized evidence<=32 KB; collection overflow => unavailable. Validate sender extension ID in collector; worker targets sender.documentId and validates returned documentUrl against browser sender URL. No hashes/bytes from DOM message accepted as authoritative without this isolated collector.

Start collector and readFrontendContext concurrently before both connection/transaction branches; policy lookup proceeds separately. Passive/malformed/unsupported/invalid-state paths do not report or redirect. Capture assessment in pendingObservations. At actual BOUND_FORWARDED_V1 receipt re-read current context, re-assess same frozen evidence, require original and current gate, same document and no override use. Extend connection forwarding receipts too, so clean connection can train without an artificial transaction. No frontend enqueue on warning display, cancel, timeout-forward, conflict, iframe or missing fresh safety status. Address observations retain existing privacy filters.

Build copies frontend.mjs/contracts validator dependencies (or bundle new routing modules) and adjusts package import paths. Add new warning row in HTML. In phase6 redirects remain disabled; ticket-dependent overrideUsed defaults false. Typed flag must already be worker-enforced in handler and used by UI; phase8 guard closes pre-consumption hook timeout loophole. Required-typed pending entries cancel on deadline/UI failure/monitoring stop, never finish forward; reject missing/wrong phrase regardless verdict. Do not change ordinary fail-open entries.

Gate: `node --experimental-strip-types --test client/extension/frontend-collector.test.mjs client/extension/frontend-routing.test.mjs client/extension/warning-integrity.test.mjs client/extension/sw.test.mjs`. Cases both paths, score unchanged, conflict at least huge, stronger severity preserved, stale display, partial subset, old evidence schema rejected,32-cap, inline/query/private path, all reporting vetoes, original conflict cannot train after data changes, required typing with amber verdict, ordinary timeout unchanged. Non-goals: enabling redirects, emitting observations before wallet-forward receipt, interpreting refetch as executed bytes.

### Phase 7 — ticket store and private confirmation

Create `client/extension/ticket-store.mjs`, `ticket-store.test.mjs`, `confirm.html`, `confirm.mjs`, `confirm.test.mjs`; modify sw.js/manifest/build. Session storage remains TRUSTED_CONTEXTS; do not grant content scripts storage access.

```ts
createTicketStore({storage,now=Date.now,randomBytes}):{
 create(input):Promise<Ticket>, get(id):Promise<Ticket|null>,
 transition(id,from,to,patch={}):Promise<Ticket>,
 approve({id,phrase,sender}):Promise<Ticket>,
 consume({tabId,documentId,topOrigin,chainId,comparison,settingsRevision,
 requestId,digest,stateDigest}):Promise<Ticket|null>,
 removeTab(tabId):Promise<void>, invalidateSettings(revision):Promise<void>,
 reconcile({getTab,getFrame}):Promise<void>
}
```

Storage keys `boundFrontendTickets:{version:1,tickets:Ticket[]}`, `boundSettingsRevision:number` (session, initialized once), `boundFrontendOverrideDocs:{version:1,entries:[{tabId,documentId,expiresAt}]}`. Ticket exact fields: `{id,state,tabId,topOrigin,returnUrl,chainId,kind,display,settingsRevision,createdAt,approvedAt:null|number,consumedAt:null|number,requestBinding:null|{documentId,requestId,digest,stateDigest},sourceDocumentId,safeUrl,expectedHop:null|{stage,url,fromDocumentId,deadline},safeDocumentId:null|string,confirmDocumentId:null|string,returnDocumentId:null|string,delivery:null|{requestId,digest,stateDigest,nonce,expiresAt,acked:boolean}}`. Display exactly `{score,tier,comparison,coverage,conflicts,reasons}`; bounded by fragment caps phase8. kind is audit metadata; it does not restrict connection vs transaction retry. chainId canonical decimal string, origin exact URL.origin including scheme/port. returnUrl browser-captured full top URL, HTTPS or loopback; never return to extension/safe page. Do not persist wallet payload/accounts in ticket.

All mutations through one promise chain loading latest session state; save before returning successful transition. If write uncertain, no authorization and fail closed for that ticket until reconcile. Cap16 after expiry prune; don't evict valid tickets. At most one live ticket per tab; creating a different one invalidates prior. State transitions created->at_safe_page->confirming->approved->consumed only, plus deletion on expiry/invalidation. consumed tombstone survives until original max expiry to reject replay. Effective expiry=min(createdAt+10 min,approvedAt+5 min if approved). Settings changes increment persistent revision serialized before invalidating tickets. Initial revision does not reset on restart.

ExpectedHop persisted BEFORE tabs.update; exact expected URL and previous document must match top-level onCommitted; only then bind new document and clear intent. Handle duplicate onUpdated without deleting ticket. Same-document changes don't count as new commits, but navigation away from permitted URL must invalidate safe/confirm state. Unexpected redirect, tab reuse, reload after approved return, wrong chain, unrelated navigation => no ticket. Startup reconcile checks actual tab/frame URL/document vs state/intent; uncertain created cancellation or half-hop is deleted, never promoted; confirmed safe/confirmation document can resume. Race new navigation after approve persistence cannot reuse ticket in another document.

Runtime messages exact:

- `{type:'BOUND_TICKET_GET_V1',ticket}` -> `{ok:true,display,expiresAt}` or `{ok:false}`.
- `{type:'BOUND_TICKET_APPROVE_V1',ticket,phrase}` -> `{ok:true}` only after approved persisted and return navigation scheduled; otherwise `{ok:false,error:'expired'|'invalid_sender'|'confirmation_required'|'unavailable'}`.

Both accept only same-tab frame0 private extension confirm.html, exact hash ticket and bound confirmDocumentId, state confirming/current revision. Never send display to remote safe page via GET. Confirmation requests authoritative worker display immediately, disables button until exact phrase, no innerHTML/inline JS/form navigation. `frame-ancestors 'none'` added to explicit extension_pages policy alongside script-src self/object-src self; add runtime `self===top` check before rendering/approval as defense in depth and test actual browser embedding denial. No WAR entries. Build copy ticket module and confirm assets.

Gate: `node --experimental-strip-types --test client/extension/ticket-store.test.mjs client/extension/confirm.test.mjs client/extension/settings.test.mjs`. Tests reload store instance (worker restart), wrong tab/frame/URL/document/chain/revision, bad phrase, out-of-order/repeated transition,10/5 min boundaries, two parallel consumes exactly one, storage write rejection, cap16, expected vs unrelated navigation, restart during each hop, no page-controlled returnUrl. Non-goals: resume canceled request, durable authorization across browser restart, approving from remote page.

### Phase 8 — cancellation, navigation, safe page

Create `client/extension/frontend-redirect.mjs`, `frontend-redirect.test.mjs`, `relay-protocol.test.mjs`, `hook-cancel.test.mjs`, `client/safe-page/src/{index.html,app.mjs,fragment.mjs,community.mjs}`, `client/safe-page/{fragment.test.mjs,community.test.mjs,build.mjs}`. Modify hook/relay/sw/settings/options.html/options.mjs/manifest/build. Safe build produces remote dist/index.html+app.js and packaged safe.html+safe.js; extension build invokes common build code. No remote scripts inside extension, no inline executable scripts. Compile fixed public RPC URL+chain and allowed watcher owners into safe bundle via build input; do not embed API keys.

```ts
createFrontendRedirect({api,tickets,now=Date.now}):{
 begin({sender,requestId,digest,stateDigest,details,assessment,chainId,
 settingsRevision,safePageUrl}):Promise<object|null>,
 acknowledge(message,sender):Promise<{ok:boolean}>,
 handleNavigation(details):Promise<void>, resume():Promise<void>
}
parseSafeFragment(hash:string):SafeEvidence|null
encodeSafeFragment(evidence:SafeEvidence):string
querySafeCommunity({rpcUrl,watcher,chainId,site,fetchImpl=fetch,now=Date.now}):Promise<Community>
```

Settings: safePageUrl default empty means packaged only. Normalize HTTPS or HTTP localhost/127.0.0.1/[::1], no userinfo/query/hash, path retained exactly; reject other schemes, remote HTTP. Persist configured exact safe URL and settings revision into ticket. Compare full expected pathname as well as origin for safe handoff: shared Swarm gateway origins serve arbitrary content. No page may change safePageUrl via runtime messages. options settings-change path invalidates outstanding tickets.

**Cancellation protocol, separate from original runtime response:** begin verifies fresh top-frame same-origin conflict+corroboration, current document, no approved ticket, capacity and settings. Persist created ticket, safe URL/fragment and delivery with random nonce. Returns original worker result `{action:'cancel',digest,stateDigest,safePage:true,ticket,cancelNonce}`; null means ordinary warning flow. Relay retains originating id/channel/digests, registers ack waiter BEFORE posting decision with these fields and id. Hook validates id/channel/digest/stateDigest and safePage===true, deletes waiting entry and timer, rejects original request4001, then posts `{type:'BOUND_CANCEL_DELIVERED_V1',channel,id,digest,stateDigest,ticket,cancelNonce}`. Only emit after actual cancellation; duplicate decision emits nothing. Relay correlates every field to its pending decision; sends same ack WITHOUT channel via runtime. Worker validates browser sender to persisted sourceDocumentId/tab/frame and all delivery fields, atomically marks acked; page ack is delivery telemetry only. Then rechecks currentDocument and initiates exact safe hop.500 ms missing ack: delete ticket, no navigate, never forward canceled request or report it. User may retry normal warning; no hidden restoration of original request. Worker restart before ack: delete unacked intents; after persisted ack reconcile source document then resume navigation at most once. No two responses to original sendMessage.

**Typed retry protocol:** before consume, send document-targeted content command `{type:'BOUND_RETRY_GUARD_V1',id,digest,stateDigest,nonce}`. Relay receives this through a separate chrome.runtime.onMessage listener, accepts only extension-owned sender.id and the worker command shape, and posts it to hook on its channel; hook matches waiting item, switches its timeout/transport-failure behavior to reject4001 and posts `{type:'BOUND_RETRY_GUARDED_V1',channel,id,digest,stateDigest,nonce}`. Relay forwards ack through runtime; worker validates current source and nonce, waits<=500 ms. Keep the runtime command response and the hook ack separate: relay forwards BOUND_RETRY_GUARDED_V1 as a new runtime message, with channel removed. Only after guard ack may atomic consume persist requestBinding and override-document marker. No ack => do not consume; cancel this attempted retry, invalidate ticket if document changed. Guard cannot authorize forwarding. Ignore any later plain continue unless worker decision for same request has `typedApproved:true` (set only after phrase validated). Relay carries it. Hook rejects guarded timeout, worker disconnect, cancellation; only exact bound continue+typedApproved forwards frozen request once. Guard is advisory against page spoofing just like current bridge, not a new malicious-MAIN-world trust guarantee. Worker separately enforces typing, which remains authoritative. Never downgrade a guarded request to readOnly fail-open when rate cap/popup open fails/monitoring disables. Ticket lookup must precede rate-cap forward shortcut. Store consumed before warning; failure afterwards requires a new authorization, no refund/replay. Use no kind equality check: first eligible interactive top request same chain with conflict consumes even if authorization was triggered by another request kind. Retry with agree/none leaves approved ticket until expiry; unrelated committed navigation invalidates it. No consumption by passive reads, iframes or malformed requests. Approved return document binding survives worker restart.

**Navigation and readiness:** register listeners before initiating; persist expected hop then tabs.update. frame0 commit to expected URL changes created->at_safe_page and binds document; onError/5 s no commit falls back once to packaged safe.html with same fragment, using new exact intent. After remote commit require `{type:'BOUND_SAFE_READY_V1',ticket}` within5 s or fallback (covers HTTP200 error HTML/missing JS). Ready and confirmation messages require exact browser sender document URL, configured origin+path, ticket.tabId/frame0/safeDocumentId/state/expiry/revision. Ready alone only cancels readiness timer. Persist deadlines; use alarms `bound-safe-commit:<ticket>` and `bound-safe-ready:<ticket>` plus in-memory timers, reconcile overdue deadlines at worker start because alarms may wake late. Local fallback failure leaves canceled request and ticket inaccessible with diagnostic; no recursion and no wallet forward.

Remote page sends exact `{type:'BOUND_SAFE_READY_V1',ticket}` / `{type:'BOUND_SAFE_CONFIRM_V1',ticket}` via window.postMessage to location.origin. Relay accepts same-window/same-origin and strict32hex ticket before forwarding, independent of hook channel. Worker does actual authorization. Packaged safe uses runtime.sendMessage directly, same types; require exact extension safe.html URL and tab/frame/document. CONFIRM atomically transitions to confirming with expected private URL before navigation. Duplicate CONFIRM never opens multiple pages. Safe page cannot approve. Confirm approval uses stored return URL only. Leave navigates to about:blank, invalidates ticket, does not consult fragment return data.

Fragment exact keys `{v:1,site,chain,score,sev,reason,conflicts,unfamiliar,cov,ticket,watcher}`. chain decimal string; score null or integer0–100, sev tier enum, reason unique known corroboration strings, conflicts<=16 paths/observed/expected<=4 hashes each, unfamiliar<=16 path/hash rows, cov Coverage, watcher lower20-byte address, ticket32hex. URL-encoded JSON UTF-8 decoded bytes<=16,384, encoded hash<=65,536 characters, strings/path/hash use shared validators. Truncate display arrays before encoding; when an array reaches its cap, show “This view may omit rows; complete evidence is held by your extension.” Do not invent an omitted count from coverage, and never treat the fragment as the full assessment. Reduce arrays further until the byte cap fits, preserving the same notice whenever capped. Validate duplicate JSON keys, no unknown keys/prototype copying. App reads/parses once inside try/finally and immediately clears fragment via history.replaceState even on invalid input; no logging/storage. Invalid evidence renders neutral error, disables confirm, no live query. Text-only evidence separated from independently fetched data; warn on disagreement without changing extension ticket.

Safe query uses v2 expression with owner, schema and four-kind filter; add key cursor and chain ID verification. Fixed RPC from build config (allowlisted HTTPS or local demo); watcher must be in compiled allowlist. Page size4, maximum64 pages,256 rows,4 MB cumulative bytes,1 MB per response,8 s total including one retry from page1 on changed block,500 ms retry delay. Enforce streaming limits/status/MIME/JSON-RPC IDs, owner/key ordering/duplicates/expiry/validateRecord, filter site+chain locally. Unrelated valid scopes ignored; invalid rows fail live view. Same ambiguity/linkage/freshness rules as phase5; never create trust from text claims. Refuse arbitrary RPC URL/owner from malformed fragment. CORS failure renders extension evidence + “from your extension; live community data unavailable”. No localStorage/cache/third-party assets. Controls remain usable on network failure.

Gates: `node --experimental-strip-types --test client/extension/frontend-redirect.test.mjs client/extension/relay-protocol.test.mjs client/extension/hook-cancel.test.mjs client/extension/ticket-store.test.mjs client/safe-page/fragment.test.mjs client/safe-page/community.test.mjs client/extension/settings.test.mjs`. Negative cases: omitted digests/id/nonce, wrong ack/channel/document, ack before cancel, timeout no navigate, duplicate ack, source navigation mid-cancel, missing remote JS, fallback once, READY from wrong gateway path, channel-less legitimate safe page, spoofed safe messages, typed retry popup failure/rate cap/worker restart, second retry cannot consume, fragment XSS/private paths/oversize/duplicate keys, RPC oversized stream/block churn/unlinked incidents. Browser gates in phase10 verify actual CSP, cache and cancellation before commit. Non-goals: cryptographic authentication of hostile page MAIN-world messages, remote code in extension, trusting fragment as ticket state.

### Phase 9 — manual / owner-gated Swarm publication script only

Create `scripts/swarm/publish-safe-page.mjs`, `publish-safe-page.test.mjs`. Implement/import-safe API `publishSafePage({directory,beeUrl,batchId,fetchImpl=fetch,dryRun=true}):Promise<{reference:string|null,url:string|null,files:string[]}>`. CLI defaults dry-run; explicit `--publish` is necessary for upload. Only prebuilt remote dist permitted; exactly index.html/app.js plus declared local assets, all paths bounded, no symlinks/traversal, no private files; validate external JS/CSP and absence of third-party resources. A single immutable website manifest upload with index.html, no feeds or mutable updates. Require explicit pre-funded immutable postage batch ID and Bee endpoint; no node provisioning, buying postage, swaps or token transfers. Endpoint credentials from private environment only, never printed. Validate returned64hex reference; print immutable reference and configured HTTPS gateway release URL, no automatic settings edits.

Implementation must verify Bee API/version against the funded owner node before finalizing HTTP request headers/manifest format; script should check compatible health/version and fail with an actionable error rather than guess. Tests mock the validated protocol and force dry-run zero POST. This review intentionally does not specify an unverified Bee wire API as fact. Live publication is manual/owner-gated: funded Bee plus xBZZ/xDAI and explicit upload authorization required. Creating/testing script is within implementation scope; actual funding/upload is outside autonomous batches. Validate served MIME/relative JS path/CORS-compatible Arkiv endpoint and extension redirect on that exact release URL, then owner sets safePageUrl.

Gate: `node --experimental-strip-types --test scripts/swarm/publish-safe-page.test.mjs`; `node scripts/swarm/publish-safe-page.mjs --directory client/safe-page/dist --dry-run`. Mock negatives: malformed batch ID, bad Bee reply/reference, unsupported API, missing index, traversal/symlink, extra secret file, upload failure, dry-run no writes/network mutation. Do not run script/build in this planning review. Non-goals: owning Bee funds, automatic postage creation, Swarm feed/ENS changes.

### Phase 10 — end-to-end / failure matrix

Create `client/extension/e2e/frontend-mismatch-check.mjs`, `frontend-mismatch-check.test.mjs`; modify browser harness only if required, preserving existing entry points. Export `runFrontendMismatchChecks({extensionPath,baseUrl,arkivFixtureUrl,launchBrowser,now}):Promise<{passed:number,failed:number}>`; CLI uses same installed Playwright/browser-path workflow as existing e2e scripts. Test fixture time injection only in explicit test harness, never a production bypass of maturity/typing. Browser scenarios exercise actual built extension; stage build permitted for implementer, not during this review.

Use request/forward/cancel counters in a fake provider and record committed browser URLs without sensitive fragments in logs. Mandatory clean fixture must first generate real collector reports via forwarding receipt, then reach K/age using controlled watcher test clock. Seed helper only for owner live demo. Scenarios: clean/partial agreement; same-path uncorroborated attack warning; each corroborated source including amber called risk; top redirect4001 before safe commit, zero wallet forwards; private confirmation rejects wrong phrase, returns stored URL; retry new frozen payload, typed required despite amber score, one wallet forward; parallel retries and replay; iframe conflict warnings and no top training; live Arkiv down with fresh cache vs missing/stale;1.5 s join timeout with background completion; worker restart in safe/confirm/approved/consumed/ack windows; missing safe JS, HTTP200 error, navigation failure fallback; unrelated navigation/settings change; wrong chain/sender/path; source byte mutation/digest mismatch; fragment XSS/budget/privacy; anonymous site-status query count stays zero with usable bundle; CSP embedding refusal. Required-typed timeout/UI failure never forwards. All existing address-policy severity and observation privacy cases retained.

Gates after implementation: `node --experimental-strip-types --test client/extension/e2e/frontend-mismatch-check.test.mjs` then `node client/extension/build.mjs`, `node client/extension/e2e/frontend-mismatch-check.mjs` and existing `node client/extension/e2e/no-popup-check.mjs` where environment prerequisites are configured. Browser integration may write artifacts during implementation only. Live Swarm URL case waits for phase9 owner setup; packaged+mock HTTPS cases must pass independently.

Pre-existing failures explicitly excluded from completion claims: `client/extension/trust-engine.test.mjs` has six stale Swarm-fixture failures; `client/extension/sw-fake-integration.test.mjs` hangs. Do not include either in unbounded broad globs or claim they pass. No macOS `timeout` dependency. Use test-specific Node timeout where supported or a harness spawning process with `{timeout:60000,killSignal:'SIGTERM'}` and SIGKILL escalation after2 s; exit nonzero on deadline. New tests must close timers/servers/browser in finally. Skip only missing live funding/browser prerequisites explicitly, never a failed security assertion. Non-goals: unrelated fixture repairs, performance benchmark campaign, deployment/publication in CI.

## 5. Delegation batches and review boundaries

Each batch is independently testable and one focused commit (or multiple atomic commits if reviewer requests). Batches are serial; do not concurrently edit shared sw.js/contracts/build files. This document itself delegates no execution.

1. **A — contracts and detector primitives (phases1–3).** Pure semantics, detectable demo, transport and migration. Reviewer checks truth table, privacy path validator, fixed K/M, exact wire keys, compatibility and serialized-size batch limits. Run phase1–3 gates. No redirect/UI authorization code enabled.
2. **B — watcher and cache (phases4–5).** Durable aggregation, real quarantine, archive support, coalesced bounded reader, independent frontend context and bundle-first statuses. Reviewer checks persisted replay behavior, idle maturity/withdrawal, no false normal overwrite, owner/expiry/ambiguity validation and zero per-navigation full-query amplification. Run4–5 gates plus contracts/queue regressions. Live Rabdi readback pending only if credentials absent; report it explicitly.
3. **C — warning UI and ticket authority (phases6–7).** Collection on both paths, evidence display, reporting gates, worker typing, durable ticket/confirmation scaffolding. Redirect remains disabled. Reviewer checks score preservation, all reporting vetoes, private sender checks, restart/expiry/concurrency and navigation intents. Run6–7 gates plus collector/context regressions. Ticket scaffolding does not imply a usable override until D.
4. **D — complete security flow and browser verification (phases8,10).** Relay/hook cancellation+guard protocols, safe app/fallback, worker routing and complete failure matrix. Reviewer checks no wallet call before fresh frozen retry, no timeout bypass of typing, exactly-one consumption, delivery-before-navigation, path-bound handoff and restart/failure behavior. Run8/10 gates and all earlier focused suites. Enable redirect only once these pass. Commit is independently usable with packaged page and local/mocked remote safe page; live Swarm not required.
5. **E — publication tooling (phase9, manual release after D).** Script and mock tests committable without funds. Reviewer checks dry-run default, immutable artifact boundaries, exact Bee compatibility verified before upload, no automated funding/settings mutation. Owner funds node/authorizes immutable upload and performs live gateway acceptance; record release reference, owner-selected URL and pending live checks. Do not mark manual publication complete from a passing script test.

No changes to Solidity, wallet transaction execution policy, ENS release manifests, chain deployment, or score arithmetic are required. No Foundry/Slither gate applies to this frontend/watcher-only implementation.
