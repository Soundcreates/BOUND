# Domain-global Swarm evidence cache — implementation amendment

Date: 2026-11-06. Status: ready for implementation; this document is the only workspace file changed by this design task. This amends `Docs/frontend-mismatch-swarm-implementation.md`, principally phase 5, without replacing its detector, warning, cancel/redirect, or private confirmation protocols. The latest user correction selects a **domain URL**, not a user address, as the shared cache key. There is no wallet-cache implementation requirement.

## 1. Small complete slice and trust boundary

Implement **L1 persistent extension-local storage → L2 signed Swarm domain feed → L3 existing fresh ENS/Arkiv verification** for public frontend/community evidence. All profiles configured with the same publisher derive the same feed from a domain's canonical origin. The JSON contains chain-scoped public baseline evidence, script fingerprints, policy-anchor metadata, source expiry and an explicit TTL. Repeated transactions reuse that evidence, while the worker recollects the current document's scripts and runs current local policy and assessment every time.

The first slice caches frontend/community evidence and a public policy-anchor fingerprint. It does not import remote address-policy trust rows, replace the trust engine, or cache evaluated scores/verdicts. Existing ENS-root/snapshot verification remains the source of address-policy trust; a signed Swarm claim is not an ENS proof. A cache hit avoids another frontend/community bundle fetch when its existing block-verification lease is usable. If a current policy anchor is required but absent, obtain it through the existing trust engine; do not claim that Swarm removed that necessary verification.

Use one owner-controlled **publisher CLI/job**, not a new browser-facing upload service. The job reads configured ENS/Arkiv sources itself, creates an allowlisted public projection, uploads its JSON, and updates the domain's feed using a dedicated operator signer and prepaid postage. Browsers automatically read feeds; they never send evidence, arbitrary JSON, wallet information, keys, or upload requests to the publisher. A new site gets L3 fallback until the operator adds its origin to the publisher's bounded allowlist. That is a defined first-slice coverage limit, not a fake remote cache.

TTL is bounded staleness, matching the existing five-minute community cache. There is **no mandatory online signed-head service**. A valid signed update can be older than another valid update within its TTL, particularly for a new profile without a watermark. This is accepted cache behavior, not a claim of globally latest status. A signature authenticates the publisher and bytes, not absence of newer updates. See §5 for rollback handling.

Preserve all existing local ticket/approval and typed-retry rules. Neither L1 nor L2 stores an approval, ticket, authorization, original wallet request, account array, private return URL or completed decision. Do not restore or reopen the completed provenance-stub work.

## 2. Verified Swarm API basis

Research was read-only: official documentation, npm metadata/tarballs, and upstream source downloaded into `/tmp`. No Bee writes, postage purchases, key setup or live compatibility test were performed.

- The requested `https://docs.ethswarm.org/hosting-and-retrieval/feeds/` returned HTTP 404. Its current official replacement is [Feeds](https://docs.ethswarm.org/docs/develop/tools-and-features/feeds). Feeds comprise predictable Single Owner Chunks (SOCs), addressed by publisher owner plus topic; editing requires the publisher's Ethereum keypair.
- npm's current `@ethersphere/bee-js` was **13.2.0**, git head `549318851eb60f91ad249acad8431ffc2cf86773`. Its package declares Bee **2.8.3**, Bee API **8.2.0**, and `@ethersphere/core-sdk ^0.2.2`. Pin `bee-js: 13.2.0` and the directly used `core-sdk: 0.2.2`, with lockfile integrity; do not implement from old `bee.makeFeedWriter(...)` examples. Core SDK requires Node >=22; use the repository's supported current Node runtime.
- Verified [Bee JS feed module](https://github.com/ethersphere/bee-js/blob/549318851eb60f91ad249acad8431ffc2cf86773/src/modules/feed.ts), [feed implementation](https://github.com/ethersphere/bee-js/blob/549318851eb60f91ad249acad8431ffc2cf86773/src/feed/index.ts), [feed identifier](https://github.com/ethersphere/bee-js/blob/549318851eb60f91ad249acad8431ffc2cf86773/src/feed/identifier.ts), and [SOC implementation](https://github.com/ethersphere/bee-js/blob/549318851eb60f91ad249acad8431ffc2cf86773/src/chunk/soc.ts). The exact-index reader downloads `/chunks/{address}` and validates the raw SOC; the latest-feed response alone does not perform that client-side validation.
- Verified release-pinned [Bee 2.8.3 OpenAPI](https://github.com/ethersphere/bee/blob/v2.8.3/openapi/Swarm.yaml), [common schemas](https://github.com/ethersphere/bee/blob/v2.8.3/openapi/SwarmCommon.yaml), [feed handler](https://github.com/ethersphere/bee/blob/v2.8.3/pkg/api/feed.go), and [feed tests](https://github.com/ethersphere/bee/blob/v2.8.3/pkg/api/feed_test.go). Payload feeds resolve as v2; reference feeds have legacy timestamp/reference semantics. Do not conflate them.

Actual APIs for this slice:

```text
GET  /feeds/{owner}/{topic}?type=sequence   latest-candidate discovery
       swarm-feed-index / swarm-feed-index-next: 8-byte big-endian hex
GET  /chunks/{socAddress}                 raw signed SOC, including identifier/signature
POST /bytes                              immutable JSON upload; postage header required
GET  /bytes/{reference}                   immutable JSON download
POST /soc/{owner}/{identifier}?sig={signature}
                                           signed update upload; postage header required
GET  /health                             version/apiVersion/status
GET  /stamps/{batchId}                    batch existence/usability/TTL
```

`POST /feeds/{owner}/{topic}` creates a feed manifest; **it does not update feed content**. No manifest, ENS update, GSOC, mutable `/kv` endpoint, or local pointer registry is needed. `GET /soc/{owner}/{id}` also exists, but raw `/chunks` is the chosen verification path.

Publisher call verified in 13.2.0:

```js
const bee = new Bee(privateBeeUrl);
const writer = bee.feed.makeWriter(topic, operatorPrivateKey);
await writer.uploadPayload(batchId, descriptorBytes, {
  index: FeedIndex.fromBigInt(nextIndex),
  deferred: false,
});
```

`descriptorBytes` must be <=4096 bytes, so the SDK writes exactly one SOC containing that payload. Use the explicitly journaled index: SDK automatic next-index discovery catches a broad Bee-response error and can return index zero; that is unsuitable for durable publisher sequencing. Do not use `uploadReference` here: the signed descriptor must also bind an independently checkable JSON digest. Readers use bounded fetch plus Core SDK SOC validation, avoiding an unbounded SDK HTTP response in the extension.

## 3. Canonical domain key and public JSON contract

One shared `canonicalDomainOrigin` routine serves the publisher and extension. For a browser-captured document URL, take only `new URL(url).origin`; never persist or transmit its path/query/fragment. Accept HTTPS and HTTP only for `localhost`, `127.0.0.1`, `[::1]`. URL normalization lowercases/punycodes the host and removes default ports; preserve nondefault ports and scheme. Reject credentials, opaque origins, invalid hosts, trailing-dot aliases and identity-looking 40-hex substrings in host labels. Publisher/config input must itself be an origin (optional final `/` only), with no path/query/fragment. Never merge subdomains, `http` with `https`, or different ports. The operator explicitly maps each allowed origin to existing Arkiv `site = URL(origin).host`; no arbitrary source URL comes from the client.

```js
// All peers with the same configured publisher and origin derive this remotely.
const topic = Topic.fromString('bound.domain-cache.v1\0' + canonicalOrigin);
// Topic.fromString = keccak256(UTF8(the exact string)); no user/account inputs.
const index = FeedIndex.fromBigInt(sequence);       // uint64, big endian, 8 bytes
const id = new Identifier(keccak256(Bytes.concat(topic.toUint8Array(), index.toUint8Array())));
const socAddress = makeSOCAddress(id, configuredPublisherOwner);
// socAddress = keccak256(identifier || publisherOwnerBytes)
```

Application key is the domain URL; Swarm represents that key by deterministic topic under the pinned publisher. The configured publisher owner is an operator identity used by the feed protocol, never the user's wallet. It lives in trusted settings, not as an account field in cached JSON. Two fresh profiles can resolve the same value without copying any local reference from one to another.

Exact-key signed descriptor (canonical JSON in the SOC, <=4096 UTF-8 bytes):

```ts
type DomainDescriptor = {
  schemaVersion: 1; kind: 'bound-domain-pointer';
  origin: string; sequence: string;        // exactly 16 lowercase hex, uint64 index
  reference: string; digest: string;       // Swarm ref:64 hex; keccak256 JSON bytes:0x+64 hex
  issuedAt: number; ttlMs: number; expiresAt: number;
};
type DomainEnvelope = {
  schemaVersion: 1; kind: 'bound-domain-evidence';
  origin: string; sequence: string;
  issuedAt: number; ttlMs: number; expiresAt: number;
  entries: DomainEntry[];
};
type DomainEntry = {
  chainId: string;                        // canonical positive decimal
  policyAnchor: null | {epoch:number; digest:string};
  scriptFingerprint: string;              // sha256 of canonical sorted unique {path,hash} rows
  verifiedAt: number; sourceExpiresAt: number;
  arkiv: {chainId:string; block:number; verifiedAt:number};
  frontend: null | {key:string; expiresAtBlock:number; record:FrontendRecord};
  status: null | {key:string; expiresAtBlock:number;
    state:'normal'|'drift'|'incident'; incidentReference:null|string; updatedAt:string};
  drift: null | {key:string; expiresAtBlock:number; detectedAt:string; corroborated:boolean};
  incident: null | {key:string; expiresAtBlock:number; createdAt:string};
};
```

Types above are the full allowlist, not a spread of original records. `FrontendRecord` is the existing validated public frontend aggregate with its original site/chain, path/hash rows, reporter **counts**, receipt times and established flags. Enforce its existing 128-row/61,440-byte maximum and path privacy validator. Status/drift/incident are deliberately narrow projections: **do not serialize the original incident's `counterparty`, report payloads, reporter keys, baseline address arrays, ENS text blobs or arbitrary DNS-change strings**. Source entity keys, digests, timestamps and chain identifiers are public evidence references; publisher/source owners are pinned configuration. No user wallet address appears in key or value. Unknown fields at any level reject the object rather than being ignored.

Publisher validates original source records and exact owner/site/chain/expiry/uniqueness before constructing projections. Reader validates the projection's signature, complete schema, links, time bounds and configured source scope; the projection is an explicit **publisher attestation**, not a cryptographic Arkiv inclusion proof. Require the pinned publisher to be the source operator or explicitly trusted by configuration; do not infer that any feed signer is trusted. Source ambiguity makes a scope ineligible for a usable entry; do not select one conflicting record. A uniquely validated empty frontend record is a withdrawal; missing frontend/status or an unavailable source is not a fresh normal/empty result.

At most **4 entries**, one per chain, sorted uniquely by canonical chain ID; envelope <=262,144 UTF-8 bytes; each frontend record retains its own bound. Never truncate an envelope to valid-looking partial JSON; skip an oversized scope or fail publication explicitly. Check the descriptor digest over exact received bytes *before* decoding; then `parseUniqueJSON`, strict UTF-8, exact-key validation and canonical re-encoding. Descriptor and envelope origin, sequence and top-level times must match exactly.

`scriptFingerprint` describes the published baseline script set and must recompute from its validated path/hash tuples. The current document's observed fingerprint stays local. A changed observed fingerprint causes fresh assessment against the same baseline, **not rejection of that baseline**; otherwise an attack would turn a cached conflict into a cache miss. Never reuse a cached comparison solely because fingerprints match. Always collect/hash the current document under the original coverage/time/privacy rules.

`policyAnchor` is the last verified public snapshot epoch/digest for that scope, or null when only community evidence is available. Null cannot enable an address-policy shortcut. A cached epoch/digest never overrides a newer locally verified anchor, or supplies policy source rows. A mismatch discards any policy-context memo, obtains current original policy context, and reassesses; community evidence remains subject to its own valid source lease. Preserve the original snapshot-independent frontend warning path.

## 4. TTL, source expiry and current-decision checks

All times are nonnegative safe-integer Unix milliseconds; all expiry is exclusive. `TTL_MS=300_000`; no TTL enlargement setting in v1. For each entry, the publisher computes `sourceExpiresAt` as the minimum of applicable original source freshness deadlines, verified policy snapshot expiry when included, and frontend receipt-retirement deadlines. Its verification lease is no longer than `verifiedAt+300_000`. Arkiv's entity expiry is a **block height**, separately retained and checked; never treat it as a timestamp or infer a guaranteed wall-clock lifetime from average block time.

For the smallest uniform envelope, drop already unusable entries, then set:

```text
expiresAt = min(issuedAt + 300000, each entry.sourceExpiresAt)
ttlMs     = expiresAt - issuedAt                 // 1..300000, otherwise no publication
```

Require `issuedAt <= now < expiresAt`, `verifiedAt <= issuedAt`, `expiresAt <= sourceExpiresAt` for every entry, and internally consistent source deadlines. Download time, promotion to L1, gateway retry, service-worker restart, republishing an unchanged pointer and repeated transactions **never restart** the TTL. New TTL requires genuine successful source revalidation by the publisher/L3. Future timestamps and backward clocks invalidate eligibility.

Before **every decision**, including a hit:

1. Verify origin, chain, settings generation, configured publisher/source scope and all source deadlines again. Recollect current document scripts and coverage; bind to the browser's current document, not a cached URL.
2. Join/reuse the existing shared Arkiv chain/current-block verification lease (<=30 s), preserving monotonic block watermarks. If needed run that existing verification without downloading the whole bundle. All retained entity expiries must exceed the verified current block; an unverifiable block lease makes evidence unavailable for authority. Do not import a publisher's `arkiv.verifiedAt` as the browser's own verification lease.
3. Derive active incident only from one projected status `incident` linked to the unique incident key, with both unexpired. Derive corroborated drift only from unique status `drift`, matching drift timestamp, `corroborated:true` and valid expiries. Reapply frontend K/maturity and 48-hour row retirement locally; never extend lastSeen on publication.
4. Run original current local policy, counterparty checks and `assessFrontend`; check freshness again immediately before routing. Agreement never lowers existing severity. No cached payload chooses a return URL or authorizes a wallet call.

Expired L2 data is a miss and cannot trigger redirect, suppress checks, train the baseline, or provide fresh corroboration. The original 5–60 minute local display-only community fallback may remain, labelled stale; it is never returned as a fresh domain-cache hit. Missing/failed reads retain the original warning behavior and background refresh; errors are not negative evidence that a site is normal.

## 5. Signed lookup, version watermarks and accepted rollback limit

Automatic L2 lookup requires no publisher process online:

1. Compute topic from origin and use a configured read gateway's real `/feeds/{owner}/{topic}?type=sequence` to discover a candidate. Read index and next-index headers as **untrusted hints**; require fixed 16-hex uint64 and `next == current+1`, rejecting overflow. Do not pass through client-selected historical `at`/`after` options. Gateway CORS must expose the index headers for a web consumer; the extension uses its configured network permissions.
2. Compute expected identifier and SOC address locally for that exact index. Fetch raw `/chunks/{socAddress}`, capped at **4201 bytes** (32 identifier +65 signature +8 span +4096 payload). Use Core SDK `unmarshalSingleOwnerChunk(raw, expectedAddress)`; explicitly require recovered `soc.owner` equals pinned operator owner, `soc.identifier` equals computed ID, span equals actual descriptor payload length, and payload <=4096 bytes. Recomputing the wrapped CAC/BMT plus recovering the SOC signer authenticates the descriptor; gateway headers alone do not. Enforce the cache's payload-feed schema; a legacy timestamp/reference payload is unsupported.
3. Verify descriptor sequence equals the discovered index and its domain equals the requested origin. Check TTL and watermarks. Fetch `/bytes/{reference}` through the bounded existing adapter, verify `keccak256(bytes)==descriptor.digest`, and validate the envelope and source checks in §3–4.
4. Only now serialize a single L1+watermark update. Persist highest accepted sequence plus descriptor digest for `(publisherOwner,topic)`, and highest source block/policy epoch for the configured source scope. Lower sequence/block/epoch is rejected; the same sequence with a different descriptor digest is equivocation and rejected. A repeated identical sequence does not refresh TTL. The local policy anchor can supersede an older cache claim without importing that claim as authority.

Store watermarks separately from evictable data, survive worker/browser restarts and ordinary “clear cached evidence”; fail closed for the L2 promotion if durable watermark persistence fails. A fresh L3 result can still be used under existing local rules. For bounded storage the v1 reader accepts at most **64 distinct publisher/topic watermark entries**; at the cap, unknown domains use L3 until an explicit local trust/cache reset. Do not silently evict rollback memory. Keep a bounded per-source block watermark separately (existing reader mechanism); no account-derived namespace.

One authenticated gateway response is sufficient for this cache's integrity because the reader verifies the SOC and signed digest. A second configured independent gateway may be retried within the same budget for availability; when several valid candidates arrive, prefer the greatest sequence consistent with source/policy watermarks. Do not call two matching gateways a proof of latest state. `swarm-feed-index-next` proves neither existence nor absence of a newer valid update; it is checked for sequence consistency only. No unbounded next-index probing or full history scan.

**Accepted limitation:** a new profile, cleared trust store, malicious gateway, network partition or withheld new update can expose an older signed value that remains within its source-bounded five-minute TTL. Existing profiles reject regressions below observed watermarks, but cannot detect every unseen update. A signer can also equivocate at a sequence; different profiles may first observe different valid versions. Pinning the operator, keeping watermarks and rejecting expired evidence bound this risk; they do not create global consensus. Stronger freshness using a nonce-bound head, transparency log or another authenticated monotonic anchor is a future opt-in feature, not a dependency of this slice.

## 6. Publisher: signer, postage and abuse controls

Add one import-safe `scripts/swarm/publish-domain-cache.mjs` with a mockable `publishDomainCache` function. The default CLI is **dry-run**: compile and validate configured public scopes, print only redacted counts/digests, and make no Bee writes. `--publish` explicitly enables a funded upload. Optional `--watch --publish` performs serialized scheduled refresh for the same configured allowlist; no new public HTTP service or web mutation API.

The publisher uses a **dedicated operator signer**, loaded only in its Node process from an owner-provisioned private file (`BOUND_SWARM_CACHE_SIGNER_FILE`, restrictive permissions). Derive its public owner and require exact match to configured `BOUND_SWARM_CACHE_PUBLISHER_OWNER`. Never reuse or request a user's wallet key/signature, put the key in a browser build or `.env.example`, log it, or accept it through chat. File provisioning is an operator prerequisite outside this task; no real keys or addresses are invented in fixtures/config defaults.

The operator pays through an already funded private Bee node and a pre-existing usable immutable postage batch. Validate `/health` against Bee 2.8.3/API 8.2.0 for the pinned implementation, and `/stamps/{id}` for exact batch, existence, usability, immutable flag and adequate remaining TTL/capacity before writes. The job buys no postage, transfers no tokens and creates no account. Bee postage lifetime is independent of logical cache TTL; both JSON and feed SOC must remain retrievable, including after node restart. Restrict private Bee API network access to the publisher process; batch ID and Bee credentials never go into client settings. Any private endpoint credentials are provided through owner environment/transport configuration and redacted from failures.

Inputs are only an exact operator origin/chain allowlist plus configured source trust anchors. The job invokes the original ENS/root/snapshot/Arkiv validators itself; no client-provided hashes, TTL, normal-status claims, policy epochs, references or record JSON are signed. Fetch only configured source RPC endpoints; do not fetch a URL derived from a domain or follow source/gateway redirects. Thus this slice has **no unauthenticated upload/signing endpoint**, no client credential distribution, no arbitrary content signing, and no domain-driven SSRF crawler.

Limits: <=16 configured origins, <=4 chains/origin, <=1 active job globally and serialized writes per topic, <=1 new update/origin per 240 s on scheduled runs, <=256 feed updates/hour globally, finite retry/backoff (1 s, 5 s, 30 s; then wait for next scheduled cycle). A failed/expired source never renews the old envelope's TTL. Source verification and record bounds apply before spending postage. An explicit operator one-shot may bypass the schedule interval for recovery, still obeying source validation and global spend cap. Log counts, hashes and error codes, not full source records or browser activity. There is no per-user publishing cost or write amplification from transaction count.

Publication order, under a durable single-writer journal in `.bound/swarm-domain-cache/`:

1. Reconcile any pending attempt; an empty journal may create index zero only when feed discovery gives a definite not-found and no retained sequence. Authentication/HTTP/network errors never mean “new feed”. Refuse to reset if journal is missing while a feed exists; recover and verify its current signed state first. Never run two independent journals for one signer/topic.
2. Fetch/verify source evidence; construct bounded canonical envelope and descriptor for reserved next uint64 index. Journal the index, exact canonical bytes/digests and pending state atomically **before** upload. Never reserve a different payload at an already used index.
3. Use the existing bounded Swarm byte adapter to upload JSON and verify exact byte round-trip/digest. Record its immutable reference; create and persist the exact descriptor before signing/uploading its SOC with the SDK call in §2. Upload with the prepaid batch; verify the returned SOC reference equals the locally expected feed address.
4. Read raw SOC back and verify its signer/identifier/payload plus JSON digest, then atomically commit the journal. Restart reconciles ambiguous uploads by reading the reserved address; retry the identical descriptor/index, never reset to zero or advance while an older pending write is unresolved. Do not rely on latest lookup seeing an upload immediately after propagation.

This journal is write coordination, **not the read locator**. A separate profile still discovers the feed using the domain topic. Test/read-back through an independent read gateway before claiming network persistence; a same-node round-trip alone is not that proof. The immutable safe-page publication script stays separate.

## 7. Implementation interfaces and ownership for Terra

All paths below are proposed implementation work; this design task changes none of them. Terra can implement sequentially in the existing checkout, accommodating ongoing frontend changes and avoiding unrelated cleanup.

**A. Shared pure contract:** new `packages/contracts/domain-cache.js` and `domain-cache.test.js`. Own canonical origin, topic input text, descriptor/envelope/projection validators, exact limits, expiry rules and baseline fingerprint. Reuse `parseUniqueJSON`, `validateFrontendRecord` and frontend path/hash validation. Keep Core SDK crypto in the integration module, not in the base contracts package. Exports:

```ts
canonicalDomainOrigin(input:string, mode:'document'|'origin'):string|null;
domainTopicText(origin:string):string;
validateDomainDescriptor(value:unknown):boolean;
validateDomainEnvelope(value:unknown):boolean;
fingerprintFrontendScripts(record:FrontendRecord):string;
isDomainEntryCurrent(entry, envelope, {now, currentBlock, sourceScope}):boolean;
```

**B. Swarm transport:** new `integrations/swarm/domain-feed.mjs`, `domain-feed.test.mjs`; update that workspace's dependencies/exports and root lockfile. Reuse `integrations/swarm/index.js` bounded request/digest behavior; extract/share read-only bounded transport if necessary, so readers do not require `uploadUrl` or postage configuration. Do not route new code through the older unbounded `src/gateway.ts` as-is or trust its comments claiming an HTTP gateway cannot substitute content. Real client-side SOC/digest checks are required.

```ts
createDomainFeedReader({gatewayUrls, publisherOwner, fetchImpl, now,
  maxBytes=262144, timeoutMs=1000}): {
  read({origin, signal}):Promise<{
    descriptor, envelope, proof:{socBytes:Uint8Array, index:string}
  }>; // no trusted result until full SOC, digest, schema and time checks pass
};
// Low-level reader does not own browser policy, source block leases or storage.
```

Use Core SDK public exports `Topic`, `FeedIndex`, `Identifier`, `Bytes`, `keccak256`, `makeSOCAddress`, `unmarshalSingleOwnerChunk`. No internal npm `dist/...` imports. Node publisher additionally imports `Bee` from bee-js. Bundle only browser-compatible reader/crypto; no signer module, secret-file reader, Node fs or remote JS in the extension.

**C. Extension coordinator:** new `apps/extension/domain-cache.mjs`, `domain-cache.test.mjs`; integrate through `trust-adapter.mjs`, `decision-context.mjs`, `arkiv-reader.mjs`, `sw.js`, `settings.mjs`, options and build. Own the automatic L1→L2→L3 ordering, atomic storage, watermarks, current-context invalidation and adapter wiring:

```ts
createDomainEvidenceCache({storage, getSettings, feedReader,
  readFreshEvidence, verifyCurrentBlock, now}): {
  resolve({origin, chainId, generation, budgetMs=1500}):Promise<{
    source:'local'|'swarm'|'live'|'unavailable', entry:null|DomainEntry,
    expiresAt:null|number
  }>;
  invalidateContext():void;
  clearEvidence():Promise<void>;          // retains rollback watermarks
};
```

The worker owns L1 in **`chrome.storage.local`**, not DOM `localStorage` (MV3 service workers have no DOM). Use `setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'})` for local storage as well as existing private session storage, if not already set. Page/content-script messages never directly write or read cache objects. A browser-page harness may inject a namespaced `localStorage` adapter for tests; the remote safe page needs no domain cache in this slice and receives no new cache authority.

L1 key: `bound.domainCache.v1:<publicConfigDigest>:<canonicalOrigin>`, storing the actual JSON plus SOC proof for a Swarm entry, not just its immutable reference. Config digest covers pinned publisher and source trust configuration, not a wallet. Locally verified L3 material is eligible only through the existing trusted reader's validation path; a serialized `verified:true`/`source:'live'` flag must never manufacture provenance. Reparse/revalidate all stored data and reauthenticate stored Swarm SOC proof on read. Store at most16 origins and <=2 MiB total data; prune expired data first, then bounded LRU data, retaining separate watermarks. Storage failure is a cache miss, not a wallet-flow exception.

Synchronously install single-flight before the first await, keyed by config/origin/chain/generation. Separate one origin-feed download flight so concurrent chains/tabs join the same network lookup; join existing source-block and L3 refresh flights. L1 hit with valid proof/source lease returns immediately. On L1 miss, try real L2; on L2 miss/expiry/invalidity/timeout invoke `readFreshEvidence` using original source adapters. Default L2 network sub-budget **1000 ms total**, whole request retains the existing **1500 ms** frontend wait; L3 may continue bounded in background after that foreground budget expires. Full refresh must stay inside the existing 30-second source deadline. No network failure is persisted as a fresh negative cache entry. The published configuration covers popular origins; a never-published origin falls through to L3 automatically.

`readFreshEvidence` must require genuinely current source verification and preserve original receipt/source deadlines; wrapping a stale fallback from `readVerifiedSnapshot()` or `readCommunityCache()` must not renew TTL. Reuse/refactor existing pure source validation/projection functions rather than invoking `createDecisionContext()` recursively. Keep ordinary current policy evaluation outside the domain resolver to avoid adapter cycles. A valid local L3 result can populate L1 under that existing validation contract; browsers cannot publish it to Swarm. Prefer a newer independently verified L3 result over an older late L2 response; compare captured generation, source block/epoch and verification time before committing.

Capture context generation before async work; recheck before saving and before using. Settings/source/publisher changes clear eligibility and cancel/supersede flights. Chain changes select the correct chain entry and invalidate in-flight assessments. Account change/disconnect invalidates pending local assessments and all authorization/ticket state as existing rules require, **but neither keys, clears, nor republishes the shared domain evidence because of an address**. No account data enters the coordinator. Document changes invalidate collected hashes/assessment; a valid public domain baseline may be reused after recollection.

Expose the resulting validated projection through `decisionAdapters.readFrontendCommunity` (and bundle-first preconnection status where applicable). Keep a separate original source method for L3 so that calling through the adapter does not recurse. Require the current block and local `assessFrontend` mapping before returning `state:'fresh'`; do not treat merely parsed remote fields as the existing validated bundle. Original global owner-bundle background refresh remains available for all other readers; this slice must not turn preconnection checks into an ENS/Arkiv per-navigation query on cache hits.

**D. Publisher:** new `scripts/swarm/publish-domain-cache.mjs`, `publish-domain-cache.test.mjs`, and a small import-safe shared source-projection helper if needed. Own §6 journal, CLI, SDK call and authoritative source adapter. Source configuration may reuse the existing verified root/snapshot and bounded Arkiv reader primitives with Node storage/transport injection; do not import extension globals or executable `local-intake.mjs` as a library. Changes to source helpers should preserve original APIs/tests.

**E. Configuration/build/docs:** update `.env.example`, extension settings/options/tests and `build.mjs`. Public normalized settings: `swarmCacheEnabled:false`, `swarmCachePublisherOwner:''`, `swarmCacheGatewayUrls:[]` (1–2 HTTPS or loopback API bases; no credentials/query/fragment). With enabled=true require a valid explicit owner and at least one endpoint; fail configuration rather than infer an owner from Swarm. Owner key rotation is an explicit local trust-setting change, invalidating eligibility; never trust a downloaded successor key. Retain separate `safePageUrl`.

Proposed operator env (placeholders only; these are new names, not claims they exist):

```dotenv
BOUND_SWARM_CACHE_ORIGINS=                  # JSON array of canonical public origins, <=16
BOUND_SWARM_CACHE_CHAINS=                   # JSON array of canonical decimal chains, <=4
BOUND_SWARM_CACHE_PUBLISHER_OWNER=          # dedicated publisher public identity
BOUND_SWARM_CACHE_SIGNER_FILE=              # private operator file, never bundled
BOUND_SWARM_CACHE_STATE_DIR=.bound/swarm-domain-cache
BOUND_SWARM_CACHE_PUBLISH=0                 # explicit --publish AND 1 required for Bee writes
BOUND_BEE_API_URL=                          # private publisher node; never browser config
BOUND_BEE_API_VERSION=8.2.0
BOUND_POSTAGE_BATCH_ID=                     # existing funded immutable batch
BOUND_SWARM_CACHE_GATEWAYS=                 # JSON array of public Bee read API bases
```

Also require existing explicit ENS/Arkiv source URL, chain, resolver/root and owner settings. Do not silently choose production anchors. The publisher has no frontend scoring-threshold input; all local settings and wallet-dependent policy decisions remain local. Add a dedicated browser bundle for the coordinator/reader through esbuild, adjusting copied import paths. Build must include only public settings and local packaged JS; reject signer/secret env leakage in dist checks.

## 8. Implementation gates and live prerequisites

Implement contracts/transport/coordinator/publisher tests before their respective code, using injected clocks, HTTP and storage. No Solidity change; `slither .` is not a useful gate for this documentation/JS slice. Run focused existing frontend and trust tests affected by integration; respect the implementation contract's bounded-test guidance and known pre-existing failures.

Minimum meaningful automated matrix (no funds, no keys from users):

- Canonical origin equivalence (case, IDNA, default port) and separation (scheme/subdomain/nondefault port); credentials/opaque/identity path rejected; normalization never stores full document URLs.
- Genuine Core SDK signed SOC fixtures with test-only generated signer; verify deterministic topic/ID/address, 8-byte sequence, signer/identifier/span mismatch, tampered signature/descriptor/JSON/digest, duplicate JSON keys, extra fields, unsupported legacy feed payload, malformed headers, redirect/oversize/timeout. Test the **actual** SDK `uploadPayload` wire shape through a mock Bee HTTP server, not just a mock function that echoes arbitrary JSON.
- Three process/store instances: publisher uploads v0 then v1 to mock Bee routes; fresh profile A discovers v0 by domain without a local pointer; a separate fresh profile B resolves updated v1; A refuses lower/equivocal v0 after observing v1. Persist/reopen publisher journal and reader storage, then repeat lookup. Explicit test demonstrates a first-seen older but unexpired update is accepted under the documented bounded-staleness model; expired update is rejected.
- Exact expiry at `now==expiresAt`, future/backward clock, source expiry before TTL, block expiry at equality, 30-second verification lease, 48-hour receipt cutoff, replay does not renew TTL, source failure never becomes a fresh normal result. Newer local source block/policy epoch wins over old L2.
- 20 concurrent same-scope callers cause one feed lookup, one JSON download and one shared source-block verification; concurrent chains share the origin flight. L1 hit needs no Swarm call; valid L2 skips full Arkiv/ENS community fetch; miss/expired/timeout invokes original fresh L3 once. Foreground wait remains <=1500 ms while bounded background work fills storage. A stuck/failed cache never bypasses warning or authorization.
- Settings/chain/account/document changes during fetch cannot apply an old assessment, overwrite the new scope or leak account data. Cache hit with changed current script bytes produces a newly computed conflict; no cached approval/verdict is used. Snapshot-unavailable frontend behavior remains available as specified originally.
- Strict allowlist serialization tests inject wallet/account arrays, `counterparty`, private URL/path, reporter keys, request calldata and ticket/approval fields; none can enter JSON or logs. Count/byte/LRU/watermark caps and storage errors covered. Reader needs no signer/postage; dry-run and missing enable flag perform zero Bee writes; malformed/unusable/expired batch prevents upload. Concurrent publisher, crash-before/after SOC upload, ambiguous error, missing journal and index reuse tested.

Suggested focused gates after implementation:

```bash
node --experimental-strip-types --test packages/contracts/domain-cache.test.js integrations/swarm/domain-feed.test.mjs apps/extension/domain-cache.test.mjs scripts/swarm/publish-domain-cache.test.mjs
node --experimental-strip-types --test apps/extension/arkiv-reader.test.mjs apps/extension/decision-context.test.mjs apps/extension/frontend-context.test.mjs apps/extension/settings.test.mjs
node apps/extension/build.mjs
node apps/extension/check-dist-imports.mjs
```

Use mock Bee routes plus actual crypto/SDK for the complete local slice. A passing mock suite is not evidence that Swarm was used live. The live gate requires an operator-provisioned dedicated signer, compatible Bee node, funded usable postage batch, configured trusted public owner, allowed domain/chain, working read gateway/CORS and configured ENS/Arkiv source access. Never ask for those secrets in chat; no purchase/provisioning is included.

Once the owner configures those prerequisites and explicit upload is enabled, the integration gate is: publish one real envelope + SOC; read from an independent Bee gateway using only configured owner plus domain; change verified public source evidence and publish the next index; start a clean second browser profile with no cache/local pointer; resolve and verify the new value; restart reader/publisher; confirm durable high-watermark and exclusive expiry/L3 fallback. Record real references/indexes and actual gateway results. Until then report **local slice verified; funded live upload/read-back pending**, rather than claiming live Swarm persistence.

This amendment is implementation-ready with those deployment prerequisites. The material accepted limitation is TTL-bounded first-seen rollback/withholding; stronger global freshness is explicitly outside the current product requirement.
