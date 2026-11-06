# Plan v2: frontend hash mismatch → safe page (Swarm) → extension-enforced override

**Status:** v2, 2026-11-06. Revised after the GPT-6.1 Sol review (round 1: 19 findings, 16 high). Nothing implemented yet. Branch `swarm-integration`.

**Owner decisions:**
- Expected hashes come from a **community baseline** aggregated by the watcher. The protocol ENS release manifest comes later.
- A mismatch **redirects only when independently corroborated**; otherwise it produces a louder warning.
- Redirecting cancels the current wallet request. This is an **explicit, documented exception** to "warn, never block": the request is rejected with 4001 and the user must retry, and the original request is not resumed. The user can always get back to the site and proceed.

## 0. Current state (verified by Claude and by Sol)

| Piece | Status | Where |
|---|---|---|
| Interception, byte/state digests | Exists | `hook.js:106`, `relay.js:23`, `sw.js:240` |
| Script collection | Exists, **transaction path only**. Covers the **first 32 `<script>` elements, inline included**. URLs with a query string are **excluded**. Paths are truncated to 256 characters. Only same-origin `only-if-cached` re-fetches | `frontend-collector.mjs:7,18,29`, `sw.js:312` |
| Hash comparison | `compareScripts()` has no production caller, and its input shape `{path,hash}` differs from the collector's `{label,hash,source}` | `frontend-integrity.mjs:22,29` |
| Observation pipeline | Accepts **address values only** in the queue, sender and intake | `observation-queue.mjs:21`, `watcher-adapter.mjs:18`, `contracts/index.js:68` |
| Arkiv reader | Keeps only `baseline/status/drift/ens_record`; incident and frontend records are dropped | `arkiv-reader.mjs:33` |
| Typed confirmation | Enforced by `verdict === "escalated"`, not by `tier`. Named tiers exist only for connections | `warning.js:94`, `sw.js:458` |
| Arkiv upsert/renewal/bundle | Each has its own allowlist of record kinds | `upsert.js:9`, `renewal.js:9`, `contracts/index.js:149` |
| Hijack demo | Attack is **inline**, `/` only, `no-store`. Not detectable by this feature as-is | `demo/hijack-server/server.js` |

## 1. Target flow

1. A wallet request is intercepted (unchanged).
2. Both the connection path and the transaction path collect script evidence.
3. The decision context reads the site's `frontend`, `status`, `drift` and `incident` records from the watcher bundle. No frontend-specific network request is made.
4. `assessFrontend()` returns **two independent results**:
   - **comparison:** `agree | conflict | unfamiliar | none`;
   - **coverage:** counts of compared, inline-excluded, query-excluded, unavailable and over-cap scripts.
5. Routing, evaluated in order:
   - `conflict` **and** corroborated (§2.3) **and** the request comes from the top-level frame **and** there is no approved ticket → **redirect** (§4).
   - `conflict` with an approved ticket for this tab, origin and chain → consume the ticket, then show the existing warning with typed confirmation required, plus the integrity rows.
   - `conflict` without corroboration, or from an iframe → existing warning, severity raised to at least `huge`, with the integrity rows.
   - `unfamiliar`, `agree` or `none` → existing flow, with integrity rows and coverage shown.
   - **Any error** in steps 3–5 → existing flow. Never redirect on an error.
6. Safe page: shows the extension-supplied evidence and the live Arkiv community data. **"Go back anyway"** asks the extension to open its **private** confirmation page.
7. Confirmation page (an extension page, **not** web-accessible): the user types `I UNDERSTAND`, the service worker approves the ticket and navigates the tab back to the **stored** site URL.
8. The user retries; the approved-ticket branch from step 5 applies.

## 2. Assessment semantics

### 2.1 Per-script comparison
Only same-origin external scripts are compared. Inline scripts are counted as excluded, because they carry per-user state.

| Observed (path P, hash H) | Community record for P | Per-script result |
|---|---|---|
| H is **established** for P | — | agree |
| H not established; P has another established hash | (H may exist as a candidate) | **conflict** |
| P has no established hash | — | unfamiliar |

**Established** means at least K distinct reporter keys **and** maturity (`firstSeen` older than M = 1 h at publication time). Candidates below that bar never suppress a conflict.

### 2.2 Page-level precedence
- **comparison:** `conflict` if any script conflicts. Otherwise `agree` if at least one script agrees and none is unfamiliar. Otherwise `unfamiliar` if any script is unfamiliar. Otherwise `none`.
- **coverage** is always reported separately. The UI must say "**the observed subset** agrees (n of m scripts compared)", never "frontend verified".

### 2.3 Corroboration (the redirect gate)
A redirect needs **at least one** of the following:
- (a) **corroborated** drift for this exact site and chain, current. This is the `drift` record with `corroborated:true`, as mapped at `arkiv-reader.mjs:48`. A raw `status:drift` alone does not count.
- (b) An **active incident** for this site and chain. This requires `incident` records to be loaded.
- (c) **Transaction requests only:** the decoded request grants rights to, or calls, an address the policy marks untrusted for that role. Implemented as a flag returned from `evaluate`, not via `warnedAddresses` (some untrusted addresses only receive an amber cap, `policy-core/index.mjs:43`).

The old gate "old hash still recently seen" is **dropped**. It turned every legitimate in-place redeploy into a redirect. A deploy without drift, incident or a dangerous counterparty therefore only produces a louder warning.

### 2.4 Missing or stale community data (owner-approved rules)
A redirect requires **fresh, verified** evidence. Missing, stale or failed data always falls back to the existing warning flow.

| Situation | Behaviour |
|---|---|
| No bundle, or bundle older than 5 min (`arkiv-reader.mjs:74`) at request time | Join the in-flight refresh, or start one, **in parallel with script collection**, with a 1.5 s budget. The bundle is downloaded whole, so there is no per-site request. |
| Refresh did not finish within the budget | `comparison: none`. Row reads "Community data unavailable: scripts not compared". **No redirect.** The refresh keeps running in the background and fills the cache for the next request. |
| Bundle present but between 5 and 60 min old | Compare **for display only**, labelled with its age. A conflict may raise severity but **cannot redirect**. |
| No `frontend` record for the site | `comparison: none` (or `unfamiliar`). Existing flow. |
| Safe page cannot reach Arkiv | Show the extension-supplied fragment data, labelled "from your extension; live community data unavailable". |

### 2.5 Known blind spots (shown in the UI, documented)
An attacker can avoid a `conflict` by:
- injecting inline code;
- using a new file name (→ `unfamiliar`);
- serving from another origin or with a query string;
- placing scripts beyond the 32nd element;
- loading module imports;
- relying on the re-fetch from cache differing from what executed.

Address-policy warnings remain fully active regardless of the frontend result. Frontend agreement never lowers severity.

## 3. Data contracts

### 3.1 Intake event (new exact-key variant; the address variants are unchanged)
```json
{"site":"app.x.com","kind":"frontend","chainId":11155111,"reporterKey":"…","path":"/assets/index-3f9a.js","hash":"sha256-<43 b64>="}
```
- `path`: `/`-prefixed, at most 256 characters (**reject** longer paths; do not truncate), printable ASCII, no `?` or `#`.
- **Skip paths that look like they carry identity:** any 40-hex segment (`0x…`), or segments longer than 64 characters.
- Local deduplication of frontend events: **24 h** per (site, chain, path, hash), not 7 days.

### 3.2 Arkiv aggregate record `frontend` (one **upserted** entity per site and chain)
```json
{"schemaVersion":1,"kind":"frontend","site":"app.x.com","chainId":11155111,
 "scripts":[{"path":"/a.js","hash":"sha256-…","reporters":7,"firstSeen":"…","lastSeen":"…","established":true}],
 "updatedAt":"…"}
```
- `scripts` is sorted by (path, hash) and unique, with at most 128 entries.
- Selection is deterministic: established entries first, then by reporter count descending, then by `lastSeen` descending.
- Entries with fewer than 2 reporters are never published.
- `firstSeen` and `lastSeen` are watcher **receipt** times. `lastSeen` is never refreshed by a republish.
- Serialized size at most 61,440 bytes.
- The contract validator checks: canonical path and hash, sorting, timestamp order, no future timestamps, and `established` consistent with K and M.

### 3.3 Reporting gate (prevents victims from training the baseline)
A frontend event is queued only if **all** of these hold:
- the existing `mayRecordObservation` passes;
- there is **no** current drift (raw or corroborated);
- there is no incident;
- the comparison is **not** `conflict`;
- **no** override ticket was used for this tab.

The watcher also quarantines events for any site with drift or an incident, and does not count them toward promotion. Reporter counts are labelled "distinct reporter keys", not "users". Sybil resistance is out of scope.

## 4. Redirect, ticket and handoff (security core)

### 4.1 Ticket state machine
Tickets are persisted in `chrome.storage.session` with serialized access (a single promise chain):

```
created → at_safe_page → confirming → approved → consumed
```

Any other transition is invalid. Expiry runs 10 minutes from `created`, and 5 minutes from `approved`.

A ticket holds:
- `id`: 128-bit random;
- `tabId`, `topOrigin`, `returnUrl` (the **captured top-level URL**, never page-supplied), `chainId`, `kind`;
- authoritative display data: score, severity, comparison, coverage, conflict rows, corroboration reasons;
- `settingsRevision` and `createdAt`.

There are at most 16 tickets. Closing the tab deletes its tickets.

Navigation rule: only the worker-initiated hops (dApp → safe page → confirmation page → dApp) are allowed for the ticket's tab. Any other committed navigation in that tab expires the ticket.

### 4.2 Cancel → navigate sequence (fail open)
1. Create and persist the ticket and the destination URL. **If this fails, use the existing warning flow** and do not cancel.
2. Send `{action:"cancel", digest, stateDigest, safePage:true}` to the relay. Both digests are required, or the hook ignores the message.
3. The relay posts the decision to the hook, waits for the hook's `BOUND_CANCEL_DELIVERED_V1` acknowledgement (bounded to 500 ms), then tells the worker. The acknowledgement is delivery information only.
4. The worker re-checks that the document is still current, then calls `chrome.tabs.update(tabId, {url: safePageUrl#fragment})`.
5. The worker watches `webNavigation.onErrorOccurred` and a 5 s commit timeout for that navigation. On failure it loads the bundled `safe.html` instead.

### 4.3 Handoff: safe page → private confirmation (no web-accessible resources)
- **Remote safe page:** it sends `window.postMessage({type:"BOUND_SAFE_CONFIRM_V1", ticket})`. `relay.js`, which is already injected on `https://*/*` and localhost, forwards it. The worker accepts only if **all** of these hold:
  - `sender.tab.id === ticket.tabId`;
  - `frameId === 0`;
  - the sender origin equals the configured safe-page origin;
  - the ticket state is `at_safe_page` and unexpired.
  
  The worker then navigates the tab to `chrome-extension://<id>/confirm.html#<ticket>`. The message can only *request* that the confirmation page opens; it cannot approve anything.
- **Bundled `safe.html`:** sends the same request through `chrome.runtime.sendMessage`. The sender URL is checked.
- **`confirm.html`:**
  - requests the ticket's authoritative data from the worker; nothing comes from the URL or fragment;
  - the typed phrase is checked in the worker (`BOUND_TICKET_APPROVE_V1`);
  - the sender must be `confirm.html` in the same tab;
  - CSP `frame-ancestors 'none'` is set in the manifest's `extension_pages` policy.

### 4.4 Retry
The first interactive request (connection or transaction) from `ticket.topOrigin` in `ticket.tabId` on the same chain, whose assessment is still `conflict`, consumes the ticket **atomically**: the consumed state is persisted before routing. It is then routed to the warning with **typed confirmation required**. The warning gains a worker-enforced `requireTypedConfirmation` flag, independent of the score verdict. The original score is preserved, and severity never goes down. The request forwarded to the wallet is the newly frozen retry request, sent exactly once.

## 5. Safe page

- **Source:** `apps/safe-page/src`. Built twice:
  - **remote:** `index.html` plus `app.js`, published to Swarm;
  - **packaged:** `safe.html` plus `safe.js` in the extension (external script, MV3-compliant).
- **Fragment:**
  - versioned, strict parser with size caps;
  - display-only;
  - cleared with `history.replaceState` immediately after parsing;
  - never stored;
  - rendered with `textContent` only;
  - no third-party resources.
  
  Fields: `v, site, chain, score, sev, reason, conflicts, unfamiliar, cov, ticket, watcher`.
  
  It never carries wallet addresses, transaction details, the return URL or the extension ID. The relay handoff (§4.3) removes the need for the extension ID.
- **Arkiv query** (Sol-verified syntax):
  ```
  $owner = addr(<watcher>) AND arkiv.schema = str('bound.record.v1')
  AND (kind = str('frontend') OR kind = str('status') OR kind = str('drift') OR kind = str('incident'))
  ORDER BY $key ASC
  ```
  - Page size 4, with total byte and time budgets.
  - Bounded retry when the block number changes between pages.
  - Filter by site and chain after decoding.
  - Validate the owner, expiry, `validateRecord`, and duplicates.
- **UI:** a banner labelled "**Extension-reported**" (your evidence) alongside "**Live from Arkiv**" (community) and how fresh it is. Differences between the two are flagged. "Leave" and "Go back anyway" buttons. No `localStorage` cache in this iteration.

## 6. Work items, in order, with gates

1. **Semantics and tests first.**
   - `packages/policy-core/frontend.mjs`: `assessFrontend({observed, record, k, maturityMs, now, drift, incident, counterpartyRisk, frame})` → `{comparison, coverage, conflicts, unfamiliar, corroborated, reasons}`, plus `frontendObservationCandidates` with the §3.3 gate.
   - **Gate:** truth-table tests for §2.1–2.3: partial coverage, a weak competing hash, a legitimate redeploy, stale data, every corroboration source, iframe requests.
2. **Make the demo detectable.** `demo/hijack-server`:
   - a cacheable stable-path `/app.js` in both modes, with attack bytes differing;
   - a benign wallet request in clean mode so reports can be generated;
   - a seeding script that posts K benign reports to the local watcher.
   - **Gate:** the real collector yields different hashes for clean and attack at the same path.
3. **Contracts and the reporting path.**
   - `contracts/index.js`: the intake variant, the `frontend` record and the bundle allowlist.
   - `observation-queue.mjs`: validation, preserving fields, namespaced deduplication, 24 h window, migration of queues already stored.
   - `watcher-adapter.mjs`: convert.
   - Batching capped by serialized size (under 60 KB).
   - **Gate:** mixed batches survive retry and restart without loss or double counting; existing address reporting is unchanged.
4. **Watcher aggregation and publication.**
   - `services/watcher/frontend.js`: a durable journal with per-reporter receipt timestamps, quarantine, K plus maturity promotion, global caps (sites, tuples, reporters, bytes) and pruning.
   - `local-intake.mjs`: route frontend events; schedule hourly serialized publication and pruning.
   - `integrations/arkiv`: `writeFrontend` via upsert, plus the renewal allowlist.
   - **Gate:** read-back of the aggregate from Rabdi; journals from the old version still open.
5. **Reader and decision context.**
   - `arkiv-reader.mjs`: retain `frontend` and `incident`, and map them with metadata.
   - `decision-context.mjs`: expose frontend, incident and corroborated-drift data even when the snapshot path returns early.
   - Also: **bundle-first site status** (`readPreconnectionSiteStatus` uses the 5-minute cached bundle before the full anonymous-RPC query), which addresses the per-navigation load concern.
   - **Gate:** foreign-owner, expired, ambiguous or stale records never trigger a redirect.
6. **Warning-only integration.**
   - `sw.js`: evidence collection in both paths, `assessFrontend`, `details.frontendIntegrity`, the `requireTypedConfirmation` flag, the reporting gate.
   - `warning.js`: integrity rows and coverage.
   - **Gate:** a conflict raises severity; unavailable evidence leaves the flow unchanged; no observations after a conflict.
7. **Tickets and confirmation.** Ticket store and state machine (§4.1), `confirm.html/.mjs`, CSP in the manifest, `build.mjs` copies.
   - **Gate:** tests for restart, replay, concurrent retry, wrong tab/frame/chain/sender, expiry, unrelated navigation.
8. **Cancel, redirect and the bundled safe page.**
   - Changes to `relay.js` and `hook.js` (acknowledgement, safe-page message);
   - redirect sequence and navigation failure fallback;
   - `apps/safe-page`, packaged build;
   - `settings.mjs` and `options.mjs`: `safePageUrl`, which must be HTTPS or localhost, and changes the exact origin used by §4.3.
   - **Gate:** the cancellation reaches the hook; the wallet is never called before the retry; exactly one authorized retry reaches the typed-confirmation warning.
9. **Swarm publication** (needs a Bee light node, an immutable batch, xBZZ and xDAI). `scripts/swarm/publish-safe-page.mjs` publishes one immutable release and prints the URL; then set `safePageUrl`.
   - **Gate:** both the Swarm path and the fallback work; a crafted fragment or message cannot approve a ticket or choose the return URL.
10. **End-to-end demo and failure matrix (Playwright):**
    - clean flow;
    - corroborated conflict → redirect → confirm → retry;
    - uncorroborated conflict → warning only;
    - Arkiv down;
    - service-worker restart during confirmation;
    - attempted replay of a ticket.
    - **Gate:** no regressions in interception, digest binding, typed confirmation, observation privacy or address-policy severity.

## 7. Cut or deferred
- Swarm feeds, feed manifest and ENS contenthash: publish one immutable release.
- `localStorage` caching on the safe page.
- Automatic redirect for requests from an iframe (they get a warning instead).
- Coverage of CDN, cross-origin, module and worker scripts, and hashing of executed bytes.
- Score arithmetic changes in `evaluate` (integrity affects routing, severity and display only).
- ENS release manifest (`bound.frontend.v1`).

## 8. Review log
- **Round 1 (GPT-6.1 Sol, high effort, read-only).** All 19 findings were adopted, with one exception:
  - **Sol suggested seeded-only baselines for the demo.** v2 instead keeps automatic promotion (K reporter keys plus maturity M) and adds seeding. Seeding is for demo reliability; automatic promotion is what makes the community cache real.
