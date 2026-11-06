> Design review produced by GPT-6.1 Sol (Codex CLI, read-only sandbox, reasoning high) on 2026-11-06. Input to `Docs/request-decision-ux.md`; that document records which recommendations were adopted or changed.

# BOUND: user-controlled warning and firewall design

**Replace score-based cancellation with tiered user consent.** An intact request must remain continuable regardless of its score. Lower scores increase the warning’s prominence and confirmation requirements.

When BOUND cannot safely identify or forward the request—because its document disappeared, its bytes do not match, or provider state is unreadable—the firewall must explain the failure and offer recovery. It must not pretend that confirming an obsolete request can execute it safely.

This was a read-only review. No files were changed, builds or tests run, or commits created.

## 1. Proposed tiers and configuration

### Default routing

| Surface | Connection score | Transaction/signature score | Behavior |
|---|---:|---:|---|
| Silent pass | 80–100 | 70–100 | Forward after integrity and state checks. Record a local check. |
| Normal warning | 40–79 | 40–69 | Existing warning window; explicit Continue or Cancel. |
| Huge warning | 16–39 | 16–39 | Prominent, expanded warning window; consequences and failed checks visible immediately. |
| Firewall page | 0–15 | 0–15 | Extension-owned browser tab; explicit risk acknowledgement and typed confirmation. |
| No numeric score | See below | Grey/unsupported | Never invent a percentage. Require a huge warning, or firewall where a severity rule requires it. |

The connection bands retain the current pass threshold of 80. Transaction bands retain the current 70/40/16 boundaries defined in [score-config.mjs:1](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/score-config.mjs:1).

**Required routing rules beyond numeric thresholds:**

| Condition | Minimum surface | Can the user continue? |
|---|---|---|
| Fresh, authenticated active incident | Firewall | Yes, if request integrity is intact. |
| Fresh watcher-reported drift | Firewall; distinguish reported drift from corroborated drift | Yes. |
| No transaction baseline or unsupported method | Huge warning, labelled “No score” | Yes, if the exact request was frozen successfully. |
| Safely frozen request with malformed/truncated calldata | Huge warning; preserve decoder cap | Yes; wallet may subsequently reject it. |
| `eth_sign`, zero-chain authorization, or another existing zero-score classification | Firewall | Yes, with typed confirmation. |
| Bypass-possible coverage | At least huge warning; never silent pass or green reassurance | Yes for the mediated request; disclose uncovered paths. |
| Unreadable provider state, payload mismatch, obsolete document | Firewall recovery state | Retry/resend; no execution of the invalid request. |

Connection “hard blockers” currently combine policy concerns and integrity concerns in one array: unsupported origin, unreadable wallet state, active incident, and drift ([connection-score.mjs:22](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/connection-score.mjs:22)). Split these into:

- `riskSignals`: affect warning severity, never deny consent.
- `integrityFailures`: prevent dispatch of this particular request and require recovery.

A valid, authenticated HTTP origin is a transport-risk warning if interception exists there. An opaque or unidentifiable requesting origin is an integrity problem. Do not conflate them. Public HTTP currently falls outside the content-script match patterns in [manifest.json:18](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/manifest.json:18); expanding coverage is a separate scope decision.

### Configuration contract

Keep existing variables compatible and add the missing connection boundaries:

| Environment variable | Default | Meaning |
|---|---:|---|
| `BOUND_CONNECTION_THRESHOLD` | 80 | Silent-pass lower bound |
| `BOUND_CONNECTION_HUGE_WARNING_THRESHOLD` | 40 | Normal-warning lower bound; lower scores receive huge warning |
| `BOUND_CONNECTION_FIREWALL_THRESHOLD` | 16 | Huge-warning lower bound; lower scores receive firewall |
| Existing `BOUND_CONNECTION_WEIGHT_*` | 10/25/20/10/25/10 | Preserve current connection arithmetic |
| `BOUND_TX_GREEN_THRESHOLD` | 70 | Silent-pass lower bound |
| `BOUND_TX_AMBER_THRESHOLD` | 40 | Normal-warning lower bound |
| `BOUND_TX_RED_THRESHOLD` | 16 | Huge-warning lower bound; lower scores receive firewall |

Recommended generated shape:

```js
{
  version: 2,
  connectionThreshold: 80,
  connection: { pass: 80, huge: 40, firewall: 16 },
  weights: { origin: 10, snapshot: 25, domain: 20, arkiv: 10, watcher: 25, wallet: 10 },
  transaction: { green: 70, amber: 40, red: 16 }
}
```

Implementation requirements:

1. Validate integer thresholds with `0 < firewall < huge < pass <= 100`.
2. Keep connection weights totaling 100.
3. Preserve transaction guardrails: green ≥66, amber ≥40. Raise the minimum red boundary to 16 so a cap of 15 cannot lose its strongest treatment through configuration.
4. Mandatory severity rules—incident, drift, unsupported coverage—cannot be configured into silent pass.
5. Export settings through `score-settings.mjs`; generate the same validated object in the build. This already happens at [build.mjs:10](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/build.mjs:10).
6. Update `.env.example` comments to describe warning routing rather than permission to connect. Existing variables are at [.env.example:33](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/.env.example:33).

The UI must receive the effective thresholds from the worker; it must not hardcode them.

### ENS connection regression

For the supplied `app.ens.domains` scenario:

```text
10 + 25 + 20 + 10 + 0 + 10 = 75
```

The result becomes **normal warning → user chooses → original connection reaches MetaMask**, provided document and provider state remain valid. No allowlist exception or threshold reduction is necessary.

## 2. Audit of current cancellation paths

Classes below:

- **I — User-decidable:** policy risk or operational admission must become a visible choice.
- **II — Integrity/transport failure:** this request cannot currently be dispatched safely; explain and recover.
- **III — User cancellation or expiry:** terminate explicitly with an accurate reason.

### Service worker

References in this table are to [apps/extension/sw.js](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/sw.js:1).

| Current location | Current trigger | Class | Required treatment |
|---|---|---|---|
| `sw.js:81` | Any uncaught `handleRequest` exception becomes cancellation | II, unless only optional evidence failed | Separate evidence failures from integrity/transport exceptions. Evidence failure produces an unavailable check and a warning. Other failures produce a recovery explanation with a stable reason code. |
| `sw.js:68–70` | Settings change invalidates every pending request | II | Mark reviews “Settings changed”; reevaluate a fresh request. Never apply approval from the previous configuration. |
| `sw.js:104–109` | Provider state event cancels matching frame/document requests | II | Explain chain/account/disconnect change. Offer return and resend; no silent continuation against changed state. |
| `sw.js:132–147`, `385–387` | Source tab loads/navigates or closes | II | Invalidate old document binding. Firewall becomes a terminal explanation. Return only to the existing source tab, never silently recreate it. |
| `sw.js:150–152` | Warning window closes | III if deliberate; II if browser teardown | Treat ordinary review closure as dismissal. Record `review_closed`, not “low score blocked.” |
| `sw.js:161–167` | Eight requests in ten seconds, or global pending size ≥128 | I; bounded-resource fallback is II | Replace generic rejection with bounded scheduling and an extension-owned busy/queue view. Allow selecting a request to review. If no capacity exists to retain it, explain `capacity_exceeded` and offer resend. |
| `sw.js:169–176` | Request cloning/serialization/size failure | II | Cannot approve bytes that were never captured safely. Show recovery diagnostics; require a new bounded, plain-data request. |
| `sw.js:178–184` | Provider-state serialization failure or size >8192 | II | Explain unreadable state and retry state acquisition. |
| `sw.js:186–190` | Request or state digest mismatch | II | Reject this envelope as mismatched. Never allow “Continue anyway” to authorize different bytes. Offer a new request. |
| `sw.js:204–207` | Invalid revision/document or invalid provider state during connection preparation | II | Return a precise recovery reason, rather than generic unknown connection status. |
| `sw.js:213–217` | Revision/document changed after history write | II | Same recovery behavior; history is not proof that dispatch remains valid. |
| **`sw.js:202–217`** | **Connection score below threshold or policy blocker** | **I** | **Route through normal/huge/firewall review. Remove score-driven `cancel`.** |
| `sw.js:234` | Transaction preparation becomes stale | II | Explain and require fresh preparation. |
| `sw.js:264` | Stale request or full global pending map after history write | II for staleness; I/II for capacity | Separate these conditions and reasons. Reserve capacity before expensive evaluation. |
| `sw.js:266` | 45-second pending timer | III | Visible expiry, adequate review time, explicit extension option; never label it user rejection. |
| **`sw.js:281`** | **`locked` forces `cancel` regardless of resolved choice** | **II** | **Expose a recovery state from the outset. Never show an actionable Continue that will be overridden.** |
| `sw.js:319–350` | Malformed-report path creates a non-forwardable warning after the hook already rejected input | II | Represent it as a diagnostic, not a live approval. Its rate/pending guard at `324` currently drops even that diagnostic; retain bounded local recovery information. |
| `sw.js:346` | Diagnostic warning expires | III | Close/expire diagnostic state; no request exists to resume. |
| `sw.js:353–362` | Warning-window creation fails | II | Try an extension tab. If that also fails, retain a recoverable entry accessible from the action popup; disclose eventual expiry. |
| `sw.js:368–370`, `372` | Wrong UI identity, replay, expired entry, or missing confirmation | II: rejected decision message | Keep the genuine review pending. Reject forged/replayed decisions without creating attacker-triggered dialogs. Missing phrase returns a validation error. |
| `sw.js:373–375` | Any action other than `"continue"` becomes cancellation | III only for explicit `"cancel"` | Validate an exact action enum. Unknown actions must return an error, not silently cancel. |

Two distinctions matter:

- `MAX_PENDING_PER_FRAME` currently limits **request timestamps**, not the number of pending reviews; ordinary reads consume the quota before the read-only branch at `sw.js:220`.
- Observation failures at `sw.js:299–316` and frontend-evidence failure at `285–296` do **not** cancel wallet requests. Preserve that behavior; do not turn optional reporting or hashes into new gates.

### MAIN-world hook

References are to [apps/extension/hook.js](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/hook.js:1).

| Current location | Current trigger | Class | Required treatment |
|---|---|---|---|
| `hook.js:88–93`, `112–116` | Provider revision changes during preparation | II | Explain stale state and resend. |
| `hook.js:94–101`, `195–199`, `210–215`, `238–242` | Clone/size failure across request, send, sendAsync | II | Keep the `-32602` invalid-input result. Open a bounded diagnostic when the bridge is available; never invoke accessors to manufacture forwardable input. |
| `hook.js:104–109`, `320–323` | Bridge unavailable after initialization timeout | II | Record/report coverage failure where possible. Explain that reconnect/reload is required; no fabricated extension approval. |
| `hook.js:111–127` | Digest promise failure propagates rejection | II | Add explicit hashing/serialization diagnostics and cleanup. No automatic forwarding when the binding could not be created. |
| `hook.js:119–124` | 50-second outer timeout | III | Replace with synchronized request-lifetime handling; expiry must update the worker/UI too. |
| `hook.js:167–191` | State reads time out, reject, or return invalid data | II, indirectly | Distinguish unreadable state from a valid empty account list. Empty accounts before connection are valid. Offer unlock/retry instructions only when supported by the actual failure. |
| `hook.js:277–282` | Wrong source/channel/digest/state digest is ignored | II: rejected bridge message | Preserve rejection of forged messages. A genuine request may later expire; do not show a firewall for every forged event. |
| `hook.js:285–289` | Provider revision changed while review open | II | Explain invalidation. |
| `hook.js:294–298` | Continue received but original state/read path absent | II | Recovery, not an apparently successful approval. |
| `hook.js:299–308` | Final state read fails or differs | II | Return a specific stale/unreadable-state result. Recheck provider revision **after** the asynchronous reread too. |
| `hook.js:310–316` | Worker cancellation becomes a 4001 rejection, including score blocks | I or III/II according to reason | Remove “BOUND blocked the connection” policy messages. Distinguish user choice, expiry, and invalidation. |
| `hook.js:292`, `305–308`; legacy adapters at `163–165`, `220–225`, `242` | Captured wallet method rejects | Wallet-owned outcome | Preserve the wallet’s error. Do not report it as a BOUND policy block or automatically retry a possibly executed request. |

Patch failures at `hook.js:201–262` report bypass rather than cancelling. They remain a coverage limitation, not a path that the firewall can repair.

### Isolated relay

References are to [apps/extension/relay.js](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/relay.js:1).

| Current location | Current trigger | Class | Required treatment |
|---|---|---|---|
| `relay.js:6` | Wrong message source/origin ignored | II: rejected message | Preserve. No dialog for unauthenticated input. |
| `relay.js:18` | Invalid request ID/digest silently dropped | II | For a correlatable genuine request, return a bounded protocol-error diagnostic. Otherwise ignore; eventual expiry remains explicit. |
| `relay.js:19–21` | Serialization failure/oversize silently dropped | II | Explain invalid envelope without forwarding it or echoing sensitive payloads. |
| `relay.js:32` | Missing/unrecognized worker response is coerced to cancellation | II | Validate a versioned response schema; return `bridge_protocol_error`, not implicit user rejection. |
| `relay.js:33–34` | Runtime messaging rejection becomes cancellation | II | Report extension unavailable/restarted and offer resend. |
| `relay.js:13–15`, `36–39` | Malformed/state/coverage messages fail to reach worker; failure swallowed | II, indirect | Preserve bounded local diagnostics and expiry. These paths cannot manufacture a valid consent decision. |

**Error contract:** use explicit `reasonCode` and `retryable` fields. Reserve “User rejected the request” for actual user cancellation. Keep 4001 for user Cancel/dismissal; retain `-32602` for invalid input. Choose and document a consistent operational-error mapping for timeout, restart, and capacity rather than mislabelling them as user choices.

## 3. One decision model and one request lifecycle

### Shared decision object

Add an extension-owned `decision-model.mjs` that combines evaluator output, provenance, routing, and execution eligibility:

```text
request identity:
  id, protocolVersion, workerInstanceId
  source tab/frame/document, providerId
  topOrigin, frameOrigin, method
  requestDigest, stateDigest, providerRevision

assessment:
  modelVersion, configVersion, assessmentVersion
  score: number | null, scoreKind
  policyVerdict, effectiveTier, tierReasons
  checks[], caps[], evidence[]
  incidentStatus, driftStatus, coverage
  evaluatedAt, evidenceExpiresAt, evidenceFingerprint

execution:
  canForward, integrityFailures[]
  lifecycleState, expiresAt
  uiTabId, uiDocumentId, uiSurface
```

`scoreConnection()` should return an assessment, not an `allowed` authorization. Replace the overloaded `allowed` field with `eligibleForSilentPass`; authorization comes from either silent-pass routing or an explicit user decision.

Both UIs and history render this object. Neither recalculates scores.

### State machine

```text
received → preparing → queued/reviewing → validating → dispatching → dispatched
                    ↘ expired / user_cancelled / invalidated / failed
```

Requirements:

1. Reserve admission capacity immediately.
2. Freeze/hash the request once and retain the captured original wallet method.
3. Capture browser-derived source identity and provider state.
4. Score and select the effective tier.
5. Silent pass or await an authenticated UI choice.
6. Before dispatch, recheck document, revisions, state, evidence freshness, and assessment version.
7. Forward the same frozen request exactly once.
8. Acknowledge dispatch separately from wallet success.

If evidence changes materially during review, replace the assessment, reset acknowledgement, and require review of the new version. A confirmation of version 3 cannot authorize version 4.

The current final state check exists at `hook.js:299–305`; retain it for silent-pass transactions and connections as well as warnings.

**Mutation distinction:** changing the dApp’s original object after cloning does not necessarily invalidate anything—the frozen clone is the request. A mismatch between the scored clone and proposed dispatch envelope does invalidate it.

## 4. MV3 firewall mechanics

### Use an extension tab

Use:

```text
chrome-extension://<id>/firewall.html?request=<opaque-id>
```

Create it adjacent to the source tab, active, in the same window. Do not navigate the dApp away.

| Surface | Recommended use |
|---|---|
| Current popup window | Normal and huge warnings; expand dimensions/content for huge warnings |
| Extension tab | Firewall, complete calculation, evidence, recovery states |
| Toolbar popup | Pending-review entry point and recovery when creating a surface failed |

The existing warning opens a 440×600 popup at [sw.js:353](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/sw.js:353). A tab provides enough space for the requested calculation and leaves the pending dApp document alive.

### Replace the held `sendResponse`

Currently the relay awaits one worker response while the worker holds an in-memory promise. The worker allows 45 seconds **after preparation**, while the hook’s 50 seconds includes much of preparation. Context reads can each consume 20 seconds ([decision-context.mjs:8](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/decision-context.mjs:8)). The timers therefore do not describe one consistent lifetime.

Use a versioned protocol:

- Submission returns an acknowledgement promptly.
- A document-bound relay port carries progress and the final decision.
- The hook retains the frozen request and wallet continuation.
- `chrome.storage.session` retains bounded lifecycle metadata and terminal explanations, with access restricted to trusted extension contexts.
- Worker restart invalidates old pending execution authority; it does not reconstruct wallet-call closures or replay approval.

This avoids depending on a single long-running message handler. Chrome documents worker termination, loss of global variables, and that merely opening a port does not keep the worker alive. Design recovery explicitly; do not rely on an artificial keepalive. [Chrome service-worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)

### Proposed timing defaults

Keep these operational values separate from score settings.

| Stage | Default |
|---|---|
| Submission acknowledgement | 5 seconds |
| Preparation | 45 seconds maximum; optional evidence becomes unavailable when its budget expires |
| Queue wait | 2 minutes, visibly displayed |
| User review | 5 minutes from review readiness |
| Extension | One explicit additional 5 minutes; revalidate evidence |
| Final dispatch authorization | Short-lived, e.g. 5 seconds; then revalidate |

Synchronize hook, worker, and UI using authoritative expiry timestamps. Use alarms for cleanup and compare timestamps on every decision; do not depend on a worker timer firing precisely. The hook also enforces expiry.

When the request expires, the firewall remains as an explanation with **Return to site and resend**. Extending review must never extend stale evidence automatically.

### Return, closure, navigation, and restart

| Event | Required behavior |
|---|---|
| Continue succeeds | Focus the original tab/window, then dispatch. Close review after dispatch acknowledgement. Wallet approval still follows. |
| Cancel | Resolve once as user cancellation; return to original tab. |
| Firewall tab closes | Treat as review dismissal; resolve once. |
| Firewall tab navigates away | Invalidate that UI binding; never accept its old decision. |
| Source top document navigates/closes | Invalidate request; retain recovery explanation. |
| Requesting iframe navigates/disappears | Invalidate only affected requests, even if top page remains. |
| Chain/accounts/disconnect changes | Invalidate old assessment; require fresh state and review. |
| Worker restarts or extension reloads | Mark prior pending requests invalid; require resend. |
| Dispatch outcome is uncertain | Say so. Never auto-resend a transaction or signature request. |

Add frame-navigation listeners. Current code checks frame document identity during preparation at [sw.js:476](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/sw.js:476), but tab-level invalidation alone is insufficient while an iframe review remains open.

### Concurrent requests

- Serialize interactive reviews per source tab; queue additional requests with separate identities and assessments.
- Keep per-frame, per-tab, and global limits, but distinguish RPC throughput from interactive pending requests.
- Do not open one foreground tab per polling request.
- For repeated account-disclosure polling, show one outstanding review and a count of waiting calls; do not treat one approval as an unlimited batch grant.
- Let the user select which queued request to review; show method and requesting frame.
- Under actual capacity exhaustion, stop retaining new request bodies, explain the limit, and offer resend after capacity is available. “Never block” cannot require unbounded memory.

### Frame identity

Connections already score top and requesting origins separately and use the minimum ([sw.js:195](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/sw.js:195), [connection-score.mjs:29](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/connection-score.mjs:29)).

Preserve that and extend transaction assessment to both applicable scopes. Currently transaction context is built only from `sender.tab.url` at `sw.js:230`.

Show both scopes and the governing result. Do not let top-page trust supply missing iframe trust. For `about:blank`/opaque frames, derive identity from browser metadata where possible; never accept a page-supplied origin. Unresolvable identity requires recovery.

### Anti-clickjacking and anti-auto-confirm

1. Package the firewall as a privileged extension page, outside the Anon-RPC sandbox.
2. Keep warning/firewall resources absent from `web_accessible_resources`; Chrome makes extension resources private by default. [Chrome resource-access documentation](https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources)
3. Use packaged scripts, safe text rendering, and an extension-page CSP including `frame-ancestors 'none'` and `object-src 'none'`. Check the policy against all existing extension contexts before applying it globally. The current explicit CSP only configures sandbox pages at `manifest.json:13`.
4. Accept UI messages only from the exact extension ID, allowed page, frame 0, bound UI tab/document, request ID, assessment version, and live one-time request.
5. Bind to tab/document identity, not merely window ID. Current validation uses the warning window at `sw.js:365–375`.
6. No default-focused Continue. Initial focus goes to the heading or Cancel.
7. No Enter-to-continue from the typed input. Require a separate deliberate button activation.
8. Firewall Continue requires exact `I UNDERSTAND`, enforced in the worker. Retain the existing worker-side phrase check at `sw.js:372`.
9. Reset confirmation on assessment changes; prevent double submission.
10. The dApp cannot supply confirmation text or a decision via `postMessage`. A UI request ID is a lookup key, not authorization.

Typed confirmation is preferable to hold-to-confirm initially because it already exists and supports keyboard users. It reduces accidental approval; it cannot prevent a user being socially engineered.

## 5. Firewall content and score explanation

### Required visible content

| Area | Content |
|---|---|
| Heading | “Review before connecting” or “Review this wallet request” |
| Identity | Full top-level origin and requesting-frame origin, including port; distinguish cross-origin frames |
| Request | Method, chain name/ID when verified, permission scope, decoded action |
| Risk summary | Concrete detected concern or explicit missing evidence |
| Score | Final heuristic score, governing scope, effective tier |
| Explanation | Per-check calculation, caps, severity overrides |
| Freshness | Evaluated time, cache/live source, expiry |
| Evidence | ENS root details, snapshot entity, watcher status/drift/incident entity keys |
| Actions | Cancel; Continue despite warning; recovery actions where dispatch is invalid |
| Limits | Continuing proceeds to the wallet; BOUND does not guarantee safety or universal interception |

For `wallet_requestPermissions`, inspect and show the requested capabilities. Do not silently pass arbitrary permissions merely because the method appears in the connection-method list.

### Honest “confidence %”

Recommended wording:

> **Policy confidence score: 75% — 75 out of 100 heuristic points.**  
> This reflects BOUND’s configured checks. It is not a measured probability that the site or request is safe.

For transactions, add:

> This score starts at 100 and is limited by trust and decoding caps.

For grey:

> **Policy confidence: unavailable.** BOUND could not calculate a score because no usable baseline is available.

Do not show grey as 0%, “75% safe,” or “25% chance of fraud.” Also show evidence completeness separately, for example **5 of 6 connection checks available**; completeness is not safety.

### Connection calculation example

For the supplied missing-normal-status case:

| Check | Weight | Outcome | Points | Running total | Silent-pass threshold | Caps/overrides |
|---|---:|---|---:|---:|---:|---|
| Supported origin | 10 | Passed | +10 | 10 | 80 | None |
| Current verified snapshot | 25 | Passed | +25 | 35 | 80 | None |
| Exact domain and port | 20 | Passed | +20 | 55 | 80 | None |
| Arkiv lookup | 10 | Passed | +10 | 65 | 80 | None |
| Current normal watcher status | 25 | Unavailable | 0 | 65 | 80 | Missing evidence |
| Provider state | 10 | Passed | +10 | 75 | 80 | None |

Explain the real formula: passed adds weight, failed subtracts weight, unavailable adds zero; clamp the final sum to 0–100. This is implemented at [connection-score.mjs:15](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/connection-score.mjs:15).

Keep raw running totals until the final clamp; early row-by-row clamping would change the calculation.

For multiple scopes, show a table for each and:

> Connection score = minimum(top-page score, requesting-frame score).

An active incident can produce a numeric score of 50 yet require firewall. Show both facts explicitly: **“Score 50; firewall required because an active incident is reported.”**

### Transaction calculation

Transactions currently start at 100 and apply minima; they are not an additive weighted model ([policy-core/index.mjs:16](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/packages/policy-core/index.mjs:16)).

Use the same table layout, with **“Cap rule”** in place of a fabricated weight:

| Check | Weight / cap rule | Outcome | Applied points | Running score | Relevant boundary | Why |
|---|---|---|---:|---:|---|---|
| Starting score | Base 100 | Available | +100 | 100 | Green ≥70 | Evaluator starting value |
| Called token contract trusted | No cap | Passed | 0 | 100 | Green ≥70 | Authenticated source and matching role |
| Untrusted spender, seeded site | Cap 35 | Failed | −65 | 35 | Huge warning <40 | Address not authorized for rights role |
| Decoder | Cap 100 | Passed | 0 | 35 | Firewall <16 | No stricter decoder cap |

With corroborated drift, the rights row applies **cap 15 directly**, producing firewall. Display each candidate cap, whether it changed the running score, and the final governing cap. Preserve strictest-item behavior for batches.

### Missing evidence versus detected concerns

| Category | Example | Suitable wording |
|---|---|---|
| Missing evidence | No current normal status | “Current watcher status is unavailable.” |
| Missing evidence | Snapshot/Anon-RPC timeout | “This check did not complete; it contributed no trust.” |
| Detected concern | Authenticated active status | “The configured watcher reports an active incident.” |
| Detected concern | Corroborated drift | “Authenticated evidence reports a corroborated infrastructure change.” |
| Detected concern | Unlimited approval to untrusted spender | “This request grants unlimited spending authority to an address outside this site’s trusted policy.” |
| Coverage limitation | Unpatchable provider path | “Some wallet paths may bypass BOUND.” |

“Untrusted” must not be presented as “proven malicious.”

### Decoder and provenance additions

The decoder currently preserves token/spender pairs but omits approval amount and unlimited status ([decoder/index.mjs:137](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/packages/decoder/index.mjs:137)). Add bounded metadata for approval amount, approval type, unlimited/all-assets scope, and relevant expiration. Use decimal strings/BigInt; do not infer token decimals.

Evidence must survive the adapter pipeline:

- Trust engine already returns ENS root, epoch, digest, Arkiv key/owner, cache status, and verification time at [trust-engine.mjs:55](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/trust-engine.mjs:55).
- Decision context reduces preconnection evidence to booleans at `decision-context.mjs:164–165`.
- Arkiv reader obtains entity keys but drops them in mapped records at [arkiv-reader.mjs:39](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/arkiv-reader.mjs:39).

Carry read-only provenance alongside scored facts. Show ENS chain/name/resolver/text key, root value, snapshot digest/epoch, Arkiv entity keys, authenticated owner, and expiry.

The current implementation uses **`bound.root.v2` and Arkiv**, not the older Swarm snapshot path: [trust-engine.mjs:15](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/trust-engine.mjs:15), [Docs/no-swarm-architecture.md:3](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/Docs/no-swarm-architecture.md:3).

Provide copyable identifiers and validated links. If no verified explorer URL exists, provide an extension-owned evidence viewer rather than inventing one. External links open with `noopener noreferrer`, only after user action; do not preload remote evidence assets.

## 6. Remembered decisions and privacy

**Do not ship a permanent “accept all risk for this site” switch.** Start with one-request consent.

A later convenience option can say:

> Reduce repeated connection warnings for this tab for 15 minutes.

Recommended limits:

| Dimension | Scope |
|---|---|
| Request family | Connection/account disclosure only |
| Eligible severity | Normal warnings caused by unchanged missing evidence |
| Site | Exact scheme/host/port |
| Frame | Exact top-origin/requesting-origin pair |
| Browser context | Current tab and document session |
| Wallet | Same extension-assigned provider identity and chain |
| Permissions | Same bounded permission capability; never broader permissions |
| Expiry | At most 15 minutes and no later than applicable authenticated evidence expiry |
| Storage | `chrome.storage.session`, trusted contexts only |
| Revocation | Visible management/clear action in options and popup |

Always rerun integrity and fresh-status checks. Invalidate on:

- Incident or drift appearing, changing, clearing, or becoming stale.
- Evidence or snapshot-root change.
- Policy/configuration version change.
- Provider, chain, account revision, frame document, or top document change.
- Extension restart/reload and browser-session termination.

No remembered consent for huge/firewall warnings, transactions, signatures, unknown methods, or unreadable state. Do not treat a prior choice as trust or raise the score.

Privacy requirements follow [Docs/plan.md:24](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/Docs/plan.md:24) and [Docs/plan.md:86](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/Docs/plan.md:86):

- Never publish user choices, remembered grants, wallet accounts, request digests, amounts, transaction hashes, or browsing history.
- Store only bounded local metadata; never use sync storage for these grants.
- Keep public warned reports independent of Continue/Cancel.
- Do not generate a new public incident signal solely because a connection scored poorly from missing evidence.
- Preserve existing red-warning reporting and positive-observation restrictions. Overrides must not improve a counterparty’s trust.
- Provide clear-history controls; the existing local history retains 50 entries at `sw.js:483–498`.

## 7. Consistency with policy-core and existing UI

### Preserve the cap rules

Keep the actual evaluator’s semantics:

| Current condition | Cap |
|---|---:|
| Unverified address hit | 65 |
| Verified deployer lineage without stronger trust | 65 |
| Seeded-site untrusted rights address | 35 |
| Same with corroborated drift | 15 |
| Seeded-site untrusted destination/called/token | 65 |
| Uncurated witnessed address | 65 |
| Uncurated unwitnessed address | 35, or 15 with drift |
| Decoder restrictions | Strictest applicable decoder cap |
| No baseline | Null score/grey |

These are implemented at [policy-core/index.mjs:27](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/packages/policy-core/index.mjs:27) through line 58. Add an execution trace to that computation; do not reproduce it independently in the UI.

### Fix incident handling before enabling silent transaction pass

This is a release-critical dependency:

- `evaluate()` does not consume `incidentStatus`.
- Transaction context is built for the top page only.
- Context suppresses drift and incident status when baseline is absent at `decision-context.mjs:141–153`.
- An existing integration test explicitly expects a trusted request during an active incident to remain green at [sw-fake-integration.test.mjs:266](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/sw-fake-integration.test.mjs:266).

Preserve authenticated incident/drift facts independently of baseline availability. Apply a shared firewall severity rule to both request families. A numeric counterparty score may remain 100, but the effective decision must visibly say **firewall: active incident**; it must not present an overall green/silent result.

### Prevent UI disagreement

- `warning.html` and `firewall.html` share a renderer, wording helpers, confirmation component, and assessment schema.
- Popup/history use the recorded assessment version, thresholds, trace, and effective tier.
- Distinguish “assessment,” “user chose Continue,” and “wallet request dispatched.”
- Do not store “connection allowed/blocked” before dispatch. That currently happens at `sw.js:212`.
- Replace the misleading unconditional “no baseline” wording for every null score in [warning.js:21](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/apps/extension/warning.js:21) with the actual null-score reason.
- Retain approval-pair and revocation guidance.
- Both layouts enforce the same confirmation policy in the worker.
- Keep notification/badge status fresh and labelled separately from a historical request assessment.

## 8. Files, tests, rollout, and documentation

### Implementation file map

| Files | Planned change |
|---|---|
| `apps/extension/score-config.mjs`, `score-settings.mjs`, `.env.example` | New connection bands, validated settings version, cap-compatible boundaries |
| `apps/extension/connection-score.mjs` | Assessment/trace output; split risk from integrity; remove score-driven denial |
| `packages/policy-core/index.mjs` | Cap trace and structured reasons; preserve scoring semantics |
| `packages/decoder/index.mjs` | Approval amount/scope metadata and permission details |
| `apps/extension/decision-context.mjs` | Provenance; independent incident/drift facts; top/frame scope support |
| `apps/extension/trust-engine.mjs`, `arkiv-reader.mjs`, `trust-adapter.mjs` | Preserve authenticated evidence identifiers and freshness |
| `apps/extension/sw.js` | Common routing, lifecycle, UI authentication, revalidation, queues, structured outcomes |
| `apps/extension/hook.js`, `relay.js` | Versioned asynchronous protocol, synchronized expiry, exact dispatch, recovery diagnostics |
| `apps/extension/warning.html`, `warning.js` | Shared rendering and huge-warning layout |
| **New:** `apps/extension/firewall.html`, `firewall.mjs` | Firewall tab and recovery states |
| **New:** `apps/extension/decision-model.mjs` | Shared assessment/routing contract |
| **New:** `apps/extension/request-lifecycle.mjs` | Admission, state transitions, expiry, once-only resolution |
| **New:** `apps/extension/decision-view.mjs`, shared CSS | Shared UI content and calculation rendering |
| **New:** `apps/extension/evidence.html`, `evidence.mjs` | Local evidence viewer for identifiers without reliable external links |
| `apps/extension/popup.js`, `popup.html`, options files | Pending reviews, consistent history, clear controls; later grant management |
| `apps/extension/manifest.json`, `build.mjs` | Package new files, explicit UI security policy, preserve sandbox separation |
| `package.json` | Explicit extension-unit and Playwright scripts/dependency |

### Unit and integration tests

| Area | Required cases |
|---|---|
| Configuration | Every exact boundary and adjacent value; ordering; malformed values; weights sum; cap guardrails; generated/source defaults agree |
| Connection routing | 100 pass; 75 normal warning; 39 huge; 15 firewall; zero remains continuable |
| Risk overrides | Active/drift at score 50 or higher still firewall; no-baseline incident retained |
| Scope | Trusted top/unverified frame; distinct ports; frame replacement; opaque origin recovery |
| Policy caps | Existing role/source matrix unchanged; trace recomputes the exact final score; batch strictest cap |
| Malformed distinctions | Safely frozen bad calldata can continue; accessors/cycles/oversize cannot authorize uncaptured input |
| Consent | Both choices at every tier; phrase enforced server-side; duplicate/replayed/wrong-version decisions rejected |
| UI identity | Wrong extension/page/tab/document/frame/request rejected; unknown action rejected without cancelling valid review |
| State | Empty account list valid; unreadable state recovery; state changes during final reread; changed-and-restored revision rejected |
| Lifetime | Preparation and review clocks; explicit extension; queue expiry; restart; source/review closure/navigation |
| Admission | RPC polling does not consume interactive quota; bounded queues; overflow visible; no tab flood |
| Dispatch | Exact frozen bytes, once only; stale token rejected; wallet errors preserved; uncertain dispatch never automatically resent |
| Privacy | No choices/grants/digests/private addresses in public payloads; missing-evidence connection warning does not create incident reports |
| Presentation | Popup, warning, firewall share score/tier/reasons; grey does not become zero; unavailable differs from failed |

Update existing `connection-score.test.mjs` and `score-config.test.mjs`: they currently assert incident blocking and missing-evidence denial. Update `sw.test.mjs` and `sw-fake-integration.test.mjs` to assert user choice and structured invalidation.

Add focused hook/relay tests using the actual scripts in isolated VM contexts, including MAIN-world message forgery and poisoned built-ins.

### Playwright outline

Use Playwright’s bundled Chromium with a persistent context and the built unpacked MV3 extension, following its [extension-testing guidance](https://playwright.dev/docs/chrome-extensions). Use fake providers and authenticated fixture evidence; do not expose a production “set score” message.

1. **Connection regression:** fixture for the supplied 75-point ENS case; assert warning, complete calculation, Continue dispatches once, Cancel never reaches provider.
2. **Firewall:** 0/15-point connection and `eth_sign`; Continue disabled until typed phrase; Enter alone does not dispatch.
3. **Transaction caps:** untrusted unlimited spender gives 35; corroborated drift gives 15; both remain user-continuable.
4. **Incident precedence:** otherwise-trusted request plus incident opens firewall; no overall green state.
5. **Iframe:** trusted top with unknown child; verify both identities and governing scope; navigate child during review and reject stale approval.
6. **Timers:** hold review past the old 50 seconds; verify it remains live under the new contract, then test explicit expiry and extension.
7. **Worker lifecycle:** terminate/restart worker during review; recovery page appears, no old approval forwards.
8. **Concurrency:** two providers and multiple frames; verify independent requests, queue behavior, no duplicate dispatch or popup flood.
9. **UI failure:** popup creation failure falls back to tab; tab failure leaves a visible pending/recovery entry.
10. **Anti-forgery:** page attempts embedding, scripted decisions, forged channel messages, replay, and UI-tab substitution.
11. **Content/privacy:** exact trace matches worker output; canary choices/accounts/amounts absent from reporting.
12. **Manual real-wallet acceptance:** MetaMask and other supported providers, all three request APIs, locked/unlocked states, and cross-origin frames. Fixture success does not establish real-wallet compatibility.

### Phased rollout

| Phase | Deliverable | Exit condition |
|---|---|---|
| 1 | Shared assessment, routing, reason codes, trace, configuration | Cap matrix unchanged; all cancellation branches classified |
| 2 | Lifecycle/protocol and authenticated dual UI | Expiry, restart, navigation, replay, and once-only dispatch pass |
| 3 | Connection override, including incident/drift firewall | All five connection/account methods exercise Continue and Cancel; 75-point regression fixed |
| 4 | Transaction/signature routing and green silent pass | Incident/frame gaps fixed; cap/grey/malformed tests and e2e pass |
| 5 | Optional short-lived connection-warning preference | Privacy, invalidation, and grant-management tests pass |

Enable and test the new protocol as one unit; do not deploy a firewall tab while retaining the old hook timeout. Rollback should retain explicit warning/choice for intact requests rather than restore silent score rejection.

### Documentation updates

- **`Docs/connection-scoring.md`:** replace “missing evidence blocks,” hard-blocker language, and 75/50-point block examples at [line 18](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/Docs/connection-scoring.md:18); document tiers, overrides, integrity failures, calculations, and configuration.
- **`Docs/plan.md`:** update lifecycle/timeout/restart contracts while preserving privacy and immutable-byte requirements; document new transaction presentation.
- **`Docs/BOUND_Final_Architecture.md`:** reconcile the old tier table at [line 593](/Users/shantanavmukherjee/Desktop/code/hack-projects/BOUND/Docs/BOUND_Final_Architecture.md:593), grey forwarding, amber notes, and “decisions never cached.”
- **`Docs/no-swarm-architecture.md`:** revise “fail closed” wording at line 36 to distinguish unavailable trust from inability to dispatch.
- **`Docs/wallet-connection-audit.md`:** retain as historical findings; add a dated remediation/status section superseding the old block-on-unavailable recommendation.
- **`Docs/dev1-test-guide.md`, `apps/extension/PHASE0.md`, `README.md`:** new build/test commands, request surfaces, recovery, and manual wallet checks.
- Add **`Docs/request-decision-ux.md`** as the normative tier, lifecycle, wording, and consent contract.

## 9. Risks and owner decisions

| Issue | Recommended decision / remaining question |
|---|---|
| Meaning of “never block” | Adopt: every intact risk-assessed request remains continuable; invalid requests receive an explanation and fresh retry path. Absolute execution cannot be promised after document loss or uncaptured input. |
| Grey/no baseline | Recommend huge warning with explicit choice. This changes the architecture’s older “grey forwarded” behavior and needs a documented product decision. |
| Drift severity | Recommend firewall for fresh watcher-reported drift, with corroboration labelled accurately. Owner may prefer huge warning for uncorroborated drift; it must remain user-decidable. |
| Repeated account polling | Use bounded pending reviews and later narrow session preferences. Avoid both continuous popup storms and permanent site bypass. |
| Connection bootstrap | Keep valid empty accounts acceptable. If particular wallets cannot expose chain/account state before connecting, decide whether to design a separately reviewed connection-only bootstrap mode; do not silently relax transaction integrity. |
| Wallet gesture requirements | Returning focus may not preserve a wallet-required user gesture. Test real providers and offer an explicit dApp retry when necessary. |
| Approval fatigue | Missing evidence should explain the missing check; reserve incident language for authenticated concerns. Measure repeated warnings locally or through explicitly approved privacy-safe aggregate research. |
| Remembered risk | Ship one-request consent first. Confirm whether the later narrow 15-minute connection preference is wanted. |
| Dispatch uncertainty | Never automatically replay; especially important for signatures and transactions. |
| Interception coverage | Immutable providers and retained original methods remain outside reliable mediation. Firewall delivery does not establish universal wallet coverage. |
| Score interpretation | Use heuristic-score wording. No calibrated safety percentages without a separately validated model. |
| Evidence outages | Degrade evidence to unavailable and increase warning as specified; never manufacture trust, quietly reuse expired evidence, or hide the user’s choice. |

**Primary acceptance criterion:** an intact request scoring 75, 35, 15, or 0 can reach the captured wallet method after the required user confirmation. A cancelled, expired, mismatched, or obsolete request cannot reach it, and the user receives a specific explanation and recovery action.