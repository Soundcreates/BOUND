# Plan: watcher monitoring of the five real seeded sites

**Status:** proposal, 2026-11-06. Not implemented.

**Problem.** The connection gate needs a current `normal` watcher status (25 of 100 points). The watcher has never monitored a real site. The only `normal` statuses on Arkiv belong to `127.0.0.1:8000/8001` and `localhost:8000/8001`. Those were written by `scripts/integration/seed-demo-arkiv.mjs` as fixtures; they are not monitoring results. So `app.ens.domains`, `app.uniswap.org`, `app.aave.com`, `app.compound.finance` and `opensea.io` cap at 75 and are blocked.

## 1. What the live probe showed (2026-11-06)

Each site was polled twice, three seconds apart, with the watcher's own `pollSite` (DoH NS/A, direct TLS, Team Cymru ASN). No drift was seen between the polls.

| Site | NS zone / nameservers | A records → ASN | Certificate issuer |
|---|---|---|---|
| app.ens.domains | ens.domains · Cloudflare (`ben`, `desiree`) | 104.18.20.234, .21.234 → 13335 (Cloudflare) | Google Trust Services, CN WE1 |
| app.uniswap.org | uniswap.org · Cloudflare (`damian`, `gemma`) | 4 × 108.159.28.x → 16509 (Amazon CloudFront) | Amazon, CN Amazon RSA 2048 M01 |
| app.aave.com | aave.com · Cloudflare (`art`, `elaine`) | 104.18.20.145, .21.145 → 13335 | Google Trust Services, CN WE1 |
| app.compound.finance | compound.finance · Cloudflare (`brit`, `tim`) | 104.26.6.118, .7.118, 172.67.69.79 → 13335 | Let's Encrypt, CN YE2 |
| opensea.io | opensea.io · Cloudflare (`arch`, `nicole`) | 104.18.33.97, 172.64.154.159 → 13335 | Let's Encrypt, CN YE2 |

## 2. Why the current drift logic cannot run against these sites

These rules are fine for the controlled demo domain, but on CDN-fronted production sites they would produce false drift that **blocks connections**:

| Current rule (`server/watcher/drift.js`) | What real sites do | Result today |
|---|---|---|
| Any A-record change is a change | CloudFront and Cloudflare rotate IPs constantly and answer differently per resolver | Uncorroborated change → status `drift` → connection blocked |
| Any certificate fingerprint change is a change | Every renewal (about 60–90 days) changes it | Uncorroborated change → status `drift` |
| Issuer compared as the full string, CN included | The intermediate CN rotates (`WE1`, `WR1`, `YE2`, `R10`, `E5`…). Cloudflare Universal SSL also switches between Let's Encrypt and Google Trust Services | **Corroborated** drift → connection blocked; one warning then opens an incident |
| Every change publishes status `drift` (`drift-publisher.js`), corroborated or not | — | The extension maps any `drift` status to the "Infrastructure drift" blocker |

**Second gap: freshness.** A `normal` status counts for as long as its Arkiv entity is unexpired, which can be days. If the watcher stops, every site keeps showing `normal`. A stopped monitor must show "unavailable", not "safe".

## 3. Design

### 3.1 Reference policy instead of an exact sample

`readBaseline(site, chainId)` returns a curated **infrastructure policy**, not one poll snapshot:

```json
{
  "site": "app.ens.domains",
  "zone": "ens.domains",
  "nameservers": ["ben.ns.cloudflare.com", "desiree.ns.cloudflare.com"],
  "asns": ["13335"],
  "issuerOrganizations": ["Google Trust Services", "Let's Encrypt", "SSL.com"],
  "requiredNames": ["app.ens.domains"],
  "reviewedAt": "2026-11-06T00:00:00Z",
  "reviewedBy": "curator"
}
```

- It is produced by a new `probe` command and **reviewed by a person**, never auto-accepted. The code already says polling must never promote current data to trust (`monitor.js`).
- Cloudflare-proxied sites get the Cloudflare Universal SSL CA set. Uniswap gets `["Amazon"]` and ASN `16509`.

### 3.2 Classifier v2, comparing a poll against the policy

| Check | Normal | Corroborated drift |
|---|---|---|
| Nameservers | Set equals the allowed set | Any NS outside the allowed set (registrar/DNS takeover signal) |
| A records | Every IP maps to an allowed ASN (IP rotation ignored) | Any IP in a known, disallowed ASN |
| Certificate | Issuer **organization** allowed and SAN covers the host. Fingerprint and intermediate CN changes are ignored | Issuer organization outside the set, or SAN no longer covers the host |
| Unknown ASN (lookup failed) | — | **Uncorroborated**: cannot prove a move |

Corroborated drift is published only after it shows on **two consecutive polls**. One flaky DNS answer must not block every user.

### 3.3 Status semantics

| Poll outcome | Published |
|---|---|
| All checks normal | `normal` status, refreshed hourly (hour-rounded `updatedAt`, as today) |
| Corroborated drift, two polls in a row | `drift` record with `corroborated: true`, and `drift` status |
| Uncorroborated change | `drift` evidence record with `corroborated: false` for audit. **No `drift` status, and no `normal` refresh**, so after the freshness window the site reads "unavailable" rather than "drift" |
| Poll failure | Nothing new; the status goes stale and reads "unavailable" |

**Extension, as a second layer of defence:**

- The connection blocker fires only when a `drift` status has a matching corroborated drift record. This is the same rule `arkiv-reader.mjs` already applies to transaction decisions.
- A `normal` status older than **2 h** (configurable) counts as unavailable, whatever its Arkiv expiry.

### 3.4 Configuration (`~/.bound/watcher-deployment.json`, outside the repo)

| Field | Change |
|---|---|
| `zones` | Add the five site → zone pairs from §1 (the controlled demo domain stays) |
| `watcher.feeds` | Add the five sites, chain `11155111`. `feedReference` must be a real 32-byte digest, e.g. `keccak256(["bound-feed-v1", site, chainId])`. **The current `"placeholder-feed-ref"` fails `validateRecord`, so no status write could ever succeed** |
| `baselines` → `infraPolicies` | **Today's entries are the wrong shape**: an observation baseline, not an infrastructure reference. Replace them with the reviewed policies from §3.1, and point `readBaseline` in `config-example.mjs` at them |
| `allowedOrigins` | Replace `REPLACE_WITH_YOUR_EXTENSION_ID` with the real extension ID |
| `intervals.poll` | 300 000 ms (5 min) for real sites. Status writes stay hourly per site (5 Arkiv transactions/hour) |
| `swarm` | Already removed from the watcher path (evidence is now an Arkiv entity); nothing needed |

### 3.5 Running it

```bash
BOUND_WATCHER_CONFIG=~/.bound/watcher-deployment.json ARKIV_PRIVATE_KEY=<env only, never pasted> \
  node server/watcher/run.mjs server/watcher/config-example.mjs
```

Run it under a supervisor (`launchd` or `pm2`) so it restarts. On a laptop that sleeps, statuses go stale within 2 h, and the extension then reports "unavailable". That is honest, and is why §3.3's freshness rule matters.

## 4. Work items

| # | Change | Files |
|---|---|---|
| W1 | `probe` CLI: polls a site N times over M minutes, prints a draft policy for review | `server/watcher/probe.mjs` (new) |
| W2 | Policy validation + classifier v2 + two-poll debounce | `server/watcher/drift.js`, `drift-state.js`, `monitor.js` |
| W3 | Publish a `drift` status only for corroborated drift | `drift-publisher.js`, `guarded-flows.js` |
| W4 | `readBaseline` returns policies; config validation | `config-example.mjs`, `deployment.js` |
| W5 | Extension: freshness window on `normal`; connection drift blocker needs corroborated evidence | `decision-context.mjs`, `arkiv-reader.mjs`, `connection-score.mjs` |
| W6 | Real config: feeds, zones, reviewed policies, digests, extension ID | `~/.bound/watcher-deployment.json` |
| W7 | Run the watcher and verify live | — |

## 5. Tests and acceptance

**Unit tests:**

- IP rotation inside an allowed ASN → normal.
- Let's Encrypt ↔ Google Trust Services switch on a Cloudflare site → normal.
- Intermediate CN change → normal.
- Fingerprint renewal → normal.
- NS change → corroborated after two polls, and not after one.
- IP in a foreign ASN → corroborated.
- SAN missing the host → corroborated.
- ASN lookup failure → uncorroborated, so no `drift` status and no `normal` refresh.
- Normal status older than 2 h → connection check "unavailable".

**Live acceptance:**

1. Start the watcher. Within one poll cycle, Arkiv shows five watcher-owned `normal` statuses. Check by querying Arkiv directly, not from screenshots.
2. In the extension popup, `app.ens.domains` scores **100**, and MetaMask connects.
3. Stop the watcher. After 2 h the same site shows "Current normal watcher status: unavailable" (75), not drift.
4. The drift drill stays on the controlled domain `bound-drift-hack-x.aura-fit.tech`. Real sites can only prove the normal path; we cannot hijack them.

## 6. Limits to state honestly

- **Single vantage point.** CDN answers vary by resolver location, and the watcher sees one view.
- **What the checks cannot see behind a CDN.** For Cloudflare- or CloudFront-proxied sites, an attacker who hijacks the DNS-provider account but keeps the CDN in front and changes only the origin server leaves NS, ASN and the certificate unchanged. That path, and compromised builds or scripts (A3/A4), is caught only by the K-warning incident path and the planned frontend-hash check (`Docs/frontend-integrity-plan.md`), not by the watcher.
- **The policies are curated judgement.** A legitimate migration (for example a new CDN) produces real corroborated drift until a curator updates the policy.
- **Localhost demo statuses remain seeded fixtures.** The watcher cannot TLS-poll plain-HTTP loopback. Label them as fixtures in the demo.
