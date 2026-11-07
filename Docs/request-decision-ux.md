# Plan: never block — tiered warnings and a firewall page

**Status:** proposal, 2026-11-06. Not implemented.

**Owner rule:** BOUND never blocks a wallet request because of a low score. Lower scores get louder warnings. The lowest scores get a full "firewall" page that shows a confidence percentage and the full score calculation. The user always makes the final choice.

**Sources:**
- An audit of every cancel path and tiered user warning design.
- My own audit. The claims below marked ✔ were re-checked against the code.

## 1. What changes today's behaviour

| Today | Where | After |
|---|---|---|
| A connection score below 80 is cancelled silently ("Connection cancelled"), with no window and no override | `sw.js:202–217`, `connection-score.mjs` `allowed`, hook message "BOUND blocked the connection" `hook.js:310–316` | Routed to a warning, a huge warning or the firewall; the user decides |
| Unreadable wallet state ("locked") forces cancel even if the user pressed Continue ✔ | `sw.js:281` | Firewall in recovery mode with an explanation and "resend"; never a fake Continue |
| Active incident is ignored by the transaction scorer; a test expects a trusted request during an incident to show **green** ✔ | `policy-core/index.mjs` (no `incidentStatus`), `sw-fake-integration.test.mjs:266` | An incident always routes to the firewall for both connections and transactions |
| Time limits are 45 s in the service worker and 50 s in the hook ✔, too short to read a calculation | `sw.js:22`, `hook.js:119–124` | One shared request lifetime: 5 min review plus one explicit 5 min extension |
| Queue full, rate limit or a thrown error → silent cancel | `sw.js:81`, `161–167`, `264` | A visible explanation with a reason code and resend |

## 2. What "never block" means precisely

| Case | Behaviour |
|---|---|
| **Risk:** low score, missing evidence, untrusted spender, drift, incident, `eth_sign` | Always continuable after the confirmation its tier requires |
| **Integrity failure:** the request bytes don't match what was scored, the page or frame that sent it navigated away, wallet state is unreadable, or the extension restarted mid-review | This request cannot be forwarded safely, because forwarding different or orphaned bytes would be the real danger. The firewall page explains exactly what happened and offers **Return to site and resend**. Nothing is silently dropped |
| **User:** Cancel, closing the review, or letting it expire | Rejected with an accurate message. "User rejected" is used only for an actual Cancel; expiry says it expired |

The acceptance criterion, adopted from the review: an intact request scoring 75, 35, 15 or 0 reaches the wallet after the required confirmation. A cancelled, expired, mismatched or obsolete request never reaches the wallet, and the user gets a specific reason and a way to recover.

## 3. Tiers

| Tier | Connection score | Transaction score | Surface | Confirmation |
|---|---|---|---|---|
| Pass | 80–100 | 70–100 (green) | None; recorded locally | — |
| Warning | 40–79 | 40–69 (amber) | Existing warning window | Continue / Cancel |
| **Huge warning** | 16–39 | 16–39 (red) | Larger warning window; failed checks expanded; red header | Continue / Cancel. Continue is not focused by default |
| **Firewall** | 0–15 | 0–15 (escalated) | Full extension tab (§4) | Type `I UNDERSTAND`, checked in the service worker, then press Continue |

**Severity overrides** apply whatever the number is, and are never configurable into "pass":

| Condition | Minimum tier |
|---|---|
| Authenticated active incident | Firewall |
| Corroborated infrastructure drift | Firewall |
| Uncorroborated drift | Huge warning |
| `eth_sign`, chainId-0 delegation, or anything already scored 0 | Firewall |
| Unsupported method / no transaction baseline (grey) | Warning, labelled "No score" (see deviation D1) |
| Bypass possible on this page | At least a warning; never a silent pass |
| Integrity failure | Firewall in recovery mode (no Continue) |

**Configuration** (build-time, `score-config.mjs` → `dist/score-settings.mjs`, from `.env`):

- `BOUND_CONNECTION_THRESHOLD` = 80 is the pass boundary.
- New: `BOUND_CONNECTION_HUGE_WARNING_THRESHOLD` = 40, and `BOUND_CONNECTION_FIREWALL_THRESHOLD` = 16.
- Existing `BOUND_TX_*` = 70/40/16 are reused as pass/warning/huge boundaries.
- Validation: `0 < firewall < huge < pass ≤ 100`. The transaction red boundary must be at least 16, so the 15 cap always lands on the firewall.
- The UI receives the effective thresholds from the worker and never hardcodes them.

## 4. Firewall page

### Mechanics (Chrome MV3)

- **Separate extension tab**, `firewall.html?request=<opaque id>`, opened active and next to the dApp tab. The dApp tab must stay alive: navigating it away would destroy the page holding the wallet request. After a decision, focus returns to the dApp tab, then the request is forwarded.
- **One request lifetime, shared by hook, worker and UI:**
  - The worker acknowledges the request immediately.
  - Progress and the final decision travel over a port bound to the page document.
  - Expiry timestamps are authoritative.
  - If the service worker restarts, old pending requests become invalid and must be re-sent. Approvals are never replayed.
  - Never rely on keep-alive tricks.
- **Concurrency:**
  - One review at a time per tab; later requests queue and show a count.
  - Repeated account polling folds into one review.
  - No tab floods.
  - When capacity is genuinely exhausted, the user sees an explicit "too many requests — resend" instead of a silent drop.
- **iframes:** show both the top page and the requesting frame. The lowest score governs, which is already true for connections; the plan extends it to transactions, which today use only `sender.tab.url` (`sw.js:230`). If the frame navigates, its pending request is invalidated.
- **Anti-clickjacking and anti-auto-confirm:**
  - Not listed in `web_accessible_resources`.
  - Extension-page CSP with `frame-ancestors 'none'`.
  - Decisions are accepted only from this exact extension page, tab, document and request version.
  - No default focus on Continue, and Enter in the phrase box does not submit.
  - The phrase is checked in the worker.
  - If the assessment changes during review, the confirmation resets.

### Content

1. **Header.** Red for detected danger; amber-red for missing evidence. The two are worded differently:
   - Missing evidence: "Current watcher status is unavailable."
   - Detected danger: "The watcher reports an active incident," or "This grants unlimited spending to an address outside this site's trusted list."
   - "Untrusted" is never shown as "malicious."
2. **Who and what:** top-level site and requesting frame (with ports), method, chain, and the decoded action, including approval amount and whether it is unlimited. The decoder does not expose the amount yet; this plan adds it.
3. **Confidence**, worded honestly:

   > **Policy confidence: 35% (35 of 100 heuristic points).** This comes from BOUND's configured checks. It is not a measured probability that the site is safe.

   - It is shown next to **evidence completeness**, for example "5 of 6 checks available."
   - "No score" is never shown as 0%.
4. **Full calculation table** rendered from the worker's trace, never recomputed in the UI:
   - **Connection:** check · weight · outcome (passed/failed/unavailable) · points · running total · threshold. Formula: passed = +weight, failed = −weight, unavailable = 0, clamped to 0–100. With two origins: `score = min(top page, requesting frame)`.
   - **Transaction:** start 100 · each candidate cap (role, address, source, cap value, whether it lowered the score) · decoder cap · drift adjustment (35 → 15) · final score.
   - **Override line:** for example, "Score 50; firewall required because an active incident is reported."
5. **Evidence**, all copyable:
   - ENS name, resolver and record key, plus root epoch and digest
   - Arkiv snapshot entity key
   - Watcher status and drift entity keys, their owner and expiry
   - Freshness of each item (live or cached, and age)
   - Links open only on click.
6. **Actions:** Cancel (left, focused) and, only after the typed phrase, **Continue anyway**. For integrity failures: **Return to site and resend**.
7. **Limits line:** "Continuing sends the request to your wallet. BOUND cannot guarantee safety and cannot see wallet paths that bypass it."

## 5. Remembered choices

- **v1: none.** Every request is a fresh decision.
- **Later, optional:** "Don't warn again for this tab for 15 minutes." This applies only to connection warnings caused by unchanged missing evidence, on the exact origin pair, wallet and chain. It is stored in `chrome.storage.session` and invalidated by any incident, drift, evidence, configuration, chain, account or document change.
- Never remembered: huge warnings, firewall, transactions, signatures.
- **Privacy** (plan.md §1): choices, grants and request details stay local. A user's Continue never improves a counterparty's trust and is never published. A low connection score from missing evidence does not create a public warned report.

## 6. My changes to the GPT-6.1 Sol review

| # | Sol recommended | Decision | Why |
|---|---|---|---|
| D1 | Grey / no baseline → **huge warning** | **Normal warning, labelled "No score"** | Most uncurated sites have no baseline. A red screen on every unknown dApp trains users to click through, so the loud tiers lose meaning. Detected danger stays loud |
| D2 | Keep connection check "domain not in snapshot" as **failed (−20)** | **Unavailable (0)** | Not being on a curated list is missing evidence, not evidence of harm. Today any uncurated HTTPS site scores 35 (huge warning); with this change it scores 55 (warning). A domain that *is* in the snapshot but on the wrong chain or port still fails |
| D3 | Uncorroborated drift → firewall | **Huge warning** (corroborated drift stays firewall) | Matches `Docs/watcher-real-sites-plan.md`: CDN noise must not produce the strongest screen |
| — | Everything else (cancel-path audit, request lifecycle, tab-based firewall, anti-clickjacking, trace-driven UI, incident fix, no remembered consent in v1) | **Adopted** | — |

## 7. Work plan

| Phase | Deliverable | Gate |
|---|---|---|
| P1 | `decision-model.mjs`: one assessment object (score, tier, overrides, per-check trace, caps, evidence, `canForward`, reason codes). `connection-score.mjs` returns an assessment instead of `allowed`. Policy-core emits a cap trace with unchanged results. Thresholds in config | Existing cap matrix unchanged; every cancel branch mapped to a reason code |
| P2 | `request-lifecycle.mjs`: acknowledgement and port protocol in hook/relay/worker, shared expiry, once-only forwarding, restart invalidation | Request survives past 50 s; expiry, restart, navigation and replay tests pass |
| P3 | `firewall.html/.mjs` plus a shared renderer with `warning.html`; huge-warning layout; incident/drift overrides | `app.ens.domains` at 75 → warning → Continue → MetaMask opens. A 15 or 0 request → firewall → phrase → wallet |
| P4 | Transaction routing: incident applied to transactions, frame-scope scoring, approval amount in decoder, grey → "No score" warning | Incident test flips from green to firewall; cap/grey/malformed tests pass |
| P5 | Docs: `connection-scoring.md` (remove "missing evidence blocks"), Final Architecture §9.4 table, `no-swarm-architecture.md` "fail closed" wording | Docs match behaviour |
| P6 (optional) | 15-minute tab-scoped connection preference | Invalidation and privacy tests |

**Files:**
- **New:** `decision-model.mjs`, `request-lifecycle.mjs`, `firewall.html`, `firewall.mjs`, `decision-view.mjs`
- **Changed:** `sw.js`, `hook.js`, `relay.js`, `connection-score.mjs`, `score-config.mjs`, `policy-core/index.mjs`, `decoder/index.mjs`, `decision-context.mjs`, `warning.html/js`, `popup.*`, `manifest.json`, `build.mjs`, `.env.example`

**Tests:**
- Unit tests for every tier boundary and override.
- Integrity-failure recovery.
- Worker-checked phrase.
- Forged, replayed and wrong-version decisions rejected without cancelling a genuine review.
- Exact bytes forwarded only once.
- Popup, warning and firewall all render the same trace.

**Playwright:** extend the existing verifier with these scenarios:
- 75 → warning → forwards
- 15 / `eth_sign` → firewall phrase gating, with Enter not submitting
- Incident → firewall
- A review held for more than 60 s still forwards
- Worker restarted mid-review → resend screen
- Iframe navigation invalidates

Real MetaMask remains a manual check.

## 8. Decisions needed from you

1. Accept D1–D3, or follow Sol on any of them?
2. Tier boundaries as proposed: connection 80/40/16, transactions 70/40/16?
3. Firewall confirmation: typed `I UNDERSTAND` (proposed), or hold-to-confirm?
4. Ship P6 (15-minute "don't warn again"), or never remember choices?
5. Should a wallet that cannot report its chain before connecting get a separate, reviewed "connection-only" path? This is an open question from the review; some wallets return nothing until connected.
