# Plan: Frontend integrity (ENS release hash) and contract-to-site link evidence

**Status:** proposal, 2026-11-06. Not yet accepted. Revises scope in `plan.md` §7 ("secondary reputation signals" and the ERC-7730 importer were out of the MVP); the project owner must approve before implementation starts.

**Closes:** `BOUND_Final_Architecture.md` §16 risk "A hijack with no infrastructure change produces no early signal — [FUTURE] script integrity monitoring" (attack-tree paths A3 CDN/deploy compromise and A4 third-party script supply chain, which today rely only on the K-warning incident path).

## 1. Goal

At signing time, BOUND should be able to say three extra things, each with its evidence:

1. **What code is running.** The scripts the requesting frame loaded, and the hosts it talked to, hashed and listed.
2. **Does it match a release the protocol published?** The protocol's ENS name carries a release-manifest digest. If the running code matches, the score goes up. If it does not, the score goes down and the warning says which files differ.
3. **Do independent sources link this contract to this site?** Several data platforms are checked for an association between the requested contract (chain, address) and the site's domain or ENS name. Each independent link adds a bounded amount of score.

## 2. Non-negotiable rules (from the existing architecture)

- **Score, never authority.** A matching frontend hash and any number of link sources raise the score but **never lift a cap**. Only the four trust sources in Final Architecture §9.1 (snapshot, protocol ENS attestation, shared-contract list, deployer lineage) lift caps. Reason: an attacker can pre-deploy and verify a drainer, and can submit labels to public registries. An unknown spender on a seeded site stays capped at 35 (red), whatever the hash says.
- **Nothing the site serves authorizes itself.** The release digest must come from ENS under the protocol's keys, not from the page or DNS. The manifest *bytes* may come from anywhere (Swarm, Arkiv, even the site), because they are only accepted if they hash to the ENS digest.
- **Absent or unavailable evidence adds nothing and subtracts nothing.** No ENS record, a timed-out lookup, or an unhashable script is "unknown", not a penalty (plan.md §7).
- **No privacy regressions.** The extension must not call Etherscan/Sourcify/etc. per request (that would leak the user's activity). Third-party link data is pre-indexed into a bundle. On-chain reads go through Anon-RPC with the existing 1.5 s budget. Script hashes and hosts never leave the device.

## 3. Prerequisite: move the evaluator to additive scoring

Today `shared/policy-core/index.mjs` starts every scored request at **100** and only applies caps. There is nothing to "increase". Implement the v2 additive model already specified in Final Architecture §9.2 first, then add the new signals to it:

```
score = clamp(50 + Σ signals, 0, 100)
score = min(score, cap(site, counterparties, driftOrMismatch))
```

Existing signals keep their v2 weights (snapshot +35, attestation +40, lineage +15, known called contract +20, unknown called −30, drift −30 each/max −45, new outbound host −10, never-seen IP −15). Re-freeze the verdict matrix and keep the false-hold DEX fixture green before adding anything below. All weights are configurable.

## 4. Part A: running-code evidence (extension, Developer 1)

### 4.1 What is collected, per tab and frame

| Item | How | Notes |
|---|---|---|
| External script URLs | `chrome.webRequest.onCompleted`, `types:["script"]` (add `webRequest` permission, non-blocking) | Also records `ip` and `fromCache` (feeds the "never-seen IP" signal) |
| External script bytes → SHA-256 | Service worker re-fetches each URL with `cache:"force-cache"`, `credentials:"omit"`, size limit, then `crypto.subtle.digest` | See the limitation in 4.3 |
| Inline scripts → SHA-256 | Isolated content script hashes `script.textContent`; a `MutationObserver` catches injected ones | Same format as CSP `sha256-…` |
| Outbound hosts | `webRequest.onBeforeRequest` for `xmlhttprequest`, `websocket`, `script`, `other` | Hosts only, not paths, query strings or bodies |
| Uninspectable code | `eval`, `blob:` and `data:` scripts, WebAssembly | Counted and shown as "N code paths not inspectable" |

Stored in `chrome.storage.session`, keyed by tab and frame, cleared on navigation. It is snapshotted at decision time for the requesting frame only.

### 4.2 Release manifest format (new, BOUND-defined)

ENS text record on the protocol's name, key `bound.frontend.v1`:

```json
{"schemaVersion":1,"site":"swap.example.org","manifestDigest":"0x<keccak256 of RFC 8785 bytes>","ref":{"swarm":"…","arkiv":"…"},"releasedAt":"…","expiresAt":"…"}
```

The manifest, canonicalized the same way as the snapshot (RFC 8785, Keccak-256):

```json
{"schemaVersion":1,"site":"swap.example.org","release":"v4.12.0",
 "scripts":{"/assets/index-3f9a.js":"sha256-…","inline":["sha256-…"]},
 "allowedThirdPartyScripts":{"https://cdn.example-analytics.com":"any"},
 "connectHosts":["api.example.org","rpc.example.org"]}
```

**Reuse the existing code.** Fetching and verifying works exactly like `trust-engine.mjs`: read the record via Anon-RPC, fetch the bytes, verify the digest, and reject on mismatch, rollback or expiry. Publishing reuses `publishAttestation`'s pattern in `shared/integrations/ens/src/resolver-client.ts`. The curator CLI gains `bound-curator frontend publish <buildDir>`, which walks the build output and emits the manifest. The demo dApp's build publishes one.

The standard ENS `contenthash` record (an IPFS/Swarm site root) is read as **context only**. Matching individual executed files to a UnixFS/BMT root is out of scope for the first cut.

### 4.3 Domain → ENS name mapping: the security-critical step

The extension must know which ENS name speaks for `swap.example.org`. The options, ranked:

1. **Curator snapshot mapping (MVP).** `sites[site][chain].attestation.name` already exists in the snapshot compiler. Reuse the same name for `bound.frontend.v1`. It is hash-verified and needs no DNS.
2. **On-chain DNSSEC-claimed name (later).** Accept only if the name is claimed on-chain *and* its owner has been unchanged for ≥ 30 days, as checked by the watcher.
3. **Rejected: gasless/off-chain DNSSEC resolution.** It reads DNS TXT at resolve time, so whoever hijacks DNS controls the answer. That is exactly our threat.

### 4.4 Known limitation: a re-fetch is not proof of what executed

The service worker's re-fetch is a separate request. A cloaking server can serve clean bytes to it and malicious bytes to the page. `force-cache` usually returns the same cached bytes the page ran, but this is not guaranteed. Therefore:

- **Match** = small bonus only (it can be faked by cloaking).
- **Mismatch** = strong signal (an attacker gains nothing by causing it).
- Optional **strict mode** later: use `chrome.debugger` `Network.getResponseBody` to hash the exact executed bytes. This shows Chrome's "being debugged" banner, so it is opt-in only.

### 4.5 Integrity result → signals

| Result | Condition | Signal |
|---|---|---|
| `matched` | Every executed script is listed with an equal hash or on an allowed third-party host; every outbound host is in `connectHosts` | **+10** |
| `no_release` | No `bound.frontend.v1` record, or the lookup timed out | 0, shown as "not checked" |
| `unlisted_host` | Matched scripts, but an extra outbound host | −10 per v2, at most −20 |
| `mismatch` | Any first-party script hash differs, or an unlisted first-party script | **−20**, and it counts as drift for the cap: an untrusted rights address becomes 35 → 15 (escalated) |
| `uninspectable` | `eval`/`blob:` code present | 0, disclosed; never `matched` |

Mismatch alone, with only trusted counterparties, stays scoreable (for example 50+35+20−20 = 85, green with a banner). A legitimate deploy published before its ENS record is updated must not hard-block users. Mismatch also emits a privacy-minimized `observation` of kind `bundle` (the v2 kind that already exists) containing only the site and manifest digest, so the watcher can corroborate it into an incident.

## 5. Part B: contract ↔ site link evidence (Developer 3 indexer, Developer 2 ENS)

### 5.1 Sources

| Source | Link it gives | Who controls it | Fetched how | Weight |
|---|---|---|---|---|
| ENS reverse (primary) name of the contract, forward-verified, under the site's mapped ENS name (e.g. `router.uniswap.eth`) | contract → protocol name | The contract's owner, on-chain | Extension, live via Anon-RPC | +10 |
| ERC-7730 registry at a pinned commit | `context.contract.deployments` + `metadata.info.url` | Self/third-party submitted | Indexer | +5 |
| Sourcify / Blockscout verified source and creator tx | Deployer address → compare with the snapshot's `deployers` | Deployer | Indexer | +5 (lineage itself is already a trust source; this is the corroboration only) |
| Protocol's official deployments file in its GitHub repo (pinned commit) | Addresses listed by the protocol's repo | The protocol's repo maintainers | Indexer | +5 |
| DefiLlama protocol metadata | Protocol URL ↔ listed addresses | DefiLlama maintainers | Indexer | +5 |
| Scam Sniffer blocklist (negative) | Address/domain is known-bad | Scam Sniffer | Indexer | score 0 (v2 already) |

- **Independence:** sources are grouped by who actually controls the data. Two registries that both copy one self-submission count once.
- **Total positive link bonus is capped at +15.**
- **A conflicting link counts as a negative:** a contract linked by these sources to a *different* site gets −10 and is named in the warning.

### 5.2 Pipeline

1. **Indexer job** (new, `services/indexer/`, Dev3, runs alongside the watcher). For each seeded site and chain, it pulls each source at a pinned version. It normalizes rows to:

   ```
   link{chainId, address, site, sourceId, controller, evidenceRef, fetchedAt}
   ```

   and publishes them as watcher-owned Arkiv entities (new kind `link`, 7-day expiry).
2. **Extension** downloads the link bundle on the same timer and owner-checked path as the baseline bundle (`arkiv-reader.mjs`). It looks up `(chain, address)` locally, so no per-request network call is made.
3. **ENS reverse-name check** is the only live lookup: Anon-RPC, 1.5 s budget, skipped on timeout.

This is the "ERC-7730 importer + Arkiv mirror" from the old whitepaper, kept in its correct role: **evidence, not authority**.

## 5A. Part C: ENS lookup cache on Swarm

**Request:** recently looked-up ENS domains are cached in Swarm, as a cache layer in front of live ENS reads.

### 5A.1 What is *not* built: a per-user "recently searched" list on Swarm

Swarm content is public to anyone holding the reference. A list of the sites one user looked up is browsing history, and plan.md §1 forbids publishing it. Uploading it would also:

- require the user to hold a postage batch;
- send the user's IP to a Bee gateway on every write.

Encrypting it does not help: the plan already forbids publishing secret-bearing Swarm references, and the timing of writes still leaks activity.

### 5A.2 What is built: three tiers

| Tier | Holds | Written by | Trust | Privacy |
|---|---|---|---|---|
| **L1: local verified cache** (`chrome.storage.local`) | ENS record values this extension itself read live via Anon-RPC, with block number, read time, TTL | Extension | Same as a live read until TTL. It is the user's own earlier verified result, like the snapshot cache in `trust-engine.mjs` | Never leaves the device |
| **L2: shared Swarm cache** (watcher-signed Swarm feed) | For each cached site: `{site, ensName, record value, blockNumber, resolvedAt}`, plus the manifest bytes themselves | Watcher, on a timer | Record values are **watcher-asserted, not ENS-proven**. Manifest bytes are self-verifying against a digest | The extension downloads the whole bundle, so no per-site request is visible |
| **L3: live ENS** | Source of truth | Chain | Authoritative | Anon-RPC only |

### 5A.3 Lookup order at decision time

1. **L1 hit within TTL.** Use it.
2. **Otherwise, start the live ENS read (L3)** with the existing 1.5 s budget. **In parallel, read L2** from the already-downloaded bundle and fetch manifest bytes by reference from Swarm.
3. **L3 returns:**
   - Use its digest.
   - Accept the manifest bytes from whichever source arrived first, if they hash to that digest.
   - Store the result in L1.
   - If L3 disagrees with L2, log it as a cache inconsistency, which may indicate a stale or compromised watcher.
4. **L3 times out and only L2 exists:** the frontend row reads "cached by watcher at block N, not confirmed". **No score effect, + or −.** Reason: a compromised watcher key must not be able to cause false mismatches (griefing) or false matches.

**Net effect.** The cache buys four things, but never authority:

- **Speed:** manifests are prefetched.
- **Availability:** manifests stay readable when the site is down or hijacked.
- **Fewer Anon-RPC calls:** L1 hits skip the live read.
- **Privacy:** the bundle is downloaded in full, so no per-site Swarm request is visible.

### 5A.4 Which domains go in the shared cache

- Every site in the verified snapshot.
- Uncurated sites, only from the observation stream the watcher already receives (site-level, privacy-minimized). A site is included only if at least `K_cache` distinct rotating reporter keys reported it in the last 7 days. This gives "recently looked-up" behaviour without any new data leaving the user.
- `K_cache` is tunable. Sybil inflation only adds a site to a cache, which grants nothing.

### 5A.5 Swarm mechanics

- The watcher uses its existing Swarm config (`~/.bound/watcher-deployment.json` `swarm` block, currently placeholders) with a postage batch.
- It writes a **single-owner-chunk feed** signed by the watcher key, so readers can check the writer is the watcher's address. This is the same owner-check idea as Arkiv.
- Each update uploads `{schemaVersion, generatedAt, entries[]}` and moves the feed pointer.
- The extension reads the feed through two independent gateways and requires byte agreement, reusing `fetchSnapshot`'s two-gateway rule.
- Expiry: entries older than 24 h are ignored. The feed retains the last 7 days.

**Dependency:** Swarm is currently deferred (Bee node issue). Until it works, L2 can fall back to an Arkiv watcher-owned `ens_cache` entity. L1 and L3 work without either.

## 6. UI changes

The warning and the popup gain a **Frontend** row and a **Links** row, each with its evidence:

- "Frontend matches release v4.12.0 published by `example.eth` (Sepolia block N)."
- "2 scripts differ from the published release: `/assets/index-3f9a.js` …"
- "Not checked: no published release."
- "Contract linked to this site by: ENS reverse name, protocol GitHub deployments (2 independent sources)."

Every line points to the record, block or commit it came from, so the claims stay verifiable. Extend the Playwright check (`/tmp/bound-pw/verify-popup-data.mjs`, to be moved into the repo) to assert these fields against real inputs, not hard-coded values.

## 7. Phases and gates

| Phase | Work | Owner | Gate |
|---|---|---|---|
| F0 | Approve scope; freeze manifest schema, record key, weights, mapping rule; additive evaluator + re-frozen verdict matrix | All / Dev1 | Old verdict matrix outcomes unchanged; DEX false-hold fixture green |
| F1 | Collector (webRequest, inline hashes, hosts, IPs) and popup display only, **no scoring** | Dev1 | Playwright: hashes shown equal independently computed SHA-256 of served files; navigation clears state |
| F2 | `bound.frontend.v1` publisher in curator, manifest generator, demo dApp release published on Sepolia | Dev2 | Live record read-back; tampered manifest bytes rejected; unauthorized writer cannot set the key |
| F3 | Matching + scoring + warning rows | Dev1 | Benign demo build → `matched` +10; hijack-server serving a modified script at the same origin → `mismatch`, unknown spender escalated (cap 15); no record → no score change |
| F2.5 | ENS cache: L1 local verified cache; L2 watcher Swarm feed (Arkiv fallback until Swarm works) | Dev1 / Dev3 | L1 hit skips the live read; feed from a non-watcher signer rejected; gateway disagreement rejected; L3 timeout with only L2 → no score change; L2 vs L3 disagreement logged; network scan shows no per-site Swarm request from the extension |
| F4 | Indexer + Arkiv `link` bundle + extension lookup + ENS reverse check | Dev3 / Dev2 / Dev1 | Forged `link` from another writer ignored; duplicated self-submission counts once; bonus never lifts the 35 cap (property test over random inputs) |
| F5 | Adversarial tests | All | Cloaked re-fetch documented as a known gap; `eval`/`blob:` shown as uninspectable; legit deploy-before-ENS-update shows a banner without escalating a trusted request |

## 8. Open decisions for the project owner

1. Approve this scope revision (plan.md §7 currently says to keep these signals disabled).
2. Weights: +10 match / −20 mismatch / +15 link cap, as proposed.
3. Whether mismatch counts as drift for the cap (proposed: yes, for untrusted rights addresses only).
4. Which link sources ship in F4. Proposed minimum: ENS reverse name + protocol GitHub deployments + ERC-7730. Sourcify/DefiLlama later.
5. Strict mode via `chrome.debugger`: build it or leave it as future work.
6. ENS cache: confirm the shared watcher cache (§5A.2) instead of a per-user "recently searched" upload. Also confirm `K_cache`, the L1 TTL (proposed 1 h), and the L2 expiry (proposed 24 h).
